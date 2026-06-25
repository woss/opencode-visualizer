import {
  getDbStats,
  getDirectoryOverview,
  getModelCosts,
  getSessionsByWeek,
  getTopModels,
  getTopProviders,
  openDb,
} from "./db.ts";
import { showSpinner } from "./spinner.ts";
import * as A from "./ansi.ts";
import { isIgnoredByName, loadOcvignore } from "./ignore.ts";

// ── Box-drawing helpers ──────────────────────────────────────────

function styled(text: string, color: string): string {
  return `${color}${text}${A.RESET}`;
}

/** Full-width line: V + content + V  (total = W) */
function fullLine(text: string, w: number): string {
  return styled(A.V, A.CYAN) + A.pad(text, w) + styled(A.V, A.CYAN);
}

/** Split line: V + left + V + right + V  (total = W) */
function splitLine(
  left: string,
  right: string,
  lw: number,
  rw: number,
): string {
  return styled(A.V, A.CYAN) + A.pad(left, lw) +
    styled(A.V, A.CYAN) + A.pad(right, rw) +
    styled(A.V, A.CYAN);
}

/** Split separator: LM + H*L + TM + H*R + RM */
function splitSep(lw: number, rw: number): string {
  return styled(A.LM + A.H.repeat(lw) + A.TM + A.H.repeat(rw) + A.RM, A.CYAN);
}

/** Bottom border: BL + H*L + BM + H*R + BR */
function bottomBorder(lw: number, rw: number): string {
  return styled(A.BL + A.H.repeat(lw) + A.BM + A.H.repeat(rw) + A.BR, A.CYAN);
}

/**
 * Row with horizontal bar: "  label    value ████████░░░░"
 * label is dimmed, value is bold, bar uses given color.
 */
function rowWithBar(
  label: string,
  value: number,
  maxValue: number,
  panelW: number,
  labelW: number,
  barColor: string,
): string {
  const prefix = "  ";
  const valStr = A.fmtNum(value).padStart(7);
  const lbl = label.length > labelW
    ? label.slice(0, labelW - 1) + "\u2026"
    : label.padEnd(labelW);
  const barW = Math.max(
    0,
    panelW - prefix.length - lbl.length - 1 - valStr.length - 1,
  );
  const barStr = barW > 0 ? A.barColored(value, maxValue, barW, barColor) : "";
  return prefix + A.DIM + lbl + A.RESET + " " + A.BOLD + valStr + A.RESET +
    " " + barStr;
}

/** Row with dual-colored bar: main sessions in mainColor, sub in subColor */
function rowWithDualBar(
  label: string,
  mainVal: number,
  subVal: number,
  maxValue: number,
  panelW: number,
  labelW: number,
  mainColor: string,
  subColor: string,
): string {
  const prefix = "  ";
  const total = mainVal + subVal;
  const valStr = A.fmtNum(total).padStart(7);
  const lbl = label.length > labelW
    ? label.slice(0, labelW - 1) + "\u2026"
    : label.padEnd(labelW);
  const barW = Math.max(
    0,
    panelW - prefix.length - lbl.length - 1 - valStr.length - 1,
  );
  const barStr = barW > 0
    ? A.barDualColored(mainVal, subVal, maxValue, barW, mainColor, subColor)
    : "";
  return prefix + A.DIM + lbl + A.RESET + " " + A.BOLD + valStr + A.RESET +
    " " + barStr;
}

/** Format a Unix timestamp (ms) as ISO week label like "2026-W22". */
function formatWeekLabel(weekStart: number): string {
  const d = new Date(weekStart);
  const year = d.getFullYear();
  const start = new Date(year, 0, 1);
  const diff = d.getTime() - start.getTime();
  const dayOffset = (start.getDay() + 6) % 7; // Monday as first day
  const week = Math.ceil((diff / 86400000 + dayOffset + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

// ── Dashboard Options ────────────────────────────────────────────

export interface DashOptions {
  top: number;
  all: boolean;
  exclude?: string;
  names?: string[];
  jsonMode: boolean;
  mergeSameNames?: boolean;
}

// ── Dashboard ────────────────────────────────────────────────────

export async function showDashboard(
  dbPath: string,
  opts: DashOptions,
): Promise<void> {
  const spinner = showSpinner("Loading session data...");
  const db = openDb(dbPath);

  const topCount = opts.all ? 9999 : Math.max(1, opts.top);

  // When --name is used, directory section adapts to exactly the number of named dirs
  const filterNames = opts.names && opts.names.length > 0
    ? opts.names
    : undefined;

  // Parse --exclude flag (comma-separated directory names)
  const excludedDirs = new Set<string>();
  if (opts.exclude) {
    for (const name of opts.exclude.split(",")) {
      const trimmed = name.trim();
      if (trimmed) excludedDirs.add(trimmed);
    }
  }

  const stats = await getDbStats(db, dbPath, filterNames);

  // Load .ocvignore patterns
  const ignoreRules = loadOcvignore();

  let overview = getDirectoryOverview(db);
  if (excludedDirs.size > 0 || ignoreRules.excludes.length > 0 || filterNames) {
    overview = overview.filter((r) => {
      const shortName = r.directory.split("/").pop() || r.directory;
      // Inclusion filter (--name)
      if (
        filterNames && !filterNames.includes(shortName) &&
        !filterNames.includes(r.directory)
      ) return false;
      // Exclusion filters (--exclude + .ocvignore)
      if (excludedDirs.has(r.directory) || excludedDirs.has(shortName)) {
        return false;
      }
      if (isIgnoredByName(shortName, ignoreRules)) return false;
      if (isIgnoredByName(r.directory, ignoreRules)) return false;
      return true;
    });
  }

  // Merge directories with same basename into a single row
  if (opts.mergeSameNames) {
    const merged = new Map<string, typeof overview[0]>();
    for (const row of overview) {
      const name = row.directory.split("/").pop() || row.directory;
      const existing = merged.get(name);
      if (existing) {
        existing.total += row.total;
        existing.active += row.active;
        existing.main_count += row.main_count;
        existing.sub_count += row.sub_count;
        existing.tokens_input += row.tokens_input;
        existing.tokens_output += row.tokens_output;
        existing.tokens_reasoning += row.tokens_reasoning;
        existing.tokens_cache_read += row.tokens_cache_read;
        existing.tokens_cache_write += row.tokens_cache_write;
        existing.cost += row.cost;
        existing.last_active = Math.max(existing.last_active, row.last_active);
      } else {
        merged.set(name, { ...row, directory: name });
      }
    }
    overview = Array.from(merged.values())
      .sort((a, b) => b.total - a.total);
  }
  const weekly = getSessionsByWeek(db, filterNames);
  const topModels = getTopModels(db, topCount, filterNames);
  const topProviders = getTopProviders(db, topCount, filterNames);
  const modelCosts = getModelCosts(db, topCount, filterNames);

  // JSON output mode — dump all raw data and return early
  if (opts.jsonMode) {
    spinner.stop();
    db.close();
    console.log(JSON.stringify(
      {
        stats,
        directories: overview,
        weekly,
        models: topModels,
        providers: topProviders,
        modelCosts,
      },
      null,
      2,
    ));
    return;
  }

  // Detect terminal width
  let termWidth = 80;
  try {
    termWidth = Deno.consoleSize().columns;
  } catch {
    /* fallback */
  }
  const W = Math.max(60, termWidth);
  const inner = W - 2;
  const splitInner = W - 3;
  const leftW = Math.floor(splitInner * 0.6);
  const rightW = splitInner - leftW;
  const leftTextW = Math.max(10, leftW - 2);
  const rightTextW = Math.max(10, rightW - 2);

  // ── Prepare directory data ───────────────────────────────

  const dirTopCount = filterNames ? filterNames.length : topCount;
  const maxDisplay = filterNames ? overview.length : dirTopCount;
  const hasMore = !filterNames && overview.length > maxDisplay;
  const displayList = hasMore
    ? overview.slice(0, maxDisplay - 1).concat({
      ...overview[maxDisplay - 1],
      directory: "...",
      main_count: 0,
      sub_count: 0,
    })
    : overview.slice(0, maxDisplay);

  const totalActive = overview.reduce((s, r) => s + r.active, 0);
  const activePct = stats.sessions > 0
    ? Math.round((totalActive / stats.sessions) * 100)
    : 0;

  const dirLabels = displayList.map((r) =>
    r.directory.split("/").pop() || r.directory
  );
  const dirLabelW = Math.min(
    24,
    Math.max(4, leftTextW - 12),
    Math.max(4, ...dirLabels.map((l) => l.length)),
  );

  const modelLabels = topModels.map((m) => m.model);
  const modelLabelW = Math.min(
    24,
    Math.max(4, rightTextW - 12),
    Math.max(4, ...modelLabels.map((l) => l.length)),
  );

  const provLabels = topProviders.map((p) => p.provider);
  const provLabelW = Math.min(
    24,
    Math.max(4, rightTextW - 12),
    Math.max(4, ...provLabels.map((l) => l.length)),
  );

  const costLabels = modelCosts.map((m) => m.model);
  const costLabelW = Math.min(
    24,
    Math.max(4, rightTextW - 12),
    Math.max(4, ...costLabels.map((l) => l.length)),
  );

  // ── Token data ───────────────────────────────────────────

  const tokenData: [string, string][] = [
    ["Input", A.fmtNum(stats.tokens_input)],
    ["Output", A.fmtNum(stats.tokens_output)],
    ["Reasoning", A.fmtNum(stats.tokens_reasoning)],
    ["Cache Read", A.fmtNum(stats.tokens_cache_read)],
    ["Cache Write", A.fmtNum(stats.tokens_cache_write)],
    ["Cost", `${A.YELLOW}$${stats.total_cost.toFixed(2)}${A.RESET}`],
  ];

  // ── Build lines ──────────────────────────────────────────

  const lines: string[] = [];

  // Top border
  lines.push(styled(A.TL + A.H.repeat(inner) + A.TR, A.CYAN));

  // Header
  const headerText = `  \u25CF ${A.BOLD}OpenCode Visualizer${A.RESET}   ${
    A.fmtNum(stats.sessions)
  } sessions \u00B7 ${activePct}% active \u00B7 ${stats.projects} projects \u00B7 $${
    stats.total_cost.toFixed(2)
  } \u00B7 DB size: ${A.fmtBinaryBytes(stats.dbSize)}`;
  lines.push(fullLine(headerText, inner));

  // Split separator after header
  lines.push(splitSep(leftW, rightW));

  // Section 1 labels — Sessions per Directory | Models
  const dirCountLabel = filterNames
    ? `${filterNames.length} (filtered)`
    : (opts.all ? "All" : `Top ${Math.min(maxDisplay, overview.length)}`);
  const dirLabel = A.CYAN + A.BOLD +
    ` Sessions per Directory (${dirCountLabel}) ` + A.RESET;
  const modelCountLabel = opts.all ? "All" : `Top ${topModels.length}`;
  const modelLabel = A.CYAN + A.BOLD + ` Models (${modelCountLabel}) ` +
    A.RESET;
  lines.push(splitLine(dirLabel, modelLabel, leftW, rightW));

  // Color legend for directory section
  const dirLegend = "  " + A.BLUE + A.BOLD + "\u2588" + A.RESET + " main  " +
    A.CYAN + A.BOLD + "\u2588" + A.RESET + " sub";
  lines.push(splitLine(dirLegend, "", leftW, rightW));

  // Directory + Model rows with horizontal bars
  const dirMaxValue = overview[0]?.total || 1;
  const modelMaxValue = topModels[0]?.count || 1;
  const topSectionRows = Math.max(displayList.length, topModels.length);
  for (let i = 0; i < topSectionRows; i++) {
    const leftContent = i < displayList.length
      ? rowWithDualBar(
        dirLabels[i],
        displayList[i].main_count,
        displayList[i].sub_count,
        dirMaxValue,
        leftTextW,
        dirLabelW,
        A.BLUE,
        A.CYAN,
      )
      : "";
    const rightContent = i < topModels.length
      ? rowWithBar(
        modelLabels[i],
        topModels[i].count,
        modelMaxValue,
        rightTextW,
        modelLabelW,
        A.YELLOW,
      )
      : "";
    lines.push(splitLine(leftContent, rightContent, leftW, rightW));
  }

  // Split separator after header section
  lines.push(splitSep(leftW, rightW));

  // Section labels — Token Summary | Top Models by Cost
  const tokenCostCountLabel = opts.all ? "All" : `Top ${modelCosts.length}`;
  const tokenLabel = A.CYAN + A.BOLD + " Token Summary " + A.RESET;
  const costLabel = A.CYAN + A.BOLD +
    ` Models by Cost (${tokenCostCountLabel}) ` + A.RESET;
  lines.push(splitLine(tokenLabel, costLabel, leftW, rightW));

  // Token data (left) + Model cost rows (right)
  const costMaxValue = modelCosts[0]?.totalCost || 1;
  const costRowCount = Math.max(tokenData.length, modelCosts.length);
  for (let i = 0; i < costRowCount; i++) {
    const leftContent = i < tokenData.length
      ? "  " + tokenData[i][0].padEnd(12) + " " + tokenData[i][1]
      : "";
    const costRowBarW = Math.max(0, rightTextW - 2 - costLabelW - 1 - 8 - 1);
    const rightContent = i < modelCosts.length
      ? "  " + (modelCosts[i].model.length > costLabelW
        ? modelCosts[i].model.slice(0, costLabelW - 1) + "\u2026"
        : modelCosts[i].model.padEnd(costLabelW)) +
        " " + A.BOLD + "$" + modelCosts[i].totalCost.toFixed(2).padStart(6) +
        A.RESET +
        " " + (costMaxValue > 0
          ? A.barColored(
            modelCosts[i].totalCost,
            costMaxValue,
            costRowBarW,
            A.GREEN,
          )
          : "")
      : "";
    lines.push(splitLine(leftContent, rightContent, leftW, rightW));
  }

  // Split separator (token summary → weekly + providers)
  lines.push(splitSep(leftW, rightW));

  // Section labels — Weekly Activity | Providers
  const weeklyLabel = A.CYAN + A.BOLD + " Weekly Activity " + A.RESET;
  const provCountLabel = opts.all ? "All" : `Top ${topProviders.length}`;
  const provLabel = A.CYAN + A.BOLD + ` Providers (${provCountLabel}) ` +
    A.RESET;
  lines.push(splitLine(weeklyLabel, provLabel, leftW, rightW));

  // Weekly rows (left) + Provider rows (right)
  const weeklyMax = Math.max(...weekly.map((w) => w.count), 1);
  const provMaxValue = topProviders[0]?.count || 1;
  const weeklyRows = weekly.slice(0, 30);
  const bottomRows = Math.max(weeklyRows.length, topProviders.length);

  for (let i = 0; i < bottomRows; i++) {
    let leftContent = "";
    if (i < weeklyRows.length) {
      const r = weeklyRows[i];
      const weekLabel = formatWeekLabel(r.weekStart);
      const countStr = A.fmtNum(r.count);
      const barW = Math.max(0, leftTextW - 2 - 9 - 1 - 7 - 1);
      const barStr = barW > 0
        ? A.barColored(r.count, weeklyMax, barW, A.CYAN)
        : "";
      leftContent = "  " + weekLabel.padEnd(9) + " " + A.BOLD +
        countStr.padStart(7) + A.RESET + " " + barStr;
    }

    let rightContent = "";
    if (i < topProviders.length) {
      rightContent = rowWithBar(
        provLabels[i],
        topProviders[i].count,
        provMaxValue,
        rightTextW,
        provLabelW,
        A.MAGENTA,
      );
    }

    lines.push(splitLine(leftContent, rightContent, leftW, rightW));
  }

  // Bottom border
  lines.push(bottomBorder(leftW, rightW));

  // ── Output ───────────────────────────────────────────────
  spinner.stop();
  console.clear();
  console.log(lines.join("\n"));
  db.close();
}
