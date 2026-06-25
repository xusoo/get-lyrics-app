# AGENTS

## Project Snapshot

- Spotify Lyrics App is a React 19 + Vite 8 SPA that syncs Spotify playback with LRCLIB lyrics for a Tesla browser-friendly karaoke UI.
- The app is intentionally frontend-only: Spotify auth uses PKCE in the browser and stores runtime auth config plus tokens in `localStorage`.
- Prefer linking to the existing product and setup docs in [README.md](README.md) instead of duplicating them here.

## Commands

- `npm run dev` starts the Vite dev server.
- `npm run build` runs `tsc -b` and the production Vite build.
- `npm run lint` runs the workspace ESLint config.
- `npm run preview` serves the production build locally.

## Where To Start

- [src/App.tsx](src/App.tsx) chooses between setup, login, and the main player view.
- [src/components/MainView.tsx](src/components/MainView.tsx) is the orchestration layer for playback, carousel state, settings, queue prefetch, and panels.
- [src/components/SongCarousel.tsx](src/components/SongCarousel.tsx) owns the three-slot slide behavior.
- [src/hooks/useCurrentTrack.ts](src/hooks/useCurrentTrack.ts) handles Spotify polling, optimistic track updates, and offline detection.
- [src/hooks/useLyrics.ts](src/hooks/useLyrics.ts) handles LRCLIB fetches, local cache hydration, picker state, and in-flight deduplication.
- [src/hooks/usePlaybackSync.ts](src/hooks/usePlaybackSync.ts) interpolates playback with `requestAnimationFrame` and only re-renders on lyric line changes.
- [src/hooks/useSpotifyAuth.ts](src/hooks/useSpotifyAuth.ts) owns PKCE login, callback handling, token refresh, and runtime Spotify setup.
- [src/lib/spotify.ts](src/lib/spotify.ts), [src/lib/lrclib.ts](src/lib/lrclib.ts), [src/lib/lyrics-store.ts](src/lib/lyrics-store.ts), and [src/lib/lrc-parser.ts](src/lib/lrc-parser.ts) are the main behavior-heavy libraries.
- [src/types.ts](src/types.ts) is the source of truth for shared app types.

## Codebase Conventions

- Fix behavior at the owning hook or lib when possible. Many leaf components are mostly presentational; `MainView` and the hooks control the real state transitions.
- Preserve the current browser-only auth model unless the user explicitly asks for an architecture change.
- Respect the existing `localStorage` persistence model for auth config, tokens, settings, lyric cache, and per-song offsets.
- This app relies heavily on refs for stable closures and effect-driven orchestration. Be cautious about replacing ref-based flows with state-only rewrites.
- Keep carousel changes localized. The swipe/programmatic slide flow depends on `MainView` slot rearrangement matching `SongCarousel` transition timing.
- Preserve lyric fetch deduplication and prefetch sequencing in [src/hooks/useLyrics.ts](src/hooks/useLyrics.ts). Avoid introducing concurrent fetch paths for the same track.
- Preserve the playback interpolation model in [src/hooks/usePlaybackSync.ts](src/hooks/usePlaybackSync.ts). Avoid changes that force React re-renders on every animation frame.

## Validation Expectations

- For code changes, run `npm run build` first; it is the fastest broad check because there is no test suite configured.
- Run `npm run lint` for touched TypeScript and React code.
- For playback, auth, or lyric-sync changes, do a focused manual browser check because automated tests are not configured in this repo.

## Environment Notes

- Local development uses the Spotify redirect URI `http://127.0.0.1:5173/callback`; keep README and runtime setup flows aligned if you change auth behavior.
- Vercel deploys this as a static SPA; route handling depends on [vercel.json](vercel.json).
- If you need deployment details, see [README.md](README.md) and the repo note in `/memories/repo/deployment.md`.