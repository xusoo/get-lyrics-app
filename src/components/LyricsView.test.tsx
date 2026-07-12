import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import type { LyricLine } from '../types';
import { LyricsView } from './LyricsView';

const LINES: LyricLine[] = [
  { timeMs: 0, text: 'first line' },
  { timeMs: 1000, text: 'second line' },
  { timeMs: 2000, text: 'third line' },
];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('LyricsView active-line scroll', () => {
  it('centres the active line via container.scrollTo, never el.scrollIntoView', () => {
    // el.scrollIntoView scrolls every scrollable ancestor on both axes — including
    // the horizontally-scrollable carousel wrapper — which is exactly the bug this
    // guards against (see SongCarousel's overflow-clip wrapper).
    const scrollIntoViewSpy = vi.fn();
    const scrollToSpy = vi.fn();
    // jsdom doesn't implement scrollIntoView/scrollTo on the prototype — assign directly.
    HTMLElement.prototype.scrollIntoView = scrollIntoViewSpy;
    HTMLElement.prototype.scrollTo = scrollToSpy;

    const { rerender } = render(
      <LyricsView
        lines={LINES}
        isSynced
        currentLineIndex={-1}
        fontSize={32}
        status="found"
        trackId="track-1"
      />,
    );
    scrollToSpy.mockClear();

    rerender(
      <LyricsView
        lines={LINES}
        isSynced
        currentLineIndex={1}
        fontSize={32}
        status="found"
        trackId="track-1"
      />,
    );

    expect(scrollIntoViewSpy).not.toHaveBeenCalled();
    expect(scrollToSpy).toHaveBeenCalledTimes(1);
    const [arg] = scrollToSpy.mock.calls[0];
    expect(arg).toMatchObject({ behavior: 'smooth' });
    expect(typeof (arg as ScrollToOptions).top).toBe('number');
  });
});
