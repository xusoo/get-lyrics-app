/**
 * Lyrics orchestration service.
 *
 * All LRCLIB network access funnels through a single {@link SerialQueue}, so at
 * most ONE request is ever in flight (see requirement: never hammer LRCLIB).
 *
 * - `loadLyrics` fetches a track's lyrics by signature. 'current' requests take
 *   priority over 'prefetch' requests and can preempt a running prefetch.
 * - Successful results are persisted to the localStorage cache; a cache hit
 *   avoids any network call.
 * - Requests are deduplicated by track id, so the picker opening while a fetch
 *   is in flight reuses that same request instead of making another.
 * - `cancelLyrics` aborts an in-flight request (used when the user skips before
 *   the current track's lyrics finish loading).
 */

import { fetchLyrics, searchCandidates } from './lrclib';
import type { LrclibCandidate } from './lrclib';
import { getFromStore, hasInStore, putToStore } from './lyrics-store';
import type { SpotifyTrack } from '../types';
import { SerialQueue } from './serial-queue';

export type FetchPriority = 'current' | 'prefetch';

const PRIORITY: Record<FetchPriority, number> = {
  current: 1,
  prefetch: 0,
};

export interface LyricsFetchResult {
  synced: string | null;
  plain: string | null;
  candidates: LrclibCandidate[];
  recommendedId: number | null;
  pickedId: number | null;
}

interface CandidateEntry {
  candidates: LrclibCandidate[];
  query: string;
  recommendedId: number | null;
  selectedId: number | null;
}

// Search results per track (localStorage only stores the resolved lyrics, so the
// candidate list for the manual picker lives here in memory).
export const candidateCache = new Map<string, CandidateEntry>();

const MAP_CAP = 2000;

/** Set a Map entry, evicting the oldest key when the cap is exceeded. */
export function rememberCandidates(trackId: string, entry: CandidateEntry): void {
  candidateCache.set(trackId, entry);
  if (candidateCache.size > MAP_CAP) {
    const oldest = candidateCache.keys().next().value;
    if (oldest !== undefined) candidateCache.delete(oldest);
  }
}

const queue = new SerialQueue();

function cacheResult(track: SpotifyTrack, result: LyricsFetchResult): void {
  // Preserve existing behaviour: only persist found lyrics, never "not-found".
  if (result.synced || result.plain) {
    putToStore(track.id, result.synced, result.plain, result.pickedId);
  }
  if (result.candidates.length) {
    const artistName = track.artists[0]?.name ?? '';
    rememberCandidates(track.id, {
      candidates: result.candidates,
      query: `${artistName} ${track.name}`,
      recommendedId: result.recommendedId,
      selectedId: result.pickedId,
    });
  }
}

/**
 * Fetch a track's lyrics via the serial queue. Deduplicated by track id.
 * The result is cached on success. Rejects with an AbortError if cancelled.
 */
export function loadLyrics(track: SpotifyTrack, priority: FetchPriority): Promise<LyricsFetchResult> {
  const run = async (signal: AbortSignal): Promise<LyricsFetchResult> => {
    const artistName = track.artists[0]?.name ?? '';
    const result = await fetchLyrics(track.name, artistName, track.album.name, track.duration_ms / 1000, signal);
    cacheResult(track, result);
    return result;
  };
  return queue.enqueue(track.id, PRIORITY[priority], run);
}

/**
 * Run a manual keyword search through the queue (kept serialized so it never
 * competes with an in-flight lyrics fetch). Deduplicated by track id + query.
 */
export function searchLyrics(track: SpotifyTrack, query: string): Promise<LrclibCandidate[]> {
  const durationSec = track.duration_ms != null ? track.duration_ms / 1000 : undefined;
  const run = (signal: AbortSignal): Promise<LrclibCandidate[]> => searchCandidates(query, durationSec, signal);
  return queue.enqueue(`search:${track.id}:${query}`, PRIORITY.current, run);
}

/** Cancel an in-flight/pending lyrics fetch for a track (e.g. on skip). */
export function cancelLyrics(trackId: string): void {
  queue.cancel(trackId);
}

/** Read a cached (parsed) lyrics entry without any network call. */
export function getCachedLyrics(trackId: string) {
  return getFromStore(trackId);
}

/** True when the track's lyrics are already in the persistent cache. */
export function isCached(trackId: string): boolean {
  return hasInStore(trackId);
}

// ── Test-only helpers ──────────────────────────────────────────────────────────
export function __resetLyricsServiceForTest(): void {
  queue.clear();
  candidateCache.clear();
}

export const __queueForTest = queue;
