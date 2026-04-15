#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { detectDependencies } from './tools/detect-deps.js';
import { getDocs } from './tools/get-docs.js';
import { searchDocs } from './tools/search-docs.js';
import { getChangelog } from './tools/get-changelog.js';
import { listVersions } from './tools/list-versions.js';

const server = new McpServer({
  name: 'docpilot',
  version: '1.0.0',
});

// ---------------------------------------------------------------------------
// Tool: detect_dependencies
// ---------------------------------------------------------------------------
server.tool(
  'detect_dependencies',
  'Reads package.json, requirements.txt, or pyproject.toml from the given workspace path and returns a structured list of packages with their versions and ecosystem.',
  {
    workspace_path: z
      .string()
      .describe('Absolute path to the project root directory to scan for dependency files'),
  },
  async ({ workspace_path }) => {
    try {
      const deps = await detectDependencies(workspace_path);

      if (deps.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: `No dependency files found at ${workspace_path}. Expected package.json, requirements.txt, or pyproject.toml.`,
            },
          ],
        };
      }

      const formatted = deps
        .map(d => `${d.ecosystem === 'npm' ? '[npm]' : '[pypi]'} ${d.name}@${d.version}`)
        .join('\n');

      return {
        content: [
          {
            type: 'text',
            text: `Found ${deps.length} dependencies in ${workspace_path}:\n\n${formatted}`,
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
// Start server
// ---------------------------------------------------------------------------
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Log to stderr so it doesn't interfere with MCP stdio protocol
  process.stderr.write('docpilot MCP server running on stdio\n');
}

main().catch(err => {
  process.stderr.write(`Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
