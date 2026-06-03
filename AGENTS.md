# AGENTS.md — opencode-visualizer (ocv)

ANSI terminal dashboard + CLI for exploring OpenCode database — sessions,
tokens, costs, models, project activity.

## Tech Stack

- **Runtime**: Deno 2.x (no Node.js, no npm)
- **CLI framework**: `jsr:@cliffy/command@^1.0.0-rc.7`
- **SQLite**: `jsr:@db/sqlite@^0.12.0` — direct SQL, no ORM
- **Paths**: `jsr:@std/path@^1.0.0`
- **Formatting**: `deno fmt` (no Prettier, no ESLint)
- **Type checking**: `deno check main.ts` (not tsc)
- **Linting**: `deno lint`
- **Binary distribution**: `deno compile` → standalone binary (~7MB)
- **Distribution channels**: GitHub Releases, Homebrew tap `woss/homebrew-tap`
- **CI/CD**: semantic-release with conventional commits, GitHub Actions

## Project Structure

```
main.ts                  # CLI entrypoint, all subcommands defined inline
lib/
  ansi.ts                # ANSI helpers — colors, bar-drawing, box-drawing chars
  dashboard.ts           # Dashboard rendering (showDashboard)
  db.ts                  # Raw SQL queries against opencode.db
  format.ts              # Text formatting for each command's output
  ignore.ts              # .ocvignore file parsing
  spinner.ts             # ASCII spinner (stderr)
  types.ts               # TS interfaces — raw row types + derived/computed types
```

## Architecture Rules

1. **main.ts** owns ALL CLI parsing. Subcommands defined inline with their
   action callbacks. No separate command files.
2. **lib/db.ts** owns ALL SQL. No inline SQL anywhere else. Every query is a
   named function.
3. **lib/format.ts** owns ALL display formatting. Each format function takes
   typed data, returns string. Pure functions only.
4. **lib/dashboard.ts** is the only "renderer" — builds box-drawing-chars ANSI
   dashboard. Called by `dash` command and default (no-args) mode.
5. **lib/types.ts** has two sections: raw row types (match SQL columns exactly)
   and derived types (computed for display, e.g. `SessionDetail`,
   `DirectoryOverviewRow`).
6. **formatOutput()** in main.ts is generic output dispatch: if `--output json`,
   `JSON.stringify`; else call the format function.
7. **Error handling**: try/catch around DB operations, `spinner.stop()` in both
   success and catch, `Deno.exit(1)` on error. No unhandled promise rejections.

## CLI Commands

| Command           | Example                      | Description                                                                       |
| ----------------- | ---------------------------- | --------------------------------------------------------------------------------- |
| (no args)         | `ocv`                        | Default: show dashboard                                                           |
| `dash`            | `ocv dash --top=5`           | ANSI dashboard with bars/charts. Supports `--top`, `--all`, `--name`, `--exclude` |
| `sessions <path>` | `ocv sessions surrealdb-orm` | List sessions matching directory                                                  |
| `session <id>`    | `ocv session abc123`         | Single session detail                                                             |
| `search <query>`  | `ocv search error`           | Full-text search over titles/dirs (LIKE match)                                    |
| `stats`           | `ocv stats -o json`          | Overall DB statistics                                                             |
| `overview`        | `ocv overview`               | Per-directory overview table                                                      |
| Global            | `-o, --output json`          | All commands support JSON output                                                  |

## Code Conventions

- **Imports**: JSR specifiers only (`jsr:@cliffy/command`, `jsr:@db/sqlite`,
  `jsr:@std/path`). No npm: specifiers.
- **Naming**: `camelCase` functions, `PascalCase` types/interfaces, `kebab-case`
  files.
- **No classes** — pure functions, typed interfaces, no OOP. Zero class
  definitions.
- **No TUI frameworks** — pure ANSI escape codes, box-drawing chars
  (`─│┌┐└┘├┤┬┴┼`).
- **Spinner pattern**:
  ```ts
  const spinner = showSpinner("msg");
  try {
    // work
    spinner.stop();
  } catch (cause) {
    spinner.stop();
    console.error(`Error: ${cause}`);
    Deno.exit(1);
  }
  ```
- **DB permissions**: `--allow-read --allow-write --allow-env --allow-ffi` (ffi
  needed for SQLite native binding).
- **Run tasks**: `deno task start` (dev), `deno task compile` (binary),
  `deno task check` (type-check).
- **DB**: Opens in read-only mode with `int64: true` so timestamps (>2^31)
  aren't truncated. PRAGMA `journal_mode=WAL`.
- **BigInt handling**: `convertRow()` in db.ts recursively converts BigInt
  values to Number (all values fit within MAX_SAFE_INTEGER).
- **Model/Provider parsing**: `model` column stores JSON
  `{"providerID":"...","modelID":"..."}` — parsed in JS, not SQL.
- **Output dispatch**: `formatOutput()` in main.ts handles JSON vs text routing.
  Some commands (`session`, `stats`) handle JSON separately when format
  functions take multiple args.

## Git Workflow

- **Conventional commits**: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`,
  `ci:`.
- **Pre-commit hook** (`.githooks/pre-commit`): runs `deno fmt --check`,
  `deno lint`, `deno check main.ts lib/*.ts`.
- **semantic-release** auto-publishes on push to `main`.
- **Branch naming**: any convention works. Stacked branches per GitButler
  workflow.
- **CI** (`.github/workflows/ci.yml`): runs on PRs to `main` — `deno lint` +
  `deno check main.ts`.
- **Release** (`.github/workflows/release.yml`): runs on push to `main` —
  cross-compiles 4 targets, creates GitHub Release with gzipped binaries via
  semantic-release.

## Distribution

- Cross-compiled for 4 targets via `deno task compile-all`.
- Targets: `x86_64-unknown-linux-gnu`, `aarch64-unknown-linux-gnu`,
  `aarch64-apple-darwin`, `x86_64-apple-darwin`.
- Binaries gzipped (`tar czf`) and attached to GitHub Releases.
- Homebrew formula at `woss/homebrew-tap` (auto-updated weekly).
- Binary name: `ocv`.

## Agent Guidelines

- **When modifying code**: read the full file first. Understand the pattern
  before editing.
- **When adding a new query**: put it in `lib/db.ts` as a named function. Add
  typed return type from `lib/types.ts` if new shape needed.
- **When adding a new command**: add subcommand inline in `main.ts` using
  `@cliffy/command`. Follow existing spinner/try-catch/formatOutput pattern.
- **When adding display logic**: put formatter in `lib/format.ts`. Keep
  rendering separate from data.
- **When touching dashboard**: modify `lib/dashboard.ts`. Uses box-drawing chars
  and ANSI escape codes directly.
- **No external dependencies** beyond the 3 JSR imports (`@cliffy/command`,
  `@db/sqlite`, `@std/path`).
- **No runtime assertions or validation libraries** — manual guard clauses with
  descriptive error messages.
- **No debug logging or console.log** outside of intended output.
- **Run verification**: always run `deno check main.ts` after changes. Also
  `deno lint` if modifying structure.
- **Caveman mode** applies to agent responses: no filler, no pleasantries, no
  meta-commentary. Direct technical answers.
