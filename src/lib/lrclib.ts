import { mockDelay, MOCK_SYNCED_LYRICS } from './lrclib.mock';

// Set VITE_MOCK_LRCLIB=true (e.g. in .env.local or the E2E test server) to skip the
// real LRCLIB API and receive mock lyrics — see ./lrclib.mock. Vite inlines this to
// `false` in production, so the guarded branches (and lrclib.mock) are stripped.
const MOCK_LRCLIB = import.meta.env.VITE_MOCK_LRCLIB === 'true';

interface LrclibResponse {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string;
  duration: number;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}

export interface LrclibCandidate {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string;
  durationSec: number;
  isSynced: boolean;
  syncedLyrics: string | null;
  plainLyrics: string | null;
}

const BASE = 'https://lrclib.net/api';
const TIMEOUT_MS = 20_000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1_000;

/** AbortSignal.timeout polyfill for browsers < Chromium 103 */
function signalTimeout(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  const ac = new AbortController();
  setTimeout(() => ac.abort(new DOMException('The operation timed out.', 'TimeoutError')), ms);
  return ac.signal;
}

/** AbortSignal.any polyfill for browsers < Chromium 116 */
function signalAny(signals: AbortSignal[]): AbortSignal {
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(signals);
  const ac = new AbortController();
  for (const s of signals) {
    if (s.aborted) { ac.abort(s.reason); break; }
    s.addEventListener('abort', () => ac.abort(s.reason), { once: true });
  }
  return ac.signal;
}

function timeout(): AbortSignal {
  return signalTimeout(TIMEOUT_MS);
}

async function fetchWithRetry(url: string, signal?: AbortSignal): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
    }
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    try {
      // Combine our retry timeout with the caller's abort signal
      const combined = signal
        ? signalAny([timeout(), signal])
        : timeout();
      const res = await fetch(url, { signal: combined });
      // Only retry on server errors (5xx) or network failures; 4xx are definitive
      if (res.ok || (res.status >= 400 && res.status < 500)) return res;
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      // Propagate abort immediately — no point retrying a user cancellation.
      // Timeouts are retriable: the next attempt gets a fresh timeout signal.
      if (err instanceof Error && err.name === 'AbortError') throw err;
      lastError = err;
    }
  }
  throw lastError;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function toCandidate(r: LrclibResponse): LrclibCandidate {
  return {
    id: r.id,
    trackName: r.trackName,
    artistName: r.artistName,
    albumName: r.albumName,
    durationSec: r.duration,
    isSynced: !!r.syncedLyrics,
    syncedLyrics: r.syncedLyrics ?? null,
    plainLyrics: r.plainLyrics ?? null,
  };
}

// ── Public: search returning all candidates ───────────────────────────────────

export async function searchCandidates(
  query: string,
  durationSec?: number,
  signal?: AbortSignal,
): Promise<LrclibCandidate[]> {
  if (MOCK_LRCLIB) {
    await mockDelay(`search "${query}"`, signal);
    const mock: LrclibCandidate = {
      id: 1,
      trackName: query,
      artistName: 'Lorem',
      albumName: 'Ipsum',
      durationSec: durationSec ?? 200,
      isSynced: true,
      syncedLyrics: MOCK_SYNCED_LYRICS,
      plainLyrics: null,
    };
    return [mock];
  }
  const params = new URLSearchParams({ q: query });
  const res = await fetchWithRetry(`${BASE}/search?${params}`, signal);
  if (!res.ok) return [];
  const results: LrclibResponse[] = await res.json();
  const candidates = results
    .filter((r) => !r.instrumental && (r.syncedLyrics || r.plainLyrics))
    .map(toCandidate);
  if (durationSec !== undefined) {
    return candidates.sort(
      (a, b) => Math.abs(a.durationSec - durationSec) - Math.abs(b.durationSec - durationSec),
    );
  }
  return candidates;
}

// ── Public entry point ────────────────────────────────────────────────────────

// Score a candidate against the target track. Returns -Infinity if duration is
// too far to be useful. Album name is used as a tiebreaker for otherwise equal
// candidates (e.g. same song appearing on standard vs. deluxe edition).
function scoreCandidate(
  c: LrclibCandidate,
  nTrack: string,
  nArtist: string,
  nAlbum: string,
  durationSec: number,
): number {
  if (Math.abs(c.durationSec - durationSec) > 10) return -Infinity;
  return (
    (normalize(c.trackName) === nTrack ? 16 : 0) +
    (normalize(c.artistName) === nArtist ? 8 : 0) +
    (c.isSynced ? 4 : 0) +
    (Math.abs(c.durationSec - durationSec) <= 2 ? 2 : 0) +
    (normalize(c.albumName) === nAlbum ? 1 : 0)
  );
}

export async function fetchLyrics(
  trackName: string,
  artistName: string,
  albumName: string,
  durationSec: number,
  signal?: AbortSignal,
): Promise<{ synced: string | null; plain: string | null; candidates: LrclibCandidate[]; recommendedId: number | null; pickedId: number | null }> {
  if (MOCK_LRCLIB) {
    await mockDelay(`"${trackName}" by ${artistName}`, signal);
    const mock: LrclibCandidate = {
      id: 1,
      trackName,
      artistName,
      albumName,
      durationSec,
      isSynced: true,
      syncedLyrics: MOCK_SYNCED_LYRICS,
      plainLyrics: null,
    };
    return { synced: MOCK_SYNCED_LYRICS, plain: null, candidates: [mock], recommendedId: 1, pickedId: 1 };
  }
  const query = `${artistName} ${trackName}`;
  const allCandidates = await searchCandidates(query, durationSec, signal);

  const nTrack = normalize(trackName);
  const nArtist = normalize(artistName);
  const nAlbum = normalize(albumName);

  // Filter to ±10s window, score each candidate, and sort best-first.
  // isSynced is part of the score so a synced exact match always beats a plain exact match.
  const scored = allCandidates
    .map((c) => ({ c, score: scoreCandidate(c, nTrack, nArtist, nAlbum, durationSec) }))
    .filter(({ score }) => isFinite(score))
    .sort((a, b) => b.score - a.score);

  const candidates = scored.map(({ c }) => c);

  // "Recommended" = highest-scoring synced candidate that has track+artist match
  // and duration within ±2s. Must be synced — plain-only results are never badged.
  const recommended = scored.find(
    ({ c }) =>
      c.isSynced &&
      normalize(c.trackName) === nTrack &&
      normalize(c.artistName) === nArtist &&
      Math.abs(c.durationSec - durationSec) <= 2,
  )?.c ?? null;

  // Picked always equals recommended when one exists, so the badge and the
  // active selection are never out of sync. Only fall back when there is no
  // exact synced match.
  const picked = recommended ?? scored.find(({ c }) => c.isSynced)?.c ?? candidates[0] ?? null;

  return {
    synced: picked?.syncedLyrics ?? null,
    plain: picked?.plainLyrics ?? null,
    candidates,
    recommendedId: recommended?.id ?? null,
    pickedId: picked?.id ?? null,
  };
}

