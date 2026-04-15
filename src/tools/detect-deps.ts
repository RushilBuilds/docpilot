import { readFile } from 'fs/promises';
import { join } from 'path';

export interface Dependency {
  name: string;
  version: string;
  ecosystem: 'npm' | 'pypi';
}

/**
 * Detect dependencies from a workspace directory.
 * Supports package.json (npm), requirements.txt (PyPI), and pyproject.toml (PyPI).
 * Prefers lock files (package-lock.json, pnpm-lock.yaml, yarn.lock) for exact
 * resolved versions rather than semver ranges from package.json.
 */
export async function detectDependencies(workspacePath: string): Promise<Dependency[]> {
  const results: Dependency[] = [];
  const seen = new Set<string>(); // deduplication key: "ecosystem:name"

  const add = (dep: Dependency) => {
    const key = `${dep.ecosystem}:${dep.name}`;
    if (!seen.has(key)) {
      seen.add(key);
      results.push(dep);
    }
  };

  // --- Node / npm: prefer lock files for exact versions ---
  const npmDeps = await readNpmDeps(workspacePath);
  for (const dep of npmDeps) add(dep);

  // --- Python / requirements.txt ---
  try {
    const reqTxt = await readFile(join(workspacePath, 'requirements.txt'), 'utf-8');
    for (const line of reqTxt.split('\n')) {
      const parsed = parseRequirementLine(line);
      if (parsed) add({ ...parsed, ecosystem: 'pypi' });
    }
  } catch {
    // not found — skip
  }

  // --- Python / pyproject.toml ---
  try {
    const toml = await readFile(join(workspacePath, 'pyproject.toml'), 'utf-8');
    const deps = parsePyprojectDeps(toml);
    for (const dep of deps) {
      add({ ...dep, ecosystem: 'pypi' });
    }
  } catch {
    // not found — skip
  }

  return results;
}

// ---------------------------------------------------------------------------
// npm lock file readers
// ---------------------------------------------------------------------------

async function readNpmDeps(workspacePath: string): Promise<Dependency[]> {
  // 1. package-lock.json (npm)
  try {
    const raw = await readFile(join(workspacePath, 'package-lock.json'), 'utf-8');
    const lock = JSON.parse(raw) as {
      lockfileVersion?: number;
      packages?: Record<string, { version?: string; dev?: boolean }>;
      dependencies?: Record<string, { version: string }>;
    };

    const deps: Dependency[] = [];

    // lockfileVersion 2/3: use "packages" (node_modules/name)
    if (lock.packages) {
      for (const [key, entry] of Object.entries(lock.packages)) {
        if (!key || !entry.version) continue; // skip root entry (empty key)
        // key is like "node_modules/react" or "node_modules/@scope/pkg"
        const name = key.replace(/^node_modules\//, '');
        deps.push({ name, version: entry.version, ecosystem: 'npm' });
      }
      return deps;
    }

    // lockfileVersion 1: use "dependencies"
    if (lock.dependencies) {
      for (const [name, entry] of Object.entries(lock.dependencies)) {
        deps.push({ name, version: entry.version, ecosystem: 'npm' });
      }
      return deps;
    }
  } catch {
    // no package-lock.json — try next
  }

  // 2. pnpm-lock.yaml
  try {
    const raw = await readFile(join(workspacePath, 'pnpm-lock.yaml'), 'utf-8');
    return parsePnpmLock(raw);
  } catch {
    // no pnpm-lock.yaml — try next
  }

  // 3. yarn.lock
  try {
    const raw = await readFile(join(workspacePath, 'yarn.lock'), 'utf-8');
    return parseYarnLock(raw);
  } catch {
    // no yarn.lock — fall back to package.json ranges
  }

  // 4. Fallback: package.json semver ranges
  try {
    const pkgJson = await readFile(join(workspacePath, 'package.json'), 'utf-8');
    const pkg = JSON.parse(pkgJson) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };

    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
      ...pkg.peerDependencies,
    };

    return Object.entries(allDeps).map(([name, version]) => ({
      name,
      version: cleanVersion(version),
      ecosystem: 'npm' as const,
    }));
  } catch {
    return [];
  }
}

/**
 * Parse pnpm-lock.yaml for resolved package versions.
 * Handles v6+ format: packages section with "  /react@18.2.0:" keys.
 */
function parsePnpmLock(content: string): Dependency[] {
  const deps: Dependency[] = [];
  // Match lines like:  /react@18.2.0:  or  /react/18.2.0:
  const re = /^\s{2}\/([^@:/\s]+(?:\/[^@:/\s]+)?)[@/]([^\s:]+):/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    const name = match[1]?.replace(/\//g, '/') ?? '';
    const version = match[2] ?? '';
    if (name && version) deps.push({ name, version, ecosystem: 'npm' });
  }
  return deps;
}

/**
 * Parse yarn.lock for resolved package versions.
 * Handles both v1 and berry (v2+) formats.
 */
function parseYarnLock(content: string): Dependency[] {
  const deps: Dependency[] = [];
  // Match block headers like: "react@^18.0.0, react@^18.2.0:"
  // followed by a "  version: X.Y.Z" line
  const blockRe = /^"?(@?[^@\s"]+)@[^:]+:?\n(?:.*\n)*?\s+version:?\s+"?([^\s"]+)/gm;
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(content)) !== null) {
    const name = match[1] ?? '';
    const version = match[2] ?? '';
    if (name && version) deps.push({ name, version, ecosystem: 'npm' });
  }
  return deps;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function cleanVersion(version: string): string {
  // Strip leading ^, ~, >=, etc.
  return version.replace(/^[^0-9]*/, '') || version;
}

function parseRequirementLine(line: string): { name: string; version: string } | null {
  const trimmed = line.trim();
  // Skip comments, blank lines, and options (-r, -e, --...)
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('-')) return null;

  // Handle pkg==1.2.3, pkg>=1.0, pkg~=1.0, pkg[extra]==1.0
  const match = trimmed.match(/^([A-Za-z0-9_.-]+)(?:\[.*?\])?\s*(?:[=~><^!]+\s*([^\s,;]+))?/);
  if (!match) return null;

  const name = match[1] ?? '';
  const version = match[2] ?? 'latest';
  return { name, version };
}

function parsePyprojectDeps(toml: string): { name: string; version: string }[] {
  const results: { name: string; version: string }[] = [];

  // Match [project] dependencies array entries: "package>=1.0"
  const projectDepsMatch = toml.match(/\[project\][\s\S]*?dependencies\s*=\s*\[([\s\S]*?)\]/);
  if (projectDepsMatch?.[1]) {
    for (const line of projectDepsMatch[1].split('\n')) {
      const cleaned = line.replace(/['"]/g, '').trim().replace(/,$/, '');
      if (!cleaned || cleaned.startsWith('#')) continue;
      const parsed = parseRequirementLine(cleaned);
      if (parsed) results.push(parsed);
    }
  }

  // Also handle [tool.poetry.dependencies]
  const poetryMatch = toml.match(/\[tool\.poetry\.dependencies\]([\s\S]*?)(?=\[|$)/);
  if (poetryMatch?.[1]) {
    const block = poetryMatch[1];
    for (const line of block.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed === 'python') continue;
      // name = "^1.2.3" or name = { version = "^1.2.3", ... }
      const simpleMatch = trimmed.match(/^([A-Za-z0-9_.-]+)\s*=\s*"([^"]+)"/);
      if (simpleMatch) {
        results.push({ name: simpleMatch[1] ?? '', version: cleanVersion(simpleMatch[2] ?? '') });
      }
    }
  }

  return results;
}
