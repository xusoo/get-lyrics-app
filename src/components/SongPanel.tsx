import { Background } from './Background';
import { LyricsView } from './LyricsView';
import type { SpotifyTrack, LyricLine } from '../types';

interface SongPanelProps {
  track: SpotifyTrack | null;
  lines: LyricLine[];
  isSynced: boolean;
  /** Accepts 'picking' — will be normalised to 'found' or 'not-found' internally. */
  lyricsStatus: 'idle' | 'loading' | 'found' | 'not-found' | 'error' | 'picking';
  currentLineIndex: number;
  fontSize: number;
  /** Omit for inactive panels to disable seek-on-tap. */
  onSeek?: (ms: number) => void;
  onRetry?: () => void;
}

export function SongPanel({
  track,
  lines,
  isSynced,
  lyricsStatus,
  currentLineIndex,
  fontSize,
  onSeek,
  onRetry,
}: SongPanelProps) {
  const images = track?.album.images ?? [];
  const trackId = track?.id ?? null;

  // LyricsView doesn't know about 'picking'; convert it to the appropriate display state.
  const viewStatus: 'idle' | 'loading' | 'found' | 'not-found' | 'error' =
    lyricsStatus === 'picking'
      ? lines.length > 0 ? 'found' : 'not-found'
      : lyricsStatus;

  return (
    // isolation:isolate creates a stacking context so the -z-10 Background
    // stays behind this panel's content without bleeding behind the carousel.
    <div
      className="relative flex-shrink-0 flex flex-col overflow-hidden isolate h-full min-h-0"
      style={{ width: '100vw' }}
    >
      <Background images={images} />
      <LyricsView
        lines={lines}
        isSynced={isSynced}
        currentLineIndex={currentLineIndex}
        fontSize={fontSize}
        onSeek={onSeek}
        status={track === null ? 'loading' : viewStatus}
        trackId={trackId}
        onRetry={onRetry}
      />
    </div>
  );
}
