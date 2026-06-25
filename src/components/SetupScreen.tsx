import { useMemo, useState } from 'react';
import { KeyRound, ExternalLink, ArrowRight, Music2, Copy, Check } from 'lucide-react';
import { isValidSpotifyClientId } from '../lib/spotify';

interface SetupScreenProps {
  initialClientId: string;
  initialRedirectUri: string;
  onSave: (clientId: string, redirectUri?: string) => void;
  error?: string | null;
}

export function SetupScreen({
  initialClientId,
  initialRedirectUri,
  onSave,
  error,
}: SetupScreenProps) {
  const [clientId, setClientId] = useState(initialClientId);
  const [step, setStep] = useState<'intro' | 'config'>(
    initialClientId.trim().length > 0 ? 'config' : 'intro',
  );
  const [useCustomRedirect, setUseCustomRedirect] = useState(false);
  const [redirectUri, setRedirectUri] = useState(initialRedirectUri);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');

  const trimmedClientId = clientId.trim();
  const trimmedRedirectUri = redirectUri.trim();
  const clientIdValid = isValidSpotifyClientId(trimmedClientId);
  const canSave = clientIdValid && (!useCustomRedirect || trimmedRedirectUri.length > 0);

  const effectiveRedirect = useMemo(() => {
    if (useCustomRedirect) return trimmedRedirectUri;
    return `${window.location.origin}/callback`;
  }, [useCustomRedirect, trimmedRedirectUri]);

  const displayedRedirect = useCustomRedirect ? redirectUri : `${window.location.origin}/callback`;

  const copyRedirectUri = async () => {
    if (!displayedRedirect) return;
    try {
      await navigator.clipboard.writeText(displayedRedirect);
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 1500);
    } catch {
      setCopyState('idle');
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-8 bg-neutral-950 px-6">
      <div className="w-full max-w-xl rounded-3xl border border-white/15 bg-white/5 backdrop-blur-xl p-6 sm:p-8 flex flex-col gap-6">
        {step === 'intro' ? (
          <>
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-green-400 to-green-600 flex items-center justify-center shadow-lg shadow-green-500/25 shrink-0">
                <Music2 size={22} className="text-white" />
              </div>
              <div>
                <h1 className="text-white text-2xl font-bold tracking-tight">Welcome to Spotify Lyrics App</h1>
                <p className="text-white/60 text-sm mt-1">
                  Quick first step before login: this app needs your Spotify Client ID.
                </p>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/70 space-y-2">
              <p>Why this is needed:</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Spotify requires each app integration to use its own Client ID.</li>
                <li>Most personal Spotify apps stay in Development mode, which has user limits.</li>
                <li>Your data stays on-device: this app runs in your browser and stores setup locally.</li>
              </ul>
              <p>
                Extended Quota is generally limited to organizations (not individuals), so shared personal apps are not a reliable long-term path. See{' '}
                <a
                  href="https://developer.spotify.com/documentation/web-api/concepts/quota-modes"
                  target="_blank"
                  rel="noreferrer"
                  className="text-emerald-200/90 hover:text-emerald-100"
                >
                  Spotify Quota Modes
                </a>
                .
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
              <a
                href="https://github.com/xusoo/get-lyrics-app"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-white/75 hover:text-white text-sm"
              >
                View project on GitHub
                <ExternalLink size={14} />
              </a>

              <button
                onClick={() => setStep('config')}
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm leading-none transition-all bg-emerald-500 hover:bg-emerald-400 text-white active:scale-95"
              >
                <span>Set up</span>
                <ArrowRight size={16} className="shrink-0" />
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-emerald-500/20 border border-emerald-300/30 flex items-center justify-center shrink-0">
                <KeyRound size={22} className="text-emerald-200" />
              </div>
              <div>
                <h1 className="text-white text-2xl font-bold tracking-tight">Set up your Spotify app</h1>
                <p className="text-white/60 text-sm mt-1">Enter your Spotify app details to continue.</p>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="client-id" className="text-white/80 text-sm font-medium">Spotify Client ID</label>
              <input
                id="client-id"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="32-character client ID"
                autoComplete="off"
                spellCheck={false}
                className={[
                  'bg-white/10 border rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2',
                  trimmedClientId.length === 0
                    ? 'border-white/20 focus:ring-white/40'
                    : clientIdValid
                      ? 'border-emerald-400/50 focus:ring-emerald-400/50'
                      : 'border-red-400/60 focus:ring-red-400/60',
                ].join(' ')}
              />
              <p className="text-white/50 text-xs">Found in your Spotify Developer Dashboard app settings.</p>
              {trimmedClientId.length > 0 && !clientIdValid && (
                <p className="text-red-300 text-xs">Client ID should be 32 hexadecimal characters.</p>
              )}
            </div>

            <div className="flex items-center gap-2">
              <input
                id="custom-redirect"
                type="checkbox"
                checked={useCustomRedirect}
                onChange={(e) => setUseCustomRedirect(e.target.checked)}
                className="accent-emerald-400"
              />
              <label htmlFor="custom-redirect" className="text-white/70 text-sm">
                Advanced: use custom redirect URI
              </label>
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="redirect-uri" className="text-white/80 text-sm font-medium">Redirect URI</label>
              <div className="relative">
                <input
                  id="redirect-uri"
                  value={displayedRedirect}
                  onChange={(e) => setRedirectUri(e.target.value)}
                  readOnly={!useCustomRedirect}
                  className={[
                    'w-full bg-white/10 border border-white/20 rounded-xl px-3 py-2.5 pr-24 text-white text-sm focus:outline-none',
                    useCustomRedirect ? 'focus:ring-2 focus:ring-white/40' : 'opacity-70 cursor-not-allowed',
                  ].join(' ')}
                />
                <button
                  type="button"
                  onClick={copyRedirectUri}
                  aria-label="Copy redirect URI"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex items-center gap-1 px-2 py-1 rounded-md border border-white/20 bg-white/10 hover:bg-white/20 text-white/80 hover:text-white text-xs transition-colors"
                >
                  {copyState === 'copied' ? <Check size={12} /> : <Copy size={12} />}
                  <span>{copyState === 'copied' ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
              <p className="text-white/50 text-xs">Add this exact URI in your Spotify app Redirect URIs before login.</p>
            </div>

            {(error || saveError) && (
              <div className="px-4 py-3 rounded-xl bg-red-500/20 border border-red-500/40 text-red-300 text-sm">
                {saveError ?? error}
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
              <a
                href="https://developer.spotify.com/dashboard"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-emerald-200/90 hover:text-emerald-100 text-sm"
              >
                Open Spotify Dashboard
                <ExternalLink size={14} />
              </a>

              <button
                onClick={() => {
                  setSaveError(null);
                  try {
                    onSave(trimmedClientId, effectiveRedirect);
                  } catch (e) {
                    setSaveError(String(e));
                  }
                }}
                disabled={!canSave}
                className={[
                  'px-5 py-2.5 rounded-xl font-semibold text-sm transition-all',
                  canSave
                    ? 'bg-emerald-500 hover:bg-emerald-400 text-white active:scale-95'
                    : 'bg-white/10 text-white/30 cursor-not-allowed',
                ].join(' ')}
              >
                Save
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
