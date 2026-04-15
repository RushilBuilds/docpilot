import * as cheerio from 'cheerio';
import { withCache } from './cache.js';
import { rewriteToRawGithub } from './registry.js';

export interface FetchResult {
  text: string;
  paragraphs: string[];
}

/**
 * Fetch a URL and return cleaned text content extracted via cheerio.
 * Results are cached to ~/.cache/docpilot/ for 24 hours.
 */
export async function fetchAndParse(url: string): Promise<FetchResult> {
  return withCache(`fetchAndParse:${url}`, () => fetchAndParseUncached(url));
}

async function fetchAndParseUncached(url: string): Promise<FetchResult> {
  // Rewrite rendered GitHub page URLs to raw markdown for cleaner content
  const resolvedUrl = rewriteToRawGithub(url);

  const response = await fetch(resolvedUrl, {
    headers: {
      'User-Agent': 'docpilot/1.0.0 (MCP documentation server)',
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
  return { text, paragraphs };
}

/**
 * Fetch raw JSON from a URL.
 * Registry responses are cached for 1 hour (shorter TTL than HTML docs).
 */
export async function fetchJson<T = unknown>(url: string): Promise<T> {
  return withCache(`fetchJson:${url}`, () => fetchJsonUncached<T>(url), 60 * 60 * 1000);
}

async function fetchJsonUncached<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'docpilot/1.0.0 (MCP documentation server)',
      'Accept': 'application/json',
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching ${url}`);
  }

  return response.json() as Promise<T>;
}
