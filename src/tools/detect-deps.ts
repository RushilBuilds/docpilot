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

  // --- Node / npm ---
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

    for (const [name, version] of Object.entries(allDeps)) {
      add({ name, version: cleanVersion(version), ecosystem: 'npm' });
    }
  } catch {
    // package.json not found or invalid — skip
  }

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
// Helpers
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
