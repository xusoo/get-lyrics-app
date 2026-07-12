import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { SpotifyTrack } from '../types';

interface PendingCall {
  key: string;
  signal?: AbortSignal;
  settled: boolean;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

const mockState = vi.hoisted(() => ({
  calls: [] as PendingCall[],
}));

function register(key: string, signal: AbortSignal | undefined, resolve: (v: unknown) => void, reject: (e: unknown) => void): void {
  const call: PendingCall = {
    key,
    signal,
    settled: false,
    resolve: (value) => { if (call.settled) return; call.settled = true; resolve(value); },
    reject: (reason) => { if (call.settled) return; call.settled = true; reject(reason); },
  };
  if (signal) signal.addEventListener('abort', () => call.reject(new DOMException('Aborted', 'AbortError')));
  mockState.calls.push(call);
}

vi.mock('../lib/lrclib', () => ({
  fetchLyrics: vi.fn((trackName: string, _artist: string, _album: string, _dur: number, signal?: AbortSignal) =>
    new Promise((resolve, reject) => register(trackName, signal, resolve, reject))),
  searchCandidates: vi.fn((query: string, _dur?: number, signal?: AbortSignal) =>
    new Promise((resolve, reject) => register(`search:${query}`, signal, resolve, reject))),
}));

import { fetchLyrics } from '../lib/lrclib';
import { useLyrics } from './useLyrics';
import { putToStore, clearLyricsCache } from '../lib/lyrics-store';
import { __resetLyricsServiceForTest } from '../lib/lyrics-service';

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
    candidates: [],
    recommendedId: 1,
    pickedId: 1,
  });
}

beforeEach(() => {
  mockState.calls = [];
  clearLyricsCache();
  __resetLyricsServiceForTest();
  vi.clearAllMocks();
});

describe('useLyrics', () => {
  it('renders cached lyrics with no network call', async () => {
    putToStore('A', '[00:01.00] hello', null, 1);

    const { result } = renderHook(() => useLyrics(makeTrack('A'), 'current'));

    await waitFor(() => expect(result.current.status).toBe('found'));
    expect(fetchLyrics).not.toHaveBeenCalled();
  });

  it('searches on first load then shows found', async () => {
    const { result } = renderHook(() => useLyrics(makeTrack('A'), 'current'));

    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(fetchLyrics).toHaveBeenCalledTimes(1));

    await act(async () => {
      resolveLyrics('A');
    });

    await waitFor(() => expect(result.current.status).toBe('found'));
    expect(result.current.isSynced).toBe(true);
  });

  it('cancels the in-flight fetch when the track changes', async () => {
    const { result, rerender } = renderHook(
      ({ track }: { track: SpotifyTrack }) => useLyrics(track, 'current'),
      { initialProps: { track: makeTrack('A') } },
    );

    await waitFor(() => expect(fetchLyrics).toHaveBeenCalledTimes(1));
    const callA = pendingCall('A');

    rerender({ track: makeTrack('B') });

    await waitFor(() => expect(callA.signal?.aborted).toBe(true));
    await waitFor(() => expect(mockState.calls.some((c) => c.key === 'B')).toBe(true));

    await act(async () => {
      resolveLyrics('B');
    });

    await waitFor(() => expect(result.current.status).toBe('found'));
  });
});
