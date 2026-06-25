import type { LyricLine } from '../types';

/**
 * Parse an LRC-format string into an array of timed lyric lines.
 * Format: [mm:ss.xx] lyrics text
 */
export function parseLrc(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];
  const lineRegex = /^\[(\d{2}):(\d{2})\.(\d{1,3})\](.*)/;

  for (const raw of lrc.split('\n')) {
    const match = lineRegex.exec(raw.trim());
    if (!match) continue;

    const minutes = parseInt(match[1], 10);
    const seconds = parseInt(match[2], 10);
    const centiseconds = match[3].length === 2 ? parseInt(match[3], 10) * 10 : parseInt(match[3], 10);
    const timeMs = minutes * 60_000 + seconds * 1_000 + centiseconds;
    const text = match[4].trim();

    lines.push({ timeMs, text });
  }

  return lines;
}

/**
 * Shared helper: convert raw synced/plain strings into a parsed result object.
 * Used by both useLyrics (in-memory) and lyrics-store (persisted) to avoid duplication.
 */
export interface ParsedLyricsResult {
  lines: LyricLine[];
  plain: string | null;
  isSynced: boolean;
  status: 'found' | 'not-found';
}

export function parseLyricsResult(synced: string | null, plain: string | null): ParsedLyricsResult {
  if (synced) {
    return { lines: parseLrc(synced), plain, isSynced: true, status: 'found' };
  }
  if (plain) {
    return {
      lines: plain.split('\n').filter((l) => l.trim()).map((text) => ({ timeMs: 0, text })),
      plain,
      isSynced: false,
      status: 'found',
    };
  }
  return { lines: [], plain: null, isSynced: false, status: 'not-found' };
}
