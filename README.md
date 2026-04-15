# docpilot

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

An MCP server that plugs into Claude Code and serves version-accurate documentation as context tools. Point it at your project and ask Claude about any dependency — docpilot fetches the real docs so Claude answers with current, version-specific information instead of hallucinating stale APIs.

---

## Install

### Quick start (npx)

No installation required — Claude Code runs it on demand:

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

Add that block to your Claude Code config file:

- **macOS/Linux:** `~/.claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

### Manual install

```bash
npm install -g docpilot
```

Then use `docpilot` as the command in your config instead of `npx docpilot`.

---

## Tools

| Tool | Description |
|------|-------------|
| `detect_dependencies` | Reads `package.json`, `requirements.txt`, or `pyproject.toml` from a workspace path and returns a structured list of packages, versions, and ecosystems |
| `get_docs` | Given a package name and version, fetches and returns the first ~3000 chars of documentation from the package's official docs site or README |
| `search_docs` | Given a query string and package name, performs keyword search across the docs and returns the top 3 matching sections |
| `get_changelog` | Given a package name and two version strings, returns the version history between them using the npm or PyPI registry API |

---

## How it works

When you ask Claude about a dependency, docpilot first resolves the package's documentation URL from the npm or PyPI registry metadata. It then fetches that page and uses cheerio to strip navigation, scripts, and boilerplate — leaving only the meaningful content. For changelogs, it queries the registry directly and extracts the ordered version list between two specified versions. All tools return plain text that Claude can reason over directly as context.

---

## Example usage in Claude Code

```
What changed between react 17.0.0 and 18.2.0?
→ uses get_changelog

Show me the authentication docs for passport
→ uses search_docs with query "authentication"

What dependencies does this project use?
→ uses detect_dependencies on the current workspace
```

---

## License

MIT
