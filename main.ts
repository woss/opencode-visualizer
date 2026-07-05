import { Command } from "@cliffy/command";
import { resolve } from "@std/path";
import {
  getDbStats,
  getDirectoryOverview,
  getSessionDetail,
  getSessionsByDirectory,
  openDb,
  renameDirectory,
  searchSessions,
} from "./lib/db.ts";
import { showDashboard } from "./lib/dashboard.ts";
import { createMcpServer } from "./lib/mcp.ts";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { showSpinner } from "./lib/spinner.ts";
import { getOcvLogger, initLogger } from "./lib/logger.ts";
import { VERSION } from "./version.ts";
import {
  formatDbStats,
  formatOverview,
  formatRenameResult,
  formatSearchResults,
  formatSessionDetail,
  formatSessionList,
} from "./lib/format.ts";

/**
 * Resolve the opencode DB path from environment or default.
 */
function resolveDbPath(): string {
  const envPath = Deno.env.get("OPENCODE_DB_PATH");
  if (envPath) return resolve(envPath);

  const home = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE");
  if (!home) {
    throw new Error(
      "Cannot determine home directory. Set OPENCODE_DB_PATH explicitly.",
    );
  }

  return resolve(home, ".local/share/opencode/opencode.db");
}

/**
 * Format output as JSON or use the provided text formatter.
 */
function formatOutput<T>(
  data: T,
  format: string,
  formatter: (d: T) => string,
): void {
  if (format === "json") {
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.log(formatter(data));
  }
}

/**
 * Main entry point.
 */
async function main() {
  const dbPath = resolveDbPath();
  await initLogger();

  // Single path arg → show dashboard filtered to that directory
  const firstArg = Deno.args[0];
  if (
    Deno.args.length >= 1 &&
    (firstArg === "." || firstArg === ".." ||
      firstArg.startsWith("./") || firstArg.startsWith("../") ||
      firstArg.startsWith("/") || firstArg.startsWith("~"))
  ) {
    // Detect --output json from remaining args
    let jsonMode = false;
    for (let i = 1; i < Deno.args.length; i++) {
      const a = Deno.args[i];
      if (a === "--output" || a === "-o") {
        if (i + 1 < Deno.args.length && Deno.args[i + 1] === "json") {
          jsonMode = true;
        }
        break;
      }
      if (a.startsWith("--output=")) {
        jsonMode = a.slice(9) === "json";
        break;
      }
    }

    const abs = resolve(firstArg);
    const dirName = abs.split("/").pop() || abs;
    await showDashboard(dbPath, {
      top: 10,
      all: false,
      names: [dirName],
      jsonMode,
      mergeSameNames: true,
    });
    return;
  }

  // No args → show dashboard (default behavior)
  if (Deno.args.length === 0) {
    await showDashboard(dbPath, { top: 10, all: false, jsonMode: false });
    return;
  }

  await new Command()
    .name("opencode-visualizer")
    .version(VERSION)
    .description(
      "OpenCode database visualizer and analytics. Reads ~/.local/share/opencode/opencode.db",
    )
    .globalOption(
      "-o, --output <format:string>",
      "Output format: text (default) or json",
      { default: "text" },
    )
    .command("dash", "Interactive dashboard with charts and stats")
    .option("--top <n:number>", "Show top N items per section", { default: 10 })
    .option("--all", "Show all items instead of top N")
    .option(
      "--exclude <dirs:string>",
      "Exclude directories (comma-separated names)",
    )
    .option(
      "--name <dirs:string>",
      "Filter all panels to specific directories (comma-separated names)",
    )
    .option(
      "--merge-same-names",
      "Merge directories with same basename into one row",
    )
    .action(async (options) => {
      const names = options.name
        ? options.name.split(",").map((n: string) => n.trim()).filter((
          n: string,
        ) => n.length > 0)
        : undefined;
      await showDashboard(dbPath, {
        top: options.top ?? 10,
        all: options.all ?? false,
        exclude: options.exclude,
        names,
        jsonMode: options.output === "json",
        mergeSameNames: options.mergeSameNames ?? false,
      });
    })
    .command("sessions", "List sessions matching a directory path pattern")
    .arguments("<path:string>")
    .action((options, path: string) => {
      const spinner = showSpinner("Loading data...");
      try {
        const db = openDb(dbPath);
        const rows = getSessionsByDirectory(db, path);
        spinner.stop();
        formatOutput(rows, options.output, formatSessionList);
        db.close();
      } catch (cause) {
        spinner.stop();
        getOcvLogger().error("Command failed: {command}", {
          command: "sessions",
          cause: String(cause),
        });
        Deno.exit(1);
      }
    })
    .command("session", "Show detailed info for a single session")
    .arguments("<id:string>")
    .action((options, id: string) => {
      const spinner = showSpinner("Loading data...");
      try {
        const db = openDb(dbPath);
        const detail = getSessionDetail(db, id);
        spinner.stop();
        if (options.output === "json") {
          console.log(JSON.stringify(detail, null, 2));
        } else {
          console.log(
            formatSessionDetail(
              detail.session,
              detail.message_count,
              detail.todos,
            ),
          );
        }
        db.close();
      } catch (cause) {
        spinner.stop();
        getOcvLogger().error("Command failed: {command}", {
          command: "session",
          cause: String(cause),
        });
        Deno.exit(1);
      }
    })
    .command("search", "Search sessions by title or directory")
    .arguments("<query:string>")
    .action((options, query: string) => {
      const spinner = showSpinner("Loading data...");
      try {
        const db = openDb(dbPath);
        const rows = searchSessions(db, query);
        spinner.stop();
        formatOutput(rows, options.output, formatSearchResults);
        db.close();
      } catch (cause) {
        spinner.stop();
        getOcvLogger().error("Command failed: {command}", {
          command: "search",
          cause: String(cause),
        });
        Deno.exit(1);
      }
    })
    .command("rename", "Rename session directory (batch)")
    .option(
      "--from-dir <dir:string>",
      "Current directory path to match",
      { required: true },
    )
    .option(
      "-d, --directory <dir:string>",
      "New directory path",
      { required: true },
    )
    .action((options) => {
      const spinner = showSpinner("Renaming sessions...");
      try {
        const db = openDb(dbPath, false);
        const result = renameDirectory(db, options.fromDir, options.directory);
        spinner.stop();
        formatOutput(result, options.output, formatRenameResult);
        db.close();
      } catch (cause) {
        spinner.stop();
        getOcvLogger().error("Command failed: {command}", {
          command: "rename",
          cause: String(cause),
        });
        Deno.exit(1);
      }
    })
    .command("stats", "Show overall database statistics")
    .action(async (options) => {
      const spinner = showSpinner("Loading data...");
      try {
        const db = openDb(dbPath);
        const stats = await getDbStats(db, dbPath);
        spinner.stop();
        if (options.output === "json") {
          console.log(JSON.stringify(stats, null, 2));
        } else {
          console.log(formatDbStats(stats));
        }
        db.close();
      } catch (cause) {
        spinner.stop();
        getOcvLogger().error("Command failed: {command}", {
          command: "stats",
          cause: String(cause),
        });
        Deno.exit(1);
      }
    })
    .command("overview", "Show per-directory session overview table")
    .action((options) => {
      const spinner = showSpinner("Loading data...");
      try {
        const db = openDb(dbPath);
        const rows = getDirectoryOverview(db);
        spinner.stop();
        formatOutput(rows, options.output, formatOverview);
        db.close();
      } catch (cause) {
        spinner.stop();
        getOcvLogger().error("Command failed: {command}", {
          command: "overview",
          cause: String(cause),
        });
        Deno.exit(1);
      }
    })
    .command("mcp", "Start MCP stdio server for LLM tool access")
    .action(async () => {
      try {
        const server = createMcpServer(dbPath);
        const transport = new StdioServerTransport();
        await server.connect(transport);
      } catch (cause) {
        getOcvLogger().error("Command failed: {command}", {
          command: "mcp",
          cause: String(cause),
        });
        Deno.exit(1);
      }
    })
    .parse(Deno.args);
}

if (import.meta.main) {
  main();
}
