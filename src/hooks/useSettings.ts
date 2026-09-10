import { useCallback, useEffect, useState } from 'react';
import type { MiniPlayerLayout, Settings } from '../types';
import { clearLyricsCache, configureCacheSettings } from '../lib/lyrics-store';

const SETTINGS_KEY = 'lyrics_settings';

const DEFAULTS: Settings = {
  fontSize: 30,
  uiFontSize: 16,
  defaultLyricsOffset: 0,
  backgroundBlur: 30,
  backgroundDim: 50,
  miniPlayerLayout: 'full',
  miniPlayerFlipped: false,
  cacheMaxTTL: 90 * 24 * 60 * 60 * 1000, // 90 days
  cacheMaxEntries: 1000,
};

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return DEFAULTS;
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(loadSettings);

  // Persist on change
  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  // Sync cache configuration to lyrics-store module
  useEffect(() => {
    configureCacheSettings(settings.cacheMaxTTL, settings.cacheMaxEntries);
  }, [settings.cacheMaxTTL, settings.cacheMaxEntries]);

  const increaseFontSize = useCallback(() => {
    setSettings((s) => ({ ...s, fontSize: Math.min(s.fontSize + 3, 60) }));
  }, []);

  const decreaseFontSize = useCallback(() => {
    setSettings((s) => ({ ...s, fontSize: Math.max(s.fontSize - 3, 15) }));
  }, []);

  const resetFontSize = useCallback(() => {
    setSettings((s) => ({ ...s, fontSize: DEFAULTS.fontSize }));
  }, []);

  const adjustDefaultOffset = useCallback((deltaMs: number) => {
    setSettings((s) => ({ ...s, defaultLyricsOffset: s.defaultLyricsOffset + deltaMs }));
  }, []);

  const resetDefaultOffset = useCallback(() => {
    setSettings((s) => ({ ...s, defaultLyricsOffset: 0 }));
  }, []);

  const setUIFontSize = useCallback((size: number) => {
    setSettings((s) => ({ ...s, uiFontSize: Math.max(14, Math.min(28, size)) }));
  }, []);

  const setBackgroundBlur = useCallback((blur: number) => {
    setSettings((s) => ({ ...s, backgroundBlur: Math.max(0, Math.min(100, blur)) }));
  }, []);

  const setBackgroundDim = useCallback((dim: number) => {
    setSettings((s) => ({ ...s, backgroundDim: Math.max(0, Math.min(100, dim)) }));
  }, []);

  const setMiniPlayerLayout = useCallback((layout: MiniPlayerLayout) => {
    setSettings((s) => ({ ...s, miniPlayerLayout: layout }));
  }, []);

  const setMiniPlayerFlipped = useCallback((flipped: boolean) => {
    setSettings((s) => ({ ...s, miniPlayerFlipped: flipped }));
  }, []);

  const setCacheMaxTTL = useCallback((ttl: number) => {
    setSettings((s) => ({ ...s, cacheMaxTTL: Math.max(0, ttl) }));
  }, []);

  const setCacheMaxEntries = useCallback((entries: number) => {
    setSettings((s) => ({ ...s, cacheMaxEntries: Math.max(1, entries) }));
  }, []);

  const clearCache = useCallback(() => {
    clearLyricsCache();
  }, []);

  return {
    settings,
    increaseFontSize,
    decreaseFontSize,
    resetFontSize,
    adjustDefaultOffset,
    resetDefaultOffset,
    setUIFontSize,
    setBackgroundBlur,
    setBackgroundDim,
    setMiniPlayerLayout,
    setMiniPlayerFlipped,
    setCacheMaxTTL,
    setCacheMaxEntries,
    clearCache,
  };
}
