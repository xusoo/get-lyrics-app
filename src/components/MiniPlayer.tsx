import { useEffect, useRef, useState } from 'react';
import { Pause, Play, Music, SkipBack, SkipForward, ListMusic } from 'lucide-react';
import type { PlaybackState } from '../types';
import { togglePlayback } from '../lib/spotify';

// Fade fades over a fixed 160 px on each side regardless of viewport width.
const FADE_MASK = 'linear-gradient(to right, transparent 0, rgba(0, 0, 0, 0.95) calc(50% - 160px), rgba(0, 0, 0, 0.95) calc(50% + 160px), transparent 100%)';

interface MiniPlayerProps {
  playback: PlaybackState;
  accessToken: string;
  getInterpolatedMs: () => number;
  onNext: () => void;
  onPrev: () => void;
  queueOpen: boolean;
  onToggleQueue: () => void;
  onSeek: (ms: number) => void;
  onPlaybackError?: (msg: string) => void;
}

function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function MiniPlayer({ playback, accessToken, getInterpolatedMs, onNext, onPrev, queueOpen, onToggleQueue, onSeek, onPlaybackError }: MiniPlayerProps) {
  const { track } = playback;
  // Optimistic is_playing — flipped immediately on click, corrected by next poll
  const [optimisticPlaying, setOptimisticPlaying] = useState(playback.is_playing);
  const playbackRef = useRef(playback);

  // Sync optimistic state whenever real playback changes
  useEffect(() => {
    playbackRef.current = playback;
    setOptimisticPlaying(playback.is_playing);
  }, [playback]);

  const is_playing = optimisticPlaying;
  const artwork = track.album.images[0]?.url;

  // Direct DOM refs for progress — updated via rAF, no React state
  const trackRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const elapsedRef = useRef<HTMLSpanElement>(null);
  const rafRef = useRef<number | null>(null);
  // While dragging, the rAF loop stops driving the visual — the pointer does instead
  const draggingRef = useRef(false);

  function updateVisual(ms: number) {
    const pct = Math.min(Math.max(ms / track.duration_ms, 0), 1) * 100;
    if (barRef.current) barRef.current.style.width = `${pct}%`;
    if (thumbRef.current) thumbRef.current.style.left = `${pct}%`;
    if (elapsedRef.current) elapsedRef.current.textContent = formatTime(ms);
  }

  useEffect(() => {
    function tick() {
      if (!draggingRef.current) updateVisual(getInterpolatedMs());
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track.duration_ms, getInterpolatedMs]);

  function ratioFromClientX(clientX: number): number {
    if (!trackRef.current) return 0;
    const rect = trackRef.current.getBoundingClientRect();
    return Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingRef.current = true;
    if (thumbRef.current) thumbRef.current.style.opacity = '1';
    updateVisual(ratioFromClientX(e.clientX) * track.duration_ms);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return;
    updateVisual(ratioFromClientX(e.clientX) * track.duration_ms);
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (thumbRef.current) thumbRef.current.style.opacity = '';
    onSeek(ratioFromClientX(e.clientX) * track.duration_ms);
  }

  function handlePointerCancel() {
    draggingRef.current = false;
    if (thumbRef.current) thumbRef.current.style.opacity = '';
  }

  async function handleToggle() {
    const wasPlaying = playbackRef.current.is_playing;
    setOptimisticPlaying(!wasPlaying); // flip immediately
    try {
      await togglePlayback(accessToken, wasPlaying);
    } catch (e) {
      setOptimisticPlaying(wasPlaying); // revert on error
      onPlaybackError?.(e instanceof Error ? e.message : 'Could not toggle playback.');
    }
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-30">
      {/* Fading dark background layer */}
      <div
        className="absolute inset-0 bg-black/55 backdrop-blur-2xl"
        style={{ maskImage: FADE_MASK, WebkitMaskImage: FADE_MASK }}
      />
      {/* Top border line with same fade */}
      <div
        className="absolute top-0 left-0 right-0 h-px bg-white/20"
        style={{ maskImage: FADE_MASK, WebkitMaskImage: FADE_MASK }}
      />

      {/* Content — always fully opaque */}
      <div className="relative flex flex-col items-center px-6 pt-3 pb-5">
        {/* Progress bar */}
        <div className="w-full max-w-xl mb-2">
          <div
            ref={trackRef}
            className="group relative py-2 -my-2 cursor-grab active:cursor-grabbing touch-none"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            aria-label="Seek"
            role="slider"
          >
            <div className="h-1 rounded-full bg-white/20 overflow-hidden">
              <div ref={barRef} className="h-full rounded-full bg-white/80 w-0" />
            </div>
            <div
              ref={thumbRef}
              className="absolute top-1/2 w-3 h-3 rounded-full bg-white shadow -translate-x-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
              style={{ left: '0%' }}
            />
          </div>
          <div className="flex justify-between text-xs text-white/45 mt-1 tabular-nums">
            <span ref={elapsedRef}>0:00</span>
            <span>{formatTime(track.duration_ms)}</span>
          </div>
        </div>

        {/* Controls row */}
        <div className="flex items-center gap-4 w-full max-w-xl">
          {/* Artwork */}
          {artwork ? (
            <img src={artwork} alt={track.album.name} className="w-11 h-11 rounded-lg flex-shrink-0 shadow-lg" />
          ) : (
            <div className="w-11 h-11 rounded-lg flex-shrink-0 bg-white/10 flex items-center justify-center">
              <Music size={18} className="text-white/50" />
            </div>
          )}

          {/* Track info */}
          <div className="flex-1 min-w-0">
            <p className="text-white font-semibold text-sm truncate leading-tight">{track.name}</p>
            <p className="text-white/55 text-xs truncate mt-0.5">
              {track.artists.map((a) => a.name).join(', ')}
            </p>
          </div>

          {/* Playback controls */}
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={onPrev}
              aria-label="Previous track"
              className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-white/15 active:scale-90 transition-all text-white/65 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
            >
              <SkipBack size={18} fill="currentColor" />
            </button>
            <button
              onClick={handleToggle}
              aria-label={is_playing ? 'Pause' : 'Play'}
              className="w-12 h-12 flex items-center justify-center rounded-full bg-white/20 hover:bg-white/30 active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
            >
              {is_playing ? (
                <Pause size={20} fill="white" className="text-white" />
              ) : (
                <Play size={20} fill="white" className="text-white ml-0.5" />
              )}
            </button>
            <button
              onClick={onNext}
              aria-label="Next track"
              className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-white/15 active:scale-90 transition-all text-white/65 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
            >
              <SkipForward size={18} fill="currentColor" />
            </button>
            <button
              onClick={onToggleQueue}
              aria-label={queueOpen ? 'Close queue' : 'Show queue'}
              className={[
                'w-10 h-10 flex items-center justify-center rounded-full transition-all active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60',
                queueOpen
                  ? 'text-white bg-white/20 hover:bg-white/30'
                  : 'text-white/50 hover:text-white hover:bg-white/15',
              ].join(' ')}
            >
              <ListMusic size={18} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
