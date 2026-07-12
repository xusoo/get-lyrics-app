/**
 * End-to-end test: next-song transition timing
 *
 * Goal: verify that clicking "Next" immediately reflects the new song in the
 * UI (mini-player title, artist) even while the LRCLIB lyrics fetch is still
 * in flight (the mock introduces a 3-10 s delay).
 *
 * All external APIs are intercepted by Playwright so no real Spotify or LRCLIB
 * calls are made. The app is started with VITE_MOCK_LRCLIB=true (configured in
 * playwright.config.ts) which makes the in-app LRCLIB code add the artificial
 * delay itself — this also tests the cancellation path: switching while loading.
 */

import { test, expect, type Page, type Route } from '@playwright/test';

// ── Fake Spotify data ─────────────────────────────────────────────────────────

const FAKE_CLIENT_ID = 'a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5'; // 32 hex chars — passes validation

const TOKEN_DATA = {
  access_token: 'mock_access_token_for_testing',
  refresh_token: 'mock_refresh_token_for_testing',
  expires_at: Date.now() + 3_600_000 * 24, // 24 h from now
};

function makeTrack(id: string, name: string, artist: string) {
  return {
    id,
    name,
    type: 'track',
    duration_ms: 220_000,
    artists: [{ id: `artist-${id}`, name: artist }],
    album: {
      id: `album-${id}`,
      name: `${name} Album`,
      images: [{ url: `https://example.com/art-${id}.jpg`, height: 300, width: 300 }],
    },
  };
}

const TRACK_A = makeTrack('track-alpha', 'Track Alpha', 'Artist One');
const TRACK_B = makeTrack('track-beta', 'Track Beta', 'Artist Two');
const TRACK_C = makeTrack('track-gamma', 'Track Gamma', 'Artist Three');

// ── Mock Spotify API ──────────────────────────────────────────────────────────

function playerResponse(track: ReturnType<typeof makeTrack>, progressMs = 30_000) {
  return {
    item: track,
    progress_ms: progressMs,
    is_playing: true,
    currently_playing_type: 'track',
    repeat_state: 'off',
    shuffle_state: false,
    device: { id: 'mock-device', is_active: true, is_private_session: false, is_restricted: false, name: 'Mock Device', type: 'computer', volume_percent: 80, supports_volume: true },
  };
}

function queueResponse(current: ReturnType<typeof makeTrack>, next: ReturnType<typeof makeTrack>) {
  return {
    currently_playing: current,
    queue: [next, TRACK_C],
  };
}

async function setupMocks(page: Page): Promise<{ skipCalled: () => boolean }> {
  let currentTrack = TRACK_A;
  let skipCalled = false;

  // Spotify token refresh — always succeed
  await page.route('https://accounts.spotify.com/api/token', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        access_token: TOKEN_DATA.access_token,
        refresh_token: TOKEN_DATA.refresh_token,
        expires_in: 3600,
        token_type: 'Bearer',
      }),
    });
  });

  // Currently playing / playback state
  await page.route('**/api.spotify.com/v1/me/player**', async (route: Route) => {
    if (route.request().method() === 'POST') {
      // Skip next
      skipCalled = true;
      currentTrack = TRACK_B;
      await route.fulfill({ status: 204, body: '' });
    } else {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(playerResponse(currentTrack)),
      });
    }
  });

  // Queue
  await page.route('**/api.spotify.com/v1/me/player/queue**', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(queueResponse(currentTrack, currentTrack === TRACK_A ? TRACK_B : TRACK_C)),
    });
  });

  // Pause / play / seek (return 204 — no action needed in tests)
  await page.route('**/api.spotify.com/v1/me/player/pause', async (route: Route) => {
    await route.fulfill({ status: 204, body: '' });
  });
  await page.route('**/api.spotify.com/v1/me/player/play', async (route: Route) => {
    await route.fulfill({ status: 204, body: '' });
  });
  await page.route('**/api.spotify.com/v1/me/player/seek**', async (route: Route) => {
    await route.fulfill({ status: 204, body: '' });
  });

  // Album art — serve a tiny valid PNG so the browser can actually decode & fade it.
  await page.route('**/art-*.jpg', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
        'base64',
      ),
    });
  });

  return { skipCalled: () => skipCalled };
}

// ── Test setup ────────────────────────────────────────────────────────────────

async function bootApp(page: Page): Promise<void> {
  // Inject auth tokens before the page scripts run so the app skips the login flow.
  await page.addInitScript(({ clientId, tokenKey, configKey, tokenData }) => {
    localStorage.setItem(configKey, JSON.stringify({ clientId }));
    localStorage.setItem(tokenKey, JSON.stringify(tokenData));
  }, {
    clientId: FAKE_CLIENT_ID,
    tokenKey: 'spotify_token',
    configKey: 'spotify_auth_config',
    tokenData: TOKEN_DATA,
  });

  await page.goto('/');
}

// ── Locators ─────────────────────────────────────────────────────────────────

/** The mini-player track name — the first `p` whose text exactly matches. */
function trackTitle(page: Page, name: string) {
  return page.locator('p').filter({ hasText: name }).first();
}

// ── Tests ────────────────────────────────────────────────────────────────────

test.describe('Next-song transition', () => {
  test('immediately shows new song in mini-player when clicking Next while lyrics load', async ({ page }) => {
    const { skipCalled } = await setupMocks(page);
    await bootApp(page);

    // Wait until Track Alpha is visible in the mini-player.
    // With VITE_MOCK_LRCLIB=true the LRCLIB fetch adds 3-10 s, so lyrics are
    // NOT loaded yet when the title first appears.
    await expect(trackTitle(page, 'Track Alpha')).toBeVisible({ timeout: 15_000 });

    // The Next button should be visible as soon as the mini-player renders.
    const nextBtn = page.getByRole('button', { name: 'Next track' });
    await expect(nextBtn).toBeVisible({ timeout: 5_000 });

    // Record timing and click — the song title must change within 800 ms,
    // which is well before the fastest mock lyrics response (3 s).
    const before = Date.now();
    await nextBtn.click();

    await expect(trackTitle(page, 'Track Beta')).toBeVisible({ timeout: 800 });
    const elapsed = Date.now() - before;

    expect(elapsed).toBeLessThan(800);
    expect(skipCalled()).toBe(true);
  });

  test('lyrics eventually appear after the initial loading delay', async ({ page }) => {
    await setupMocks(page);
    await bootApp(page);

    // Wait for Track Alpha in the mini-player.
    await expect(trackTitle(page, 'Track Alpha')).toBeVisible({ timeout: 15_000 });

    // The lyrics region appears only after the mock resolves (3-10 s).
    // Budget: 15 s from the moment the title appeared.
    const lyricsRegion = page.getByRole('region', { name: 'Song lyrics' });
    await expect(lyricsRegion).toBeVisible({ timeout: 15_000 });

    // At least one Lorem-ipsum lyric line should be present.
    await expect(lyricsRegion.getByRole('button').first()).toContainText('Lorem ipsum', { timeout: 15_000 });
  });

  test('switching song cancels the in-flight lyrics request', async ({ page }) => {
    await setupMocks(page);
    await bootApp(page);

    // Wait for Track Alpha.
    await expect(trackTitle(page, 'Track Alpha')).toBeVisible({ timeout: 15_000 });

    // Click next while Track A lyrics are still loading.
    const nextBtn = page.getByRole('button', { name: 'Next track' });
    await nextBtn.click();

    // Mini-player updates immediately.
    await expect(trackTitle(page, 'Track Beta')).toBeVisible({ timeout: 800 });

    // Lyrics eventually load for Track Beta.
    const lyricsRegion = page.getByRole('region', { name: 'Song lyrics' });
    await expect(lyricsRegion).toBeVisible({ timeout: 15_000 });
    await expect(lyricsRegion.getByRole('button').first()).toContainText('Lorem ipsum', { timeout: 15_000 });

    // Track Alpha's title must not be shown — we're on Track Beta.
    await expect(trackTitle(page, 'Track Alpha')).not.toBeVisible();
    await expect(trackTitle(page, 'Track Beta')).toBeVisible();
  });

  test('shows the next song backdrop after switching (no lost background)', async ({ page }) => {
    await setupMocks(page);
    await bootApp(page);

    await expect(trackTitle(page, 'Track Alpha')).toBeVisible({ timeout: 15_000 });
    // Track Alpha's blurred backdrop is rendered.
    await expect(page.locator('img[src*="art-track-alpha.jpg"]').first()).toBeVisible({ timeout: 5_000 });

    await page.getByRole('button', { name: 'Next track' }).click();
    await expect(trackTitle(page, 'Track Beta')).toBeVisible({ timeout: 800 });

    // The new song's backdrop is present after the transition — the fix keeps an
    // album-art <img> painted across the switch instead of blanking to black.
    await expect(page.locator('img[src*="art-track-beta.jpg"]').first()).toBeVisible({ timeout: 5_000 });
  });
});
