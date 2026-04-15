import { getNpmPackage } from '../lib/registry.js';
import { fetchJson } from '../lib/fetcher.js';
import { resolveEcosystem } from '../lib/ecosystem.js';

interface PypiVersionInfo {
  info: { version: string; summary?: string };
  releases: Record<string, Array<{ upload_time: string }>>;
}

/**
 * Return changelog/version info between two version strings for a package.
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

  // Collect versions between from (exclusive) and to (inclusive)
  const start = Math.min(fromIdx, toIdx);
  const end = Math.max(fromIdx, toIdx);
  const range = allVersions.slice(start + 1, end + 1);

  if (range.length === 0) {
    return `No versions found between ${from} and ${to} for "${name}".`;
  }

  const lines: string[] = [
    `Changelog for ${name}: ${from} → ${to}`,
    `${range.length} version(s) in range:\n`,
  ];

  for (const v of range) {
    const info = pkg.versions[v];
    const date = pkg.time[v] ?? 'unknown date';
    const description = info?.description ?? pkg.description ?? '';
    lines.push(`## ${v}  (${date.slice(0, 10)})`);
    if (description) lines.push(description);
    lines.push('');
  }

  // Suggest the real changelog if available
  const latestInfo = pkg.versions[to] ?? pkg.versions[allVersions[allVersions.length - 1] ?? ''];
  const repoUrl = latestInfo?.homepage ?? pkg.homepage;
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
    `${range.length} version(s) in range:\n`,
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
