#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { detectDependencies } from './tools/detect-deps.js';
import { getDocs } from './tools/get-docs.js';
import { searchDocs } from './tools/search-docs.js';
import { getChangelog } from './tools/get-changelog.js';
import { listVersions } from './tools/list-versions.js';
import { VERSION } from './lib/version.js';
import { clearCache } from './lib/cache.js';


const server = new McpServer({
  name: 'docpilot',
  version: '1.0.0',
});

// ---------------------------------------------------------------------------
// Tool: detect_dependencies
// ---------------------------------------------------------------------------
server.tool(
  'detect_dependencies',
  'Reads package.json, requirements.txt, or pyproject.toml from the given workspace path and returns a structured list of packages with their versions and ecosystem. Defaults to the current working directory if no path is provided.',
  {
    workspace_path: z
      .string()
      .optional()
      .describe('Absolute path to the project root directory. Defaults to the current working directory (process.cwd()) if omitted.'),
  },
  async ({ workspace_path }) => {
    const resolvedPath = workspace_path ?? process.cwd();
    try {
      const deps = await detectDependencies(resolvedPath);

      if (deps.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: `No dependency files found at ${resolvedPath}. Expected package.json, requirements.txt, or pyproject.toml.`,
            },
          ],
        };
      }

      const npmDeps = deps.filter(d => d.ecosystem === 'npm');
      const pypiDeps = deps.filter(d => d.ecosystem === 'pypi');

      const summary = [
        `Found ${deps.length} dependencies in ${resolvedPath}`,
        npmDeps.length > 0 ? `  npm: ${npmDeps.length}` : null,
        pypiDeps.length > 0 ? `  pypi: ${pypiDeps.length}` : null,
      ].filter(Boolean).join('\n');

      return {
        content: [
          {
            type: 'text',
            text: `${summary}\n\n${JSON.stringify(deps, null, 2)}`,
          },
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text', text: `Error detecting dependencies: ${message}` }],
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: get_docs
// ---------------------------------------------------------------------------
server.tool(
  'get_docs',
  'Fetches and returns documentation for a specific package version from its official docs site or README. Returns the first ~3000 chars of meaningful content.',
  {
    package_name: z.string().describe('Package name (e.g. "react", "requests", "@modelcontextprotocol/sdk")'),
    version: z.string().describe('Package version string (e.g. "18.2.0")'),
    ecosystem: z
      .enum(['npm', 'pypi', 'auto'])
      .default('auto')
      .describe('Package ecosystem. Use "auto" to infer from the package name'),
  },
  async ({ package_name, version, ecosystem }) => {
    const text = await getDocs(package_name, version, ecosystem);
    return { content: [{ type: 'text', text }] };
  },
);

// ---------------------------------------------------------------------------
// Tool: search_docs
// ---------------------------------------------------------------------------
server.tool(
  'search_docs',
  'Searches documentation for a package by keyword query and returns the top 3 most relevant sections with surrounding context.',
  {
    query: z.string().describe('Search query (e.g. "authentication middleware")'),
    package_name: z.string().describe('Package name to search docs for'),
    ecosystem: z
      .enum(['npm', 'pypi', 'auto'])
      .default('auto')
      .describe('Package ecosystem. Use "auto" to infer from the package name'),
  },
  async ({ query, package_name, ecosystem }) => {
    const text = await searchDocs(query, package_name, ecosystem);
    return { content: [{ type: 'text', text }] };
  },
);

// ---------------------------------------------------------------------------
// Tool: get_changelog
// ---------------------------------------------------------------------------
server.tool(
  'get_changelog',
  'Returns the changelog or version history between two version strings for a package using the npm or PyPI registry API.',
  {
    package_name: z.string().describe('Package name'),
    from_version: z.string().describe('Starting version (exclusive start of range)'),
    to_version: z.string().describe('Ending version (inclusive end of range)'),
    ecosystem: z
      .enum(['npm', 'pypi', 'auto'])
      .default('auto')
      .describe('Package ecosystem. Use "auto" to infer from the package name'),
  },
  async ({ package_name, from_version, to_version, ecosystem }) => {
    const text = await getChangelog(package_name, from_version, to_version, ecosystem);
    return { content: [{ type: 'text', text }] };
  },
);

// ---------------------------------------------------------------------------
// Tool: list_versions
// ---------------------------------------------------------------------------
server.tool(
  'list_versions',
  'Lists the most recent versions of a package from the npm or PyPI registry, with release dates and dist-tags. Useful before calling get_changelog to find valid version strings.',
  {
    package_name: z.string().describe('Package name'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe('Maximum number of recent versions to return (default 20, max 100)'),
    ecosystem: z
      .enum(['npm', 'pypi', 'auto'])
      .default('auto')
      .describe('Package ecosystem. Use "auto" to infer from the package name'),
  },
  async ({ package_name, limit, ecosystem }) => {
    const text = await listVersions(package_name, limit, ecosystem);
    return { content: [{ type: 'text', text }] };
  },
);

// ---------------------------------------------------------------------------
// Start server (all CLI flag handling lives here to allow top-level await)
// ---------------------------------------------------------------------------
async function main() {
  const arg = process.argv[2];

  if (arg === '--version' || arg === '-v') {
    process.stdout.write(`docpilot v${VERSION}\n`);
    process.exit(0);
  }

  if (arg === '--clear-cache') {
    const count = await clearCache();
    process.stdout.write(`docpilot: cleared ${count} cache file(s) from ~/.cache/docpilot/\n`);
    process.exit(0);
  }

  if (arg === '--help' || arg === '-h') {
    process.stdout.write(`docpilot v${VERSION} — MCP documentation server for Claude Code

Usage:
  docpilot               Start the MCP server (stdio transport)
  docpilot --version     Print version and exit
  docpilot --help        Show this help
  docpilot --clear-cache Delete all cached responses from ~/.cache/docpilot/

Claude Code config (~/.claude/claude_desktop_config.json):
  {
    "mcpServers": {
      "docpilot": {
        "command": "npx",
        "args": ["docpilot"]
      }
    }
  }

Tools exposed to Claude:
  detect_dependencies  Scan workspace for npm/PyPI dependencies
  get_docs             Fetch docs for a package at a specific version
  search_docs          Keyword search across a package's documentation
  get_changelog        Get changelog between two versions
  list_versions        List recent versions of a package

Docs cache: ~/.cache/docpilot/  (24h TTL for pages, 1h for registry data)
`);
    process.exit(0);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`docpilot v${VERSION} MCP server running on stdio\n`);
}

main().catch(err => {
  process.stderr.write(`Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
