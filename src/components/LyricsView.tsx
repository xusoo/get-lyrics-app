import { useEffect, useLayoutEffect, useRef } from 'react';
import type { LyricLine } from '../types';

interface LyricsViewProps {
  lines: LyricLine[];
  isSynced: boolean;
  currentLineIndex: number;
  fontSize: number;
  onSeek?: (ms: number) => void;
  status: 'idle' | 'loading' | 'found' | 'not-found' | 'error';
  trackId: string | null;
  onRetry?: () => void;
}

const SCALE: Record<number, { scale: number; opacity: number }> = {
  0: { scale: 1.45, opacity: 1 },
  1: { scale: 1.0,  opacity: 0.75 },
  2: { scale: 0.88, opacity: 0.55 },
  3: { scale: 0.78, opacity: 0.38 },
};
const DEFAULT_STYLE = { scale: 0.7, opacity: 0.25 };

const USER_SCROLL_PAUSE = 2000;

export function LyricsView({
  lines,
  isSynced,
  currentLineIndex,
  fontSize,
  onSeek,
  status,
  trackId,
  onRetry,
}: LyricsViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const userScrollLocked = useRef(false);
  const lockTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Attach scroll-lock listeners to the scroll container so vertical lyrics scrolling
  // doesn't interfere with the horizontal carousel swipe gesture.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function arm() {
      userScrollLocked.current = true;
      resetTimer();
    }

    function resetTimer() {
      if (lockTimeoutRef.current) clearTimeout(lockTimeoutRef.current);
      lockTimeoutRef.current = setTimeout(() => {
        userScrollLocked.current = false;
      }, USER_SCROLL_PAUSE);
    }

    function onScroll() {
      if (userScrollLocked.current) resetTimer();
    }

    container.addEventListener('pointerdown', arm);
    container.addEventListener('touchstart', arm, { passive: true });
    container.addEventListener('wheel', arm, { passive: true });
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      container.removeEventListener('pointerdown', arm);
      container.removeEventListener('touchstart', arm);
      container.removeEventListener('wheel', arm);
      container.removeEventListener('scroll', onScroll);
    };
  }, []);

  // Scroll to top BEFORE the browser paints so the user never sees the old
  // song's scroll position. Scoped to the container, not the document root.
  useLayoutEffect(() => {
    userScrollLocked.current = false;
    if (lockTimeoutRef.current) clearTimeout(lockTimeoutRef.current);
    const container = containerRef.current;
    if (container) container.scrollTop = 0;
  }, [trackId]);

  useEffect(() => {
    if (!isSynced || userScrollLocked.current) return;
    const container = containerRef.current;
    if (!container) return;
    if (currentLineIndex < 0) {
      container.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    const el = lineRefs.current[currentLineIndex];
    if (!el) return;
    // Container-scoped, vertical-only scroll — NOT el.scrollIntoView(), which scrolls
    // every scrollable ancestor on both axes. The carousel wrapper is horizontally
    // scrollable (its track overflows to 300vw), so scrollIntoView would drag it via
    // scrollLeft to reveal a wide (1.45x-scaled) line, shifting the whole panel and
    // exposing the neighbouring panel underneath.
    const cRect = container.getBoundingClientRect();
    const eRect = el.getBoundingClientRect();
    const delta = (eRect.top + eRect.height / 2) - (cRect.top + cRect.height / 2);
    container.scrollTo({ top: container.scrollTop + delta, behavior: 'smooth' });
  // NOTE: trackId is intentionally NOT in this dep array — see usePlaybackSync.
  }, [currentLineIndex, isSynced]);

  function handleLineClick(lineIndex: number) {
    if (!isSynced || !onSeek) return;
    userScrollLocked.current = false;
    if (lockTimeoutRef.current) clearTimeout(lockTimeoutRef.current);
    onSeek(lines[lineIndex].timeMs);
  }

  return (
    <div
      ref={containerRef}
      className="flex-1 h-full flex flex-col overflow-y-auto min-h-0"
      style={{ scrollbarWidth: 'none', overflowX: 'hidden' }}
    >
      {status === 'loading' && (
        <div className="flex flex-col items-center justify-center flex-1 gap-4">
          <div className="flex items-center gap-1.5">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="w-2 h-2 rounded-full bg-white/50 inline-block"
                style={{ animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite` }}
              />
            ))}
          </div>
          <span className="text-white/50 text-base transition-all duration-300">
            Loading lyrics...
          </span>
        </div>
      )}

      {(status === 'not-found' || (status === 'found' && lines.length === 0)) && (
        <div className="flex flex-col items-center justify-center flex-1 gap-2 text-white/50">
          <span style={{ fontSize: fontSize * 0.75 }}>No lyrics found</span>
          <span className="text-sm opacity-60">LRCLIB does not have this track yet</span>
        </div>
      )}

      {status === 'error' && (
        <div className="flex flex-col items-center justify-center flex-1 gap-3">
          <span className="text-red-400/70" style={{ fontSize: fontSize * 0.75 }}>Failed to load lyrics</span>
          {onRetry && (
            <button
              onClick={onRetry}
              className="text-white/50 text-sm border border-white/20 rounded-full px-4 py-1.5 hover:bg-white/10 active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
            >
              Try again
            </button>
          )}
        </div>
      )}

      {status === 'found' && lines.length > 0 && (
        <div
          role="region"
          aria-label="Song lyrics"
          className="w-full px-3 sm:px-6 py-[45vh]"
        >
          {!isSynced && (
            <div className="flex justify-center mb-4">
              <span className="text-xs text-white/35 border border-white/15 rounded-full px-3 py-1">
                Plain lyrics — tap a line to skip is unavailable
              </span>
            </div>
          )}
          <div className={[
            'flex flex-col items-center max-w-3xl mx-auto',
            isSynced ? 'gap-3' : 'gap-0',
          ].join(' ')}>
            {lines.map((line, i) => {
              const dist = Math.abs(i - currentLineIndex);
              const style = SCALE[dist] ?? DEFAULT_STYLE;
              const isCurrent = isSynced && i === currentLineIndex;
              const isPrevious = isSynced && i < currentLineIndex;

              return (
                <button
                  key={i}
                  ref={(el) => { lineRefs.current[i] = el; }}
                  onClick={() => handleLineClick(i)}
                  disabled={!isSynced}
                  aria-current={isCurrent ? 'true' : undefined}
                  className={[
                    'w-full text-center font-bold transition-[transform,opacity] duration-500 px-4 rounded-2xl',
                    isSynced ? 'leading-snug py-2' : 'leading-tight py-1',
                    isPrevious ? 'text-white/40' : 'text-white',
                    'text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60',
                    isSynced && !isCurrent ? 'cursor-pointer hover:opacity-90 active:opacity-70' : '',
                    !isSynced ? 'cursor-default' : '',
                  ].join(' ')}
                  style={{
                    fontSize: `min(${fontSize}px, 7.5vw)`,
                    transform: isSynced ? `scale(${style.scale})` : `scale(${DEFAULT_STYLE.scale})`,
                    transformOrigin: 'center',
                    opacity: isSynced ? (currentLineIndex < 0 ? 0.85 : style.opacity) : 0.65,
                    textShadow: isCurrent
                      ? '0 0 40px rgba(255,255,255,0.5), 0 2px 8px rgba(0,0,0,0.8)'
                      : '0 1px 4px rgba(0,0,0,0.7)',
                    maxWidth: `calc(100% / ${SCALE[0].scale})`,
                    overflowWrap: 'break-word',
                    wordBreak: 'break-word',
                  }}
                >
                  {line.text || '\u266a'}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
