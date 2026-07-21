import { useEffect, useRef, useState } from 'react';
import { Music } from 'lucide-react';
import type { PlaybackState, SpotifyTrack } from '../types';

const WINDOW_MS = 5000;
// Small negative grace so a slightly-stale frame right at the track boundary
// doesn't cause the popup to flash back visible for one tick.
const HIDE_GRACE_MS = 1000;

interface NextPlayingPopupProps {
  playback: PlaybackState | null;
  nextTrack: SpotifyTrack | null;
  getInterpolatedMs: () => number;
  onSkip: () => void;
  /** Suppress display while another bottom-right overlay (queue panel) is open. */
  suppressed?: boolean;
}

export function NextPlayingPopup({ playback, nextTrack, getInterpolatedMs, onSkip, suppressed }: NextPlayingPopupProps) {
  const [visible, setVisible] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);

  // Refs so the rAF tick always reads latest props without re-subscribing.
  const playbackRef = useRef(playback);
  playbackRef.current = playback;
  const nextTrackRef = useRef(nextTrack);
  nextTrackRef.current = nextTrack;
  const suppressedRef = useRef(suppressed);
  suppressedRef.current = suppressed;

  useEffect(() => {
    function tick() {
      const pb = playbackRef.current;
      const next = nextTrackRef.current;
      const durMs = pb?.track.duration_ms ?? 0;
      const remainingMs = durMs - getInterpolatedMs();

      const shouldShow =
        !!pb && !!next &&
        !suppressedRef.current &&
        next.id !== pb.track.id && // guard: next hasn't been recomputed yet
        pb.repeat_state !== 'track' && // repeat-one suppression
        durMs > 0 &&
        remainingMs <= WINDOW_MS &&
        remainingMs > -HIDE_GRACE_MS;

      setVisible((prev) => (prev !== shouldShow ? shouldShow : prev));

      if (shouldShow && barRef.current) {
        const pct = Math.min(Math.max((WINDOW_MS - remainingMs) / WINDOW_MS, 0), 1) * 100;
        barRef.current.style.width = `${pct}%`;
      }

      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); };
  }, [getInterpolatedMs]);

  if (!nextTrack) return null;

  const artwork = nextTrack.album.images[nextTrack.album.images.length - 1]?.url
    ?? nextTrack.album.images[0]?.url;

  return (
    <div
      className={[
        'fixed bottom-[104px] right-4 z-20 w-64 transition-all duration-300 ease-out',
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2 pointer-events-none',
      ].join(' ')}
      aria-hidden={!visible}
    >
      <button
        onClick={onSkip}
        aria-label={`Skip to next: ${nextTrack.name} by ${nextTrack.artists.map((a) => a.name).join(', ')}`}
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left rounded-2xl bg-black/85 backdrop-blur-xl border border-white/10 shadow-2xl hover:bg-black/90 active:scale-[0.98] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
      >
        <div className="w-10 h-10 rounded-lg flex-shrink-0 overflow-hidden bg-white/10 flex items-center justify-center">
          {artwork ? (
            <img src={artwork} alt="" className="w-full h-full object-cover" />
          ) : (
            <Music size={16} className="text-white/40" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white/50 text-[10px] uppercase tracking-wide font-semibold">Next up</p>
          <p className="text-white/90 text-xs font-medium truncate leading-snug">{nextTrack.name}</p>
          <p className="text-white/45 text-xs truncate">{nextTrack.artists.map((a) => a.name).join(', ')}</p>
        </div>
      </button>

      {/* Progress bar — light-gray fill advancing over the 5s window */}
      <div className="mt-1.5 h-1 rounded-full bg-white/10 overflow-hidden">
        <div ref={barRef} className="h-full rounded-full bg-neutral-300 w-0" />
      </div>
    </div>
  );
}
