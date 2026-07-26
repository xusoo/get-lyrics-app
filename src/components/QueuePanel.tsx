import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { X, Music, Loader2, ListMusic } from 'lucide-react';
import { getQueue } from '../lib/spotify';
import type { SpotifyTrack } from '../types';

interface QueueEntry {
  track: SpotifyTrack;
  /** 0 = currently playing; 1 = next up; 2 = two skips away, etc. */
  skipsNeeded: number;
}

export interface QueueSkipContext {
  /** Tracks between the previous skip target and this one — transiently visible during propagation. */
  skippedOverIds: string[];
  /** Tracks known (from the already-fetched queue) to follow the skip target. */
  upcomingAfter: SpotifyTrack[];
  /**
   * The track immediately preceding the target in the real queue order — i.e.
   * the track a "previous" tap should land on. Note this is NOT necessarily
   * the track that was playing when the tap happened: skipping 2+ tracks at
   * once means that track is 2+ positions back, not 1.
   */
  immediatePrev: SpotifyTrack | null;
}

interface QueuePanelProps {
  isOpen: boolean;
  accessToken: string;
  currentTrackId: string | null;
  /**
   * Already-known current/upcoming tracks (from MainView's own queue
   * prefetch) to render instantly on open, before the panel's own fetch
   * resolves. The look-ahead is passed as refs (read only inside effects,
   * never during render) since MainView mutates them outside React state.
   */
  seedCurrentTrack: SpotifyTrack | null;
  nextTrackRef: RefObject<SpotifyTrack | null>;
  pendingQueueRef: RefObject<SpotifyTrack[]>;
  onClose: () => void;
  onSkipTo: (track: SpotifyTrack, skipsNeeded: number, context: QueueSkipContext) => void;
  /** Anchor to the bottom-left instead of the default bottom-right. */
  anchorLeft?: boolean;
}

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

interface QueueRowProps {
  entry: QueueEntry;
  isOptimisticCurrent: boolean;
  isDimmed: boolean;
  isDisabled: boolean;
  onClick: () => void;
  /** True for rows present at the panel's initial reveal — render at full size immediately. Rows added later (e.g. the look-ahead backfilling a slot) animate in instead, so the panel doesn't visibly jump. Read only at mount; later prop changes don't retroactively affect an already-settled row. */
  instant: boolean;
}

function QueueRow({ entry, isOptimisticCurrent, isDimmed, isDisabled, onClick, instant }: QueueRowProps) {
  const [entered, setEntered] = useState(instant);
  useEffect(() => {
    if (instant) return;
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the mount-time value of `instant` matters
  }, []);

  const { track } = entry;
  const artwork = track.album.images[track.album.images.length - 1]?.url
    ?? track.album.images[0]?.url;

  return (
    <div
      className="grid transition-[grid-template-rows] duration-300 ease-out"
      style={{ gridTemplateRows: entered ? '1fr' : '0fr' }}
    >
      <div className="overflow-hidden">
        <button
          onClick={onClick}
          disabled={isDisabled}
          className={[
            'w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors transition-opacity duration-300',
            entered ? 'opacity-100' : 'opacity-0',
            isOptimisticCurrent
              ? 'bg-white/8 cursor-default'
              : isDimmed
                ? 'opacity-40 cursor-not-allowed'
                : 'hover:bg-white/10 active:bg-white/15 cursor-pointer',
          ].join(' ')}
        >
          {/* Thumbnail */}
          <div className="w-9 h-9 rounded-lg flex-shrink-0 overflow-hidden bg-white/10 flex items-center justify-center">
            {artwork ? (
              <img src={artwork} alt="" className="w-full h-full object-cover" />
            ) : (
              <Music size={14} className="text-white/40" />
            )}
          </div>

          {/* Track info */}
          <div className="flex-1 min-w-0">
            <p className={[
              'text-xs font-medium truncate leading-snug',
              isOptimisticCurrent ? 'text-green-400' : 'text-white/90',
            ].join(' ')}>
              {track.name}
            </p>
            <p className="text-white/45 text-xs truncate mt-0.5">
              {track.artists.map((a) => a.name).join(', ')}
            </p>
          </div>

          {/* Status indicator */}
          <div className="flex-shrink-0 flex items-center">
            {isOptimisticCurrent ? (
              <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
            ) : (
              <span className="text-white/25 text-xs tabular-nums">
                {formatDuration(track.duration_ms)}
              </span>
            )}
          </div>
        </button>
      </div>
    </div>
  );
}

export function QueuePanel({ isOpen, accessToken, currentTrackId, seedCurrentTrack, nextTrackRef, pendingQueueRef, onClose, onSkipTo, anchorLeft }: QueuePanelProps) {
  const [entries, setEntries] = useState<QueueEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [pendingSkip, setPendingSkip] = useState<{ trackId: string; skipsNeeded: number } | null>(null);
  // False for the panel's initial reveal on open (those rows render at full
  // size instantly); flips true once shown, so any row added afterwards
  // (e.g. the look-ahead backfilling a slot) animates in instead of popping.
  // Resets on close so the next open is instant again. Derived directly in
  // the render body (rather than an effect) per React's guidance for state
  // that adjusts in response to a prop change, avoiding an extra render pass.
  const [revealed, setRevealed] = useState(false);
  const prevIsOpenForRevealRef = useRef(isOpen);
  if (prevIsOpenForRevealRef.current !== isOpen) {
    prevIsOpenForRevealRef.current = isOpen;
    if (!isOpen && revealed) setRevealed(false);
  }
  if (isOpen && !revealed && entries.length > 0) setRevealed(true);
  const accessTokenRef = useRef(accessToken);
  accessTokenRef.current = accessToken;
  const seedCurrentTrackRef = useRef(seedCurrentTrack);
  seedCurrentTrackRef.current = seedCurrentTrack;
  const currentTrackIdRef = useRef(currentTrackId);
  currentTrackIdRef.current = currentTrackId;
  const delayedRefreshRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    async function attempt(n: number): Promise<void> {
      if (n === 0) setLoading(true);
      try {
        const result = await getQueue(accessTokenRef.current);
        // Spotify's queue endpoint can keep reporting the track we just left
        // as "currently playing" for a couple of seconds after a skip. Don't
        // let that stale answer regress an already-correct seeded display —
        // retry instead, same as MainView's own next-track discovery does.
        const expected = currentTrackIdRef.current;
        const isStale = !!expected && !!result.currentlyPlaying && result.currentlyPlaying.id !== expected;
        if (isStale) {
          if (n < 3) {
            await new Promise((resolve) => setTimeout(resolve, 800));
            await attempt(n + 1);
          } else {
            setLoading(false);
          }
          return;
        }
        const all: QueueEntry[] = [];
        if (result.currentlyPlaying) {
          all.push({ track: result.currentlyPlaying, skipsNeeded: 0 });
        }
        result.queue.slice(0, 5).forEach((t, i) => all.push({ track: t, skipsNeeded: i + 1 }));
        setEntries(all);
        setPendingSkip(null);
        setLoading(false);
      } catch {
        // Transient failures (token refresh race, momentary 5xx) get one
        // retry before giving up, so the panel doesn't need a manual
        // close/reopen.
        if (n < 1) {
          await new Promise((resolve) => setTimeout(resolve, 1500));
          await attempt(n + 1);
        } else {
          setLoading(false);
        }
      }
    }
    await attempt(0);
  }, []);

  // Builds the visible list from MainView's continuously-updated look-ahead
  // (kept fresh regardless of whether this panel is open) so the panel never
  // shows leftover stale entries from before it was last closed — refresh()
  // still runs after to confirm/correct against the authoritative fetch.
  const seedEntries = useCallback(() => {
    const seedCurrent = seedCurrentTrackRef.current;
    const seedNext = nextTrackRef.current;
    const seedUpcomingTracks = pendingQueueRef.current;
    if (!seedCurrent && !seedNext) return;
    const seeded: QueueEntry[] = [];
    if (seedCurrent) seeded.push({ track: seedCurrent, skipsNeeded: 0 });
    if (seedNext) seeded.push({ track: seedNext, skipsNeeded: 1 });
    // Cap to match refresh()'s own display limit (5 upcoming total, incl. seedNext)
    // — the underlying buffer is intentionally kept larger than this for headroom.
    seedUpcomingTracks.slice(0, 4).forEach((t, i) => seeded.push({ track: t, skipsNeeded: i + 2 }));
    setEntries(seeded);
  }, [nextTrackRef, pendingQueueRef]);

  // Re-seed and re-fetch every time the panel opens, so it reflects the
  // current song/queue immediately rather than whatever was last displayed.
  useEffect(() => {
    if (!isOpen) return;
    seedEntries();
    void refresh();
  }, [isOpen, refresh, seedEntries]);

  // Re-seed and re-fetch when the playing track changes while already open
  // (natural song end, external skip, etc.), so a live panel updates without
  // needing to be closed and reopened. Skip the immediate refresh after a
  // queue-tap — Spotify won't reflect the change yet; the delayed refresh
  // scheduled in handleSkipTo will sync later. prevTrackIdRef is kept in sync
  // even while closed so reopening doesn't also trigger a redundant refresh
  // here on top of the open-effect above.
  const prevTrackIdRef = useRef<string | null>(null);
  useEffect(() => {
    const changed = currentTrackId !== prevTrackIdRef.current;
    prevTrackIdRef.current = currentTrackId;
    if (!isOpen || !changed) return;
    if (!delayedRefreshRef.current) {
      seedEntries();
      void refresh();
    }
  }, [currentTrackId, isOpen, refresh, seedEntries]);

  // Clear any pending refresh timeout on unmount
  useEffect(() => () => {
    if (delayedRefreshRef.current) clearTimeout(delayedRefreshRef.current);
  }, []);

  function handleSkipTo(track: SpotifyTrack, skipsNeeded: number) {
    if (skipsNeeded === 0) return;
    // Rows stay in place (dimmed instead of removed); onSkipTo still needs the
    // *incremental* skip count relative to whatever was last marked current,
    // since it maps directly to a batch of sequential "next" calls.
    const baseline = pendingSkip?.skipsNeeded ?? 0;
    const relativeSkip = skipsNeeded - baseline;
    // Everything strictly between the last-known-current and the new target is
    // being skipped over — Spotify may transiently report these mid-skip.
    const skippedOverIds = entries
      .filter((e) => e.skipsNeeded > baseline && e.skipsNeeded < skipsNeeded)
      .map((e) => e.track.id);
    // Already-fetched entries known to follow the target — seeds the look-ahead
    // instantly instead of waiting on a (possibly lagged) getNextInQueue call.
    const upcomingAfter = entries
      .filter((e) => e.skipsNeeded > skipsNeeded)
      .map((e) => e.track);
    // The real immediate predecessor is always at skipsNeeded - 1 (an absolute
    // position from the actual currently-playing track), regardless of any
    // earlier pending tap — unlike skippedOverIds, it needs no baseline.
    const immediatePrev = entries.find((e) => e.skipsNeeded === skipsNeeded - 1)?.track ?? null;
    setPendingSkip({ trackId: track.id, skipsNeeded });
    // Spotify needs time to process the skip before getQueue is accurate.
    if (delayedRefreshRef.current) clearTimeout(delayedRefreshRef.current);
    delayedRefreshRef.current = setTimeout(() => {
      delayedRefreshRef.current = null;
      void refresh();
    }, 2500);
    onSkipTo(track, relativeSkip, { skippedOverIds, upcomingAfter, immediatePrev });
  }

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-40"
      onClick={(e) => { e.stopPropagation(); onClose(); }}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
    <div
      className={[
        'absolute bottom-[130px] w-72 max-h-[55vh] flex flex-col rounded-2xl bg-black/85 backdrop-blur-xl border border-white/10 shadow-2xl overflow-hidden',
        anchorLeft ? 'left-4' : 'right-4',
      ].join(' ')}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 flex-shrink-0">
        <div className="flex items-center gap-2">
          <ListMusic size={14} className="text-white/60" />
          <span className="text-white/80 text-sm font-semibold">Up Next</span>
        </div>
        <button
          onClick={onClose}
          aria-label="Close queue"
          className="w-6 h-6 flex items-center justify-center rounded-lg text-white/40 hover:text-white/80 hover:bg-white/10 transition-all active:scale-90 focus-visible:outline-none"
        >
          <X size={14} />
        </button>
      </div>

      {/* Track list */}
      <div className="overflow-y-auto flex-1 min-h-0">
        {loading && entries.length === 0 ? (
          <div className="flex items-center justify-center h-20">
            <Loader2 size={20} className="text-white/30 animate-spin" />
          </div>
        ) : entries.length === 0 ? (
          <div className="flex items-center justify-center h-20">
            <span className="text-white/30 text-sm">Queue is empty</span>
          </div>
        ) : (
          <div>
            {entries.map((entry, i) => {
              const { track, skipsNeeded } = entry;
              const isOptimisticCurrent = pendingSkip ? track.id === pendingSkip.trackId : skipsNeeded === 0;
              const isDimmed = pendingSkip != null && skipsNeeded < pendingSkip.skipsNeeded && track.id !== pendingSkip.trackId;
              const isDisabled = isOptimisticCurrent || isDimmed;

              return (
                <QueueRow
                  key={`${track.id}-${i}`}
                  entry={entry}
                  isOptimisticCurrent={isOptimisticCurrent}
                  isDimmed={isDimmed}
                  isDisabled={isDisabled}
                  onClick={() => handleSkipTo(track, skipsNeeded)}
                  instant={!revealed}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
    </div>
  );
}
