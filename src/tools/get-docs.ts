import { fetchAndParse } from '../lib/fetcher.js';
import { getNpmPackage, getNpmDocsUrl, getPypiPackage, getPypiDocsUrl } from '../lib/registry.js';
import { resolveEcosystem } from '../lib/ecosystem.js';

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
    const resolved = ecosystem === 'auto' ? await resolveEcosystem(packageName) : ecosystem;
    const docsUrl = await resolveDocsUrl(packageName, version, resolved);

    if (!docsUrl) {
      return `No documentation URL found for ${packageName}@${version}. Try visiting the npm/PyPI page directly.`;
    }

    const { text } = await fetchAndParse(docsUrl);
    const trimmed = text.trim();

    if (!trimmed) {
      return `Fetched documentation page for ${packageName} but could not extract readable text. URL: ${docsUrl}`;
    }

    const versionWarning = buildVersionWarning(docsUrl, version);
    const snippet = trimmed.slice(0, MAX_CHARS);
    const truncationNote = trimmed.length > MAX_CHARS
      ? `\n\n[...truncated — ${trimmed.length} chars total]`
      : '';
    return `${snippet}${truncationNote}${versionWarning}\n\nSource: ${docsUrl}`;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `Error fetching docs for ${packageName}@${version}: ${message}`;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Warn if the resolved docs URL contains no version segment matching the requested version.
 * Many doc sites embed the version in the URL path (e.g. /v18/, /3.x/, /en/stable/).
 */
function buildVersionWarning(url: string, requestedVersion: string): string {
  const major = requestedVersion.split('.')[0];
  // Check if the URL contains any version-like segment
  const hasVersionInUrl = /\/v?\d+[./]|\/stable\/|\/latest\/|\/en\//.test(url);
  if (hasVersionInUrl) return ''; // URL appears versioned — no warning needed

  return `\n\n[Note: docs URL does not contain a version path segment. Content may reflect the latest version, not ${requestedVersion} (major: ${major}). Check the site for versioned docs if available.]`;
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
