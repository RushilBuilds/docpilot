import { fetchAndParse } from '../lib/fetcher.js';
import { getNpmPackage, getNpmDocsUrl, getPypiPackage, getPypiDocsUrl } from '../lib/registry.js';
import { resolveEcosystem } from '../lib/ecosystem.js';

const TOP_K = 3;
const CONTEXT_CHARS = 300;

export interface SearchResult {
  score: number;
  section: string;
}

/**
 * Search documentation for a package by keyword query.
 * Returns the top matching paragraphs with surrounding context.
 */
export async function searchDocs(
  query: string,
  packageName: string,
  ecosystem: 'npm' | 'pypi' | 'auto' = 'auto',
): Promise<string> {
  try {
    const resolved = ecosystem === 'auto' ? await resolveEcosystem(packageName) : ecosystem;
    const docsUrl = await resolveDocsUrl(packageName, resolved);

    if (!docsUrl) {
      return `No documentation URL found for ${packageName}. Try visiting the npm/PyPI page directly.`;
    }

    const { paragraphs } = await fetchAndParse(docsUrl);

    if (paragraphs.length === 0) {
      return `Could not extract any content from the documentation page for ${packageName}. URL: ${docsUrl}`;
    }

    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .filter(t => t.length > 1);

    const scored: SearchResult[] = paragraphs.map(para => {
      const lower = para.toLowerCase();
      const score = terms.reduce((acc, term) => {
        // Count occurrences of the term
        const matches = lower.split(term).length - 1;
        return acc + matches;
      }, 0);
      return { score, section: para };
    });

    const top = scored
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_K);

    if (top.length === 0) {
      return `No documentation sections found matching "${query}" in ${packageName} docs. Source: ${docsUrl}`;
    }

    const output = top
      .map((r, i) => {
        const snippet = r.section.length > CONTEXT_CHARS
          ? r.section.slice(0, CONTEXT_CHARS) + '...'
          : r.section;
        return `--- Result ${i + 1} (relevance: ${r.score}) ---\n${snippet}`;
      })
      .join('\n\n');

    return `Top ${top.length} matches for "${query}" in ${packageName} docs (${docsUrl}):\n\n${output}`;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `Error searching docs for ${packageName}: ${message}`;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function resolveDocsUrl(name: string, ecosystem: 'npm' | 'pypi'): Promise<string | null> {
  if (ecosystem === 'npm') {
    const pkg = await getNpmPackage(name);
    return getNpmDocsUrl(pkg);
  } else {
    const pkg = await getPypiPackage(name);
    return getPypiDocsUrl(pkg);
  }
}
