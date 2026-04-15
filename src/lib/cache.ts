import { mkdir, readFile, writeFile, readdir, stat, unlink } from 'fs/promises';
import { createHash } from 'crypto';
import { join } from 'path';
import { homedir } from 'os';

const CACHE_DIR = join(homedir(), '.cache', 'docpilot');
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_ENTRY_BYTES = 10 * 1024 * 1024;    // 10 MB per entry — skip caching larger responses
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;   // 200 MB total — evict oldest entries beyond this

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
    const serialized = JSON.stringify(entry);

    // Skip caching entries that are too large to avoid filling disk with single blobs
    if (Buffer.byteLength(serialized, 'utf-8') > MAX_ENTRY_BYTES) {
      process.stderr.write(`[docpilot] cache: skipping large entry (>${MAX_ENTRY_BYTES / 1024 / 1024}MB) for key ${key.slice(0, 60)}\n`);
      return;
    }

    await writeFile(cachePath(cacheKey(key)), serialized, 'utf-8');
    await evictIfOverLimit();
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

/**
 * Delete all cache entries — used by --clear-cache flag.
 */
export async function clearCache(): Promise<number> {
  try {
    const files = await readdir(CACHE_DIR);
    const jsonFiles = files.filter(f => f.endsWith('.json'));
    await Promise.all(jsonFiles.map(f => unlink(join(CACHE_DIR, f))));
    return jsonFiles.length;
  } catch {
    return 0;
  }
}

/**
 * Evict oldest cache files when total size exceeds MAX_TOTAL_BYTES.
 * Runs async in the background — non-blocking for the caller.
 */
async function evictIfOverLimit(): Promise<void> {
  try {
    const files = await readdir(CACHE_DIR);
    const jsonFiles = files.filter(f => f.endsWith('.json'));

    const stats = await Promise.all(
      jsonFiles.map(async f => {
        const filePath = join(CACHE_DIR, f);
        const s = await stat(filePath);
        return { path: filePath, size: s.size, mtime: s.mtimeMs };
      }),
    );

    const totalBytes = stats.reduce((sum, s) => sum + s.size, 0);
    if (totalBytes <= MAX_TOTAL_BYTES) return;

    // Sort oldest first, evict until under limit
    stats.sort((a, b) => a.mtime - b.mtime);
    let remaining = totalBytes;
    for (const entry of stats) {
      if (remaining <= MAX_TOTAL_BYTES) break;
      await unlink(entry.path);
      remaining -= entry.size;
    }
  } catch {
    // Eviction failures are non-fatal
  }
}
