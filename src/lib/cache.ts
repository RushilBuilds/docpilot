import { mkdir, readFile, writeFile } from 'fs/promises';
import { createHash } from 'crypto';
import { join } from 'path';
import { homedir } from 'os';

const CACHE_DIR = join(homedir(), '.cache', 'docpilot');
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

function cacheKey(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function cachePath(key: string): string {
  return join(CACHE_DIR, `${key}.json`);
}

async function ensureCacheDir(): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const raw = await readFile(cachePath(cacheKey(key)), 'utf-8');
    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (Date.now() > entry.expiresAt) return null; // expired
    return entry.data;
  } catch {
    return null;
  }
}

export async function cacheSet<T>(key: string, data: T, ttlMs = DEFAULT_TTL_MS): Promise<void> {
  try {
    await ensureCacheDir();
    const entry: CacheEntry<T> = { data, expiresAt: Date.now() + ttlMs };
    await writeFile(cachePath(cacheKey(key)), JSON.stringify(entry), 'utf-8');
  } catch {
    // Cache write failures are non-fatal — just skip
  }
}

/**
 * Wrap an async function with cache-aside logic.
 */
export async function withCache<T>(key: string, fn: () => Promise<T>, ttlMs = DEFAULT_TTL_MS): Promise<T> {
  const cached = await cacheGet<T>(key);
  if (cached !== null) return cached;

  const result = await fn();
  await cacheSet(key, result, ttlMs);
  return result;
}
