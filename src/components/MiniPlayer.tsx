import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Pause,
  Play,
  Music,
  SkipBack,
  SkipForward,
  ListMusic,
} from "lucide-react";
import type { MiniPlayerLayout, PlaybackState } from "../types";
import { togglePlayback } from "../lib/spotify";

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
  top: "-100px",
  bottom: "-100px",
  transform: "skewY(-4deg)",
  transformOrigin: "50% 100%",
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
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function MiniPlayer({
  playback,
  accessToken,
  getInterpolatedMs,
  onNext,
  onPrev,
  queueOpen,
  onToggleQueue,
  onSeek,
  onPlaybackError,
  layout,
  flipped,
}: MiniPlayerProps) {
  const { track } = playback;
  // Optimistic is_playing — flipped immediately on click, corrected by next poll
  const [optimisticPlaying, setOptimisticPlaying] = useState(
    playback.is_playing,
  );
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
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track.duration_ms, getInterpolatedMs]);

  // Paint the fill synchronously after every commit — before the browser
  // paints — so a structural change like the layout toggle never shows the bar
  // at its initial width:0 for a frame.
  useLayoutEffect(() => {
    if (!draggingRef.current) updateVisual(getInterpolatedMs());
  });

  function ratioFromClientX(clientX: number): number {
    if (!trackRef.current) return 0;
    const rect = trackRef.current.getBoundingClientRect();
    return Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingRef.current = true;
    if (thumbRef.current) thumbRef.current.style.opacity = "1";
    updateVisual(ratioFromClientX(e.clientX) * track.duration_ms);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return;
    updateVisual(ratioFromClientX(e.clientX) * track.duration_ms);
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (thumbRef.current) thumbRef.current.style.opacity = "";
    onSeek(ratioFromClientX(e.clientX) * track.duration_ms);
  }

  function handlePointerCancel() {
    draggingRef.current = false;
    if (thumbRef.current) thumbRef.current.style.opacity = "";
  }

  async function handleToggle() {
    const wasPlaying = playbackRef.current.is_playing;
    setOptimisticPlaying(!wasPlaying); // flip immediately
    try {
      await togglePlayback(accessToken, wasPlaying);
    } catch (e) {
      setOptimisticPlaying(wasPlaying); // revert on error
      onPlaybackError?.(
        e instanceof Error ? e.message : "Could not toggle playback.",
      );
    }
  }

  // When flipped, both layouts fully mirror: the two top-level blocks swap sides
  // (see controlsBlock) AND the song-info / time-label rows reverse internally
  // so the artwork and text hug the same edge as the block.
  const mirrored = flipped;
  const mask = SPLIT_FADE_MASK;

  // Full-bleed progress: a track running edge-to-edge (no side gutters, no
  // rounded corners) with a glowing white fill — the "premium media bar" look
  // from mockup 1a. Shared by Full/Split. In Split the bar hugs the bottom
  // screen edge (labels above it) and is a touch thicker to keep a usable drag
  // target there; in Full it sits flush against the panel's top edge (labels
  // beneath it). The hit-area pad grows toward the labels, away from the edge;
  // the labels are then pulled back over it so they sit right next to the bar.
  // Island is self-contained: a dynamic-width rounded pill with its own inset,
  // rounded progress bar and no full-width background.
  const isIsland = layout === "island";
  const atScreenEdge = layout === "split";

  const timeLabels = (
    <div
      key="labels"
      className={`flex justify-between text-[11px] font-semibold text-white/45 px-4 tabular-nums pointer-events-none ${mirrored ? "flex-row-reverse" : ""} ${atScreenEdge ? "-mb-2" : "-mt-1"}`}
    >
      <span ref={elapsedRef}>0:00</span>
      <span>{formatTime(track.duration_ms)}</span>
    </div>
  );
  const progressTrackEl = (
    <div
      key="track"
      ref={trackRef}
      className={`group relative cursor-grab active:cursor-grabbing touch-none ${
        isIsland ? "py-1" : atScreenEdge ? "pt-2.5" : "pb-2.5"
      }`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      aria-label="Seek"
      role="slider"
    >
      <div
        className={`relative bg-white/20 overflow-visible ${
          isIsland
            ? "h-1 rounded-full"
            : atScreenEdge
              ? "h-[5px]"
              : "h-[3px]"
        }`}
      >
        <div
          ref={barRef}
          className={`h-full bg-white w-0 ${isIsland ? "rounded-full" : ""}`}
          style={{ boxShadow: "0 0 10px rgba(255,255,255,0.6)" }}
        />
        <div
          ref={thumbRef}
          className="absolute top-1/2 w-3 h-3 rounded-full bg-white shadow -translate-x-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
          style={{ left: "0%" }}
        />
      </div>
    </div>
  );
  // Keyed children: when the layout toggle reorders bar / labels, React MOVES
  // these nodes instead of tearing them down and rebuilding — which flashed the
  // fill back to width:0 and (via the shared songInfo subtree) re-fetched the
  // album art.
  const progressBlock = (
    <div key="progress" className="w-full">
      {atScreenEdge
        ? [timeLabels, progressTrackEl]
        : [progressTrackEl, timeLabels]}
    </div>
  );

  const songInfo = (
    <div
      className={
        mirrored
          ? "flex flex-row-reverse items-center gap-4"
          : "flex items-center gap-4"
      }
    >
      {/* Artwork */}
      {artwork ? (
        <img
          src={artwork}
          alt={track.album.name}
          className="w-11 h-11 rounded-lg flex-shrink-0 shadow-lg"
        />
      ) : (
        <div className="w-11 h-11 rounded-lg flex-shrink-0 bg-white/10 flex items-center justify-center">
          <Music size={18} className="text-white/50" />
        </div>
      )}

      {/* Track info */}
      <div className={mirrored ? "min-w-0 text-right" : "min-w-0 text-left"}>
        <p className="text-white font-semibold text-sm truncate leading-tight">
          {track.name}
        </p>
        <p className="text-white/55 text-xs truncate mt-0.5">
          {track.artists.map((a) => a.name).join(", ")}
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
        aria-label={is_playing ? "Pause" : "Play"}
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
        aria-label={queueOpen ? "Close queue" : "Show queue"}
        className={[
          "w-10 h-10 flex items-center justify-center rounded-full transition-all active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60",
          queueOpen
            ? "text-white bg-white/20 hover:bg-white/30"
            : "text-white/50 hover:text-white hover:bg-white/15",
        ].join(" ")}
      >
        <ListMusic size={18} />
      </button>
    </div>
  );

  // Song info pinned to one screen corner, transport controls to the other —
  // shared by both layouts (Split and Full differ only in where the progress
  // bar goes and in the background treatment, not in the controls row).
  const controlsBlock = (
    <div key="controls" className={atScreenEdge ? "pt-3 pb-2" : "pt-2 pb-4"}>
      <div className="flex items-center justify-between gap-4 px-4 w-full">
        {flipped ? (
          <>
            {controls}
            <div className="min-w-0 max-w-xs">{songInfo}</div>
          </>
        ) : (
          <>
            <div className="min-w-0 max-w-xs">{songInfo}</div>
            {controls}
          </>
        )}
      </div>
    </div>
  );

  // Island: a self-contained rounded card, centred and only as wide as its
  // content. `w-max` sizes it to the content; `max-w-[...]` caps it to the
  // viewport (minus a gutter) so on a narrow screen the card stops growing and
  // the song title truncates instead — same clipping the other layouts do.
  const islandPill = (
    <div key="controls" className="flex justify-center px-3 pt-2 pb-3">
      <div className="w-max max-w-[calc(100vw-1.5rem)] rounded-3xl border border-white/10 bg-black/55 backdrop-blur-2xl px-3.5 pt-2.5 pb-2.5 shadow-2xl">
        <div className="flex items-center gap-3 min-w-0">
          {flipped ? (
            <>
              {controls}
              <div className="min-w-0">{songInfo}</div>
            </>
          ) : (
            <>
              <div className="min-w-0">{songInfo}</div>
              {controls}
            </>
          )}
        </div>
        <div className="mt-1.5">{progressTrackEl}</div>
      </div>
    </div>
  );

  // One stable outer element with keyed children, reordered per layout — Split
  // puts the controls above the bottom-edge bar, Full puts the top-edge bar
  // above the controls, Island is a single centred card. Keeping the tree stable
  // is what stops the Full<->Split toggle from remounting (glitching) the player.
  const content = (
    <div className="relative flex flex-col w-full">
      {isIsland
        ? islandPill
        : atScreenEdge
          ? [controlsBlock, progressBlock]
          : [progressBlock, controlsBlock]}
    </div>
  );

  return (
    <div className="fixed bottom-0 left-0 right-0 z-30">
      {/* Split background — kept mounted (just hidden) in the other layout so
          switching never re-inits the backdrop-blur mid-transition. */}
      <div className={atScreenEdge ? undefined : "hidden"}>
        {/* Mobile: the mask's fade zones eat a much larger share of a narrow
            screen, so below `sm` skip it entirely and just show a flat panel. */}
        <div className="absolute inset-0 bg-black/40 backdrop-blur-xs sm:hidden" />
        <div className="block sm:hidden absolute top-0 left-0 right-0 h-px bg-white/20" />

        {/* sm and up: skewed, edge-faded dark layer — oversized and wrapped in
            an overflow-hidden clipper (see SPLIT_SKEW_STYLE) so the skew never
            reveals gaps at its top/bottom. */}
        <div className="hidden sm:block absolute inset-0 overflow-hidden">
          <div
            className="absolute inset-0 bg-black/55 backdrop-blur-2xl"
            style={{
              maskImage: mask,
              WebkitMaskImage: mask,
              ...SPLIT_SKEW_STYLE,
            }}
          />
        </div>
        <div
          className="hidden sm:block absolute top-0 left-0 right-0 h-px bg-white/50"
          style={{ maskImage: mask, WebkitMaskImage: mask }}
        />
      </div>

      {/* Full background — one solid, full-width blurred panel behind the whole
          bar, no edge fade. The progress track's own hairline is the top border.
          Island brings its own card background, so no full-width layer there. */}
      <div
        className={`absolute inset-0 bg-black/55 backdrop-blur-2xl ${layout === "full" ? "" : "hidden"}`}
      />

      {/* Content — always fully opaque */}
      {content}
    </div>
  );
}
