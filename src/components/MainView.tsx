import { useCallback, useEffect, useRef, useState } from 'react';
import { LyricsPicker } from './LyricsPicker';
import { MiniPlayer } from './MiniPlayer';
import { QueuePanel } from './QueuePanel';
import { SettingsBar } from './SettingsBar';
import { SettingsPanel } from './SettingsPanel';
import { SongCarousel } from './SongCarousel';
import { SongPanel } from './SongPanel';
import { useCurrentTrack } from '../hooks/useCurrentTrack';
import { useLyrics, prefetchLyrics } from '../hooks/useLyrics';
import { usePlaybackSync } from '../hooks/usePlaybackSync';
import { useSettings } from '../hooks/useSettings';
import { usePerSongOffset } from '../hooks/usePerSongOffset';
import { getNextInQueue, skipToNext, skipToPrevious, skipMultiple, seekTo } from '../lib/spotify';
import type { TokenData, SpotifyTrack } from '../types';
import type { SlideDirection } from './SongCarousel';
import { Music2 } from 'lucide-react';

interface MainViewProps {
  token: TokenData;
  onLogout: () => void;
  onForgetSpotifySetup: () => void;
  onSaveSpotifySetup: (clientId: string, redirectUri?: string) => void;
}

export function MainView({ token, onLogout, onForgetSpotifySetup, onSaveSpotifySetup }: MainViewProps) {
  const {
    settings,
    increaseFontSize,
    decreaseFontSize,
    resetFontSize,
    adjustDefaultOffset,
    resetDefaultOffset,
    setUIFontSize,
    setBackgroundBlur,
    setBackgroundDim,
    setCacheMaxTTL,
    setCacheMaxEntries,
    clearCache,
  } = useSettings();
  const { playback, loading, isOffline, setOptimisticTrack } = useCurrentTrack(token);
  const [settingsPanelOpen, setSettingsPanelOpen] = useState(false);
  const [queuePanelOpen, setQueuePanelOpen] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const playbackErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showPlaybackError = useCallback((msg: string) => {
    setPlaybackError(msg);
    if (playbackErrorTimerRef.current) clearTimeout(playbackErrorTimerRef.current);
    playbackErrorTimerRef.current = setTimeout(() => setPlaybackError(null), 4000);
  }, []);

  // Apply UI settings to CSS variables
  useEffect(() => {
    document.documentElement.style.fontSize = `${settings.uiFontSize}px`;
    document.documentElement.style.setProperty('--ui-scale', String(settings.uiFontSize / 16));
    document.documentElement.style.setProperty('--bg-blur', `${settings.backgroundBlur * 0.8}px`);
    document.documentElement.style.setProperty('--bg-dim', String(settings.backgroundDim / 100));
  }, [settings.uiFontSize, settings.backgroundBlur, settings.backgroundDim]);

  // ── Three carousel slot tracks ────────────────────────────────────────────
  const [prevTrack, setPrevTrack] = useState<SpotifyTrack | null>(null);
  /** Ref mirror of prevTrack for stable access inside callbacks/effects. */
  const prevTrackStateRef = useRef<SpotifyTrack | null>(null);
  const [nextTrackForLyrics, setNextTrackForLyrics] = useState<SpotifyTrack | null>(null);
  /**
   * When true the centre panel renders as a loading spinner regardless of
   * playback.track — used after a left swipe when we had no cached prev track
   * and haven't yet received the new current track from Spotify's poll.
   */
  const [forceLoadingCenter, setForceLoadingCenter] = useState(false);
  const [frozenCenterTrack, setFrozenCenterTrack] = useState<SpotifyTrack | null>(null);

  // ── Slide orchestration ───────────────────────────────────────────────────
  const [programmaticSlide, setProgrammaticSlide] = useState<SlideDirection | null>(null);
  const lastSlideDirectionRef = useRef<SlideDirection | null>(null);
  const swipeInProgressRef = useRef(false);
  const pendingDirectionRef = useRef<SlideDirection | null>(null);
  const pendingTargetTrackIdRef = useRef<string | null>(null);
  /** Full track object for the currently displayed track (updated in the track-change effect). */
  const currentTrackObjRef = useRef<SpotifyTrack | null>(null);
  /** The track that was current when a slide started — used in handleSlideComplete. */
  const slideOldCurrentRef = useRef<SpotifyTrack | null>(null);

  // ── Lyrics for all three slots ───────────────────────────────────────────
  const prevLyricsData = useLyrics(prevTrack);
  const currentLyrics = useLyrics(playback?.track ?? null);
  const { openPicker, closePicker, selectCandidate, searchWithQuery, retry: retryLyrics } = currentLyrics;
  const nextLyricsData = useLyrics(nextTrackForLyrics);

  // Per-song offset, keyed by lrclib entry ID
  const perSongOffset = usePerSongOffset(currentLyrics.selectedId, settings.defaultLyricsOffset);

  // ── Prefetch next-queued track lyrics ─────────────────────────────────────
  const prefetchedForRef = useRef<string | null>(null);
  const nextTrackRef = useRef<SpotifyTrack | null>(null);
  useEffect(() => {
    const TERMINAL = ['found', 'not-found', 'error', 'picking'] as const;
    if (!playback || !(TERMINAL as readonly string[]).includes(currentLyrics.status)) return;
    if (prefetchedForRef.current === playback.track.id) return;
    prefetchedForRef.current = playback.track.id;
    nextTrackRef.current = null;
    const currentTrackId = playback.track.id;
    const tryPrefetchNext = (attempt: number) => {
      getNextInQueue(token.access_token)
        .then((next) => {
          if (!next || next.id === currentTrackId) {
            if (attempt < 1 && prefetchedForRef.current === currentTrackId) {
              setTimeout(() => tryPrefetchNext(attempt + 1), 2000);
            }
            return;
          }
          nextTrackRef.current = next;
          prefetchLyrics(next);
          setNextTrackForLyrics(next);
        })
        .catch(() => {});
    };
    tryPrefetchNext(0);
  }, [playback?.track.id, currentLyrics.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Detect track changes and decide slide direction ───────────────────────
  useEffect(() => {
    const newTrack = playback?.track ?? null;
    const oldTrack = currentTrackObjRef.current;
    currentTrackObjRef.current = newTrack;

    // Whenever we get a real new track, clear any stale loading-centre flag.
    if (newTrack !== null && newTrack?.id !== oldTrack?.id) {
      setForceLoadingCenter(false);
    }

    if (!oldTrack || !newTrack || oldTrack.id === newTrack.id) return;

    if (swipeInProgressRef.current) {
      // The carousel animation was already started by the touch gesture.
      // For right swipes we still need to update the prev slot immediately.
      if (lastSlideDirectionRef.current === 'right') {
        prevTrackStateRef.current = oldTrack;
        setPrevTrack(oldTrack);
      }
      return;
    }

    // MiniPlayer-triggered next/prev always animates, even if queue prefetch
    // state changed before this poll landed.
    const pendingDir = pendingDirectionRef.current;
    if (pendingDir) {
      pendingDirectionRef.current = null;
      pendingTargetTrackIdRef.current = null;
      swipeInProgressRef.current = true;
      lastSlideDirectionRef.current = pendingDir;
      slideOldCurrentRef.current = oldTrack;
      setFrozenCenterTrack(oldTrack);
      if (pendingDir === 'right') {
        prevTrackStateRef.current = oldTrack;
        setPrevTrack(oldTrack);
      }
      setProgrammaticSlide(pendingDir);
      return;
    }
    // Pending intent no longer matches reality (e.g. user changed track elsewhere).
    pendingDirectionRef.current = null;
    pendingTargetTrackIdRef.current = null;

    if (nextTrackRef.current?.id === newTrack.id || nextTrackForLyrics?.id === newTrack.id) {
      // Sequential next → slide right
      swipeInProgressRef.current = true;
      lastSlideDirectionRef.current = 'right';
      slideOldCurrentRef.current = oldTrack;
      setFrozenCenterTrack(oldTrack);
      prevTrackStateRef.current = oldTrack;
      setPrevTrack(oldTrack);
      setProgrammaticSlide('right');
    } else if (prevTrackStateRef.current?.id === newTrack.id || prevTrack?.id === newTrack.id) {
      // Sequential prev (MiniPlayer button with cached prev) → slide left
      swipeInProgressRef.current = true;
      lastSlideDirectionRef.current = 'left';
      slideOldCurrentRef.current = oldTrack;
      setFrozenCenterTrack(oldTrack);
      setProgrammaticSlide('left');
    } else {
      // Non-sequential (Spotify jumped to an arbitrary track) → instant swap
      prevTrackStateRef.current = oldTrack;
      setPrevTrack(oldTrack);
      setNextTrackForLyrics(null);
    }
  }, [playback?.track.id, nextTrackForLyrics?.id, prevTrack?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Slide complete — rearrange slots BEFORE the transform snaps back ──────
  // This runs inside flushSync so React commits the DOM before the carousel
  // resets its translateX, preventing any visible flash of stale content.
  const handleSlideComplete = useCallback(() => {
    const dir = lastSlideDirectionRef.current;
    swipeInProgressRef.current = false;
    lastSlideDirectionRef.current = null;
    setProgrammaticSlide(null);

    if (dir === 'right') {
      // The old "next" is now the current track. Clear the next slot so the
      // prefetch effect can populate it with the track that follows the new current.
      const newCurrentId = currentTrackObjRef.current?.id;
      nextTrackRef.current = null;
      setNextTrackForLyrics((prev) => (prev?.id === newCurrentId ? null : prev));
    } else if (dir === 'left') {
      // The old current becomes the "next" (so a right swipe can return to it).
      const oldCurrent = slideOldCurrentRef.current;
      setNextTrackForLyrics(oldCurrent);
      if (oldCurrent) nextTrackRef.current = oldCurrent;
      prevTrackStateRef.current = null;
      setPrevTrack(null);
    }
    slideOldCurrentRef.current = null;
    setFrozenCenterTrack(null);
  }, []);

  // ── Close lyrics picker on track change ──────────────────────────────────
  const prevTrackIdRef = useRef<string | null>(null);
  useEffect(() => {
    const currentId = playback?.track.id ?? null;
    if (prevTrackIdRef.current !== null && prevTrackIdRef.current !== currentId) {
      if (currentLyrics.status === 'picking') closePicker();
    }
    prevTrackIdRef.current = currentId;
  }, [playback?.track.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-advance at song end ──────────────────────────────────────────────
  // Fires from the usePlaybackSync rAF loop ~500 ms before the track ends.
  // Mirrors the optimistic-skip path: no skipToNext call — Spotify advances on
  // its own; we just pre-flip the carousel so there's no polling gap (~3 s).
  const handleTrackEnded = useCallback(() => {
    const next = nextTrackRef.current;
    if (!next || swipeInProgressRef.current || pendingDirectionRef.current) return;
    pendingDirectionRef.current = 'right';
    pendingTargetTrackIdRef.current = next.id;
    setOptimisticTrack(next);
  }, [setOptimisticTrack]);

  // ── Playback sync (only for the active centre panel) ─────────────────────
  const { currentLineIndex, getInterpolatedMs, setOptimisticSeek } = usePlaybackSync(
    playback,
    currentLyrics.lines,
    perSongOffset.offsetMs,
    handleTrackEnded,
  );

  // ── Seek handler — shared by MiniPlayer progress bar and lyric line taps ────
  const handleSeek = useCallback((ms: number) => {
    setOptimisticSeek(ms);
    seekTo(token.access_token, ms).catch((e) => {
      showPlaybackError(e instanceof Error ? e.message : 'Could not seek.');
    });
  }, [token.access_token, setOptimisticSeek, showPlaybackError]);

  // ── Skip handlers ─────────────────────────────────────────────────────────

  // Queue panel: optimistically update + slide before the API responds
  const handleQueueSkipTo = useCallback((track: SpotifyTrack, skipsNeeded: number) => {
    pendingDirectionRef.current = 'right';
    pendingTargetTrackIdRef.current = track.id;
    setOptimisticTrack(track);
    skipMultiple(token.access_token, skipsNeeded).catch((e) => {
      showPlaybackError(e instanceof Error ? e.message : 'Could not skip to that track.');
    });
  }, [token.access_token, setOptimisticTrack, showPlaybackError]);

  const handleSkipNext = useCallback(async () => {
    const next = nextTrackRef.current;
    if (next) {
      pendingDirectionRef.current = 'right';
      pendingTargetTrackIdRef.current = next.id;
      setOptimisticTrack(next);
    } else {
      pendingDirectionRef.current = 'right';
      pendingTargetTrackIdRef.current = null;
    }
    try { await skipToNext(token.access_token); } catch (e) {
      showPlaybackError(e instanceof Error ? e.message : 'Could not skip to next track.');
    }
  }, [token.access_token, setOptimisticTrack, showPlaybackError]);

  const handleSkipPrev = useCallback(async () => {
    pendingDirectionRef.current = 'left';
    // If we have the prev track cached, optimistically jump to it — this
    // triggers the track-change effect which starts the left slide immediately.
    const prev = prevTrackStateRef.current;
    pendingTargetTrackIdRef.current = prev?.id ?? null;
    if (prev) setOptimisticTrack(prev);
    try { await skipToPrevious(token.access_token); } catch (e) {
      showPlaybackError(e instanceof Error ? e.message : 'Could not skip to previous track.');
    }
  }, [token.access_token, setOptimisticTrack, showPlaybackError]);

  // ── Swipe-initiated skip (called by SongCarousel when gesture commits) ────
  const handleSwipeCommit = useCallback((direction: SlideDirection) => {
    swipeInProgressRef.current = true;
    lastSlideDirectionRef.current = direction;
    slideOldCurrentRef.current = currentTrackObjRef.current;
    setFrozenCenterTrack(currentTrackObjRef.current);

    if (direction === 'right') {
      const next = nextTrackRef.current;
      if (next) {
        nextTrackRef.current = null;
        setOptimisticTrack(next);
      }
      skipToNext(token.access_token).catch(() => {});
    } else {
      const prev = prevTrackStateRef.current;
      if (prev) {
        setOptimisticTrack(prev);
      } else {
        // No cached prev — centre shows loading until the Spotify poll resolves.
        setForceLoadingCenter(true);
      }
      skipToPrevious(token.access_token).catch(() => {});
    }
  }, [token.access_token, setOptimisticTrack]);

  return (
    <div className="relative min-h-0 flex flex-col overflow-hidden text-white bg-neutral-950" style={{ height: 'var(--full-height)' }}>
      {isOffline && (
        <div className="fixed top-0 left-0 right-0 z-50 flex justify-center" role="status" aria-live="polite">
          <div className="mt-2 px-4 py-1.5 bg-yellow-500/20 border border-yellow-500/40 rounded-full text-yellow-300 text-xs backdrop-blur-md">
            Connection lost — retrying…
          </div>
        </div>
      )}

      {playbackError && (
        <div className="fixed top-0 left-0 right-0 z-50 flex justify-center" role="status" aria-live="assertive">
          <div className="mt-2 px-4 py-1.5 bg-red-500/20 border border-red-500/40 rounded-full text-red-300 text-xs backdrop-blur-md max-w-xs text-center">
            {playbackError}
          </div>
        </div>
      )}

      <SettingsBar
        offsetMs={perSongOffset.offsetMs}
        isManuallySet={perSongOffset.isManuallySet}
        onAdjustOffset={perSongOffset.adjustOffset}
        onResetOffset={perSongOffset.reset}
        onOpenSettings={() => setSettingsPanelOpen(true)}
        onOpenPicker={openPicker}
      />

      {loading ? (
        <div className="flex-1 flex items-center justify-center opacity-40">
          <div className="w-8 h-8 border-2 border-white/40 border-t-white rounded-full animate-spin" />
        </div>
      ) : !playback ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 opacity-50 pb-36">
          <Music2 size={64} className="text-white" />
          <p className="text-white text-xl font-medium">Play something on Spotify</p>
          <p className="text-white/60 text-sm">Lyrics will appear here automatically</p>
        </div>
      ) : (
        <SongCarousel
          prev={
            <SongPanel
              track={prevTrack}
              lines={prevLyricsData.lines}
              isSynced={prevLyricsData.isSynced}
              lyricsStatus={prevLyricsData.status}
              currentLineIndex={-1}
              fontSize={settings.fontSize}
            />
          }
          current={
            <SongPanel
              track={forceLoadingCenter ? null : (frozenCenterTrack ?? playback.track)}
              lines={currentLyrics.lines}
              isSynced={currentLyrics.isSynced}
              lyricsStatus={currentLyrics.status}
              currentLineIndex={currentLineIndex}
              fontSize={settings.fontSize}
              onSeek={handleSeek}
              onRetry={retryLyrics}
            />
          }
          next={
            <SongPanel
              track={nextTrackForLyrics}
              lines={nextLyricsData.lines}
              isSynced={nextLyricsData.isSynced}
              lyricsStatus={nextLyricsData.status}
              currentLineIndex={-1}
              fontSize={settings.fontSize}
            />
          }
          slideDirection={programmaticSlide}
          onSlideComplete={handleSlideComplete}
          onSlideCommit={handleSwipeCommit}
        />
      )}

      {currentLyrics.status === 'picking' && (
        <LyricsPicker
          candidates={currentLyrics.candidates}
          query={currentLyrics.pickerQuery}
          isSearching={currentLyrics.isSearching}
          selectedId={currentLyrics.selectedId}
          recommendedId={currentLyrics.recommendedId}
          onSelect={(c) => { selectCandidate(c); }}
          onSearch={searchWithQuery}
          onClose={closePicker}
        />
      )}

      <SettingsPanel
        isOpen={settingsPanelOpen}
        settings={settings}
        onClose={() => setSettingsPanelOpen(false)}
        onSetUIFontSize={setUIFontSize}
        onIncreaseLyricsFontSize={increaseFontSize}
        onDecreaseLyricsFontSize={decreaseFontSize}
        onResetLyricsFontSize={resetFontSize}
        onAdjustDefaultOffset={adjustDefaultOffset}
        onResetDefaultOffset={resetDefaultOffset}
        onSetBackgroundBlur={setBackgroundBlur}
        onSetBackgroundDim={setBackgroundDim}
        onSetCacheMaxTTL={setCacheMaxTTL}
        onSetCacheMaxEntries={setCacheMaxEntries}
        onClearCache={clearCache}
        onLogout={onLogout}
        onForgetSpotifySetup={onForgetSpotifySetup}
        onSaveSpotifySetup={onSaveSpotifySetup}
      />

      {playback && (
        <MiniPlayer
          playback={playback}
          accessToken={token.access_token}
          getInterpolatedMs={getInterpolatedMs}
          onNext={handleSkipNext}
          onPrev={handleSkipPrev}
          queueOpen={queuePanelOpen}
          onToggleQueue={() => setQueuePanelOpen((o) => !o)}
          onSeek={handleSeek}
          onPlaybackError={showPlaybackError}
        />
      )}

      <QueuePanel
        isOpen={queuePanelOpen}
        accessToken={token.access_token}
        currentTrackId={playback?.track.id ?? null}
        onClose={() => setQueuePanelOpen(false)}
        onSkipTo={handleQueueSkipTo}
      />
    </div>
  );
}

