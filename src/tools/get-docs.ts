import { fetchAndParse } from '../lib/fetcher.js';
import { getNpmPackage, getNpmDocsUrl, getPypiPackage, getPypiDocsUrl } from '../lib/registry.js';

const MAX_CHARS = 3000;

/**
 * Fetch documentation for a package at a specific version.
 * Returns the first ~3000 chars of meaningful content.
 */
export async function getDocs(
  packageName: string,
  version: string,
  ecosystem: 'npm' | 'pypi' | 'auto' = 'auto',
): Promise<string> {
  try {
    const resolved = ecosystem === 'auto' ? detectEcosystem(packageName) : ecosystem;
    const docsUrl = await resolveDocsUrl(packageName, version, resolved);

    if (!docsUrl) {
      return `No documentation URL found for ${packageName}@${version}. Try visiting the npm/PyPI page directly.`;
    }

    const { text } = await fetchAndParse(docsUrl);
    const trimmed = text.trim();

    if (!trimmed) {
      return `Fetched documentation page for ${packageName} but could not extract readable text. URL: ${docsUrl}`;
    }

    const snippet = trimmed.slice(0, MAX_CHARS);
    const suffix = trimmed.length > MAX_CHARS ? `\n\n[...truncated — ${trimmed.length} chars total. Source: ${docsUrl}]` : `\n\nSource: ${docsUrl}`;
    return snippet + suffix;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `Error fetching docs for ${packageName}@${version}: ${message}`;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function detectEcosystem(packageName: string): 'npm' | 'pypi' {
  // Scoped npm packages always start with @
  if (packageName.startsWith('@')) return 'npm';
  // Heuristic: npm packages rarely have underscores as primary separator
  return 'npm';
}

async function resolveDocsUrl(name: string, _version: string, ecosystem: 'npm' | 'pypi'): Promise<string | null> {
  if (ecosystem === 'npm') {
    const pkg = await getNpmPackage(name);
    return getNpmDocsUrl(pkg);
  } else {
    const pkg = await getPypiPackage(name);
    return getPypiDocsUrl(pkg);
  }
}
