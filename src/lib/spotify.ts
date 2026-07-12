import type { CurrentlyPlayingResponse, SpotifyTrack, TokenData } from '../types';

const RUNTIME_AUTH_CONFIG_KEY = 'spotify_auth_config';

type RuntimeAuthConfig = {
  clientId: string;
  redirectUri?: string;
};

export type ResolvedAuthConfig = {
  clientId: string;
  redirectUri: string;
  source: 'env' | 'runtime';
};

const SCOPES = [
  'user-read-currently-playing',
  'user-read-playback-state',
  'user-modify-playback-state',
].join(' ');

const TOKEN_KEY = 'spotify_token';

function clean(value: string | null | undefined): string {
  return (value ?? '').trim();
}

function defaultRedirectUri(): string {
  return `${window.location.origin}/callback`;
}

export function hasEnvAuthConfig(): boolean {
  return clean(import.meta.env.VITE_SPOTIFY_CLIENT_ID as string | undefined).length > 0;
}

export function isValidSpotifyClientId(clientId: string): boolean {
  return /^[a-f0-9]{32}$/i.test(clean(clientId));
}

function loadRuntimeAuthConfig(): RuntimeAuthConfig | null {
  try {
    const raw = localStorage.getItem(RUNTIME_AUTH_CONFIG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RuntimeAuthConfig>;
    const clientId = clean(parsed.clientId);
    const redirectUri = clean(parsed.redirectUri);
    if (!clientId) return null;
    return {
      clientId,
      redirectUri: redirectUri || undefined,
    };
  } catch {
    return null;
  }
}

export function saveRuntimeAuthConfig(clientId: string, redirectUri?: string): void {
  const cleanedClientId = clean(clientId);
  if (!isValidSpotifyClientId(cleanedClientId)) {
    throw new Error('Client ID must be a 32-character hexadecimal string.');
  }

  const cleanedRedirectUri = clean(redirectUri);
  localStorage.setItem(
    RUNTIME_AUTH_CONFIG_KEY,
    JSON.stringify({
      clientId: cleanedClientId,
      redirectUri: cleanedRedirectUri || undefined,
    }),
  );
}

export function clearRuntimeAuthConfig(): void {
  localStorage.removeItem(RUNTIME_AUTH_CONFIG_KEY);
}

export function getResolvedAuthConfig(): ResolvedAuthConfig | null {
  const envClientId = clean(import.meta.env.VITE_SPOTIFY_CLIENT_ID as string | undefined);
  const envRedirectUri = clean(import.meta.env.VITE_SPOTIFY_REDIRECT_URI as string | undefined);

  if (envClientId && isValidSpotifyClientId(envClientId)) {
    return {
      clientId: envClientId,
      redirectUri: envRedirectUri || defaultRedirectUri(),
      source: 'env',
    };
  }

  const runtime = loadRuntimeAuthConfig();
  if (!runtime || !isValidSpotifyClientId(runtime.clientId)) return null;

  return {
    clientId: runtime.clientId,
    redirectUri: runtime.redirectUri || defaultRedirectUri(),
    source: 'runtime',
  };
}

export function getRuntimeAuthDraft(): { clientId: string; redirectUri: string } {
  const runtime = loadRuntimeAuthConfig();
  return {
    clientId: runtime?.clientId ?? '',
    redirectUri: runtime?.redirectUri ?? defaultRedirectUri(),
  };
}

function requireAuthConfig(): ResolvedAuthConfig {
  const config = getResolvedAuthConfig();
  if (!config) {
    throw new Error('Spotify setup required: configure a valid Client ID.');
  }
  return config;
}

// ── PKCE helpers ─────────────────────────────────────────────────────────────

function generateRandomString(length: number): string {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const values = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(values)
    .map((x) => possible[x % possible.length])
    .join('');
}

async function sha256(plain: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  return crypto.subtle.digest('SHA-256', encoder.encode(plain));
}

function base64URLEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// ── Auth URL ──────────────────────────────────────────────────────────────────

export async function buildAuthUrl(): Promise<string> {
  const config = requireAuthConfig();
  const verifier = generateRandomString(64);
  const challenge = base64URLEncode(await sha256(verifier));
  const state = generateRandomString(16);

  sessionStorage.setItem('pkce_verifier', verifier);
  sessionStorage.setItem('oauth_state', state);

  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: 'code',
    redirect_uri: config.redirectUri,
    scope: SCOPES,
    state,
    code_challenge_method: 'S256',
    code_challenge: challenge,
  });
  return `https://accounts.spotify.com/authorize?${params}`;
}

// ── Token exchange ────────────────────────────────────────────────────────────

export async function exchangeCode(code: string, returnedState?: string): Promise<TokenData> {
  const config = requireAuthConfig();
  const verifier = sessionStorage.getItem('pkce_verifier');
  if (!verifier) throw new Error('Missing PKCE verifier');
  const savedState = sessionStorage.getItem('oauth_state');
  // Fail-closed: if we generated a state, the returned state must match.
  // If returnedState is absent, reject rather than silently accepting.
  if (savedState && (savedState !== returnedState)) {
    sessionStorage.removeItem('pkce_verifier');
    sessionStorage.removeItem('oauth_state');
    throw new Error('OAuth state mismatch — possible CSRF attack');
  }
  if (savedState && !returnedState) {
    sessionStorage.removeItem('pkce_verifier');
    sessionStorage.removeItem('oauth_state');
    throw new Error('OAuth state missing in callback — possible CSRF attack');
  }
  sessionStorage.removeItem('oauth_state');

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.redirectUri,
      client_id: config.clientId,
      code_verifier: verifier,
    }),
  });

  if (!res.ok) {
    sessionStorage.removeItem('pkce_verifier');
    throw new Error(`Token exchange failed: ${res.status}`);
  }
  const json = await res.json();
  sessionStorage.removeItem('pkce_verifier');
  return parseTokenResponse(json);
}

// ── Token refresh ─────────────────────────────────────────────────────────────

export async function refreshToken(token: TokenData): Promise<TokenData> {
  const config = requireAuthConfig();
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: token.refresh_token,
      client_id: config.clientId,
    }),
  });

  if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);
  const json = await res.json();
  return parseTokenResponse(json, token.refresh_token);
}

function parseTokenResponse(json: Record<string, unknown>, fallbackRefreshToken?: string): TokenData {
  const expiresIn = (json['expires_in'] as number) ?? 3600;
  return {
    access_token: json['access_token'] as string,
    refresh_token: (json['refresh_token'] as string | undefined) ?? fallbackRefreshToken ?? '',
    expires_at: Date.now() + expiresIn * 1000,
  };
}

// ── Token persistence ─────────────────────────────────────────────────────────

export function saveToken(token: TokenData): void {
  localStorage.setItem(TOKEN_KEY, JSON.stringify(token));
}

export function loadToken(): TokenData | null {
  const raw = localStorage.getItem(TOKEN_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TokenData;
  } catch {
    return null;
  }
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export function isTokenExpired(token: TokenData): boolean {
  return Date.now() >= token.expires_at - 60_000; // 1-min early refresh
}

// ── Spotify API calls ─────────────────────────────────────────────────────────

// Module-level rate-limit expiry so callers can back off before making requests.
let rateLimitExpiry = 0;
export function isRateLimited(): boolean {
  return Date.now() < rateLimitExpiry;
}

// Exposed so useSpotifyAuth can inject a fresh token via callback.
let getLatestToken: (() => Promise<string>) | null = null;
export function registerTokenRefresher(fn: () => Promise<string>): void {
  getLatestToken = fn;
}

async function spotifyFetch(
  url: string,
  accessToken: string,
  options: RequestInit = {},
): Promise<Response> {
  const doFetch = (token: string) =>
    fetch(url, {
      ...options,
      headers: { Authorization: `Bearer ${token}`, ...options.headers },
    });

  let res = await doFetch(accessToken);

  // 401 → try refreshing the token once, then retry
  if (res.status === 401 && getLatestToken) {
    try {
      const fresh = await getLatestToken();
      res = await doFetch(fresh);
    } catch {
      // Refresh failed; return the original 401 for the caller to handle
    }
  }

  // 429 → respect Retry-After header, record expiry, and back off
  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get('Retry-After') ?? '5', 10);
    rateLimitExpiry = Date.now() + retryAfter * 1000;
    await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
    rateLimitExpiry = 0;
    res = await doFetch(accessToken);
  }

  return res;
}

export async function getCurrentlyPlaying(accessToken: string, signal?: AbortSignal): Promise<CurrentlyPlayingResponse | null> {
  const res = await spotifyFetch(
    'https://api.spotify.com/v1/me/player?additional_types=track',
    accessToken,
    { signal },
  );
  if (res.status === 204 || res.status === 202) return null; // nothing playing / no active device
  if (!res.ok) throw new Error(`Spotify API error: ${res.status}`);
  const json = await res.json() as CurrentlyPlayingResponse;
  if (!json || json.currently_playing_type !== 'track' || !json.item) return null;
  return json;
}

function checkPlaybackResponse(res: Response): void {
  if (res.ok || res.status === 204) return;
  if (res.status === 403) throw new Error('Spotify Premium is required for playback control.');
  if (res.status === 404) throw new Error('No active Spotify device found. Open Spotify on a device first.');
  throw new Error(`Playback error: ${res.status}`);
}

export async function seekTo(accessToken: string, positionMs: number): Promise<void> {
  const res = await spotifyFetch(
    `https://api.spotify.com/v1/me/player/seek?position_ms=${Math.round(positionMs)}`,
    accessToken,
    { method: 'PUT' },
  );
  checkPlaybackResponse(res);
}

export async function togglePlayback(accessToken: string, isPlaying: boolean): Promise<void> {
  const endpoint = isPlaying
    ? 'https://api.spotify.com/v1/me/player/pause'
    : 'https://api.spotify.com/v1/me/player/play';
  const res = await spotifyFetch(endpoint, accessToken, { method: 'PUT' });
  checkPlaybackResponse(res);
}

export async function skipToNext(accessToken: string): Promise<void> {
  const res = await spotifyFetch('https://api.spotify.com/v1/me/player/next', accessToken, { method: 'POST' });
  checkPlaybackResponse(res);
}

/**
 * Skip forward `count` tracks by issuing sequential next-track requests.
 * Each call is awaited before the next to preserve Spotify's execution order.
 */
export async function skipMultiple(accessToken: string, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await spotifyFetch('https://api.spotify.com/v1/me/player/next', accessToken, { method: 'POST' });
  }
}

export async function skipToPrevious(accessToken: string): Promise<void> {
  await spotifyFetch('https://api.spotify.com/v1/me/player/previous', accessToken, { method: 'POST' });
}

function isSpotifyTrack(item: unknown): item is SpotifyTrack {
  return (
    typeof item === 'object' && item !== null &&
    typeof (item as Record<string, unknown>).id === 'string' &&
    typeof (item as Record<string, unknown>).name === 'string' &&
    (item as Record<string, unknown>).type === 'track'
  );
}

// How many upcoming tracks to keep as a look-ahead buffer. MainView consumes the
// first as the immediate "next" and the rest as an optimistic queue for rapid skips.
const QUEUE_LOOKAHEAD = 5;

export async function getNextInQueue(accessToken: string, signal?: AbortSignal): Promise<SpotifyTrack[]> {
  const res = await spotifyFetch('https://api.spotify.com/v1/me/player/queue', accessToken, { signal });
  if (!res.ok) return [];
  const json = await res.json() as { queue?: unknown[] };
  return (json?.queue ?? []).filter(isSpotifyTrack).slice(0, QUEUE_LOOKAHEAD);
}

export async function getQueue(accessToken: string): Promise<{ currentlyPlaying: SpotifyTrack | null; queue: SpotifyTrack[] }> {
  const res = await spotifyFetch('https://api.spotify.com/v1/me/player/queue', accessToken);
  if (!res.ok) return { currentlyPlaying: null, queue: [] };
  const json = await res.json() as { currently_playing?: unknown; queue?: unknown[] };
  return {
    currentlyPlaying: isSpotifyTrack(json.currently_playing) ? json.currently_playing : null,
    queue: (json.queue ?? []).filter(isSpotifyTrack).slice(0, 20),
  };
}
