import { useCallback, useEffect, useRef, useState } from 'react';
import { LyricsPicker } from './LyricsPicker';
import { MiniPlayer } from './MiniPlayer';
import { NextPlayingPopup } from './NextPlayingPopup';
import { QueuePanel, type QueueSkipContext } from './QueuePanel';
import { SettingsBar } from './SettingsBar';
import { SettingsPanel } from './SettingsPanel';
import { SongCarousel } from './SongCarousel';
import { SongPanel } from './SongPanel';
import { useCurrentTrack } from '../hooks/useCurrentTrack';
import { useLyrics } from '../hooks/useLyrics';
import { usePlaybackSync } from '../hooks/usePlaybackSync';
import { useSettings } from '../hooks/useSettings';
import { usePerSongOffset } from '../hooks/usePerSongOffset';
import { getNextInQueue, skipToNext, skipToPrevious, skipMultiple, seekTo } from '../lib/spotify';
import type { TokenData, SpotifyTrack, SpotifyUser } from '../types';
import type { SlideDirection, CarouselSlot } from './SongCarousel';
import { Music2 } from 'lucide-react';

interface MainViewProps {
  token: TokenData;
  user: SpotifyUser | null;
  onLogout: () => void;
  onForgetSpotifySetup: () => void;
  onSaveSpotifySetup: (clientId: string, redirectUri?: string) => void;
}

export function MainView({ token, user, onLogout, onForgetSpotifySetup, onSaveSpotifySetup }: MainViewProps) {
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
  /**
   * Direction of the slide currently in progress (mirrors lastSlideDirectionRef
   * as reactive state). Drives the render window: while sliding, the incoming
   * panel is sourced from playback.track so its already-mounted, preloaded DOM
   * is *moved* into the centre rather than rebuilt. Null when not sliding.
   */
  const [slideDir, setSlideDir] = useState<SlideDirection | null>(null);
  const lastSlideDirectionRef = useRef<SlideDirection | null>(null);
  const swipeInProgressRef = useRef(false);
  const pendingDirectionRef = useRef<SlideDirection | null>(null);
  const pendingTargetTrackIdRef = useRef<string | null>(null);
  /** Full track object for the currently displayed track (updated in the track-change effect). */
  const currentTrackObjRef = useRef<SpotifyTrack | null>(null);
  /** The track that was current when a slide started — used in handleSlideComplete. */
  const slideOldCurrentRef = useRef<SpotifyTrack | null>(null);

  // ── Lyrics for all three slots ───────────────────────────────────────────
  const prevLyricsData = useLyrics(prevTrack, 'passive');
  const currentLyrics = useLyrics(playback?.track ?? null, 'current');
  const { openPicker, closePicker, selectCandidate, searchWithQuery, retry: retryLyrics } = currentLyrics;
  const nextLyricsData = useLyrics(nextTrackForLyrics, 'prefetch');

  // Per-song offset, keyed by lrclib entry ID
  const perSongOffset = usePerSongOffset(currentLyrics.selectedId, settings.defaultLyricsOffset);

  // ── Next-track discovery ─────────────────────────────────────────────────
  // Keyed only on track ID so it fires immediately when the track changes —
  // not gated on lyrics loading. This ensures nextTrackRef is populated as
  // soon as the Spotify queue API responds (~0.5 s), so optimistic skip
  // (setOptimisticTrack) is always available even if lyrics are still loading.
  // The useLyrics('prefetch') hook wired to nextTrackForLyrics serialises the
  // actual LRCLIB prefetch through the serial queue (after the current track).
  const nextTrackRef = useRef<SpotifyTrack | null>(null);
  // Look-ahead queue: tracks that follow the immediate next, pre-fetched from
  // Spotify. Consumed synchronously by skip handlers so rapid consecutive clicks
  // get an optimistic update without waiting for a new getNextInQueue call.
  const pendingQueueRef = useRef<SpotifyTrack[]>([]);
  // Set synchronously by handleQueueSkipTo when it seeds nextTrackRef/pendingQueueRef
  // from the queue panel's already-known data. While targetId matches the current
  // track, the discovery effect below trusts that seed over a naive reset/promote
  // and won't let a lagged getNextInQueue response (still containing a
  // skipped-over track) overwrite it — only a clean response clears the guard.
  const authoritativeNextRef = useRef<{ targetId: string; skippedOverIds: string[] } | null>(null);
  useEffect(() => {
    if (!playback) {
      nextTrackRef.current = null;
      pendingQueueRef.current = [];
      authoritativeNextRef.current = null;
      return;
    }

    const currentTrackId = playback.track.id;
    const seeded = authoritativeNextRef.current?.targetId === currentTrackId;

    if (seeded) {
      // Keep the seed as-is; tryDiscoverNext below confirms or retries against it.
    } else {
      authoritativeNextRef.current = null;
      // Natural advancement: promote the pre-fetched look-ahead immediately so the
      // skip button has a target before getNextInQueue responds.
      if (nextTrackRef.current?.id === currentTrackId) {
        nextTrackRef.current = pendingQueueRef.current[0] ?? null;
        pendingQueueRef.current = pendingQueueRef.current.slice(1);
        setNextTrackForLyrics(nextTrackRef.current);
      } else {
        // Unexpected track (shuffle, prev, external skip) — stale look-ahead.
        nextTrackRef.current = null;
        pendingQueueRef.current = [];
        setNextTrackForLyrics(null);
      }
    }

    const ac = new AbortController();
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const tryDiscoverNext = (attempt: number) => {
      getNextInQueue(token.access_token, ac.signal)
        .then((queue) => {
          if (ac.signal.aborted) return;
          // Guard against Spotify including the current track in the queue.
          const upcoming = queue.filter((t) => t.id !== currentTrackId);

          const authoritative = authoritativeNextRef.current;
          if (authoritative && authoritative.targetId === currentTrackId) {
            // Spotify's queue can lag a multi-track skip by several seconds and
            // keep reporting tracks we just skipped over. Treat that as stale
            // and retry rather than clobbering the seeded look-ahead.
            const isStale = upcoming.some((t) => authoritative.skippedOverIds.includes(t.id));
            if (isStale) {
              if (attempt < 3) {
                retryTimer = setTimeout(() => tryDiscoverNext(attempt + 1), 1500);
              }
              return;
            }
            authoritativeNextRef.current = null; // clean queue confirms the seed
          }

          if (upcoming.length === 0) {
            nextTrackRef.current = null;
            pendingQueueRef.current = [];
            if (attempt < 1) {
              retryTimer = setTimeout(() => tryDiscoverNext(attempt + 1), 2000);
            }
            return;
          }
          nextTrackRef.current = upcoming[0];
          pendingQueueRef.current = upcoming.slice(1);
          setNextTrackForLyrics(upcoming[0]);
        })
        .catch(() => {});
    };
    tryDiscoverNext(0);

    return () => {
      ac.abort();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [playback?.track.id]); // eslint-disable-line react-hooks/exhaustive-deps

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

    // A queue-panel jump already seeded the correct "previous" (the real
    // immediate predecessor, which may be several positions behind oldTrack
    // when 2+ tracks were skipped) — don't let the generic oldTrack fallback
    // below clobber it.
    const prevAlreadySeeded = authoritativeNextRef.current?.targetId === newTrack.id;

    if (swipeInProgressRef.current) {
      // The carousel animation was already started by the touch gesture.
      // For right swipes we still need to update the prev slot immediately.
      if (lastSlideDirectionRef.current === 'right' && !prevAlreadySeeded) {
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
      setSlideDir(pendingDir);
      if (pendingDir === 'right' && !prevAlreadySeeded) {
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
      setSlideDir('right');
      prevTrackStateRef.current = oldTrack;
      setPrevTrack(oldTrack);
      setProgrammaticSlide('right');
    } else if (prevTrackStateRef.current?.id === newTrack.id || prevTrack?.id === newTrack.id) {
      // Sequential prev (MiniPlayer button with cached prev) → slide left
      swipeInProgressRef.current = true;
      lastSlideDirectionRef.current = 'left';
      slideOldCurrentRef.current = oldTrack;
      setFrozenCenterTrack(oldTrack);
      setSlideDir('left');
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
      // The discovery effect will re-populate nextTrackRef when the track
      // change commits. Clear the carousel slot only if it still shows the
      // song that just became current.
      const newCurrentId = currentTrackObjRef.current?.id;
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
    setSlideDir(null);
  }, []);

  // Freeze the centre on the current (outgoing) track and record the slide
  // direction in the SAME commit as an optimistic skip. This keeps the keyed
  // carousel window stable between the optimistic track update and the
  // track-change effect that actually starts the animation — without it the
  // window would momentarily re-centre the new track, remounting the outgoing
  // panel (a one-frame flicker). The effect re-applies these idempotently.
  //
  // Guarded by swipeInProgressRef: a rapid second skip while the CSS slide from
  // the FIRST skip is still animating must NOT re-freeze the centre. The CSS
  // transform keeps interpolating along its original path regardless, so
  // reassigning frozenCenterTrack/slideDir mid-flight would swap the window's
  // content out from under the still-animating geometry — visible as a hard
  // seam where two different tracks' backgrounds meet mid-slide. Skipping the
  // re-freeze here leaves the outgoing (centre) track untouched; the new
  // optimistic track still flows into the incoming (next/prev) slot normally.
  const beginPendingSlide = useCallback((direction: SlideDirection) => {
    if (swipeInProgressRef.current) return;
    slideOldCurrentRef.current = currentTrackObjRef.current;
    setFrozenCenterTrack(currentTrackObjRef.current);
    setSlideDir(direction);
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
    // Don't auto-advance when repeat-one is active — Spotify will replay the same track.
    if (playback?.repeat_state === 'track') return;
    pendingDirectionRef.current = 'right';
    pendingTargetTrackIdRef.current = next.id;
    beginPendingSlide('right');
    setOptimisticTrack(next);
  }, [setOptimisticTrack, playback?.repeat_state, beginPendingSlide]);

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
  const handleQueueSkipTo = useCallback((track: SpotifyTrack, skipsNeeded: number, context: QueueSkipContext) => {
    pendingDirectionRef.current = 'right';
    pendingTargetTrackIdRef.current = track.id;
    beginPendingSlide('right');
    // Seed the look-ahead from the queue panel's already-known queue so a
    // lagged getNextInQueue response can't poison "next" with a skipped-over
    // track; the discovery effect trusts this until a clean response confirms it.
    nextTrackRef.current = context.upcomingAfter[0] ?? null;
    pendingQueueRef.current = context.upcomingAfter.slice(1);
    setNextTrackForLyrics(nextTrackRef.current);
    // Seed "previous" with the real immediate predecessor too — skipping 2+
    // tracks at once means the track that was playing before this jump is 2+
    // positions back, not 1, so it's the wrong target for a "previous" tap.
    // The track-change effect below must not overwrite this with oldTrack.
    prevTrackStateRef.current = context.immediatePrev;
    setPrevTrack(context.immediatePrev);
    authoritativeNextRef.current = { targetId: track.id, skippedOverIds: context.skippedOverIds };
    setOptimisticTrack(track, context.skippedOverIds);
    skipMultiple(token.access_token, skipsNeeded).catch((e) => {
      showPlaybackError(e instanceof Error ? e.message : 'Could not skip to that track.');
    });
  }, [token.access_token, setOptimisticTrack, showPlaybackError, beginPendingSlide]);

  const handleSkipNext = useCallback(async () => {
    const next = nextTrackRef.current;
    if (next) {
      // Advance the look-ahead immediately so rapid consecutive clicks also get
      // an optimistic update without waiting for getNextInQueue.
      nextTrackRef.current = pendingQueueRef.current[0] ?? null;
      pendingQueueRef.current = pendingQueueRef.current.slice(1);
      pendingDirectionRef.current = 'right';
      pendingTargetTrackIdRef.current = next.id;
      // Freeze the centre on the outgoing track in the SAME commit as the
      // optimistic switch, so the keyed window never briefly re-centres the new
      // track before the slide starts (which would remount the outgoing panel).
      beginPendingSlide('right');
      setOptimisticTrack(next);
    } else {
      pendingDirectionRef.current = 'right';
      pendingTargetTrackIdRef.current = null;
    }
    try { await skipToNext(token.access_token); } catch (e) {
      showPlaybackError(e instanceof Error ? e.message : 'Could not skip to next track.');
    }
  }, [token.access_token, setOptimisticTrack, showPlaybackError, beginPendingSlide]);

  const handleSkipPrev = useCallback(async () => {
    pendingDirectionRef.current = 'left';
    // If we have the prev track cached, optimistically jump to it — this
    // triggers the track-change effect which starts the left slide immediately.
    const prev = prevTrackStateRef.current;
    pendingTargetTrackIdRef.current = prev?.id ?? null;
    if (prev) {
      beginPendingSlide('left');
      setOptimisticTrack(prev);
    }
    try { await skipToPrevious(token.access_token); } catch (e) {
      showPlaybackError(e instanceof Error ? e.message : 'Could not skip to previous track.');
    }
  }, [token.access_token, setOptimisticTrack, showPlaybackError, beginPendingSlide]);

  // ── Swipe-initiated skip (called by SongCarousel when gesture commits) ────
  const handleSwipeCommit = useCallback((direction: SlideDirection) => {
    swipeInProgressRef.current = true;
    lastSlideDirectionRef.current = direction;
    slideOldCurrentRef.current = currentTrackObjRef.current;
    setFrozenCenterTrack(currentTrackObjRef.current);
    setSlideDir(direction);

    if (direction === 'right') {
      const next = nextTrackRef.current;
      if (next) {
        nextTrackRef.current = pendingQueueRef.current[0] ?? null;
        pendingQueueRef.current = pendingQueueRef.current.slice(1);
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
          slots={((): [CarouselSlot, CarouselSlot, CarouselSlot] => {
            // ── Build the render window [prev, centre, next] ──────────────────
            // Keys are track ids, so React MOVES a panel's DOM (its decoded
            // background <img> and rendered lyrics) as the window shifts, rather
            // than rebuilding it in a fixed slot — which is what flashed.
            //
            // While a slide is in progress the centre shows the OUTGOING track
            // (frozenCenterTrack), and the INCOMING track (playback.track — the
            // song we optimistically skipped to, whose panel is already mounted
            // as the preloaded next/prev slot) fills the slot it slides in from.
            // That keeps the incoming panel's key stable from preloaded-slot →
            // sliding-slot → centre, so it is never rebuilt. We deliberately do
            // NOT use nextTrackForLyrics here: the discovery effect repurposes it
            // as the *prefetch* look-ahead the instant the track changes.
            const activeId = playback.track.id;
            const outgoing = frozenCenterTrack;
            const incoming = outgoing && playback.track.id !== outgoing.id ? playback.track : null;

            let prevW: SpotifyTrack | null;
            let centerW: SpotifyTrack | null;
            let nextW: SpotifyTrack | null;
            if (outgoing && slideDir === 'right') {
              centerW = outgoing;
              nextW = incoming; // same id as the pre-slide next slot → DOM preserved
              prevW = null;
            } else if (outgoing && slideDir === 'left') {
              centerW = outgoing;
              prevW = incoming; // same id as the pre-slide prev slot → DOM preserved
              nextW = null;
            } else {
              centerW = forceLoadingCenter ? null : playback.track;
              prevW = prevTrack && prevTrack.id !== centerW?.id ? prevTrack : null;
              nextW =
                nextTrackForLyrics &&
                nextTrackForLyrics.id !== centerW?.id &&
                nextTrackForLyrics.id !== prevW?.id
                  ? nextTrackForLyrics
                  : null;
            }

            // Resolve a window track's lyrics from whichever position-hook
            // currently holds it, so content follows the *track* (not the slot)
            // through a shift. Prev/next are checked before current so that at
            // the exact frame playback.track flips, the incoming track still
            // reads its already-loaded prefetch state instead of the current
            // hook's not-yet-updated one — avoiding a one-frame lyric flicker.
            const lyricsFor = (t: SpotifyTrack | null) => {
              if (!t) return null;
              if (t.id === nextTrackForLyrics?.id) return nextLyricsData;
              if (t.id === prevTrack?.id) return prevLyricsData;
              if (t.id === activeId) return currentLyrics;
              return null;
            };

            const panel = (t: SpotifyTrack | null) => {
              const ly = lyricsFor(t);
              const active = t !== null && t.id === activeId;
              return (
                <SongPanel
                  track={t}
                  lines={ly?.lines ?? []}
                  isSynced={ly?.isSynced ?? false}
                  lyricsStatus={ly ? ly.status : t ? 'loading' : 'idle'}
                  currentLineIndex={active ? currentLineIndex : -1}
                  fontSize={settings.fontSize}
                  onSeek={active ? handleSeek : undefined}
                  onRetry={active ? retryLyrics : undefined}
                />
              );
            };

            return [
              { key: prevW?.id ?? '__empty_prev', content: panel(prevW) },
              { key: centerW?.id ?? '__empty_center', content: panel(centerW) },
              { key: nextW?.id ?? '__empty_next', content: panel(nextW) },
            ];
          })()}
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
        user={user}
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

      {playback && (
        <NextPlayingPopup
          playback={playback}
          nextTrack={nextTrackForLyrics}
          getInterpolatedMs={getInterpolatedMs}
          onSkip={handleSkipNext}
          suppressed={queuePanelOpen}
        />
      )}

      <QueuePanel
        isOpen={queuePanelOpen}
        accessToken={token.access_token}
        currentTrackId={playback?.track.id ?? null}
        seedCurrentTrack={playback?.track ?? null}
        nextTrackRef={nextTrackRef}
        pendingQueueRef={pendingQueueRef}
        onClose={() => setQueuePanelOpen(false)}
        onSkipTo={handleQueueSkipTo}
      />
    </div>
  );
}

