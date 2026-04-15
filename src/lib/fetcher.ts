import * as cheerio from 'cheerio';
import { withCache } from './cache.js';
import { rewriteToRawGithub } from './registry.js';
import { USER_AGENT } from './version.js';

/**
 * Retry an async operation up to maxAttempts times with exponential backoff.
 * Only retries on network-level errors (not HTTP 4xx client errors).
 */
async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      // Don't retry on HTTP client errors (4xx) — they won't change
      if (err instanceof Error && err.message.match(/HTTP 4\d\d/)) throw err;
      if (attempt < maxAttempts - 1) {
        await new Promise(res => setTimeout(res, 1000 * 2 ** attempt)); // 1s, 2s, 4s
      }
    }
  }
  throw lastErr;
}

export interface FetchResult {
  text: string;
  paragraphs: string[];
}

/**
 * Fetch a URL and return cleaned text content extracted via cheerio.
 * Results are cached to ~/.cache/docpilot/ for 24 hours.
 */
export async function fetchAndParse(url: string): Promise<FetchResult> {
  return withCache(`fetchAndParse:${url}`, () => withRetry(() => fetchAndParseUncached(url)));
}

async function fetchAndParseUncached(url: string): Promise<FetchResult> {
  // Rewrite rendered GitHub page URLs to raw markdown for cleaner content
  const resolvedUrl = rewriteToRawGithub(url);

  const response = await fetch(resolvedUrl, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'text/html,text/plain,application/xhtml+xml,*/*',
    },
    signal: AbortSignal.timeout(15_000),
  });

  // If raw GitHub 404s (e.g. master branch), fall back to the original URL
  if (!response.ok && resolvedUrl !== url) {
    return fetchAndParseUncached(url);
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching ${resolvedUrl}`);
  }

  const contentType = response.headers.get('content-type') ?? '';

  // Raw markdown — return as-is, split into paragraphs by double newline
  if (contentType.includes('text/plain') || resolvedUrl.endsWith('.md')) {
    const markdown = await response.text();
    const paragraphs = markdown
      .split(/\n{2,}/)
      .map(p => p.trim())
      .filter(p => p.length > 20);
    return { text: markdown, paragraphs };
  }

  if (contentType.includes('application/json')) {
    const json = await response.text();
    return { text: json.slice(0, 5000), paragraphs: [json.slice(0, 5000)] };
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  // Remove noisy elements
  $('script, style, nav, header, footer, aside, .sidebar, .toc, [role="navigation"]').remove();

  // Prefer main content containers
  const contentSelectors = [
    'main',
    'article',
    '[role="main"]',
    '.content',
    '.main-content',
    '.documentation',
    '.docs-content',
    '#content',
    '#main',
    'body',
  ];

  const rootSelector = contentSelectors.find(sel => $(sel).length > 0) ?? 'body';

  const paragraphs: string[] = [];
  $(`${rootSelector} p, ${rootSelector} h1, ${rootSelector} h2, ${rootSelector} h3, ${rootSelector} h4, ${rootSelector} li, ${rootSelector} pre, ${rootSelector} code`).each((_i, el) => {
    const text = $(el).text().trim().replace(/\s+/g, ' ');
    if (text.length > 20) {
      paragraphs.push(text);
    }
  });

  const text = paragraphs.join('\n\n');

  // Detect SPA/JS-rendered pages: very little content but the page loaded fine.
  // Common for modern doc sites (Next.js, Vite, Tailwind, FastAPI etc.).
  if (paragraphs.length < 4 && text.length < 300) {
    const spaWarning = `[docpilot] This page returned very little readable content (${paragraphs.length} paragraph(s), ${text.length} chars). The site is likely a JavaScript-rendered SPA that requires a browser to render. Cheerio cannot execute JS. Try one of these alternatives:\n  1. Find the package's GitHub repo and read the raw README instead.\n  2. Check if the package has a readthedocs.io or similar static docs site.\n  3. Search the npm/PyPI registry page directly for quick reference.\n\nPartial content extracted:\n${text}`;
    return { text: spaWarning, paragraphs: [spaWarning] };
  }

  return { text, paragraphs };
}

/**
 * Fetch raw JSON from a URL.
 * Registry responses are cached for 1 hour (shorter TTL than HTML docs).
 */
export async function fetchJson<T = unknown>(url: string, extraHeaders: Record<string, string> = {}): Promise<T> {
  const cacheKey = `fetchJson:${url}:${JSON.stringify(extraHeaders)}`;
  return withCache(cacheKey, () => withRetry(() => fetchJsonUncached<T>(url, extraHeaders)), 60 * 60 * 1000);
}

async function fetchJsonUncached<T>(url: string, extraHeaders: Record<string, string> = {}): Promise<T> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'application/json',
      ...extraHeaders,
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching ${url}`);
  }

  return response.json() as Promise<T>;
}
