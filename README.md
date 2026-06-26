# opencode-visualizer

[![CI](https://github.com/woss/opencode-visualizer/actions/workflows/ci.yml/badge.svg)](https://github.com/woss/opencode-visualizer/actions/workflows/ci.yml)
[![Release](https://github.com/woss/opencode-visualizer/actions/workflows/release.yml/badge.svg)](https://github.com/woss/opencode-visualizer/actions/workflows/release.yml)
[![Deno](https://img.shields.io/badge/deno-2.x-black?logo=deno)](https://deno.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Homebrew](https://img.shields.io/badge/brew-woss%2Ftap%2Focv-blue?logo=homebrew)](https://github.com/woss/homebrew-tap)

ANSI terminal dashboard and CLI for exploring your
[OpenCode](https://opencode.ai) database — sessions, tokens, costs, models, and
project activity.

![ocv dashboard](https://u.macula.link/9BH9LsNYSJ6za1-x5QxLEA-7?preset=sys_sm)

## Install

### Homebrew (macOS & Linux)

```bash
brew install woss/tap/ocv
```

### Pre-built binary

Download the latest binary from
[Releases](https://github.com/woss/opencode-visualizer/releases):

```bash
# Linux x86_64
curl -L https://github.com/woss/opencode-visualizer/releases/latest/download/ocv-x86_64-linux.tar.gz | tar xz
./ocv
```

```bash
# Linux ARM64 (e.g. Raspberry Pi)
curl -L https://github.com/woss/opencode-visualizer/releases/latest/download/ocv-aarch64-linux.tar.gz | tar xz
./ocv
```

```bash
# macOS ARM64 (Apple Silicon)
curl -L https://github.com/woss/opencode-visualizer/releases/latest/download/ocv-aarch64-macos.tar.gz | tar xz
./ocv
```

### From source (requires Deno)

```bash
deno install --allow-read --allow-write --allow-env --allow-ffi -n ocv main.ts
```

### Compile a standalone binary

```bash
deno task compile       # Produces ./ocv
```

Cross-compile for other platforms:

```bash
deno task compile-all   # Produces ocv-x86_64-linux, ocv-aarch64-macos, ocv-aarch64-linux
```

## Usage

```bash
ocv .                       # Dashboard filtered to current directory
ocv                        # Show per-directory session overview (default)
ocv stats                  # Detailed statistics
ocv dash                   # Dashboard with bars and charts
ocv dash --top=5           # Show top 5 items per section
ocv dash --exclude=simstore,infra  # Exclude directories
ocv dash --name=surrealdb-orm,woss.io  # Focus on specific directories
ocv dash --all             # Show all items
ocv dash --merge-same-names  # Merge same-named directories into one row
ocv sessions <path>        # List sessions matching directory path
ocv session <id>           # Detailed info for a specific session
ocv search <query>         # Search sessions by title or directory
ocv rename --from-dir <old-dir> -d <new-dir>  # Batch-rename session directory
ocv mcp                       # MCP stdio server for AI agent integration
ocv --help                 # Top-level help
ocv <command> --help       # Per-command help
ocv --version              # Show version
```

### Output formats

Every command supports `--output json` (or `-o json`):

```bash
ocv stats --output json              # Stats as JSON
ocv sessions <path> -o json          # Sessions as JSON
ocv dash --output json               # Dashboard data as JSON
ocv overview --output json           # Overview as JSON
ocv search <query> --output json     # Search results as JSON
ocv rename --from-dir ... -d ... --output json   # Rename result as JSON
ocv mcp                       # MCP server — communicates via JSON-RPC on stdio (no --output flag)
```

### Excluding directories

Two ways to hide directories from the dashboard:

1. **CLI flag**: `ocv dash --exclude=secret-company,infrastructure`
2. **Config file**: Edit `~/.config/ocv/.ocvignore` with gitignore-style
   patterns:

```ocvignore
# One pattern per line — gitignore-style globs
simstore              # exact directory name
fork-*                # glob: any directory starting with fork-
*site                 # glob: any directory ending with -site
!important-site       # negation: re-include even if matched
```

### Filtering by directory

Focus the dashboard on specific directories with `--name`:

```bash
ocv dash --name=surrealdb-orm,woss.io
```

Works on all dashboard panels — directories, models, providers, weekly activity,
and costs. The directory section adapts to show exactly the named directories
(instead of the top N). Accepts comma-separated directory names (not paths).

### Merging same-named directories

If you have projects in multiple locations (different clones, worktrees) with
the same directory name, the dashboard shows each path as a separate row. Use
`--merge-same-names` to collapse them into a single row by basename:

```bash
ocv dash --merge-same-names
ocv dash --name=my-project --merge-same-names
```

The path-arg shortcut (`ocv .`) enables this automatically — current-directory
sessions from all clones/worktrees are merged into one row.

### Session types

The `sessions` and `search` commands show a "Type" column:

- **Main** — top-level session (no parent)
- **Sub** — subagent/delegated session (has a parent_id)

### MCP server

`ocv` includes a [Model Context Protocol](https://modelcontextprotocol.io) (MCP)
stdio server for AI agent tool access. Run `ocv mcp` to start the server — it
communicates over stdin/stdout via JSON-RPC, exposing database queries as
structured, typed tools.

**Available tools:** `get_stats`, `get_overview`, `list_sessions`,
`get_session`, `search_sessions`, `get_top_models`, `get_top_providers`,
`get_weekly_activity`

`get_overview` accepts an optional `directory` string — when provided, returns
aggregate stats for only that directory. Omit for all directories.

Register with OpenCode by adding to `.opencode/opencode.jsonc` in any project:

```json
"ocv": {
  "type": "local",
  "command": ["ocv", "mcp"],
  "enabled": true
}
```

Or from source (requires Deno):

```json
"ocv": {
  "type": "local",
  "command": ["deno", "run", "-A", "main.ts", "mcp"],
  "enabled": true
}
```

Agents in that workspace can then query session data, token usage, costs, and
more through structured tool calls.

## Commands

| Command                            | Description                                                                                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `(no args)` / `overview`           | Per-directory session overview table                                                                                                             |
| `stats`                            | Full statistics: sessions (active/archived), projects, tokens, cost, most-used model, app version range                                          |
| `dash`                             | ANSI dashboard with bars per directory, model, provider, weekly activity. Supports `--top`, `--all`, `--name`, `--exclude`, `--merge-same-names` |
| `.` (path arg)                     | Dashboard filtered to the given directory's sessions — resolve `.`, `./x`, `/abs/path` to dir basename, auto-merges same-named dirs              |
| `sessions <path>`                  | Filtered session list matching a directory path                                                                                                  |
| `session <id>`                     | Single session detail with messages and todo breakdown                                                                                           |
| `search <query>`                   | Full-text search over session titles and directories                                                                                             |
| `rename --from-dir <old> -d <new>` | Batch-rename session directory and path fields when project moves                                                                                |
| `mcp`                              | Start MCP stdio server — exposes DB queries as structured tools for AI agents                                                                    |

## Semantic versioning

This project uses [semantic-release](https://semantic-release.gitbook.io/) with
[conventional commits](https://www.conventionalcommits.org/). Version bumps are
automatic based on commit messages:

| Commit message prefix                                       | Version bump          |
| ----------------------------------------------------------- | --------------------- |
| `fix: ...`                                                  | Patch (1.0.0 → 1.0.1) |
| `feat: ...`                                                 | Minor (1.0.0 → 1.1.0) |
| `feat!: ...` or `fix!: ...` with `BREAKING CHANGE:` in body | Major (1.0.0 → 2.0.0) |
| `chore: ...`, `docs: ...`, `refactor: ...`, `ci: ...`       | No release            |

GitHub Releases are created automatically on push to `main` with compiled
binaries attached.

## Environment

| Variable           | Default                               | Description                         |
| ------------------ | ------------------------------------- | ----------------------------------- |
| `OPENCODE_DB_PATH` | `~/.local/share/opencode/opencode.db` | Override the OpenCode database path |

## How it works

Reads the OpenCode SQLite database (`opencode.db`) directly via `@db/sqlite`.
Queries aggregate token usage, session counts, model usage, version ranges, and
per-project activity from the session, message, and part tables. Most commands
are read-only; the `rename` command writes to update directory and path fields.

## Build

```bash
deno check main.ts                          # Type-check
deno lint                                    # Lint all source files
deno compile --allow-read --allow-write --allow-env --allow-ffi --output ocv main.ts  # Build binary
```

## License

MIT
