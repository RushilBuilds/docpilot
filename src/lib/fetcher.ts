import * as cheerio from 'cheerio';

export interface FetchResult {
  text: string;
  paragraphs: string[];
}

/**
 * Fetch a URL and return cleaned text content extracted via cheerio.
 */
export async function fetchAndParse(url: string): Promise<FetchResult> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'docpilot/1.0.0 (MCP documentation server)',
      'Accept': 'text/html,application/xhtml+xml,*/*',
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching ${url}`);
  }

  const contentType = response.headers.get('content-type') ?? '';

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
 */
export async function fetchJson<T = unknown>(url: string): Promise<T> {
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
