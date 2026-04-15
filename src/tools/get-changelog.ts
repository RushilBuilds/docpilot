import { getNpmPackage, getNpmDocsUrl, getPypiPackage, getPypiDocsUrl } from '../lib/registry.js';
import { fetchJson, fetchAndParse } from '../lib/fetcher.js';
import { resolveEcosystem } from '../lib/ecosystem.js';

interface PypiVersionInfo {
  info: { version: string; summary?: string };
  releases: Record<string, Array<{ upload_time: string }>>;
}

/**
 * Return changelog/version info between two version strings for a package.
 * First tries to fetch a real CHANGELOG.md/HISTORY.md from the repo.
 * Falls back to registry version-date listing if no changelog file is found.
 */
export async function getChangelog(
  packageName: string,
  fromVersion: string,
  toVersion: string,
  ecosystem: 'npm' | 'pypi' | 'auto' = 'auto',
): Promise<string> {
  try {
    const resolved = ecosystem === 'auto' ? await resolveEcosystem(packageName) : ecosystem;

    if (resolved === 'npm') {
      return await getNpmChangelog(packageName, fromVersion, toVersion);
    } else {
      return await getPypiChangelog(packageName, fromVersion, toVersion);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `Error fetching changelog for ${packageName} (${fromVersion}..${toVersion}): ${message}`;
  }
}

// ---------------------------------------------------------------------------
// Changelog file extraction
// ---------------------------------------------------------------------------

/**
 * Try to fetch a CHANGELOG / HISTORY / RELEASES file from the repo
 * and extract only the section between fromVersion and toVersion headings.
 */
async function extractChangelogFromRepo(repoUrl: string, from: string, to: string): Promise<string | null> {
  // Convert rendered GitHub URL to raw base for file fetching
  const ghMatch = repoUrl.match(/github\.com\/([^/#?]+\/[^/#?]+)/);
  if (!ghMatch) return null;

  const slug = ghMatch[1].replace(/\.git$/, '');
  const candidates = [
    'CHANGELOG.md', 'CHANGELOG', 'HISTORY.md', 'HISTORY',
    'RELEASES.md', 'CHANGES.md', 'CHANGES',
  ];

  for (const filename of candidates) {
    for (const branch of ['main', 'master']) {
      const rawUrl = `https://raw.githubusercontent.com/${slug}/${branch}/${filename}`;
      try {
        const { text } = await fetchAndParse(rawUrl);
        if (!text.trim()) continue;

        const section = extractVersionSection(text, from, to);
        if (section) return `Source: ${rawUrl}\n\n${section}`;
      } catch {
        // Try next candidate
      }
    }
  }

  return null;
}

/**
 * Extract the markdown section(s) between two version headings.
 * Handles common formats:
 *   ## [1.2.0] - 2024-01-01
 *   ## 1.2.0 (2024-01-01)
 *   # Version 1.2.0
 */
function extractVersionSection(changelog: string, from: string, to: string): string | null {
  const lines = changelog.split('\n');
  const versionPattern = /^#{1,3}\s+(?:\[)?v?(\d+\.\d+[\d.]*)/i;

  // Find indices of from and to version headings
  let fromIdx = -1;
  let toIdx = -1;

  lines.forEach((line, i) => {
    const match = line.match(versionPattern);
    if (!match) return;
    const ver = match[1];
    if (ver === to && toIdx === -1) toIdx = i;
    if (ver === from && fromIdx === -1) fromIdx = i;
  });

  // We want lines from toIdx (inclusive) up to fromIdx (exclusive)
  // i.e. everything between "to" heading and "from" heading
  if (toIdx === -1 && fromIdx === -1) return null;

  const start = toIdx !== -1 ? toIdx : 0;
  const end = fromIdx !== -1 ? fromIdx : lines.length;

  const section = lines.slice(start, end).join('\n').trim();
  return section.length > 0 ? section : null;
}

// ---------------------------------------------------------------------------
// npm changelog
// ---------------------------------------------------------------------------

async function getNpmChangelog(name: string, from: string, to: string): Promise<string> {
  const pkg = await getNpmPackage(name);
  const allVersions = Object.keys(pkg.versions);

  const fromIdx = allVersions.indexOf(from);
  const toIdx = allVersions.indexOf(to);

  if (fromIdx === -1) {
    return `Version ${from} not found for npm package "${name}". Available versions: ${allVersions.slice(-10).join(', ')}`;
  }
  if (toIdx === -1) {
    return `Version ${to} not found for npm package "${name}". Available versions: ${allVersions.slice(-10).join(', ')}`;
  }

  // Try to get real changelog from the repo first
  const repoUrl = getNpmDocsUrl(pkg);
  if (repoUrl) {
    const realChangelog = await extractChangelogFromRepo(repoUrl, from, to);
    if (realChangelog) {
      return `Changelog for ${name}: ${from} → ${to}\n\n${realChangelog}`;
    }
  }

  // Fall back to registry version listing
  const start = Math.min(fromIdx, toIdx);
  const end = Math.max(fromIdx, toIdx);
  const range = allVersions.slice(start + 1, end + 1);

  if (range.length === 0) {
    return `No versions found between ${from} and ${to} for "${name}".`;
  }

  const lines: string[] = [
    `Changelog for ${name}: ${from} → ${to}`,
    `${range.length} version(s) in range (no CHANGELOG.md found in repo):\n`,
  ];

  for (const v of range) {
    const info = pkg.versions[v];
    const date = pkg.time[v] ?? 'unknown date';
    const description = info?.description ?? pkg.description ?? '';
    lines.push(`## ${v}  (${date.slice(0, 10)})`);
    if (description) lines.push(description);
    lines.push('');
  }

  if (repoUrl) {
    lines.push(`\nFor full release notes see: ${repoUrl}`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// PyPI changelog
// ---------------------------------------------------------------------------

async function getPypiChangelog(name: string, from: string, to: string): Promise<string> {
  const pkg = await fetchJson<PypiVersionInfo>(
    `https://pypi.org/pypi/${encodeURIComponent(name)}/json`,
  );

  const allVersions = Object.keys(pkg.releases ?? {}).sort(semverish);

  if (!pkg.releases[from]) {
    return `Version ${from} not found for PyPI package "${name}". Available: ${allVersions.slice(-10).join(', ')}`;
  }
  if (!pkg.releases[to]) {
    return `Version ${to} not found for PyPI package "${name}". Available: ${allVersions.slice(-10).join(', ')}`;
  }

  // Try to get real changelog from the repo first
  const pypiMeta = await getPypiPackage(name);
  const repoUrl = getPypiDocsUrl(pypiMeta);
  if (repoUrl) {
    const realChangelog = await extractChangelogFromRepo(repoUrl, from, to);
    if (realChangelog) {
      return `Changelog for ${name}: ${from} → ${to}\n\n${realChangelog}`;
    }
  }

  // Fall back to release date listing
  const fromIdx = allVersions.indexOf(from);
  const toIdx = allVersions.indexOf(to);
  const start = Math.min(fromIdx, toIdx);
  const end = Math.max(fromIdx, toIdx);
  const range = allVersions.slice(start + 1, end + 1);

  if (range.length === 0) {
    return `No versions found between ${from} and ${to} for PyPI package "${name}".`;
  }

  const lines: string[] = [
    `Changelog for ${name}: ${from} → ${to}`,
    `${range.length} version(s) in range (no CHANGELOG.md found in repo):\n`,
  ];

  for (const v of range) {
    const files = pkg.releases[v] ?? [];
    const date = files[0]?.upload_time?.slice(0, 10) ?? 'unknown date';
    lines.push(`## ${v}  (${date})`);
    lines.push('');
  }

  lines.push(`\nFor full release notes see: https://pypi.org/project/${name}/#history`);

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Very rough version sort — good enough for numeric major.minor.patch. */
function semverish(a: string, b: string): number {
  const toNum = (v: string) =>
    v.split(/[.-]/).map(p => parseInt(p, 10) || 0);
  const na = toNum(a);
  const nb = toNum(b);
  for (let i = 0; i < Math.max(na.length, nb.length); i++) {
    const diff = (na[i] ?? 0) - (nb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
