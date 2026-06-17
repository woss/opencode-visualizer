import { Table } from "@cliffy/table";
import { fmtBinaryBytes } from "./ansi.ts";
import type {
  DbStats,
  DirectoryOverviewRow,
  RenameResult,
  SessionListRow,
  SessionRow,
  TodoSummary,
} from "./types.ts";

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Format a number with comma separators: 1234567 → "1,234,567".
 */
export function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

/**
 * Format a unix-ms timestamp to a readable date string.
 * Returns "—" for null/0 timestamps.
 */
export function formatTime(ts: number | null | undefined): string {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Shorten a filesystem path for display.
 * Preserves the last `maxLen` characters, replacing the start with "…" if truncated.
 */
export function truncatePath(path: string, maxLen: number = 50): string {
  if (!path || path.length <= maxLen) return path;
  return "…" + path.slice(-(maxLen - 1));
}

// ── Table formatting helpers ─────────────────────────────────────────────

interface Column {
  label: string;
  align: "left" | "right";
}

function formatTable(rows: string[][], columns: Column[]): string {
  if (rows.length === 0) return "No results.";

  const headers = columns.map((c) => c.label);
  return new Table()
    .header(headers)
    .body(rows)
    .border(false)
    .padding(2)
    .toString()
    .trimEnd();
}

// ── Display formatters ───────────────────────────────────────────────────

/**
 * Format the per-directory overview table.
 */
export function formatOverview(rows: DirectoryOverviewRow[]): string {
  if (rows.length === 0) return "No session data found.";

  const data = rows.map((r) => [
    truncatePath(r.directory, 55),
    formatNumber(r.total),
    formatNumber(r.active),
    formatNumber(r.archived),
    formatNumber(r.tokens_input),
    formatNumber(r.tokens_output),
    formatNumber(r.tokens_reasoning),
    r.cost.toFixed(4),
  ]);

  return formatTable(data, [
    { label: "Directory", align: "left" },
    { label: "Total", align: "right" },
    { label: "Active", align: "right" },
    { label: "Archived", align: "right" },
    { label: "Tokens In", align: "right" },
    { label: "Tokens Out", align: "right" },
    { label: "Reasoning", align: "right" },
    { label: "Cost ($)", align: "right" },
  ]);
}

/**
 * Format a list of sessions (for sessions command and search results).
 */
function sessionRowsToTable(rows: SessionListRow[]): string {
  if (rows.length === 0) return "No sessions found.";

  const data = rows.map((r) => [
    r.id,
    r.title.slice(0, 50),
    truncatePath(r.directory, 35),
    r.parent_id ? "Sub" : "Main",
    formatTime(r.time_created),
    r.time_archived ? "Yes" : "—",
    formatNumber(r.tokens_input),
    formatNumber(r.tokens_output),
    formatNumber(r.message_count),
  ]);

  return formatTable(data, [
    { label: "ID", align: "left" },
    { label: "Title", align: "left" },
    { label: "Directory", align: "left" },
    { label: "Type", align: "left" },
    { label: "Created", align: "left" },
    { label: "Archived", align: "left" },
    { label: "In", align: "right" },
    { label: "Out", align: "right" },
    { label: "Msgs", align: "right" },
  ]);
}

/**
 * Format session list (for `sessions` command).
 */
export function formatSessionList(rows: SessionListRow[]): string {
  return sessionRowsToTable(rows);
}

/**
 * Format search results (for `search` command).
 */
export function formatSearchResults(rows: SessionListRow[]): string {
  return sessionRowsToTable(rows);
}

/**
 * Format a single session's detailed view.
 */
export function formatSessionDetail(
  session: SessionRow,
  messageCount: number,
  todos: TodoSummary,
): string {
  const lines: string[] = [];
  lines.push("Session Detail");
  lines.push("─".repeat(60));
  lines.push(`  ID:            ${session.id}`);
  lines.push(`  Title:         ${session.title}`);
  lines.push(`  Directory:     ${session.directory}`);
  lines.push(`  Project ID:    ${session.project_id ?? "—"}`);
  lines.push(`  Agent:         ${session.agent ?? "—"}`);
  lines.push(`  Model:         ${session.model ?? "—"}`);
  lines.push(`  Slug:          ${session.slug}`);
  lines.push(`  Path:          ${session.path ?? "—"}`);
  lines.push("");
  lines.push("Timestamps");
  lines.push(`  Created:       ${formatTime(session.time_created)}`);
  lines.push(`  Updated:       ${formatTime(session.time_updated)}`);
  lines.push(`  Archived:      ${formatTime(session.time_archived)}`);
  lines.push(`  Compacting:    ${formatTime(session.time_compacting)}`);
  lines.push("");
  lines.push("Tokens");
  lines.push(`  Input:         ${formatNumber(session.tokens_input)}`);
  lines.push(`  Output:        ${formatNumber(session.tokens_output)}`);
  lines.push(`  Reasoning:     ${formatNumber(session.tokens_reasoning)}`);
  lines.push(`  Cache Read:    ${formatNumber(session.tokens_cache_read)}`);
  lines.push(`  Cache Write:   ${formatNumber(session.tokens_cache_write)}`);
  lines.push(`  Cost:          $${session.cost.toFixed(4)}`);
  lines.push("");
  lines.push("Messages & Todos");
  lines.push(`  Messages:      ${formatNumber(messageCount)}`);
  lines.push(`  Todos (total): ${formatNumber(todos.total)}`);
  lines.push(`  ├ Completed:   ${formatNumber(todos.completed)}`);
  lines.push(`  ├ In Progress: ${formatNumber(todos.in_progress)}`);
  lines.push(`  └ Pending:     ${formatNumber(todos.pending)}`);

  if (
    session.summary_additions || session.summary_deletions ||
    session.summary_files
  ) {
    lines.push("");
    lines.push("Summary");
    lines.push(
      `  Additions:     ${formatNumber(session.summary_additions ?? 0)}`,
    );
    lines.push(
      `  Deletions:     ${formatNumber(session.summary_deletions ?? 0)}`,
    );
    lines.push(`  Files:         ${formatNumber(session.summary_files ?? 0)}`);
  }

  if (session.metadata) {
    lines.push("");
    lines.push(
      `  Metadata:      ${session.metadata.slice(0, 200)}${
        session.metadata.length > 200 ? "…" : ""
      }`,
    );
  }

  return lines.join("\n");
}

/**
 * Format DB statistics in a key-value layout.
 */
export function formatDbStats(stats: DbStats): string {
  const lines: string[] = [];
  lines.push("OpenCode Database Statistics");
  lines.push("─".repeat(50));

  // General section
  const general: [string, string][] = [
    ["Projects:", formatNumber(stats.projects)],
    ["Sessions:", formatNumber(stats.sessions)],
    ["├ Active:", formatNumber(stats.active_sessions)],
    ["└ Archived:", formatNumber(stats.archived_sessions)],
    ["Messages:", formatNumber(stats.messages)],
    ["Parts:", formatNumber(stats.parts)],
    ["Todos:", formatNumber(stats.todos)],
    ["Distinct Directories:", formatNumber(stats.directories)],
  ];
  if (stats.top_model) {
    general.push([
      "Most Used Model:",
      `${stats.top_model.model} (${
        formatNumber(stats.top_model.count)
      } sessions)`,
    ]);
  }
  if (stats.top_provider) {
    general.push([
      "Most Used Provider:",
      `${stats.top_provider.provider} (${
        formatNumber(stats.top_provider.count)
      } sessions)`,
    ]);
  }
  if (stats.version_min && stats.version_max) {
    general.push([
      "App Versions:",
      `${stats.version_min} → ${stats.version_max}`,
    ]);
  }
  general.push([
    "Period:",
    `${formatNumber(Math.round(stats.total_days))} days`,
  ]);

  lines.push(
    new Table()
      .body(general)
      .padding(2)
      .border(false)
      .toString()
      .trimEnd()
      .split("\n")
      .map((l) => "  " + l)
      .join("\n"),
  );
  lines.push("");

  // Session Activity section
  const activity: [string, string][] = [
    ["Daily avg:", `${stats.daily_avg.toFixed(1)} sessions/day`],
    ["Weekly avg:", `${stats.weekly_avg.toFixed(1)} sessions/week`],
    ["Monthly avg:", `${stats.monthly_avg.toFixed(1)} sessions/month`],
  ];
  lines.push("Session Activity");
  lines.push(
    new Table()
      .body(activity)
      .padding(2)
      .border(false)
      .toString()
      .trimEnd()
      .split("\n")
      .map((l) => "  " + l)
      .join("\n"),
  );
  lines.push("");

  // Token Usage section
  const tokens: [string, string][] = [
    ["Input:", formatNumber(stats.tokens_input)],
    ["Output:", formatNumber(stats.tokens_output)],
    ["Reasoning:", formatNumber(stats.tokens_reasoning)],
    ["Cache Read:", formatNumber(stats.tokens_cache_read)],
    ["Cache Write:", formatNumber(stats.tokens_cache_write)],
    ["Total Cost:", `$${stats.total_cost.toFixed(4)}`],
    ["DB size:", fmtBinaryBytes(stats.dbSize)],
  ];
  lines.push("Token Usage (all sessions)");
  lines.push(
    new Table()
      .body(tokens)
      .padding(2)
      .border(false)
      .toString()
      .trimEnd()
      .split("\n")
      .map((l) => "  " + l)
      .join("\n"),
  );
  lines.push("");

  // Time Range section
  const time: [string, string][] = [
    ["Oldest session:", formatTime(stats.oldest_session)],
    ["Newest session:", formatTime(stats.newest_session)],
  ];
  lines.push("Time Range");
  lines.push(
    new Table()
      .body(time)
      .padding(2)
      .border(false)
      .toString()
      .trimEnd()
      .split("\n")
      .map((l) => "  " + l)
      .join("\n"),
  );

  return lines.join("\n");
}

/**
 * Format the result of a rename operation.
 */
export function formatRenameResult(result: RenameResult): string {
  const lines: string[] = [];
  lines.push("Directory renamed successfully");
  lines.push("─".repeat(40));
  lines.push(`  Old directory:  ${result.old_directory}`);
  lines.push(`  New directory:  ${result.new_directory}`);
  lines.push(`  Sessions affected: ${result.affected_sessions}`);
  return lines.join("\n");
}

/**
 * Print usage information.
 */
export function printUsage(): void {
  console.log("Run `opencode-visualizer --help` for usage information.");
}
