/**
 * Development mock for LRCLIB.
 *
 * Enabled via `VITE_MOCK_LRCLIB=true` (e.g. in .env.local or the E2E test server).
 * When active, {@link lrclib} short-circuits the real API and returns Lorem Ipsum
 * lyrics after a realistic 2-5 s delay — this avoids hammering the free API during
 * UI testing while still exercising the slow-response and cancellation paths.
 *
 * This module is only referenced from behind the `MOCK_LRCLIB` guard in lrclib.ts,
 * which Vite inlines to `false` in production builds, so the guarded branch is
 * dead-code-eliminated and this whole module is tree-shaken out of the bundle.
 */

// Incremented once per mock request — gives each log line a unique number.
let mockRequestCounter = 0;

function mockLog(id: number, state: 'start' | 'done' | 'abort', label: string, timing: string): void {
  const prefix = state === 'start' ? '🟡 Starting ' : state === 'done' ? '✅ Resolved ' : '❌ Aborted  ';
  console.log(`[LRCLIB #${id}] ${prefix}${label}  ${timing}`);
}

export const MOCK_SYNCED_LYRICS = [
  '[00:03.00] Lorem ipsum dolor sit amet',
  '[00:07.50] Consectetur adipiscing elit sed do',
  '[00:12.20] Eiusmod tempor incididunt ut labore',
  '[00:17.80] Et dolore magna aliqua ut enim ad',
  '[00:22.10] Minim veniam quis nostrud exercitation',
  '[00:26.50] Ullamco laboris nisi ut aliquip ex ea',
  '[00:31.00] Commodo consequat duis aute irure dolor',
  '[00:36.40] In reprehenderit in voluptate velit esse',
  '[00:41.20] Cillum dolore eu fugiat nulla pariatur',
  '[00:46.00] Excepteur sint occaecat cupidatat non',
  '[00:51.30] Proident sunt in culpa qui officia',
  '[00:56.10] Deserunt mollit anim id est laborum',
  '[01:01.00] Sed ut perspiciatis unde omnis iste',
  '[01:06.50] Natus error sit voluptatem accusantium',
  '[01:12.00] Doloremque laudantium totam rem aperiam',
  '[01:17.50] Eaque ipsa quae ab illo inventore',
  '[01:23.00] Veritatis et quasi architecto beatae',
  '[01:28.50] Vitae dicta sunt explicabo nemo enim',
].join('\n');

export function mockDelay(label: string, signal?: AbortSignal): Promise<void> {
  const id = ++mockRequestCounter;
  const ms = Math.round(Math.random() * 3_000 + 2_000);
  const start = Date.now();
  mockLog(id, 'start', label, `(≈${(ms / 1_000).toFixed(1)} s)`);
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      mockLog(id, 'done', label, `(${((Date.now() - start) / 1_000).toFixed(1)} s)`);
      resolve();
    }, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timeoutId);
      mockLog(id, 'abort', label, `(after ${((Date.now() - start) / 1_000).toFixed(1)} s)`);
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });
}
