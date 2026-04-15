import { getNpmPackage, getPypiPackage } from './registry.js';

/**
 * Resolve the ecosystem for a package name.
 *
 * Strategy:
 * 1. Scoped npm packages (@scope/pkg) are always npm.
 * 2. Otherwise query both registries in parallel and use whichever responds first.
 *    If only one succeeds, use that. If both succeed, prefer npm (most common case
 *    for ambiguous names — can be overridden by passing ecosystem explicitly).
 */
export async function resolveEcosystem(packageName: string): Promise<'npm' | 'pypi'> {
  if (packageName.startsWith('@')) return 'npm';

  const npmResult = getNpmPackage(packageName).then(() => 'npm' as const).catch(() => null);
  const pypiResult = getPypiPackage(packageName).then(() => 'pypi' as const).catch(() => null);

  const [npm, pypi] = await Promise.all([npmResult, pypiResult]);

  if (npm && pypi) return 'npm'; // both exist — npm wins (more common in ambiguous cases)
  if (npm) return 'npm';
  if (pypi) return 'pypi';

  // Neither found — default to npm so the downstream error message names the right registry
  return 'npm';
}
