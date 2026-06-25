/**
 * Persistent lyrics cache backed by localStorage.
 * - Entries expire after CACHE_TTL_MS (30 days).
 * - At most CACHE_MAX_ENTRIES are kept; oldest are evicted when the cap is exceeded.
 * - Raw LRC/plain strings are stored (not parsed arrays) to minimise storage size.
 */

import { parseLyricsResult, type ParsedLyricsResult } from './lrc-parser';

const STORAGE_KEY = 'tesla_lyrics_cache_v1';
const CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
const CACHE_MAX_ENTRIES = 1000;

// ── Runtime-configurable limits (overridden by configureCacheSettings) ──────
let activeCacheTTL = CACHE_TTL_MS;
let activeCacheMaxEntries = CACHE_MAX_ENTRIES;

export function configureCacheSettings(ttlMs: number, maxEntries: number): void {
  activeCacheTTL = ttlMs;
  activeCacheMaxEntries = maxEntries;
}

interface StoredEntry {
  synced: string | null;
  plain: string | null;
  cachedAt: number;
  selectedId?: number | null;
}

interface StoredCache {
  entries: Record<string, StoredEntry>;
}

export type ResolvedEntry = ParsedLyricsResult & { selectedId: number | null };

// ── Singleton store (parsed once on first access) ───────────────────────────

let storedCache: StoredCache | null = null;

function getStore(): StoredCache {
  if (!storedCache) {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      storedCache = raw ? (JSON.parse(raw) as StoredCache) : { entries: {} };
    } catch {
      storedCache = { entries: {} };
    }
  }
  return storedCache;
}

function save(store: StoredCache): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Storage quota exceeded — silently skip
  }
}

function evict(store: StoredCache): void {
  const now = Date.now();
  // Remove expired entries
  for (const [id, entry] of Object.entries(store.entries)) {
    if (now - entry.cachedAt > activeCacheTTL) {
      delete store.entries[id];
    }
  }
  // If still over cap, remove oldest entries
  const ids = Object.keys(store.entries);
  if (ids.length > activeCacheMaxEntries) {
    ids
      .sort((a, b) => store.entries[a].cachedAt - store.entries[b].cachedAt)
      .slice(0, ids.length - activeCacheMaxEntries)
      .forEach((id) => delete store.entries[id]);
  }
}

function toResolved(entry: StoredEntry): ResolvedEntry {
  return { ...parseLyricsResult(entry.synced, entry.plain), selectedId: entry.selectedId ?? null };
}

// ── Public API ────────────────────────────────────────────────────────────────

export function hasInStore(trackId: string): boolean {
  const entry = getStore().entries[trackId];
  return !!entry && Date.now() - entry.cachedAt <= activeCacheTTL;
}

export function getFromStore(trackId: string): ResolvedEntry | null {
  const store = getStore();
  const entry = store.entries[trackId];
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > activeCacheTTL) return null;
  return toResolved(entry);
}

export function putToStore(trackId: string, synced: string | null, plain: string | null, selectedId?: number | null): void {
  const store = getStore();
  store.entries[trackId] = { synced, plain, cachedAt: Date.now(), selectedId: selectedId ?? null };
  evict(store);
  save(store);
}

export function getCacheStats(): { entryCount: number; storageSize: number } {
  const store = getStore();
  const entryCount = Object.keys(store.entries).length;
  try {
    const json = JSON.stringify(store);
    const storageSize = new Blob([json]).size;
    return { entryCount, storageSize };
  } catch {
    return { entryCount, storageSize: 0 };
  }
}

export function clearLyricsCache(): void {
  storedCache = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
