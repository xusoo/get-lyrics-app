import { useCallback, useEffect, useRef, useState } from 'react';
import { getCurrentlyPlaying, isRateLimited } from '../lib/spotify';
import type { PlaybackState, SpotifyTrack, TokenData } from '../types';

const POLL_INTERVAL = 3000;
const OFFLINE_THRESHOLD = 3; // consecutive errors before we surface the offline state

export function useCurrentTrack(token: TokenData | null) {
  const [playback, setPlayback] = useState<PlaybackState | null>(null);
  const [loading, setLoading] = useState(true);
  const [isOffline, setIsOffline] = useState(false);
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const consecutiveErrors = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const pollSeqRef = useRef(0);
  // rejectId: the track we just left — block it from re-entering via stale polls.
  // acceptId: the optimistic track we expect Spotify to confirm.
  // until: hard expiry so we never block forever.
  const optimisticGuardRef = useRef<{ rejectId: string; acceptId: string; until: number } | null>(null);
  const playbackRef = useRef<PlaybackState | null>(null);

  const poll = useCallback(async () => {
    const t = tokenRef.current;
    if (!t) return;
    // Skip while Spotify has told us to back off, or while the page is hidden.
    if (isRateLimited() || document.visibilityState === 'hidden') return;
    const seq = ++pollSeqRef.current;
    // Cancel any previous in-flight request
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    try {
      const data = await getCurrentlyPlaying(t.access_token, abortRef.current.signal);

      // Ignore stale poll completions (out-of-order response race).
      if (seq !== pollSeqRef.current) return;

      // After an optimistic skip, Spotify can keep returning the old track for
      // several seconds while propagation catches up. Explicitly reject polls
      // that report the old track we just left, until Spotify confirms the new
      // one or the hard timeout fires.
      const guard = optimisticGuardRef.current;
      const polledId = data?.item?.id ?? null;
      if (guard) {
        if (performance.now() < guard.until) {
          if (polledId === guard.rejectId) return; // still returning old track — ignore
          if (polledId === guard.acceptId) optimisticGuardRef.current = null; // confirmed ✓
        } else {
          optimisticGuardRef.current = null; // hard expiry — stop guarding
        }
      }

      consecutiveErrors.current = 0;
      setIsOffline(false);
      if (!data) {
        setPlayback(null);
      } else {
        const next = {
          track: data.item,
          progress_ms: data.progress_ms ?? 0,
          is_playing: data.is_playing ?? false,
          timestamp: performance.now(),
        };
        playbackRef.current = next;
        setPlayback(next);
      }
    } catch (err) {
      // Ignore aborted requests (token changed / unmount)
      if (err instanceof Error && err.name === 'AbortError') return;
      consecutiveErrors.current += 1;
      if (consecutiveErrors.current >= OFFLINE_THRESHOLD) setIsOffline(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!token) {
      abortRef.current?.abort();
      pollSeqRef.current += 1;
      optimisticGuardRef.current = null;
      setPlayback(null);
      setLoading(false);
      setIsOffline(false);
      consecutiveErrors.current = 0;
      return;
    }
    setLoading(true);
    poll();
    const id = setInterval(poll, POLL_INTERVAL);
    // Resume polling immediately when the page becomes visible again.
    function onVisible() {
      if (document.visibilityState === 'visible') void poll();
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      abortRef.current?.abort();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [token, poll]);

  /** Optimistically switch to a known next track without waiting for the poll. */
  const setOptimisticTrack = useCallback((track: SpotifyTrack) => {
    const oldId = playbackRef.current?.track.id;
    if (oldId && oldId !== track.id) {
      // Block polls that still return the old track for up to 8 s.
      // Only cleared when Spotify confirms the new track or the window expires.
      optimisticGuardRef.current = {
        rejectId: oldId,
        acceptId: track.id,
        until: performance.now() + 8000,
      };
    }
    const next: PlaybackState = {
      track,
      progress_ms: 0,
      is_playing: true,
      timestamp: performance.now(),
    };
    playbackRef.current = next;
    setPlayback(next);
  }, []);

  return { playback, loading, isOffline, setOptimisticTrack };
}
