import { Database } from "@db/sqlite";
import type {
  AgentStat,
  DbStats,
  DirectoryOverviewRow,
  ModelCostRow,
  ModelStat,
  ProviderStat,
  SessionDetail,
  SessionListRow,
  SessionRow,
  TodoRow,
  TodoSummary,
} from "./types.ts";

/**
 * Open the opencode SQLite DB in read-only mode.
 * Enables int64 support so timestamps (>2^31) aren't truncated.
 * Throws with descriptive message if the file doesn't exist or can't be opened.
 */
export function openDb(dbPath: string): Database {
  try {
    const db = new Database(dbPath, { readonly: true, int64: true });
    db.exec("PRAGMA journal_mode=WAL;");
    return db;
  } catch (cause) {
    throw new Error(`Cannot open DB at ${dbPath}: ${cause}`);
  }
}

export interface WeeklySession {
  weekStart: number;
  count: number;
}

/**
 * Build SQL WHERE/AND clause fragment for filtering by short directory names.
 * Matches against the `directory` column (full path or short name).
 */
function dirFilter(names: string[] | undefined): {
  clause: string;
  and: string;
  params: string[];
} {
  if (!names || names.length === 0) return { clause: "", and: "", params: [] };
  const parts: string[] = [];
  const params: string[] = [];
  for (const n of names) {
    parts.push("(directory = ? OR directory LIKE ?)");
    params.push(n, `%/${n}`);
  }
  const conds = parts.join(" OR ");
  return {
    clause: ` WHERE (${conds})`,
    and: ` AND (${conds})`,
    params,
  };
}

/**
 * Recursively convert BigInt values to Number in a query result.
 * The timestamps and token counts fit within Number.MAX_SAFE_INTEGER (2^53).
 */
function convertRow<T>(row: T): T {
  if (row === null || row === undefined) return row;
  if (typeof row === "bigint") return Number(row) as unknown as T;
  if (Array.isArray(row)) return row.map(convertRow) as unknown as T;
  if (typeof row === "object") {
    const obj = row as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      obj[key] = convertRow(obj[key]);
    }
    return obj as T;
  }
  return row;
}

/**
 * Return aggregate statistics across all tables.
 */
export function getDbStats(db: Database, names?: string[]): DbStats {
  const df = dirFilter(names);
  interface CountRow {
    c: number;
  }

  const projectCount = convertRow(
    db.prepare("SELECT COUNT(*) AS c FROM project").get() as CountRow,
  ).c;
  const sessionCount = convertRow(
    db.prepare("SELECT COUNT(*) AS c FROM session" + df.clause).get(
      ...df.params,
    ) as CountRow,
  ).c;
  const activeCount = convertRow(
    db.prepare(
      "SELECT COUNT(*) AS c FROM session WHERE time_archived IS NULL" + df.and,
    ).get(...df.params) as CountRow,
  ).c;
  const archivedCount = convertRow(
    db.prepare(
      "SELECT COUNT(*) AS c FROM session WHERE time_archived IS NOT NULL" +
        df.and,
    ).get(...df.params) as CountRow,
  ).c;
  const messageCount = convertRow(
    db.prepare("SELECT COUNT(*) AS c FROM message").get() as CountRow,
  ).c;
  const partCount = convertRow(
    db.prepare("SELECT COUNT(*) AS c FROM part").get() as CountRow,
  ).c;
  const todoCount = convertRow(
    db.prepare("SELECT COUNT(*) AS c FROM todo").get() as CountRow,
  ).c;
  const dirCount = convertRow(
    db.prepare("SELECT COUNT(DISTINCT directory) AS c FROM session" + df.clause)
      .get(...df.params) as CountRow,
  ).c;

  // Most used model — model column stores JSON, parse in JS
  const allModels = convertRow(
    db.prepare(
      "SELECT model FROM session WHERE model IS NOT NULL AND model != ''" +
        df.and,
    ).all(...df.params) as { model: unknown }[],
  ) as { model: unknown }[];

  interface ModelEntry {
    id: string;
    count: number;
  }
  const modelCounts = new Map<string, number>();
  const providerCounts = new Map<string, number>();
  for (const row of allModels) {
    let id = "";
    if (typeof row.model === "string") {
      try {
        const parsed = JSON.parse(row.model);
        id = parsed.modelID || parsed.id || String(parsed);
      } catch {
        id = row.model; // plain string fallback
      }
    }
    if (id) modelCounts.set(id, (modelCounts.get(id) || 0) + 1);

    // Also count provider
    let providerId = "";
    if (typeof row.model === "string") {
      try {
        const parsed = JSON.parse(row.model);
        providerId = parsed.providerID || String(parsed);
      } catch {
        // skip unparseable
      }
    }
    if (providerId) {
      providerCounts.set(providerId, (providerCounts.get(providerId) || 0) + 1);
    }
  }
  let topModel: { model: string; count: number } | null = null;
  for (const [model, count] of modelCounts) {
    if (!topModel || count > topModel.count) topModel = { model, count };
  }

  let topProvider: { provider: string; count: number } | null = null;
  for (const [provider, count] of providerCounts) {
    if (!topProvider || count > topProvider.count) {
      topProvider = { provider, count };
    }
  }

  // Version range — semver sort in JS, not string sort
  interface VersionEntry {
    version: string;
  }
  const allVersions = convertRow(
    db.prepare(
      "SELECT DISTINCT version FROM session WHERE version IS NOT NULL AND version != ''" +
        df.and,
    ).all(...df.params) as VersionEntry[],
  ) as VersionEntry[];

  function parseSemver(v: string): number[] {
    return v.split("-")[0].split(".").map((n) => {
      const p = parseInt(n, 10);
      return isNaN(p) ? 0 : p;
    });
  }
  const sorted = allVersions.map((r) => r.version).sort((a, b) => {
    const pa = parseSemver(a), pb = parseSemver(b);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const diff = (pa[i] || 0) - (pb[i] || 0);
      if (diff !== 0) return diff;
    }
    return 0;
  });

  const tokenRow = convertRow(
    db.prepare(`
    SELECT
      COALESCE(SUM(tokens_input), 0) AS tokens_input,
      COALESCE(SUM(tokens_output), 0) AS tokens_output,
      COALESCE(SUM(tokens_reasoning), 0) AS tokens_reasoning,
      COALESCE(SUM(tokens_cache_read), 0) AS tokens_cache_read,
      COALESCE(SUM(tokens_cache_write), 0) AS tokens_cache_write,
      COALESCE(SUM(cost), 0) AS total_cost,
      MIN(time_created) AS oldest,
      MAX(time_created) AS newest
    FROM session${df.clause}
  `).get(...df.params),
  ) as {
    tokens_input: number;
    tokens_output: number;
    tokens_reasoning: number;
    tokens_cache_read: number;
    tokens_cache_write: number;
    total_cost: number;
    oldest: number | null;
    newest: number | null;
  };

  const oldest = tokenRow.oldest ?? null;
  const newest = tokenRow.newest ?? null;
  const totalDays = oldest && newest
    ? Math.max(1, Math.round((newest - oldest) / 86_400_000))
    : 1;

  return {
    projects: projectCount,
    sessions: sessionCount,
    active_sessions: activeCount,
    archived_sessions: archivedCount,
    messages: messageCount,
    parts: partCount,
    todos: todoCount,
    directories: dirCount,
    daily_avg: sessionCount / totalDays,
    weekly_avg: sessionCount / Math.max(1, totalDays / 7),
    monthly_avg: sessionCount / Math.max(1, totalDays / 30.44),
    total_days: totalDays,
    top_model: topModel,
    top_provider: topProvider,
    version_min: sorted.length > 0 ? sorted[0] : null,
    version_max: sorted.length > 0 ? sorted[sorted.length - 1] : null,
    tokens_input: tokenRow.tokens_input,
    tokens_output: tokenRow.tokens_output,
    tokens_reasoning: tokenRow.tokens_reasoning,
    tokens_cache_read: tokenRow.tokens_cache_read,
    tokens_cache_write: tokenRow.tokens_cache_write,
    total_cost: tokenRow.total_cost,
    oldest_session: oldest,
    newest_session: newest,
  };
}

/**
 * Group sessions by directory returning aggregate stats per directory.
 */
export function getDirectoryOverview(db: Database): DirectoryOverviewRow[] {
  return convertRow(
    db.prepare(`
    SELECT
      directory,
      COUNT(*) AS total,
      SUM(CASE WHEN time_archived IS NULL THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN time_archived IS NOT NULL THEN 1 ELSE 0 END) AS archived,
      SUM(CASE WHEN parent_id IS NULL THEN 1 ELSE 0 END) AS main_count,
      SUM(CASE WHEN parent_id IS NOT NULL THEN 1 ELSE 0 END) AS sub_count,
      COALESCE(SUM(tokens_input), 0) AS tokens_input,
      COALESCE(SUM(tokens_output), 0) AS tokens_output,
      COALESCE(SUM(tokens_reasoning), 0) AS tokens_reasoning,
      COALESCE(SUM(tokens_cache_read), 0) AS tokens_cache_read,
      COALESCE(SUM(tokens_cache_write), 0) AS tokens_cache_write,
      COALESCE(SUM(cost), 0) AS cost,
      MAX(time_created) AS last_active
    FROM session
    GROUP BY directory
    ORDER BY total DESC
  `).all(),
  ) as DirectoryOverviewRow[];
}

/**
 * Aggregate sessions into weekly buckets for time-series display.
 */
export function getSessionsByWeek(
  db: Database,
  names?: string[],
): WeeklySession[] {
  const df = dirFilter(names);
  const raw = db.prepare(
    "SELECT time_created FROM session" + df.clause + " ORDER BY time_created",
  ).all(...df.params) as { time_created: unknown }[];
  const rows = convertRow(raw) as { time_created: number }[];

  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const buckets = new Map<number, number>();

  for (const row of rows) {
    if (row.time_created <= 0) continue;
    const weekStart = Math.floor(row.time_created / WEEK_MS) * WEEK_MS;
    buckets.set(weekStart, (buckets.get(weekStart) || 0) + 1);
  }

  return Array.from(buckets.entries())
    .map(([weekStart, count]) => ({
      weekStart: Number(weekStart),
      count: Number(count),
    }))
    .sort((a, b) => a.weekStart - b.weekStart);
}

/**
 * Return top N models by session count.
 * model column stores JSON like {"providerID":"opencode","modelID":"big-pickle"},
 * so we parse in JS.
 */
export function getTopModels(
  db: Database,
  limit: number = 10,
  names?: string[],
): ModelStat[] {
  const df = dirFilter(names);
  const allModels = convertRow(
    db.prepare(
      "SELECT model FROM session WHERE model IS NOT NULL AND model != ''" +
        df.and,
    ).all(...df.params) as { model: unknown }[],
  ) as { model: unknown }[];

  const modelCounts = new Map<string, number>();
  for (const row of allModels) {
    let id = "";
    if (typeof row.model === "string") {
      try {
        const parsed = JSON.parse(row.model);
        id = parsed.modelID || parsed.id || String(parsed);
      } catch {
        id = row.model;
      }
    }
    if (id) modelCounts.set(id, (modelCounts.get(id) || 0) + 1);
  }

  return Array.from(modelCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([model, count]) => ({ model, count }));
}

/**
 * Return top N models by cumulative cost.
 */
export function getModelCosts(
  db: Database,
  limit: number = 10,
  names?: string[],
): ModelCostRow[] {
  const df = dirFilter(names);
  const rows = convertRow(
    db.prepare(
      "SELECT model, cost FROM session WHERE model IS NOT NULL AND model != '' AND cost > 0" +
        df.and,
    ).all(...df.params) as { model: unknown; cost: unknown }[],
  ) as { model: unknown; cost: number }[];

  const costMap = new Map<string, { totalCost: number; count: number }>();
  for (const row of rows) {
    let id = "";
    if (typeof row.model === "string") {
      try {
        const parsed = JSON.parse(row.model);
        id = parsed.modelID || parsed.id || String(parsed);
      } catch {
        id = row.model;
      }
    }
    if (id) {
      const entry = costMap.get(id) || { totalCost: 0, count: 0 };
      entry.totalCost += row.cost;
      entry.count++;
      costMap.set(id, entry);
    }
  }

  return Array.from(costMap.entries())
    .sort((a, b) => b[1].totalCost - a[1].totalCost)
    .slice(0, limit)
    .map(([model, { totalCost, count }]) => ({
      model,
      totalCost,
      sessionCount: count,
    }));
}

/**
 * Return top N agents by session count.
 */
export function getTopAgents(db: Database, limit: number = 8): AgentStat[] {
  const rows = convertRow(
    db.prepare(`
    SELECT agent, COUNT(*) AS count FROM session
    WHERE agent IS NOT NULL AND agent != ''
    GROUP BY agent ORDER BY count DESC LIMIT ?
  `).all(limit),
  ) as { agent: string; count: number }[];
  return rows;
}

/**
 * Return top N providers by session count.
 * Parses model JSON to extract providerID.
 */
export function getTopProviders(
  db: Database,
  limit: number = 10,
  names?: string[],
): ProviderStat[] {
  const df = dirFilter(names);
  const allModels = convertRow(
    db.prepare(
      "SELECT model FROM session WHERE model IS NOT NULL AND model != ''" +
        df.and,
    ).all(...df.params) as { model: unknown }[],
  ) as { model: unknown }[];

  const providerCounts = new Map<string, number>();
  for (const row of allModels) {
    let id = "";
    if (typeof row.model === "string") {
      try {
        const parsed = JSON.parse(row.model);
        id = parsed.providerID || parsed.provider || String(parsed);
      } catch {
        id = row.model;
      }
    }
    if (id) providerCounts.set(id, (providerCounts.get(id) || 0) + 1);
  }

  return Array.from(providerCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([provider, count]) => ({ provider, count }));
}

/**
 * Return sessions whose directory matches a LIKE pattern.
 */
export function getSessionsByDirectory(
  db: Database,
  pathPattern: string,
): SessionListRow[] {
  const pattern = `%${pathPattern}%`;
  return convertRow(
    db.prepare(`
    SELECT
      s.id,
      s.title,
      s.directory,
      s.time_created,
      s.time_archived,
      s.tokens_input,
      s.tokens_output,
      s.tokens_reasoning,
      s.parent_id,
      (SELECT COUNT(*) FROM message m WHERE m.session_id = s.id) AS message_count
    FROM session s
    WHERE s.directory LIKE ?
    ORDER BY s.time_created DESC
  `).all(pattern),
  ) as SessionListRow[];
}

/**
 * Return full detail for a single session by ID.
 * Throws if sessionId is empty or session is not found.
 */
export function getSessionDetail(
  db: Database,
  sessionId: string,
): SessionDetail {
  if (!sessionId || sessionId.trim().length === 0) {
    throw new Error("sessionId must be a non-empty string");
  }

  const session = convertRow(
    db.prepare("SELECT * FROM session WHERE id = ?").get(sessionId),
  ) as SessionRow | undefined;

  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const messageCount = convertRow(
    db.prepare("SELECT COUNT(*) AS c FROM message WHERE session_id = ?").get(
      sessionId,
    ) as {
      c: number;
    },
  ).c;

  const todoRows = convertRow(
    db.prepare(
      "SELECT * FROM todo WHERE session_id = ?",
    ).all(sessionId),
  ) as TodoRow[];

  const todos: TodoSummary = {
    completed: todoRows.filter((t) => t.status === "completed").length,
    in_progress: todoRows.filter((t) => t.status === "in_progress").length,
    pending: todoRows.filter((t) => t.status === "pending").length,
    total: todoRows.length,
  };

  return { session, message_count: messageCount, todos };
}

/**
 * Search sessions by title or directory (LIKE match).
 */
export function searchSessions(
  db: Database,
  query: string,
): SessionListRow[] {
  const pattern = `%${query}%`;
  return convertRow(
    db.prepare(`
    SELECT
      s.id,
      s.title,
      s.directory,
      s.time_created,
      s.time_archived,
      s.tokens_input,
      s.tokens_output,
      s.tokens_reasoning,
      s.parent_id,
      (SELECT COUNT(*) FROM message m WHERE m.session_id = s.id) AS message_count
    FROM session s
    WHERE s.title LIKE ? OR s.directory LIKE ?
    ORDER BY s.time_created DESC
  `).all(pattern, pattern),
  ) as SessionListRow[];
}
