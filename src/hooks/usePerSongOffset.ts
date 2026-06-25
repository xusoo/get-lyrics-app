import { useCallback, useEffect, useRef, useState } from 'react';

const OFFSET_KEY_PREFIX = 'tesla_lyrics_offset_';

/**
 * Manages per-song lyrics offset, keyed by LRCLIB entry ID.
 * - `isManuallySet`: true only when the user explicitly pressed a button on the main screen.
 * - When not manually set, `offsetMs` tracks `defaultLyricsOffset` live.
 * - `defaultLyricsOffset` must come from the caller's own useSettings() instance
 *   to ensure React state updates propagate correctly.
 */
export function usePerSongOffset(lyricsId: number | null, defaultLyricsOffset: number) {
  const [offsetMs, setOffsetMs] = useState(defaultLyricsOffset);
  const [isManuallySet, setIsManuallySet] = useState(false);

  // Refs for stable access inside effects/callbacks without stale closures
  const offsetMsRef = useRef(offsetMs);
  offsetMsRef.current = offsetMs;
  const isManuallySetRef = useRef(isManuallySet);
  isManuallySetRef.current = isManuallySet;

  // Load stored offset when lyricsId changes (new song or lyrics source change).
  // Always resets isManuallySet first so the previous song's state never bleeds in.
  useEffect(() => {
    setIsManuallySet(false);
    if (lyricsId === null) {
      setOffsetMs(defaultLyricsOffset);
      return;
    }
    try {
      const stored = localStorage.getItem(`${OFFSET_KEY_PREFIX}${lyricsId}`);
      if (stored !== null) {
        setIsManuallySet(true);
        setOffsetMs(JSON.parse(stored) as number);
      } else {
        setOffsetMs(defaultLyricsOffset);
      }
    } catch {
      setOffsetMs(defaultLyricsOffset);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lyricsId]);

  // When the global default changes, apply only to songs with no manual override
  useEffect(() => {
    if (!isManuallySetRef.current) {
      setOffsetMs(defaultLyricsOffset);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultLyricsOffset]);

  /** User pressed ±0.5s — always updates state; persists only when lyricsId is known. */
  const adjustOffset = useCallback((deltaMs: number) => {
    const next = offsetMsRef.current + deltaMs;
    setOffsetMs(next);
    setIsManuallySet(true);
    if (lyricsId !== null) {
      try {
        localStorage.setItem(`${OFFSET_KEY_PREFIX}${lyricsId}`, JSON.stringify(next));
      } catch { /* Storage quota exceeded */ }
    }
  }, [lyricsId]);

  /** Clears the manual override, reverting to the current global default. */
  const reset = useCallback(() => {
    setIsManuallySet(false);
    setOffsetMs(defaultLyricsOffset);
    if (lyricsId !== null) {
      try {
        localStorage.removeItem(`${OFFSET_KEY_PREFIX}${lyricsId}`);
      } catch { /* ignore */ }
    }
  }, [lyricsId, defaultLyricsOffset]);

  return { offsetMs, isManuallySet, adjustOffset, reset };
}
