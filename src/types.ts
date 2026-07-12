export interface SpotifyImage {
  url: string;
  height: number | null;
  width: number | null;
}

export interface SpotifyAlbum {
  id: string;
  name: string;
  images: SpotifyImage[];
}

export interface SpotifyArtist {
  id: string;
  name: string;
}

export interface SpotifyTrack {
  id: string;
  name: string;
  duration_ms: number;
  artists: SpotifyArtist[];
  album: SpotifyAlbum;
}

export interface PlaybackState {
  track: SpotifyTrack;
  progress_ms: number;
  is_playing: boolean;
  timestamp: number; // local performance.now() at the time of the poll
  repeat_state?: string;
}

export interface LyricLine {
  timeMs: number;
  text: string;
}

export interface Settings {
  fontSize: number; // base px
  uiFontSize: number; // base px for :root font-size (UI scaling)
  defaultLyricsOffset: number; // ms — positive = show lyrics earlier, negative = later
  backgroundBlur: number; // 0-100 (percent)
  backgroundDim: number; // 0-100 (percent, extra dark overlay on top of the blurred art)
  cacheMaxTTL: number; // ms
  cacheMaxEntries: number; // number
}

export interface TokenData {
  access_token: string;
  refresh_token: string;
  expires_at: number; // unix ms
}

// ── Spotify API response shapes ───────────────────────────────────────────────

export interface CurrentlyPlayingResponse {
  item: SpotifyTrack;
  progress_ms: number | null;
  is_playing: boolean;
  currently_playing_type: string;
  repeat_state?: string;
}
