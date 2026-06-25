import { Music2 } from 'lucide-react';

interface LoginScreenProps {
  onLogin: () => void;
  error?: string | null;
}

export function LoginScreen({ onLogin, error }: LoginScreenProps) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-8 bg-neutral-950 dark:bg-neutral-950 px-6">
      {/* Logo + title */}
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-green-400 to-green-600 flex items-center justify-center shadow-2xl shadow-green-500/30">
          <Music2 size={40} className="text-white" />
        </div>
        <h1 className="text-4xl font-bold text-white tracking-tight">Spotify Lyrics App</h1>
        <p className="text-white/50 text-lg max-w-sm">
          Synced lyrics for your drive. Connect with Spotify to get started.
        </p>
      </div>

      {/* Error */}
      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-500/20 border border-red-500/40 text-red-300 text-sm max-w-sm text-center">
          {error}
        </div>
      )}

      {/* Login button */}
      <button
        onClick={onLogin}
        className="flex items-center gap-3 px-8 py-4 rounded-2xl bg-[#1DB954] hover:bg-[#1ed760] active:scale-95 transition-all text-white font-bold text-lg shadow-2xl shadow-green-500/30 min-w-[280px] justify-center"
      >
        {/* Spotify wordmark SVG */}
        <svg viewBox="0 0 24 24" className="w-6 h-6 fill-current" aria-hidden>
          <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
        </svg>
        Login with Spotify
      </button>

      <p className="text-white/25 text-xs max-w-xs text-center">
        Lyrics provided by LRCLIB. This app is for personal use and requires your own Spotify Developer credentials.
      </p>
    </div>
  );
}
