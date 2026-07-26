import { useCallback, useEffect, useRef, useState } from 'react';
import {
  buildAuthUrl,
  clearRuntimeAuthConfig,
  clearToken,
  exchangeCode,
  getCurrentUserProfile,
  getResolvedAuthConfig,
  getRuntimeAuthDraft,
  isTokenExpired,
  loadToken,
  refreshToken,
  registerTokenRefresher,
  saveRuntimeAuthConfig,
  saveToken,
} from '../lib/spotify';
import type { SpotifyUser, TokenData } from '../types';

// StrictMode double-mount guard: only allow one exchange at a time per page load.
let exchangeInFlight = false;

export function useSpotifyAuth() {
  const [token, setToken] = useState<TokenData | null>(() => loadToken());
  const [error, setError] = useState<string | null>(null);
  const [isConfigured, setIsConfigured] = useState<boolean>(() => getResolvedAuthConfig() !== null);
  const [user, setUser] = useState<SpotifyUser | null>(null);
  const tokenRef = useRef(token);
  tokenRef.current = token;

  // Fetch the logged-in user's profile whenever we get a (new) token.
  useEffect(() => {
    if (!token) {
      setUser(null);
      return;
    }
    const ac = new AbortController();
    getCurrentUserProfile(token.access_token, ac.signal)
      .then(setUser)
      .catch(() => {}); // non-critical — settings panel just won't show account details
    return () => ac.abort();
  }, [token]);

  const refreshConfigState = useCallback(() => {
    setIsConfigured(getResolvedAuthConfig() !== null);
  }, []);

  const doRefresh = useCallback(async (t: TokenData) => {
    try {
      const refreshed = await refreshToken(t);
      saveToken(refreshed);
      setToken(refreshed);
    } catch {
      // Refresh failed — require re-login
      clearToken();
      setToken(null);
    }
  }, []);

  // Register a refresher so spotifyFetch can auto-refresh 401s
  useEffect(() => {
    registerTokenRefresher(async () => {
      const current = tokenRef.current;
      if (!current) throw new Error('No token');
      const refreshed = await refreshToken(current);
      saveToken(refreshed);
      setToken(refreshed);
      return refreshed.access_token;
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // On mount: handle OAuth callback or check for expired token
  useEffect(() => {
    const url = new URL(window.location.href);
    const code = url.searchParams.get('code');
    const returnedState = url.searchParams.get('state') ?? undefined;
    const err = url.searchParams.get('error');

    if (err) {
      setError(`Spotify login denied: ${err}`);
      window.history.replaceState({}, '', '/');
      return;
    }

    if (code) {
      if (exchangeInFlight) return; // StrictMode second mount — skip
      exchangeInFlight = true;
      window.history.replaceState({}, '', '/');
      exchangeCode(code, returnedState)
        .then((t) => {
          saveToken(t);
          setToken(t);
        })
        .catch((e) => setError(String(e)))
        .finally(() => { exchangeInFlight = false; });
      return;
    }

    // Already have a token — check if it needs refreshing
    const stored = loadToken();
    if (stored && isTokenExpired(stored)) {
      doRefresh(stored);
    }
  }, [doRefresh]);

  // Proactive refresh: schedule ~1 min before expiry
  useEffect(() => {
    if (!token) return;
    const delay = token.expires_at - Date.now() - 60_000;
    if (delay <= 0) {
      doRefresh(token);
      return;
    }
    const id = setTimeout(() => doRefresh(token), delay);
    return () => clearTimeout(id);
  }, [token, doRefresh]);

  const login = useCallback(async () => {
    try {
      const url = await buildAuthUrl();
      window.location.href = url;
    } catch (e) {
      const message = String(e);
      if (message.includes('setup required')) {
        setError('Setup required: add your Spotify Client ID before logging in.');
      } else {
        setError(message);
      }
      refreshConfigState();
    }
  }, [refreshConfigState]);

  const logout = useCallback(() => {
    clearToken();
    setToken(null);
  }, []);

  const saveSpotifySetup = useCallback((clientId: string, redirectUri?: string) => {
    saveRuntimeAuthConfig(clientId, redirectUri);
    clearToken();
    setToken(null);
    setError(null);
    refreshConfigState();
  }, [refreshConfigState]);

  const clearSpotifySetup = useCallback(() => {
    clearRuntimeAuthConfig();
    clearToken();
    setToken(null);
    setError(null);
    refreshConfigState();
  }, [refreshConfigState]);

  return {
    token,
    user,
    login,
    logout,
    error,
    isConfigured,
    saveSpotifySetup,
    clearSpotifySetup,
    getSetupDraft: getRuntimeAuthDraft,
  };
}
