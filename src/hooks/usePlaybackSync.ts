import { useEffect, useRef, useState } from 'react';
import type { LyricLine, PlaybackState } from '../types';

/**
 * Tracks which lyric line is currently active using requestAnimationFrame.
 * Only triggers a React re-render when the active line index actually changes,
 * keeping renders down to ~one per line change rather than 60/s.
 *
 * Progress interpolation is exposed as getInterpolatedMs() — a ref-based
 * function that callers can use to drive DOM updates directly without state.
 * setOptimisticSeek() lets callers immediately reflect a seek in both the
 * progress bar and lyric highlight before the next Spotify poll arrives.
 */
const END_THRESHOLD_MS = 500;

export function usePlaybackSync(playback: PlaybackState | null, lines: LyricLine[], lyricsOffset: number, onTrackEnded?: () => void) {
  const [currentLineIndex, setCurrentLineIndex] = useState(-1);

  const playbackRef = useRef(playback);
  playbackRef.current = playback;
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const lyricsOffsetRef = useRef(lyricsOffset);
  lyricsOffsetRef.current = lyricsOffset;
  const onTrackEndedRef = useRef(onTrackEnded);
  onTrackEndedRef.current = onTrackEnded;
  const trackEndedFiredRef = useRef(false);
  const lastIndexRef = useRef(-1);
  const rafRef = useRef<number | null>(null);
  const trackId = playback?.track.id;

  // Reset per-track state when the track changes.
  // Also clear any pending optimistic seek — it belongs to the old track.
  useEffect(() => {
    lastIndexRef.current = -1;
    trackEndedFiredRef.current = false;
    setCurrentLineIndex(-1);
    optimisticSeekRef.current = null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId]);

  // Optimistic seek — set by setOptimisticSeek, cleared on the next Spotify poll.
  // A ref so getInterpolatedMs() and the rAF tick always read the latest value.
  const optimisticSeekRef = useRef<{ positionMs: number; startedAt: number } | null>(null);

  // Clear when a fresh poll arrives — but only after enough time has passed for
  // Spotify to have processed the seek. A poll that was already in-flight when
  // the seek happened arrives with the OLD position and must not revert the bar.
  const SEEK_SETTLE_MS = 1500;
  useEffect(() => {
    if (!optimisticSeekRef.current) return;
    if (!playback) { optimisticSeekRef.current = null; return; }
    if (playback.timestamp - optimisticSeekRef.current.startedAt >= SEEK_SETTLE_MS) {
      optimisticSeekRef.current = null;
    }
  }, [playback?.timestamp]);

  // Stable — reads refs, no closures over stale state
  // Returns raw playback position (no offset) for the progress bar
  const getInterpolatedMs = useRef(() => {
    if (optimisticSeekRef.current) {
      const pb = playbackRef.current;
      const elapsed = pb?.is_playing ? performance.now() - optimisticSeekRef.current.startedAt : 0;
      return optimisticSeekRef.current.positionMs + elapsed;
    }
    const pb = playbackRef.current;
    if (!pb) return 0;
    const elapsed = pb.is_playing ? performance.now() - pb.timestamp : 0;
    return pb.progress_ms + elapsed;
  }).current;

  // Stable — immediately reflects a seek in the progress bar and lyric highlight
  const setOptimisticSeek = useRef((ms: number) => {
    optimisticSeekRef.current = { positionMs: ms, startedAt: performance.now() };
  }).current;

  useEffect(() => {
    function tick() {
      const pb = playbackRef.current;
      const ls = linesRef.current;

      // If paused and there are no lines to track, no need to do anything this frame
      // — but we still want the rAF to keep running so we can wake up when state changes.
      if (pb?.is_playing || ls.length > 0 || optimisticSeekRef.current) {
        // Apply offset only for lyric line detection, not for the progress bar
        const posMs = getInterpolatedMs() + lyricsOffsetRef.current;

        if (ls.length > 0) {
          // Binary search for last line whose timeMs <= posMs
          let lo = 0, hi = ls.length - 1, idx = -1;
          while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (ls[mid].timeMs <= posMs) { idx = mid; lo = mid + 1; }
            else hi = mid - 1;
          }
          // Only setState when the line actually changes → avoids 60fps re-renders
          if (idx !== lastIndexRef.current) {
            lastIndexRef.current = idx;
            setCurrentLineIndex(idx);
          }
        } else if (lastIndexRef.current !== -1) {
          lastIndexRef.current = -1;
          setCurrentLineIndex(-1);
        }

        // Auto-advance: fire near the end so the next track appears without
        // waiting for the Spotify poll (~3 s delay).
        if (pb?.is_playing && !trackEndedFiredRef.current) {
          const durMs = pb.track.duration_ms;
          if (durMs > 0 && getInterpolatedMs() >= durMs - END_THRESHOLD_MS) {
            trackEndedFiredRef.current = true;
            onTrackEndedRef.current?.();
          }
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); };
  }, []); // intentional: runs once, uses refs

  return { currentLineIndex, getInterpolatedMs, setOptimisticSeek };
}
