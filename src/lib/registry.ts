import { fetchJson } from './fetcher.js';

// ---------------------------------------------------------------------------
// npm registry types
// ---------------------------------------------------------------------------

export interface NpmPackageInfo {
  name: string;
  description?: string;
  homepage?: string;
  repository?: { url?: string } | string;
  versions: Record<string, NpmVersionInfo>;
  'dist-tags': Record<string, string>;
  time: Record<string, string>;
}

export interface NpmVersionInfo {
  name: string;
  version: string;
  description?: string;
  homepage?: string;
  repository?: { url?: string } | string;
}

// ---------------------------------------------------------------------------
// PyPI registry types
// ---------------------------------------------------------------------------

export interface PypiPackageInfo {
  info: {
    name: string;
    version: string;
    summary?: string;
    home_page?: string;
    project_urls?: Record<string, string>;
    requires_python?: string;
  };
  releases: Record<string, PypiReleaseFile[]>;
  urls: PypiReleaseFile[];
}

export interface PypiReleaseFile {
  filename: string;
  url: string;
  upload_time: string;
  size: number;
}

// ---------------------------------------------------------------------------
// npm helpers
// ---------------------------------------------------------------------------

export async function getNpmPackage(name: string): Promise<NpmPackageInfo> {
  const encoded = encodeURIComponent(name).replace('%40', '@').replace('%2F', '/');
  return fetchJson<NpmPackageInfo>(`https://registry.npmjs.org/${encoded}`);
}

export function getNpmDocsUrl(pkg: NpmPackageInfo): string | null {
  if (pkg.homepage) return pkg.homepage;

  const repo = pkg.repository;
  if (typeof repo === 'string') {
    return githubUrlFromRepoString(repo);
  }
  if (repo?.url) {
    return githubUrlFromRepoString(repo.url);
  }
  return null;
}

function githubUrlFromRepoString(raw: string): string | null {
  // Handle git+https://github.com/... or github:user/repo etc.
  const match = raw.match(/github\.com[:/]([^/]+\/[^/.]+)/);
  if (match) {
    return `https://github.com/${match[1]}#readme`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// PyPI helpers
// ---------------------------------------------------------------------------

export async function getPypiPackage(name: string): Promise<PypiPackageInfo> {
  return fetchJson<PypiPackageInfo>(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`);
}

export function getPypiDocsUrl(pkg: PypiPackageInfo): string | null {
  const urls = pkg.info.project_urls ?? {};
  // Prefer explicit docs/documentation link
  for (const key of ['Documentation', 'Docs', 'Homepage', 'Home']) {
    if (urls[key]) return urls[key];
  }
  return pkg.info.home_page ?? null;
}
