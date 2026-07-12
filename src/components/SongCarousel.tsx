import { useEffect, useLayoutEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import type { ReactNode } from 'react';

export type SlideDirection = 'left' | 'right';

/**
 * One carousel slot. `key` is the React key that lets a panel's DOM (its
 * already-decoded background <img> and rendered lyrics) be *preserved and moved*
 * when the window shifts, instead of being rebuilt in a fixed slot — which is
 * what caused the background to flash on song change. Keys are track ids (or a
 * stable placeholder for an empty edge slot).
 */
export interface CarouselSlot {
  key: string;
  content: ReactNode;
}

interface SongCarouselProps {
  /** Exactly three slots, ordered [prev, current, next]. Keyed by track id. */
  slots: [CarouselSlot, CarouselSlot, CarouselSlot];
  /**
   * When set to 'left' or 'right', triggers a programmatic CSS-animated slide.
   * MainView resets this to null via onSlideComplete.
   */
  slideDirection: SlideDirection | null;
  /**
   * Called (via flushSync) when any slide animation finishes so MainView can
   * rearrange the three slot tracks before the transform is reset. Because the
   * slots are keyed, React moves the surviving panels' DOM rather than
   * re-rendering their content — so the reshuffle is invisible and flash-free.
   */
  onSlideComplete: () => void;
  /**
   * Called when a touch-initiated swipe crosses the commit threshold (33 % of
   * screen width). MainView should trigger the Spotify skip here.
   */
  onSlideCommit: (direction: SlideDirection) => void;
}

const SNAP_DURATION = '300ms';
const SLIDE_DURATION = '400ms';
const EASE = 'ease-out';

/** Transform value that shows the centre (current) panel. */
const CENTER = 'translateX(-100vw)';
const TO_PREV = 'translateX(0vw)';
const TO_NEXT = 'translateX(-200vw)';

export function SongCarousel({
  slots,
  slideDirection,
  onSlideComplete,
  onSlideCommit,
}: SongCarouselProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const isSlidingRef = useRef(false);

  // Keep callback refs stable so the touch-handler effect doesn't need to re-run.
  const onSlideCompleteRef = useRef(onSlideComplete);
  const onSlideCommitRef = useRef(onSlideCommit);
  useLayoutEffect(() => {
    onSlideCompleteRef.current = onSlideComplete;
    onSlideCommitRef.current = onSlideCommit;
  });

  // ── Programmatic slide (poll-detected track change) ──────────────────────
  useEffect(() => {
    if (!slideDirection || !trackRef.current) return;
    if (isSlidingRef.current) return;

    isSlidingRef.current = true;
    const track = trackRef.current;
    track.style.transition = `transform ${SLIDE_DURATION} ${EASE}`;
    track.style.transform = slideDirection === 'right' ? TO_NEXT : TO_PREV;

    function onEnd() {
      track.removeEventListener('transitionend', onEnd);
      isSlidingRef.current = false;

      // 1. Synchronously flush React slot rearrangement so the centre panel
      //    already has the correct content before we snap the transform back.
      flushSync(() => { onSlideCompleteRef.current(); });

      // 2. Instant snap back to centre — user never sees it because React has
      //    already committed the updated centre slot above.
      track.style.transition = 'none';
      track.style.transform = CENTER;

      // 3. Re-enable transitions on the next frame.
      requestAnimationFrame(() => {
        if (trackRef.current) trackRef.current.style.transition = '';
      });
    }

    track.addEventListener('transitionend', onEnd);
    return () => { track.removeEventListener('transitionend', onEnd); };
  }, [slideDirection]);

  // ── Touch gesture handler ─────────────────────────────────────────────────
  useEffect(() => {
    const wrapper = trackRef.current?.parentElement;
    if (!wrapper) return;

    // Plain object (not a ref) — mutable, shared across the three handlers via closure.
    const touch = { startX: 0, startY: 0, axisLocked: false, isHorizontal: false, dragging: false };

    function onTouchStart(e: TouchEvent) {
      if (isSlidingRef.current) return;
      const t = e.touches[0];
      touch.startX = t.clientX;
      touch.startY = t.clientY;
      touch.axisLocked = false;
      touch.isHorizontal = false;
      touch.dragging = false;
    }

    function onTouchMove(e: TouchEvent) {
      if (isSlidingRef.current || !trackRef.current) return;
      const t = e.touches[0];
      const dx = t.clientX - touch.startX;
      const dy = t.clientY - touch.startY;

      // Wait for enough movement before committing to an axis.
      if (!touch.axisLocked) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        touch.axisLocked = true;
        touch.isHorizontal = Math.abs(dx) > Math.abs(dy);
      }

      // Vertical swipe — let the inner lyrics scroll handle it.
      if (!touch.isHorizontal) return;

      // Horizontal swipe — take ownership and prevent vertical scroll.
      e.preventDefault();
      touch.dragging = true;
      trackRef.current.style.transition = 'none';
      trackRef.current.style.transform = `translateX(calc(-100vw + ${dx}px))`;
    }

    function onTouchEnd(e: TouchEvent) {
      if (!touch.dragging || !trackRef.current) {
        touch.dragging = false;
        return;
      }
      touch.dragging = false;

      const t = e.changedTouches[0];
      const dx = t.clientX - touch.startX;
      const threshold = window.innerWidth * 0.33;
      const track = trackRef.current;

      if (Math.abs(dx) >= threshold) {
        // ── Commit swipe ──────────────────────────────────────────────────
        const direction: SlideDirection = dx < 0 ? 'right' : 'left';
        isSlidingRef.current = true;

        track.style.transition = `transform ${SNAP_DURATION} ${EASE}`;
        track.style.transform = direction === 'right' ? TO_NEXT : TO_PREV;

        // Notify MainView to trigger Spotify skip; don't await — fire-and-forget.
        onSlideCommitRef.current(direction);

        function onEnd() {
          track.removeEventListener('transitionend', onEnd);
          isSlidingRef.current = false;
          flushSync(() => { onSlideCompleteRef.current(); });
          track.style.transition = 'none';
          track.style.transform = CENTER;
          requestAnimationFrame(() => {
            if (trackRef.current) trackRef.current.style.transition = '';
          });
        }
        track.addEventListener('transitionend', onEnd);
      } else {
        // ── Snap back to centre ───────────────────────────────────────────
        track.style.transition = `transform ${SNAP_DURATION} ${EASE}`;
        track.style.transform = CENTER;
        function onSnapBack() {
          track.removeEventListener('transitionend', onSnapBack);
          track.style.transition = '';
        }
        track.addEventListener('transitionend', onSnapBack);
      }
    }

    wrapper.addEventListener('touchstart', onTouchStart, { passive: true });
    wrapper.addEventListener('touchmove', onTouchMove, { passive: false });
    wrapper.addEventListener('touchend', onTouchEnd, { passive: true });

    return () => {
      wrapper.removeEventListener('touchstart', onTouchStart);
      wrapper.removeEventListener('touchmove', onTouchMove);
      wrapper.removeEventListener('touchend', onTouchEnd);
    };
  }, []); // stable — all mutable state lives in refs

  // overflow-clip (not overflow-hidden): clips the 300vw track identically but
  // establishes NO scroll container, so nothing (scrollIntoView, focus-scroll,
  // scroll anchoring) can ever set scrollLeft here and displace the carousel.
  return (
    <div className="flex-1 overflow-clip relative min-h-0 h-full">
      <div
        ref={trackRef}
        className="flex h-full"
        style={{ width: '300vw', transform: CENTER, willChange: 'transform' }}
      >
        {slots.map((slot) => (
          <div key={slot.key} className="h-full min-h-0 flex-shrink-0" style={{ width: '100vw' }}>
            {slot.content}
          </div>
        ))}
      </div>
    </div>
  );
}
