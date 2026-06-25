import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchLyrics, searchCandidates } from '../lib/lrclib';
import type { LrclibCandidate } from '../lib/lrclib';
import { parseLyricsResult, type ParsedLyricsResult } from '../lib/lrc-parser';
import { getFromStore, hasInStore, putToStore } from '../lib/lyrics-store';
import type { LyricLine, SpotifyTrack } from '../types';

interface LyricsState {
  lines: LyricLine[];
  plain: string | null;
  isSynced: boolean;
  status: 'idle' | 'loading' | 'found' | 'not-found' | 'error' | 'picking';
  candidates: LrclibCandidate[];
  pickerQuery: string;
  isSearching: boolean;
  selectedId: number | null;
  recommendedId: number | null;
}

// Candidate cache: search results per track (so manual picker re-opens without re-fetching)
const candidateCache = new Map<string, { candidates: LrclibCandidate[]; query: string; recommendedId: number | null; selectedId: number | null }>();

const MAP_CAP = 2000;
function cappedSet<K, V>(map: Map<K, V>, key: K, value: V): void {
  map.set(key, value);
  if (map.size > MAP_CAP) {
    map.delete(map.keys().next().value as K);
  }
}

const BLANK: LyricsState = {
  lines: [], plain: null, isSynced: false,
  status: 'idle', candidates: [], pickerQuery: '',
  isSearching: false, selectedId: null, recommendedId: null,
};

// In-flight fetch dedup: prevents prefetchLyrics and useLyrics from racing
// on the same track. Both share the same promise when one is already in-flight.
type FetchResult = { synced: string | null; plain: string | null; candidates: LrclibCandidate[]; recommendedId: number | null; pickedId: number | null };
const inFlight = new Map<string, Promise<FetchResult>>();

// Persist the pre-selected lyrics from a fetch result and return parsed form.
// fetchLyrics already determined the best candidate; synced/plain reflect that choice.
function resolveAndCache(trackId: string, result: FetchResult): ParsedLyricsResult {
  const { synced, plain } = result;
  if (!synced && !plain) {
    return { lines: [], plain: null, isSynced: false, status: 'not-found' };
  }
  const parsed = parseLyricsResult(synced, plain);
  putToStore(trackId, synced, plain, result.pickedId);
  return parsed;
}

// Start (or join) a fetch for a track, deduplicating concurrent requests.
// The first caller's signal controls the underlying fetch. Later callers that
// join the existing promise do NOT wire their signal — aborting one caller
// must not kill a shared request that another caller is also awaiting.
function startFetch(track: SpotifyTrack, signal?: AbortSignal): Promise<FetchResult> {
  const existing = inFlight.get(track.id);
  if (existing) return existing;

  const artistName = track.artists[0]?.name ?? '';
  const promise = fetchLyrics(track.name, artistName, track.album.name, track.duration_ms / 1000, signal)
    .finally(() => { inFlight.delete(track.id); });
  inFlight.set(track.id, promise);
  return promise;
}

// Wait for any in-flight fetch for a specific track to settle (used by openPicker).
function waitForTrackFetch(trackId: string): Promise<void> {
  const existing = inFlight.get(trackId);
  if (!existing) return Promise.resolve();
  return existing.then(() => {}, () => {});
}

// Silently pre-populate the cache for an upcoming track without triggering renders.
// Waits for any ongoing fetches to finish first — guarantees we never fetch the
// current track and prefetch the next track simultaneously.
export async function prefetchLyrics(track: SpotifyTrack): Promise<void> {
  if (hasInStore(track.id)) return;

  // If useLyrics is fetching the current track, wait for it to complete before
  // starting the prefetch. This prevents concurrent fetches and avoids a stale-
  // status race in MainView where the prefetch effect fires before the 'loading'
  // state update has propagated.
  if (inFlight.size > 0) {
    await Promise.allSettled([...inFlight.values()]);
  }

  // Re-check after waiting — the track may have been cached while we waited
  if (hasInStore(track.id)) return;
  if (inFlight.has(track.id)) return;

  try {
    const result = await startFetch(track);
    const artistName = track.artists[0]?.name ?? '';
    const query = `${artistName} ${track.name}`;
    if (result.candidates.length) {
      cappedSet(candidateCache, track.id, { candidates: result.candidates, query, recommendedId: result.recommendedId, selectedId: result.pickedId });
    }
    resolveAndCache(track.id, result);
  } catch {
    // Silent — useLyrics will retry when the track becomes current
  }
}

export function useLyrics(track: SpotifyTrack | null) {
  const [state, setState] = useState<LyricsState>(BLANK);
  const trackRef = useRef(track);
  trackRef.current = track;
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (!track) {
      setState(BLANK);
      return;
    }

    const artistName = track.artists[0]?.name ?? '';
    const defaultQuery = `${artistName} ${track.name}`;

    // Cache hit (localStorage — loaded once into memory, so this is O(1))
    const persisted = getFromStore(track.id);
    if (persisted) {
      const saved = candidateCache.get(track.id);
      setState({ ...BLANK, ...persisted, candidates: saved?.candidates ?? [], pickerQuery: saved?.query ?? defaultQuery, recommendedId: saved?.recommendedId ?? null, selectedId: saved?.selectedId ?? persisted.selectedId });
      return;
    }

    setState({ ...BLANK, status: 'loading' });

    const requestedTrackId = track.id;
    const abortController = new AbortController();

    startFetch(track, abortController.signal)
      .then((result) => {
        if (trackRef.current?.id !== requestedTrackId) return;

        const { candidates, recommendedId, pickedId } = result;
        if (candidates.length) cappedSet(candidateCache, track.id, { candidates, query: defaultQuery, recommendedId, selectedId: pickedId });

        const resolved = resolveAndCache(track.id, result);

        if (resolved.status === 'found') {
          setState({
            ...BLANK, ...resolved,
            candidates, pickerQuery: defaultQuery,
            selectedId: pickedId, recommendedId,
          });
        } else {
          // Nothing found — show picker so user can search manually
          setState({ ...BLANK, status: 'picking', pickerQuery: defaultQuery });
        }
      })
      .catch((err) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        if (trackRef.current?.id !== requestedTrackId) return;
        const isTimeout = err instanceof Error && err.name === 'TimeoutError';
        setState({ ...BLANK, status: isTimeout ? 'picking' : 'error', pickerQuery: defaultQuery });
      });

    return () => abortController.abort();
  }, [track?.id, retryCount]); // eslint-disable-line react-hooks/exhaustive-deps

  const retry = useCallback(() => {
    setState((prev) => ({ ...prev, status: 'loading' }));
    setRetryCount((c) => c + 1);
  }, []);

  const openPicker = useCallback(() => {
    const t = trackRef.current;
    if (!t) return;
    const artistName = t.artists[0]?.name ?? '';
    const defaultQuery = `${artistName} ${t.name}`;
    const saved = candidateCache.get(t.id);
    if (saved) {
      setState((prev) => ({ ...prev, status: 'picking', candidates: saved.candidates, pickerQuery: saved.query, recommendedId: saved.recommendedId, selectedId: saved.selectedId ?? prev.selectedId }));
    } else {
      setState((prev) => ({ ...prev, status: 'picking', candidates: [], pickerQuery: defaultQuery, isSearching: true, recommendedId: null }));
      const trackId = t.id;
      const durationSec = t.duration_ms / 1000;
      // If a lyrics fetch is already in-flight for this track, wait for it — it may
      // populate candidateCache so we can reuse the results instead of firing a duplicate search.
      waitForTrackFetch(trackId).then(() => {
        const fresh = candidateCache.get(trackId);
        if (fresh) {
          setState((prev) => (prev.status === 'picking' ? { ...prev, candidates: fresh.candidates, pickerQuery: fresh.query, recommendedId: fresh.recommendedId, isSearching: false } : prev));
          return;
        }
        return fetchLyrics(t.name, t.artists[0]?.name ?? '', t.album.name, durationSec).then((fresh) => {
          // Prefer the user's persisted selection over the auto-picked best match.
          const persistedSelectedId = getFromStore(trackId)?.selectedId ?? null;
          const resolvedSelectedId = persistedSelectedId ?? fresh.pickedId;
          cappedSet(candidateCache, trackId, { candidates: fresh.candidates, query: defaultQuery, recommendedId: fresh.recommendedId, selectedId: resolvedSelectedId });
          setState((prev) => (prev.status === 'picking' ? { ...prev, candidates: fresh.candidates, recommendedId: fresh.recommendedId, selectedId: resolvedSelectedId, isSearching: false } : prev));
        });
      }).catch(() => {
        setState((prev) => ({ ...prev, isSearching: false }));
      });
    }
  }, []);

  const closePicker = useCallback(() => {
    setState((prev) => ({
      ...prev,
      status: prev.lines.length > 0 || prev.plain ? 'found' : 'not-found',
    }));
  }, []);

  const selectCandidate = useCallback((c: LrclibCandidate) => {
    const t = trackRef.current;
    const parsed = parseLyricsResult(c.syncedLyrics, c.plainLyrics);
    if (t) {
      putToStore(t.id, c.syncedLyrics, c.plainLyrics, c.id);
      const cached = candidateCache.get(t.id);
      if (cached) cappedSet(candidateCache, t.id, { ...cached, selectedId: c.id });
    }
    setState((prev) => ({ ...prev, ...parsed, selectedId: c.id }));
  }, []);

  const searchWithQuery = useCallback((query: string) => {
    const t = trackRef.current;
    setState((prev) => ({ ...prev, pickerQuery: query, candidates: [], isSearching: true, recommendedId: null }));
    searchCandidates(query, t?.duration_ms != null ? t.duration_ms / 1000 : undefined)
      .then((candidates) => {
        if (t) {
          const cached = candidateCache.get(t.id);
          cappedSet(candidateCache, t.id, { candidates, query, recommendedId: null, selectedId: cached?.selectedId ?? null });
        }
        setState((prev) => (prev.status === 'picking' ? { ...prev, candidates, isSearching: false } : prev));
      })
      .catch(() => {
        setState((prev) => ({ ...prev, isSearching: false }));
      });
  }, []);

  return { ...state, openPicker, closePicker, selectCandidate, searchWithQuery, retry };
}

