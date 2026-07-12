# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Snapshot

- Spotify Lyrics App is a React 19 + Vite 8 SPA that syncs Spotify playback with LRCLIB lyrics for a Tesla browser-friendly karaoke UI.
- The app is intentionally frontend-only: Spotify auth uses PKCE in the browser and stores runtime auth config plus tokens in `localStorage`.
- Prefer linking to the existing product and setup docs in [README.md](README.md) instead of duplicating them here.

## Commands

```bash
npm run dev           # Vite dev server (localhost only, 127.0.0.1:5173)
npm run dev:host      # Vite dev server visible on network
npm run build         # TypeScript + Vite build to dist/
npm run typecheck     # TypeScript type check only
npm run lint          # ESLint
npm run check         # typecheck + lint + build (run this before committing)
npm run preview       # Serve the production build locally

npm run test          # Vitest unit tests (run once)
npm run test:watch    # Vitest watch mode
npm run test:e2e      # Playwright E2E (starts mock server on port 5174)
npm run test:e2e:ui   # Playwright with inspector

# Run a single unit test file:
npx vitest run src/lib/serial-queue.test.ts
npx vitest run src/hooks/useLyrics.test.tsx --reporter=verbose

# Run a single E2E test:
npx playwright test e2e/next-song-transition.spec.ts
```

## Environment Variables

```
VITE_SPOTIFY_CLIENT_ID      # 32-char hex (from Spotify Developer Dashboard)
VITE_SPOTIFY_REDIRECT_URI   # defaults to {origin}/callback
VITE_MOCK_LRCLIB            # true = artificial 2-5s delay + Lorem Ipsum lyrics (used in E2E tests)
```

Local development uses the Spotify redirect URI `http://127.0.0.1:5173/callback`. Vercel deploys this as a static SPA; route handling depends on [vercel.json](vercel.json).

## Where To Start

- [src/App.tsx](src/App.tsx) chooses between setup, login, and the main player view.
- [src/components/MainView.tsx](src/components/MainView.tsx) is the orchestration layer for playback, carousel state, settings, queue prefetch, and panels. If something feels "wrong" with app behavior, look here first.
- [src/components/SongCarousel.tsx](src/components/SongCarousel.tsx) owns the three-slot slide behavior.
- [src/hooks/useCurrentTrack.ts](src/hooks/useCurrentTrack.ts) handles Spotify polling, optimistic track updates, and offline detection.
- [src/hooks/useLyrics.ts](src/hooks/useLyrics.ts) handles LRCLIB fetches, local cache hydration, picker state, and in-flight deduplication.
- [src/hooks/usePlaybackSync.ts](src/hooks/usePlaybackSync.ts) interpolates playback with `requestAnimationFrame` and only re-renders on lyric line changes.
- [src/hooks/useSpotifyAuth.ts](src/hooks/useSpotifyAuth.ts) owns PKCE login, callback handling, token refresh, and runtime Spotify setup.
- [src/lib/spotify.ts](src/lib/spotify.ts), [src/lib/lrclib.ts](src/lib/lrclib.ts), [src/lib/lyrics-service.ts](src/lib/lyrics-service.ts), [src/lib/serial-queue.ts](src/lib/serial-queue.ts), [src/lib/lyrics-store.ts](src/lib/lyrics-store.ts), and [src/lib/lrc-parser.ts](src/lib/lrc-parser.ts) are the main behavior-heavy libraries.
- [src/types.ts](src/types.ts) is the source of truth for shared app types.

## Architecture

Data flow at a glance:

```
Spotify API (3s poll)
  └── useCurrentTrack → playback state (track, progress_ms, is_playing)
        └── MainView (central orchestrator)
              ├── useLyrics ×3 (prev/current/next track) → LyricLine[]
              │     └── lyrics-service → SerialQueue → lrclib.ts → LRCLIB API
              ├── usePlaybackSync → ~50fps rAF loop → currentLineIndex
              ├── useSettings → localStorage preferences
              └── SongCarousel (3-slot: prev | current | next)
```

**SerialQueue bottleneck**: All LRCLIB requests are serialized through a single queue to avoid hammering the free API. A `'current'`-priority request preempts an in-flight `'prefetch'` request by aborting it and re-queuing. The `'passive'` role (prev song) is cache-only and never triggers a network request.

**Optimistic UI**: Skips show the new track immediately before the Spotify API confirms. `useCurrentTrack` implements an 8s guard that blocks stale polls after a skip (Spotify sometimes returns the old track for 3-4s after skipping).

**Progress interpolation**: `usePlaybackSync` records `performance.now()` at each poll and interpolates how far playback has advanced in the 3s gap, enabling smooth lyric line transitions without extra API calls. It fires `onTrackEnded` ~500ms before the track ends to trigger an optimistic carousel advance.

**3-slot carousel**: Slots are always `[prev, current, next]`. On skip, `MainView` rearranges the slots in state first, then `SongCarousel` animates. Direction (slide left/right/instant) is decided based on whether the new track was the expected next/prev or an unexpected external change.

**Per-song offset**: Each LRCLIB track ID can have an independent timing shift stored in `localStorage`, so users can fix sync on one song without affecting others.

## Codebase Conventions

- Fix behavior at the owning hook or lib when possible. Many leaf components are mostly presentational; `MainView` and the hooks control the real state transitions.
- Preserve the current browser-only auth model unless the user explicitly asks for an architecture change.
- Respect the existing `localStorage` persistence model for auth config, tokens, settings, lyric cache, and per-song offsets.
- This app relies heavily on refs for stable closures and effect-driven orchestration. Be cautious about replacing ref-based flows with state-only rewrites.
- Keep carousel changes localized. The swipe/programmatic slide flow depends on `MainView` slot rearrangement matching `SongCarousel` transition timing.
- Preserve lyric fetch deduplication and prefetch sequencing in [src/hooks/useLyrics.ts](src/hooks/useLyrics.ts). Avoid introducing concurrent fetch paths for the same track.
- Preserve the playback interpolation model in [src/hooks/usePlaybackSync.ts](src/hooks/usePlaybackSync.ts). Avoid changes that force React re-renders on every animation frame.
- Unit tests use Vitest with JSDOM. No test globals — use explicit `import { describe, it, expect } from 'vitest'`.
- E2E tests use Playwright with a full mock Spotify API and run single-worker (no parallelization). The mock server runs on port 5174.

## Validation

- Run `npm run check` (typecheck + lint + build) as the broad pre-commit gate.
- Run `npm run test` for unit tests and `npm run test:e2e` for E2E.
- For playback, auth, or lyric-sync changes, do a focused manual browser check in addition to automated tests.
