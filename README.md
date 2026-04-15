# docpilot

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![version](https://img.shields.io/badge/version-1.0.0-blue.svg)](https://github.com/RushilBuilds/docpilot)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org)

An MCP server that plugs into Claude Code and serves version-accurate documentation as context tools. Point it at your project and ask Claude about any dependency — docpilot fetches the real docs so Claude answers with current, version-specific information instead of hallucinating stale APIs.

---

## Install

### Quick start (npx — no install needed)

Add this to your Claude Code config and restart:

```json
{
  "mcpServers": {
    "docpilot": {
      "command": "npx",
      "args": ["docpilot"]
    }
  }
}
```

**Config file location:**
- macOS / Linux: `~/.claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

### Global install

```bash
npm install -g docpilot
```

Then use `"command": "docpilot"` (no args) in your config.

---

## Tools

| Tool | Description |
|------|-------------|
| `detect_dependencies` | Reads `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `package.json`, `requirements.txt`, or `pyproject.toml` from a workspace path and returns a structured JSON list of packages, exact versions, and ecosystems. Defaults to the current working directory. |
| `get_docs` | Given a package name and version, fetches the official docs or README and returns the first ~3000 chars of meaningful content. Warns when the page may not be version-specific. |
| `search_docs` | Given a query string and package name, keyword-searches the docs and returns the top 3 matching sections with up to 600 chars of context each. |
| `get_changelog` | Given a package name and two version strings, fetches `CHANGELOG.md` / `HISTORY.md` from the repo and extracts the section between those versions. Falls back to registry version-date listing if no changelog file is found. |
| `list_versions` | Lists the most recent N versions of a package from npm or PyPI with release dates and dist-tags. Use this before `get_changelog` to find valid version strings. |

---

## CLI usage

```bash
docpilot               # Start MCP server (stdio)
docpilot --version     # Print version
docpilot --help        # Show help and config instructions
docpilot --clear-cache # Delete all cached responses from ~/.cache/docpilot/
```

---

## How it works

When you ask Claude about a dependency, docpilot resolves the package's documentation URL from the npm or PyPI registry — preferring explicit `Documentation` links, falling back to the homepage, then the GitHub repo. For GitHub URLs it fetches the raw markdown directly instead of parsing rendered HTML. Responses are cached to `~/.cache/docpilot/` with a 24-hour TTL (1 hour for registry data) and a 200 MB total cap, so repeated queries in a session are instant. For changelogs, it fetches `CHANGELOG.md` from the repo and extracts only the section between the two requested version headings. All tools handle errors gracefully and return descriptive messages rather than throwing, including a specific warning when a doc site appears to be a JavaScript-rendered SPA that cheerio cannot parse.

---

## Example prompts in Claude Code

```
What are the exact versions of all packages in this project?
→ detect_dependencies (reads lock file automatically)

What changed in zod between 3.20.0 and 3.23.8?
→ list_versions to confirm valid versions, then get_changelog

Show me the passport.js authentication middleware docs
→ search_docs with query "authentication middleware"

What does the useCallback hook do in React 18?
→ get_docs for react@18.2.0, then search_docs with query "useCallback"
```

---

## Cache

Responses are stored in `~/.cache/docpilot/` as JSON files:

| Content type | TTL |
|---|---|
| Doc pages, READMEs | 24 hours |
| Registry metadata (npm, PyPI) | 1 hour |
| Ecosystem resolution (npm vs pypi) | 24 hours |

Run `docpilot --clear-cache` to force-refresh everything.

---

## Requirements

- Node.js >= 18.0.0 (uses native `fetch` and `AbortSignal.timeout`)

---

## License

MIT
