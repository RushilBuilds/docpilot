import { getNpmPackage, getPypiPackage } from './registry.js';
import { withCache } from './cache.js';

/**
 * Resolve the ecosystem for a package name.
 *
 * Strategy:
 * 1. Scoped npm packages (@scope/pkg) are always npm.
 * 2. Otherwise query both registries in parallel and use whichever responds.
 *    If only one succeeds, use that. If both succeed, prefer npm.
 *
 * Result is cached for 24 hours — a package's registry membership rarely changes.
 * This avoids 2 network calls on every auto-detect tool invocation.
 */
export async function resolveEcosystem(packageName: string): Promise<'npm' | 'pypi'> {
  if (packageName.startsWith('@')) return 'npm';
  return withCache(`ecosystem:${packageName}`, () => detectEcosystem(packageName));
}

async function detectEcosystem(packageName: string): Promise<'npm' | 'pypi'> {
  const npmResult = getNpmPackage(packageName).then(() => 'npm' as const).catch(() => null);
  const pypiResult = getPypiPackage(packageName).then(() => 'pypi' as const).catch(() => null);

  const [npm, pypi] = await Promise.all([npmResult, pypiResult]);

  if (npm && pypi) return 'npm'; // both exist — npm wins (more common in ambiguous cases)
  if (npm) return 'npm';
  if (pypi) return 'pypi';

  // Neither found — default to npm so the downstream error message names the right registry
  return 'npm';
}
