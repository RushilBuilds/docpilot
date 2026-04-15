import { getNpmPackage, getPypiPackage } from '../lib/registry.js';
import { resolveEcosystem } from '../lib/ecosystem.js';

/**
 * List the most recent N versions of a package from npm or PyPI.
 */
export async function listVersions(
  packageName: string,
  limit: number,
  ecosystem: 'npm' | 'pypi' | 'auto' = 'auto',
): Promise<string> {
  try {
    const resolved = ecosystem === 'auto' ? await resolveEcosystem(packageName) : ecosystem;

    if (resolved === 'npm') {
      return await listNpmVersions(packageName, limit);
    } else {
      return await listPypiVersions(packageName, limit);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `Error listing versions for ${packageName}: ${message}`;
  }
}

async function listNpmVersions(name: string, limit: number): Promise<string> {
  const pkg = await getNpmPackage(name);
  const allVersions = Object.keys(pkg.versions);
  const recent = allVersions.slice(-limit).reverse();

  const distTags = pkg['dist-tags'];
  const tagMap: Record<string, string> = {};
  for (const [tag, ver] of Object.entries(distTags)) {
    tagMap[ver] = tag;
  }

  const lines = recent.map(v => {
    const date = pkg.time[v]?.slice(0, 10) ?? '';
    const tag = tagMap[v] ? `  [${tagMap[v]}]` : '';
    return `  ${v}${tag}  ${date}`;
  });

  return [
    `${name} — ${allVersions.length} versions on npm (showing latest ${recent.length}):`,
    ...lines,
  ].join('\n');
}

async function listPypiVersions(name: string, limit: number): Promise<string> {
  const pkg = await getPypiPackage(name);
  const allVersions = Object.keys(pkg.releases);
  const recent = allVersions.slice(-limit).reverse();

  const lines = recent.map(v => {
    const files = pkg.releases[v] ?? [];
    const date = files[0]?.upload_time?.slice(0, 10) ?? '';
    return `  ${v}  ${date}`;
  });

  return [
    `${name} — ${allVersions.length} versions on PyPI (showing latest ${recent.length}):`,
    ...lines,
  ].join('\n');
}
