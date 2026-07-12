import { useCallback, useEffect, useRef, useState } from 'react';
import type { LrclibCandidate } from '../lib/lrclib';
import { parseLyricsResult } from '../lib/lrc-parser';
import { getFromStore, putToStore } from '../lib/lyrics-store';
import {
  loadLyrics,
  searchLyrics,
  cancelLyrics,
  getCandidates,
  rememberCandidates,
  type FetchPriority,
} from '../lib/lyrics-service';
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

// Candidate cache and in-flight dedup now live in ../lib/lyrics-service, which
// serializes all LRCLIB access through a single request queue.

const BLANK: LyricsState = {
  lines: [], plain: null, isSynced: false,
  status: 'idle', candidates: [], pickerQuery: '',
  isSearching: false, selectedId: null, recommendedId: null,
};

export function useLyrics(track: SpotifyTrack | null, role: FetchPriority | 'passive' = 'current') {
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

    // Cache hit (localStorage — loaded once into memory, so this is O(1)).
    // Render immediately with no network call.
    const persisted = getFromStore(track.id);
    if (persisted) {
        console.log(`💾 [LRCLIB] Cache hit  "${track.name}" by ${artistName}  (${role})`);
      const saved = getCandidates(track.id);
      setState({ ...BLANK, ...persisted, candidates: saved?.candidates ?? [], pickerQuery: saved?.query ?? defaultQuery, recommendedId: saved?.recommendedId ?? null, selectedId: saved?.selectedId ?? persisted.selectedId });
      return;
    }

    setState({ ...BLANK, status: 'loading' });

    // Passive slots (prev carousel slot) only show cached lyrics — they must
    // never trigger a LRCLIB fetch. If not in cache, stay idle until the song
    // becomes current and fetches normally.
    if (role === 'passive') return;

    const requestedTrackId = track.id;
    let cancelled = false;

    loadLyrics(track, role)
      .then((result) => {
        if (cancelled || trackRef.current?.id !== requestedTrackId) return;

        const { candidates, recommendedId, pickedId } = result;
        const resolved = (result.synced || result.plain)
          ? parseLyricsResult(result.synced, result.plain)
          : { lines: [] as LyricLine[], plain: null, isSynced: false, status: 'not-found' as const };

        if (resolved.status === 'found') {
          setState({
            ...BLANK, ...resolved,
            candidates, pickerQuery: defaultQuery,
            selectedId: pickedId, recommendedId,
          });
        } else {
          // Nothing found — show picker so the user can search manually.
          setState({ ...BLANK, status: 'picking', pickerQuery: defaultQuery });
        }
      })
      .catch((err) => {
        if (cancelled || trackRef.current?.id !== requestedTrackId) return;
        if (err instanceof Error && err.name === 'AbortError') return;
        const isTimeout = err instanceof Error && err.name === 'TimeoutError';
        setState({ ...BLANK, status: isTimeout ? 'picking' : 'error', pickerQuery: defaultQuery });
      });

    return () => {
      cancelled = true;
      // Only the active slot cancels its in-flight request when leaving the track.
      // Prefetch slots don't cancel here, but the serial queue may still preempt
      // (abort) a running prefetch when a 'current' request arrives — in that case
      // the cache simply isn't populated until the track later becomes current.
      if (role === 'current') cancelLyrics(requestedTrackId);
    };
  }, [track?.id, retryCount, role]); // eslint-disable-line react-hooks/exhaustive-deps

  const retry = useCallback(() => {
    setState((prev) => ({ ...prev, status: 'loading' }));
    setRetryCount((c) => c + 1);
  }, []);

  const openPicker = useCallback(() => {
    const t = trackRef.current;
    if (!t) return;
    const artistName = t.artists[0]?.name ?? '';
    const defaultQuery = `${artistName} ${t.name}`;
    const saved = getCandidates(t.id);
    if (saved) {
      setState((prev) => ({ ...prev, status: 'picking', candidates: saved.candidates, pickerQuery: saved.query, recommendedId: saved.recommendedId, selectedId: saved.selectedId ?? prev.selectedId }));
      return;
    }

    // No candidates cached yet — reuse the in-flight fetch (deduplicated by the
    // service), so opening the picker while lyrics load makes no extra call.
    setState((prev) => ({ ...prev, status: 'picking', candidates: [], pickerQuery: defaultQuery, isSearching: true, recommendedId: null }));
    const trackId = t.id;
    loadLyrics(t, 'current')
      .then((result) => {
        if (trackRef.current?.id !== trackId) return;
        const persistedSelectedId = getFromStore(trackId)?.selectedId ?? null;
        const resolvedSelectedId = persistedSelectedId ?? result.pickedId;
        setState((prev) => (prev.status === 'picking'
          ? { ...prev, candidates: result.candidates, recommendedId: result.recommendedId, selectedId: resolvedSelectedId, isSearching: false }
          : prev));
      })
      .catch(() => {
        if (trackRef.current?.id !== trackId) return;
        setState((prev) => ({ ...prev, isSearching: false }));
      });
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
      const cached = getCandidates(t.id);
      if (cached) rememberCandidates(t.id, { ...cached, selectedId: c.id });
    }
    setState((prev) => ({ ...prev, ...parsed, selectedId: c.id }));
  }, []);

  const searchWithQuery = useCallback((query: string) => {
    const t = trackRef.current;
    setState((prev) => ({ ...prev, pickerQuery: query, candidates: [], isSearching: true, recommendedId: null }));
    if (!t) return;
    searchLyrics(t, query)
      .then((candidates) => {
        if (trackRef.current?.id !== t.id) return;
        const cached = getCandidates(t.id);
        rememberCandidates(t.id, { candidates, query, recommendedId: null, selectedId: cached?.selectedId ?? null });
        setState((prev) => (prev.status === 'picking' ? { ...prev, candidates, isSearching: false } : prev));
      })
      .catch(() => {
        if (trackRef.current?.id !== t.id) return;
        setState((prev) => ({ ...prev, isSearching: false }));
      });
  }, []);

  return { ...state, openPicker, closePicker, selectCandidate, searchWithQuery, retry };
}

