import { useEffect, useRef, useState } from 'react';
import { Pause, Play, Music, SkipBack, SkipForward, ListMusic } from 'lucide-react';
import type { MiniPlayerLayout, PlaybackState } from '../types';
import { togglePlayback } from '../lib/spotify';

// Fade fades over a fixed 160 px on each side regardless of viewport width.
const FADE_MASK = `linear-gradient(to right, 
  transparent 0,
  rgba(0, 0, 0, 0.7) calc(50% - 160px), 
  rgba(0, 0, 0, 0.7) calc(50% + 160px), 
  transparent 100%
)`;

// A contained, gradual edge-to-center falloff — starts fading immediately at the
// edge (no flat opaque plateau) so it reads as a soft glow rather than a block,
// and dies out well before the center so it never swallows most of the width.
// The straight-line slant comes from a skewY() applied to the layer this paints on
// (see SPLIT_SKEW_STYLE below) — mirror-symmetric by construction, so a flipped
// layout never needs a 3rd mask variant.
const SPLIT_FADE_MASK = `linear-gradient(to right, 
  rgba(0, 0, 0, 0.4) 0, 
  rgba(0, 0, 0, 0.3) 180px,
  rgba(0, 0, 0, 0.1) 250px, 
  transparent 300px, transparent calc(100% - 300px),
  rgba(0, 0, 0, 0.1) calc(100% - 250px),
  rgba(0, 0, 0, 0.3) calc(100% - 180px),
  rgba(0, 0, 0, 0.4) 100%
)`;

// Skews the masked backdrop layer so its fade boundary reads as a diagonal cut
// instead of a vertical one. Oversized top/bottom + a clipping wrapper (see render)
// keep the skew from revealing gaps at the layer's edges. Origin is horizontally
// centered so the skew is mirror-symmetric — matches SPLIT_FADE_MASK's symmetry.
const SPLIT_SKEW_STYLE: React.CSSProperties = {
  top: '-100px',
  bottom: '-100px',
  transform: 'skewY(-4deg)',
  transformOrigin: '50% 100%',
};

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
  layout: MiniPlayerLayout;
  flipped: boolean;
}

function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function MiniPlayer({ playback, accessToken, getInterpolatedMs, onNext, onPrev, queueOpen, onToggleQueue, onSeek, onPlaybackError, layout, flipped }: MiniPlayerProps) {
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

  // Only split+flipped fully mirrors internal alignment — centered+flipped just
  // reorders the two top-level blocks, it never mirrors within a block.
  const mirrored = layout === 'split' && flipped;
  const mask = layout === 'split' ? SPLIT_FADE_MASK : FADE_MASK;

  const progressBar = (
    <div className={layout === 'split' ? 'w-full' : 'w-full max-w-xl mb-2'}>
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
      <div className={mirrored ? 'flex flex-row-reverse justify-between text-xs text-white/45 mt-1 tabular-nums' : 'flex justify-between text-xs text-white/45 mt-1 tabular-nums'}>
        <span ref={elapsedRef}>0:00</span>
        <span>{formatTime(track.duration_ms)}</span>
      </div>
    </div>
  );

  const songInfo = (
    <div className={mirrored ? 'flex flex-row-reverse items-center gap-4' : 'flex items-center gap-4'}>
      {/* Artwork */}
      {artwork ? (
        <img src={artwork} alt={track.album.name} className="w-11 h-11 rounded-lg flex-shrink-0 shadow-lg" />
      ) : (
        <div className="w-11 h-11 rounded-lg flex-shrink-0 bg-white/10 flex items-center justify-center">
          <Music size={18} className="text-white/50" />
        </div>
      )}

      {/* Track info */}
      <div className={mirrored ? 'min-w-0 text-right' : 'min-w-0 text-left'}>
        <p className="text-white font-semibold text-sm truncate leading-tight">{track.name}</p>
        <p className="text-white/55 text-xs truncate mt-0.5">
          {track.artists.map((a) => a.name).join(', ')}
        </p>
      </div>
    </div>
  );

  const controls = (
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
  );

  const content = layout === 'split' ? (
    <div className="relative flex items-center justify-between gap-4 px-6 pt-3 pb-5 w-full">
      {flipped ? (
        <>
          {controls}
          <div className="flex flex-col gap-2 w-full max-w-xs">
            {songInfo}
            {progressBar}
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-col gap-2 w-full max-w-xs">
            {songInfo}
            {progressBar}
          </div>
          {controls}
        </>
      )}
    </div>
  ) : (
    <div className="relative flex flex-col items-center px-6 pt-3 pb-5">
      {progressBar}
      <div className="flex items-center gap-4 w-full max-w-xl">
        {flipped ? (
          <>
            {controls}
            <div className="flex-1 min-w-0">{songInfo}</div>
          </>
        ) : (
          <>
            <div className="flex-1 min-w-0">{songInfo}</div>
            {controls}
          </>
        )}
      </div>
    </div>
  );

  return (
    <div className="fixed bottom-0 left-0 right-0 z-30">
      {/* Mobile: the mask's fade zones eat a much larger share of a narrow screen,
          so below `sm` skip it entirely and just show a flat, semi-opaque panel. */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-xs sm:hidden" />
      <div
        className={`block sm:hidden absolute top-0 left-0 right-0 h-px bg-white/20`}
      />

      {/* sm and up: fading dark background layer. In split mode it's skewed for a
          diagonal edge, so it's oversized and wrapped in an overflow-hidden clipper
          (see SPLIT_SKEW_STYLE) to avoid revealing gaps at its top/bottom. */}
      <div className={layout === 'split' ? 'hidden sm:block absolute inset-0 overflow-hidden' : 'hidden sm:contents'}>
        <div
          className="absolute inset-0 bg-black/55 backdrop-blur-2xl"
          style={layout === 'split' ? { maskImage: mask, WebkitMaskImage: mask, ...SPLIT_SKEW_STYLE } : { maskImage: mask, WebkitMaskImage: mask }}
        />
      </div>
      {/* Top border line with same fade (kept unskewed — at 1px tall the slant isn't visible anyway) */}
      <div
        className={`hidden sm:block absolute top-0 left-0 right-0 h-px bg-white/${layout === 'split' ? '50' : '20'}`}
        style={{ maskImage: mask, WebkitMaskImage: mask }}
      />

      {/* Content — always fully opaque */}
      {content}
    </div>
  );
}
