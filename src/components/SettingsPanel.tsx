import { useEffect, useRef, useState } from 'react';
import { X, Rewind, FastForward, Trash2, ChevronDown } from 'lucide-react';
import type { MiniPlayerLayout, Settings, SpotifyUser } from '../types';
import { getCacheStats } from '../lib/lyrics-store';
import {
  getResolvedAuthConfig,
  getRuntimeAuthDraft,
  hasEnvAuthConfig,
  isValidSpotifyClientId,
} from '../lib/spotify';

const DEFAULT_LYRICS_FONT_SIZE = 30;
const DEFAULT_UI_FONT_SIZE = 16;
const DEFAULT_BG_BLUR = 30;
const DEFAULT_BG_DIM = 50;

const TABS = ['General', 'Advanced', 'Account'] as const;
type Tab = (typeof TABS)[number];

interface SettingsPanelProps {
  isOpen: boolean;
  settings: Settings;
  user: SpotifyUser | null;
  onClose: () => void;
  onSetUIFontSize: (size: number) => void;
  onIncreaseLyricsFontSize: () => void;
  onDecreaseLyricsFontSize: () => void;
  onResetLyricsFontSize: () => void;
  onAdjustDefaultOffset: (delta: number) => void;
  onResetDefaultOffset: () => void;
  onSetBackgroundBlur: (blur: number) => void;
  onSetBackgroundDim: (dim: number) => void;
  onSetMiniPlayerLayout: (layout: MiniPlayerLayout) => void;
  onSetMiniPlayerFlipped: (flipped: boolean) => void;
  onSetCacheMaxTTL: (ttl: number) => void;
  onSetCacheMaxEntries: (entries: number) => void;
  onClearCache: () => void;
  onLogout: () => void;
  onForgetSpotifySetup: () => void;
  onSaveSpotifySetup: (clientId: string, redirectUri?: string) => void;
}

function Slider({
  label,
  min,
  max,
  value,
  onChange,
  unit = '',
}: {
  label: string;
  min: number;
  max: number;
  value: number;
  onChange: (v: number) => void;
  unit?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <label className="text-white/70 text-sm">{label}</label>
        <span className="text-white/50 text-sm tabular-nums">
          {value}
          {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-2 bg-white/20 rounded-full appearance-none cursor-pointer accent-white/60 hover:accent-white"
        style={{
          background: `linear-gradient(to right, rgba(255,255,255,0.6) 0%, rgba(255,255,255,0.6) ${((value - min) / (max - min)) * 100}%, rgba(255,255,255,0.2) ${((value - min) / (max - min)) * 100}%, rgba(255,255,255,0.2) 100%)`,
        }}
      />
    </div>
  );
}

function Section({
  title,
  children,
  collapsible = false,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="flex flex-col gap-3 pb-4 border-b border-white/10 last:border-b-0 last:pb-0">
      <div
        className={['flex items-center justify-between', collapsible ? 'cursor-pointer select-none' : ''].join(' ')}
        onClick={collapsible ? () => setOpen((o) => !o) : undefined}
        onKeyDown={collapsible ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen((o) => !o); } } : undefined}
        role={collapsible ? 'button' : undefined}
        tabIndex={collapsible ? 0 : undefined}
        aria-expanded={collapsible ? open : undefined}
      >
        <h3 className="text-white/80 font-semibold text-sm uppercase tracking-wide">{title}</h3>
        {collapsible && (
          <ChevronDown
            size={16}
            className={['text-white/50 transition-transform duration-200', open ? '' : '-rotate-90'].join(' ')}
          />
        )}
      </div>
      {open && <div className="flex flex-col gap-3">{children}</div>}
    </div>
  );
}

export function SettingsPanel({
  isOpen,
  settings,
  user,
  onClose,
  onSetUIFontSize,
  onIncreaseLyricsFontSize,
  onDecreaseLyricsFontSize,
  onResetLyricsFontSize,
  onAdjustDefaultOffset,
  onResetDefaultOffset,
  onSetBackgroundBlur,
  onSetBackgroundDim,
  onSetMiniPlayerLayout,
  onSetMiniPlayerFlipped,
  onSetCacheMaxTTL,
  onSetCacheMaxEntries,
  onClearCache,
  onLogout,
  onForgetSpotifySetup,
  onSaveSpotifySetup,
}: SettingsPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeTab, setActiveTab] = useState<Tab>('General');
  const [cacheStats, setCacheStats] = useState({ entryCount: 0, storageSize: 0 });
  const [clientId, setClientId] = useState('');
  const [useCustomRedirect, setUseCustomRedirect] = useState(false);
  const [customRedirectUri, setCustomRedirectUri] = useState(`${window.location.origin}/callback`);
  const [spotifyConfigError, setSpotifyConfigError] = useState<string | null>(null);
  const [authSource, setAuthSource] = useState<'env' | 'runtime' | 'none'>('none');

  // Update cache stats when panel opens
  useEffect(() => {
    if (isOpen) {
      setActiveTab('General');
      setCacheStats(getCacheStats());
      const resolved = getResolvedAuthConfig();
      const runtime = getRuntimeAuthDraft();
      setClientId(runtime.clientId || resolved?.clientId || '');
      setCustomRedirectUri(runtime.redirectUri || resolved?.redirectUri || `${window.location.origin}/callback`);
      setUseCustomRedirect(Boolean(runtime.redirectUri));
      setAuthSource(resolved?.source ?? 'none');
      setSpotifyConfigError(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const lyricsFontAtDefault = settings.fontSize === DEFAULT_LYRICS_FONT_SIZE;
  const displayAtDefault = settings.uiFontSize === DEFAULT_UI_FONT_SIZE && lyricsFontAtDefault && settings.backgroundBlur === DEFAULT_BG_BLUR && settings.backgroundDim === DEFAULT_BG_DIM;
  const defaultOffsetAtZero = settings.defaultLyricsOffset === 0;
  const hideSpotifyCredentialsSection = hasEnvAuthConfig();
  const clientIdLooksValid = isValidSpotifyClientId(clientId);
  const effectiveRedirectUri = useCustomRedirect ? customRedirectUri.trim() : `${window.location.origin}/callback`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Panel */}
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="relative w-full h-full md:w-1/2 md:h-auto md:max-h-[80vh] md:rounded-3xl bg-white/5 backdrop-blur-2xl border border-white/10 shadow-2xl flex flex-col overflow-hidden"
        style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.03) 100%)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 shrink-0 border-b border-white/10">
          <h2 className="text-white font-bold text-xl">Settings</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-10 h-10 flex items-center justify-center rounded-lg text-white/60 hover:bg-white/10 active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            <X size={20} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 px-6 pt-3 shrink-0 border-b border-white/10" role="tablist">
          {TABS.map((tab) => (
            <button
              key={tab}
              role="tab"
              aria-selected={activeTab === tab}
              onClick={() => setActiveTab(tab)}
              className={[
                'px-3.5 py-2 text-sm font-medium rounded-t-lg transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 border-b-2 -mb-px',
                activeTab === tab
                  ? 'text-white border-white/70'
                  : 'text-white/50 hover:text-white/80 border-transparent',
              ].join(' ')}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6" style={{ scrollbarWidth: 'none' }}>
          {activeTab === 'General' && (
          <>
          {/* Display Section */}
          <Section title="Display">
            <Slider
              label="UI Font Size"
              min={14}
              max={28}
              value={settings.uiFontSize}
              onChange={onSetUIFontSize}
              unit="px"
            />

            <Slider
              label="Lyrics Font Size"
              min={15}
              max={60}
              value={settings.fontSize}
              onChange={(size) => {
                const delta = size - settings.fontSize;
                if (delta > 0) {
                  for (let i = 0; i < delta / 3; i++) onIncreaseLyricsFontSize();
                } else {
                  for (let i = 0; i < -delta / 3; i++) onDecreaseLyricsFontSize();
                }
              }}
              unit="px"
            />

            <Slider
              label="Background Blur"
              min={0}
              max={100}
              value={settings.backgroundBlur}
              onChange={onSetBackgroundBlur}
              unit="%"
            />

            <Slider
              label="Background Dim"
              min={0}
              max={100}
              value={settings.backgroundDim}
              onChange={onSetBackgroundDim}
              unit="%"
            />

            <button
              onClick={() => {
                onSetUIFontSize(DEFAULT_UI_FONT_SIZE);
                onResetLyricsFontSize();
                onSetBackgroundBlur(DEFAULT_BG_BLUR);
                onSetBackgroundDim(DEFAULT_BG_DIM);
              }}
              disabled={displayAtDefault}
              className={[
                'text-sm px-3 py-1.5 rounded-lg transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60',
                displayAtDefault
                  ? 'text-white/30 cursor-not-allowed'
                  : 'text-white/60 hover:text-white/80 hover:bg-white/10 active:scale-95',
              ].join(' ')}
            >
              Reset display settings
            </button>
          </Section>

          {/* Miniplayer Section */}
          <Section title="Miniplayer">
            <div className="flex items-center justify-between gap-2">
              <span className="text-white/60 text-sm">Layout</span>
              <div className="flex items-center rounded-lg overflow-hidden border border-white/10">
                {(['full', 'split'] as const).map((layout) => (
                  <button
                    key={layout}
                    onClick={() => onSetMiniPlayerLayout(layout)}
                    aria-pressed={settings.miniPlayerLayout === layout}
                    className={[
                      'px-3 py-1.5 text-sm capitalize transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60',
                      settings.miniPlayerLayout === layout
                        ? 'bg-white/20 text-white'
                        : 'text-white/60 hover:bg-white/10',
                    ].join(' ')}
                  >
                    {layout}
                  </button>
                ))}
              </div>
            </div>

            <label className="inline-flex items-center gap-2 text-white/70 text-sm">
              <input
                type="checkbox"
                checked={settings.miniPlayerFlipped}
                onChange={(e) => onSetMiniPlayerFlipped(e.target.checked)}
                className="accent-white"
              />
              Flip layout (mirror controls and song info)
            </label>
          </Section>

          {/* Sync Section */}
          <Section title="Lyrics Sync">
            <div className="flex items-center justify-between gap-2">
              <span className="text-white/60 text-sm">Default Offset</span>
              <div className="flex items-center gap-1">
                <div className="flex items-center rounded-lg overflow-hidden border border-white/10">
                  <button
                    onClick={() => onAdjustDefaultOffset(-500)}
                    aria-label="Decrease default offset by 0.5s"
                    className="w-9 h-9 relative flex items-center justify-center bg-white/10 hover:bg-white/20 active:scale-95 transition-all text-white/70 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                  >
                    <Rewind size={12} />
                    <span className="absolute bottom-1 text-[0.5em] leading-none">-0.5s</span>
                  </button>
                  <span className="px-2.5 text-sm tabular-nums font-medium text-white min-w-[52px] text-center">
                    {settings.defaultLyricsOffset > 0 ? '+' : ''}{(settings.defaultLyricsOffset / 1000).toFixed(1)}s
                  </span>
                  <button
                    onClick={() => onAdjustDefaultOffset(500)}
                    aria-label="Increase default offset by 0.5s"
                    className="w-9 h-9 relative flex items-center justify-center bg-white/10 hover:bg-white/20 active:scale-95 transition-all text-white/70 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                  >
                    <FastForward size={12} />
                    <span className="absolute bottom-1 text-[0.5em] leading-none">+0.5s</span>
                  </button>
                </div>
                <button
                  onClick={onResetDefaultOffset}
                  disabled={defaultOffsetAtZero}
                  aria-label="Reset default offset"
                  className={[
                    'w-7 h-7 flex items-center justify-center text-xs rounded-lg transition-all focus-visible:outline-none',
                    defaultOffsetAtZero ? 'text-white/20 cursor-not-allowed' : 'text-white/50 hover:text-white/80 hover:bg-white/10 active:scale-95',
                  ].join(' ')}
                >
                  ✕
                </button>
              </div>
            </div>
          </Section>
          </>
          )}

          {activeTab === 'Advanced' && (
          <>
          {/* Cache Section */}
          <Section title="Cache">
            <div className="bg-white/5 border border-white/10 rounded-lg p-4">
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-white/60">Cached Songs:</span>
                  <span className="text-white/80 font-semibold">{cacheStats.entryCount}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/60">Cache Size:</span>
                  <span className="text-white/80 font-semibold">
                    {(cacheStats.storageSize / 1024).toFixed(1)} KB
                  </span>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-4">
                <label className="text-white/70 text-sm shrink-0">Max Cache Age</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={Math.round(settings.cacheMaxTTL / (24 * 60 * 60 * 1000))}
                    onChange={(e) => onSetCacheMaxTTL(Math.max(1, Number(e.target.value)) * 24 * 60 * 60 * 1000)}
                    className="w-20 bg-white/10 border border-white/20 rounded-lg px-2 py-1.5 text-white text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-white/40"
                  />
                  <span className="text-white/50 text-sm">days</span>
                </div>
              </div>
              <div className="flex items-center justify-between gap-4">
                <label className="text-white/70 text-sm shrink-0">Max Entries</label>
                <input
                  type="number"
                  min={10}
                  max={10000}
                  value={settings.cacheMaxEntries}
                  onChange={(e) => onSetCacheMaxEntries(Math.max(1, Number(e.target.value)))}
                  className="w-20 bg-white/10 border border-white/20 rounded-lg px-2 py-1.5 text-white text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-white/40"
                />
              </div>
            </div>

            <button
              onClick={() => {
                onClearCache();
                setCacheStats({ entryCount: 0, storageSize: 0 });
              }}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-red-900/20 hover:bg-red-900/40 border border-red-500/30 hover:border-red-500/50 rounded-lg text-red-300 hover:text-red-200 active:scale-95 transition-all font-medium text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/60"
            >
              <Trash2 size={16} />
              Clear Cache
            </button>
          </Section>
          </>
          )}

          {activeTab === 'Account' && (
          <>
          {/* Spotify Account Section */}
          <Section title="Spotify Account">
            <div className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-lg p-4">
              {user?.images?.[0]?.url ? (
                <img
                  src={user.images[0].url}
                  alt=""
                  className="w-12 h-12 rounded-full object-cover shrink-0"
                />
              ) : (
                <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center text-white/50 text-lg font-semibold shrink-0">
                  {(user?.display_name || '?').charAt(0).toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <div className="text-white font-semibold text-sm truncate">
                  {user?.display_name || 'Unknown user'}
                </div>
                {user?.email && (
                  <div className="text-white/50 text-xs truncate">{user.email}</div>
                )}
              </div>
            </div>

            <button
              onClick={() => {
                onLogout();
                onClose();
              }}
              className="w-full px-4 py-2.5 bg-white/10 hover:bg-white/20 border border-white/20 hover:border-white/40 rounded-lg text-white font-medium text-sm active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
            >
              Log Out
            </button>
          </Section>

          {/* Spotify Credentials Section */}
          {!hideSpotifyCredentialsSection && (
            <Section title="Spotify Credentials" collapsible defaultOpen={false}>
            <div className="bg-white/5 border border-white/10 rounded-lg p-4 space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-white/60">Credential Source:</span>
                <span className="text-white/80 font-semibold">
                  {authSource === 'env' ? '.env / deployment' : authSource === 'runtime' ? 'custom (browser)' : 'not configured'}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-white/60">Current Client ID:</span>
                <span className="text-white/80 font-semibold tabular-nums">
                  {clientIdLooksValid ? `${clientId.slice(0, 6)}...${clientId.slice(-4)}` : 'not set'}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-white/70 text-sm">Client ID</label>
              <input
                type="text"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="32-character Spotify Client ID"
                spellCheck={false}
                className={[
                  'w-full bg-white/10 border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2',
                  clientId.length === 0
                    ? 'border-white/20 focus:ring-white/40'
                    : clientIdLooksValid
                    ? 'border-emerald-400/50 focus:ring-emerald-400/50'
                    : 'border-red-400/50 focus:ring-red-400/50',
                ].join(' ')}
              />
              {clientId.length > 0 && !clientIdLooksValid && (
                <p className="text-red-300 text-xs">Client ID must be 32 hexadecimal characters.</p>
              )}
            </div>

            <label className="inline-flex items-center gap-2 text-white/70 text-sm">
              <input
                type="checkbox"
                checked={useCustomRedirect}
                onChange={(e) => setUseCustomRedirect(e.target.checked)}
                className="accent-white"
              />
              Advanced: custom redirect URI
            </label>

            <div className="flex flex-col gap-2">
              <label className="text-white/70 text-sm">Redirect URI</label>
              <input
                type="text"
                value={useCustomRedirect ? customRedirectUri : `${window.location.origin}/callback`}
                onChange={(e) => setCustomRedirectUri(e.target.value)}
                readOnly={!useCustomRedirect}
                className={[
                  'w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none',
                  useCustomRedirect ? 'focus:ring-2 focus:ring-white/40' : 'opacity-70 cursor-not-allowed',
                ].join(' ')}
              />
              <p className="text-white/50 text-xs">This URI must exactly match what is configured in your Spotify app.</p>
            </div>

            {spotifyConfigError && (
              <div className="px-3 py-2 rounded-lg bg-red-500/20 border border-red-500/40 text-red-200 text-xs">
                {spotifyConfigError}
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-2">
              <button
                onClick={() => {
                  setSpotifyConfigError(null);
                  try {
                    onSaveSpotifySetup(clientId.trim(), effectiveRedirectUri);
                    onClose();
                  } catch (e) {
                    setSpotifyConfigError(String(e));
                  }
                }}
                disabled={!clientIdLooksValid || (useCustomRedirect && effectiveRedirectUri.length === 0)}
                className={[
                  'px-4 py-2 rounded-lg text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60',
                  clientIdLooksValid && (!useCustomRedirect || effectiveRedirectUri.length > 0)
                    ? 'bg-emerald-500/80 hover:bg-emerald-400 text-white active:scale-95'
                    : 'bg-white/10 text-white/30 cursor-not-allowed',
                ].join(' ')}
              >
                Save credentials (re-login required)
              </button>

              <button
                onClick={() => {
                  onForgetSpotifySetup();
                  onClose();
                }}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-white/10 hover:bg-white/20 border border-white/20 text-white/80 active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
              >
                Forget custom credentials
              </button>
            </div>
            </Section>
          )}
          </>
          )}
        </div>
      </div>
    </div>
  );
}
