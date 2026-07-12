import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SpotifyTrack } from '../types';

// ── Mock LRCLIB so no real network happens. The mock tracks concurrency and
//    exposes each pending call so tests can resolve/reject them deterministically.
interface PendingCall {
  key: string;
  signal?: AbortSignal;
  settled: boolean;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

const mockState = vi.hoisted(() => ({
  active: 0,
  maxActive: 0,
  calls: [] as PendingCall[],
}));

function register(key: string, signal: AbortSignal | undefined, resolve: (v: unknown) => void, reject: (e: unknown) => void): void {
  mockState.active += 1;
  mockState.maxActive = Math.max(mockState.maxActive, mockState.active);
  const call: PendingCall = {
    key,
    signal,
    settled: false,
    resolve: (value) => { if (call.settled) return; call.settled = true; mockState.active -= 1; resolve(value); },
    reject: (reason) => { if (call.settled) return; call.settled = true; mockState.active -= 1; reject(reason); },
  };
  if (signal) signal.addEventListener('abort', () => call.reject(new DOMException('Aborted', 'AbortError')));
  mockState.calls.push(call);
}

vi.mock('./lrclib', () => ({
  fetchLyrics: vi.fn((trackName: string, _artist: string, _album: string, _dur: number, signal?: AbortSignal) =>
    new Promise((resolve, reject) => register(trackName, signal, resolve, reject))),
  searchCandidates: vi.fn((query: string, _dur?: number, signal?: AbortSignal) =>
    new Promise((resolve, reject) => register(`search:${query}`, signal, resolve, reject))),
}));

import { fetchLyrics } from './lrclib';
import {
  loadLyrics,
  searchLyrics,
  cancelLyrics,
  isCached,
  getCachedLyrics,
  __resetLyricsServiceForTest,
} from './lyrics-service';
import { clearLyricsCache } from './lyrics-store';

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

function makeTrack(id: string, name = id): SpotifyTrack {
  return {
    id,
    name,
    duration_ms: 200_000,
    artists: [{ id: 'artist', name: 'Artist' }],
    album: { id: 'album', name: 'Album', images: [] },
  };
}

function pendingCall(key: string): PendingCall {
  const call = mockState.calls.find((c) => c.key === key && !c.settled);
  if (!call) throw new Error(`No pending call for "${key}"`);
  return call;
}

function resolveLyrics(key: string): void {
  pendingCall(key).resolve({
    synced: '[00:01.00] hello',
    plain: null,
    candidates: [{
      id: 1,
      trackName: key,
      artistName: 'Artist',
      albumName: 'Album',
      durationSec: 200,
      isSynced: true,
      syncedLyrics: '[00:01.00] hello',
      plainLyrics: null,
    }],
    recommendedId: 1,
    pickedId: 1,
  });
}

beforeEach(() => {
  mockState.active = 0;
  mockState.maxActive = 0;
  mockState.calls = [];
  clearLyricsCache();
  __resetLyricsServiceForTest();
  vi.clearAllMocks();
});

describe('lyrics-service', () => {
  it('fetches once and caches the result', async () => {
    const p = loadLyrics(makeTrack('A'), 'current');
    await flush();
    expect(fetchLyrics).toHaveBeenCalledTimes(1);

    resolveLyrics('A');
    await p;

    expect(isCached('A')).toBe(true);
    expect(getCachedLyrics('A')).not.toBeNull();
  });

  it('does not need a network call once cached', async () => {
    const p = loadLyrics(makeTrack('A'), 'current');
    await flush();
    resolveLyrics('A');
    await p;

    vi.clearAllMocks();
    expect(isCached('A')).toBe(true);
    expect(getCachedLyrics('A')).not.toBeNull();
    expect(fetchLyrics).not.toHaveBeenCalled();
  });

  it('runs the current fetch before the prefetch, never concurrently', async () => {
    const pCurrent = loadLyrics(makeTrack('A'), 'current');
    const pPrefetch = loadLyrics(makeTrack('B'), 'prefetch');
    await flush();

    // Only the current track is fetching.
    expect(fetchLyrics).toHaveBeenCalledTimes(1);
    expect(mockState.calls.filter((c) => !c.settled).map((c) => c.key)).toEqual(['A']);
    expect(mockState.maxActive).toBe(1);

    resolveLyrics('A');
    await pCurrent;
    await flush();

    // Now the prefetch runs — after the current one finished.
    expect(fetchLyrics).toHaveBeenCalledTimes(2);
    expect(mockState.calls.some((c) => c.key === 'B' && !c.settled)).toBe(true);
    expect(mockState.maxActive).toBe(1);

    resolveLyrics('B');
    await pPrefetch;
    expect(isCached('B')).toBe(true);
  });

  it('shares one in-flight request between concurrent callers', async () => {
    const p1 = loadLyrics(makeTrack('A'), 'current');
    const p2 = loadLyrics(makeTrack('A'), 'current');
    await flush();

    expect(fetchLyrics).toHaveBeenCalledTimes(1);

    resolveLyrics('A');
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(r2);
  });

  it('cancels the in-flight request on skip and fetches the new track', async () => {
    const pA = loadLyrics(makeTrack('A'), 'current');
    await flush();
    const callA = pendingCall('A');

    cancelLyrics('A');
    const pB = loadLyrics(makeTrack('B'), 'current');

    await expect(pA).rejects.toThrow();
    await flush();

    expect(callA.signal?.aborted).toBe(true);
    expect(mockState.calls.some((c) => c.key === 'B')).toBe(true);

    resolveLyrics('B');
    await pB;
    expect(isCached('B')).toBe(true);
    // The cancelled track was never cached.
    expect(isCached('A')).toBe(false);
  });

  it('serializes manual search with an in-flight load', async () => {
    const pLoad = loadLyrics(makeTrack('A'), 'current');
    const pSearch = searchLyrics(makeTrack('A'), 'custom query');
    await flush();

    // Search waits behind the running load.
    expect(mockState.calls.filter((c) => !c.settled).length).toBe(1);
    expect(mockState.maxActive).toBe(1);

    resolveLyrics('A');
    await pLoad;
    await flush();

    const searchCall = pendingCall('search:custom query');
    searchCall.resolve([]);
    await pSearch;
    expect(mockState.maxActive).toBe(1);
  });
});
