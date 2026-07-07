import { getLogger } from "@logtape/logtape";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type {
  CallToolRequest,
  GetPromptRequest,
} from "@modelcontextprotocol/sdk/types.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  getDbStats,
  getDirectoryOverview,
  getSessionDetail,
  getSessionsByDirectory,
  getSessionsByWeek,
  getTopModels,
  getTopProviders,
  openDb,
  searchSessions,
} from "./db.ts";
import { computeProjections } from "./pricing.ts";
import { VERSION } from "../version.ts";

export function createMcpServer(dbPath: string): Server {
  // Health check: verify DB is accessible before accepting tool calls
  const healthDb = openDb(dbPath);
  try {
    healthDb.prepare("SELECT 1").get();
  } catch (cause) {
    healthDb.close();
    throw new Error(`Cannot open database at ${dbPath}: ${cause}`);
  } finally {
    healthDb.close();
  }

  const server = new Server(
    { name: "ocv", version: VERSION },
    { capabilities: { tools: {}, prompts: {} } },
  );

  const logger = getLogger(["ocv", "mcp"]);

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [
      {
        name: "get_stats",
        description:
          "Get overall database statistics including token counts, session counts, and cost",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      {
        name: "get_overview",
        description: "Get per-directory session overview with aggregate stats",
        inputSchema: {
          type: "object",
          properties: {
            directory: {
              type: "string",
              description: "Optional. Filter to one directory. Omit for all.",
            },
          },
          required: [],
        },
      },
      {
        name: "list_sessions",
        description: "List sessions matching a directory path pattern",
        inputSchema: {
          type: "object",
          properties: {
            directory: {
              type: "string",
              description:
                "Directory path pattern to match (e.g. 'my-project')",
            },
          },
          required: ["directory"],
        },
      },
      {
        name: "get_session",
        description: "Get detailed info for a single session by ID",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Session ID",
            },
          },
          required: ["id"],
        },
      },
      {
        name: "search_sessions",
        description: "Search sessions by title or directory name",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description:
                "Search query to match against session titles or directories",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "get_top_models",
        description: "Get top models by session count",
        inputSchema: {
          type: "object",
          properties: {
            limit: {
              type: "number",
              description: "Number of top models to return (default: 10)",
              minimum: 1,
            },
          },
          required: [],
        },
      },
      {
        name: "get_top_providers",
        description: "Get top providers by session count",
        inputSchema: {
          type: "object",
          properties: {
            limit: {
              type: "number",
              description: "Number of top providers to return (default: 10)",
              minimum: 1,
            },
          },
          required: [],
        },
      },
      {
        name: "get_weekly_activity",
        description: "Get session counts grouped by weekly buckets",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      {
        name: "project_cost",
        description:
          "Compute projected costs for a project across Zen models. Takes token counts and returns cost projections per model.",
        inputSchema: {
          type: "object",
          properties: {
            tokens_input: {
              type: "number",
              description: "Total input tokens",
            },
            tokens_output: {
              type: "number",
              description: "Total output tokens",
            },
            tokens_cache_read: {
              type: "number",
              description: "Total cache read tokens",
            },
            tokens_cache_write: {
              type: "number",
              description: "Total cache write tokens",
            },
            actual_cost: {
              type: "number",
              description: "Actual cost from the database",
            },
          },
          required: [
            "tokens_input",
            "tokens_output",
            "tokens_cache_read",
            "tokens_cache_write",
            "actual_cost",
          ],
        },
      },
    ],
  }));

  // ListPromptsRequestSchema handler is registered below with logging
  server.setRequestHandler(
    GetPromptRequestSchema,
    (request: GetPromptRequest) => {
      const dirArg = request.params.arguments?.directory;
      logger.info("prompt request", {
        prompt: request.params.name,
        dirArg: typeof dirArg === "string"
          ? (dirArg.length > 0 ? dirArg : "(empty)")
          : undefined,
      });
      const dirHint = typeof dirArg === "string" && dirArg.length > 0
        ? dirArg === "all"
          ? "The user asked for all directories. Call `get_overview` without the directory parameter."
          : `The user provided directory: "${dirArg}". Use this directly.`
        : 'The current project directory is "/Users/woss/projects/woss/opencode-visualizer". Use this directly.';

      if (request.params.name === "token-stats") {
        return {
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text:
                  `You have access to the ocv MCP server which provides data from the opencode SQLite database.

## Task: Show token usage statistics for a project

1. **Detect the project directory**
   ${dirHint}

2. **Call the \`get_overview\` MCP tool**
   - Call it with the directory you detected.
   - If you cannot determine a directory, call \`get_overview\` without the directory parameter to get all directories and display them all.

3. **Format the result as a table**
   Use markdown with these columns:
   - **Directory** — the project directory
   - **Sessions** — total session count
   - **Input Tokens** — token count for input
   - **Output Tokens** — token count for output
   - **Reasoning Tokens** — token count for reasoning
   - **Cache Read** — cache read tokens
   - **Cache Write** — cache write tokens
   - **Cost ($)** — the actual cost from the database

4. **Display** — present the table clearly to the user. If there are multiple directories, show all.`,
              },
            },
          ],
        };
      }

      if (request.params.name === "cost-project") {
        return {
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: `You have access to the ocv MCP server.

## Task: Show projected costs across Zen models

1. **Detect the directory**: ${dirHint}

2. **Call \`get_overview\`** to get token counts.

3. **Call \`project_cost\`** with the token counts and actual cost from step 2.

4. **Format the result as a table** with columns:
   | Model | Input Cost | Output Cost | Cache Cost | Projected Total | vs Actual |

   Sort by Projected Total ascending. Keep the "Actual" row at the top.`,
              },
            },
          ],
        };
      }

      throw new Error(`Unknown prompt: ${request.params.name}`);
    },
  );

  server.setRequestHandler(
    CallToolRequestSchema,
    async (request: CallToolRequest) => {
      const { name, arguments: args } = request.params;
      logger.info("tool call", {
        tool: name,
        args: args ?? {},
      });
      const db = openDb(dbPath);
      try {
        let result: unknown;
        switch (name) {
          case "get_stats":
            result = await getDbStats(db, dbPath);
            break;
          case "get_overview":
            result = getDirectoryOverview(
              db,
              typeof args?.directory === "string" ? args.directory : undefined,
            );
            break;
          case "list_sessions":
            if (!args?.directory || typeof args.directory !== "string") {
              throw new Error("Missing required argument: directory");
            }
            result = getSessionsByDirectory(db, args.directory);
            break;
          case "get_session":
            if (!args?.id || typeof args.id !== "string") {
              throw new Error("Missing required argument: id");
            }
            result = getSessionDetail(db, args.id);
            break;
          case "search_sessions":
            if (!args?.query || typeof args.query !== "string") {
              throw new Error("Missing required argument: query");
            }
            result = searchSessions(db, args.query);
            break;
          case "get_top_models": {
            const limit = typeof args?.limit === "number"
              ? Math.max(1, Math.floor(args.limit))
              : 10;
            result = getTopModels(db, limit);
            break;
          }
          case "get_top_providers": {
            const limit = typeof args?.limit === "number"
              ? Math.max(1, Math.floor(args.limit))
              : 10;
            result = getTopProviders(db, limit);
            break;
          }
          case "get_weekly_activity":
            result = getSessionsByWeek(db);
            break;
          case "project_cost": {
            const a = args ?? {};
            if (
              typeof a.tokens_input !== "number" ||
              typeof a.tokens_output !== "number" ||
              typeof a.tokens_cache_read !== "number" ||
              typeof a.tokens_cache_write !== "number" ||
              typeof a.actual_cost !== "number"
            ) {
              throw new Error(
                "Missing or invalid arguments: tokens_input, tokens_output, tokens_cache_read, tokens_cache_write, actual_cost",
              );
            }
            result = computeProjections(
              a.tokens_input,
              a.tokens_output,
              a.tokens_cache_read,
              a.tokens_cache_write,
              a.actual_cost,
            );
            break;
          }
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
        logger.info("tool result", {
          tool: name,
          resultType: typeof result,
          isArray: Array.isArray(result),
          length: Array.isArray(result) ? result.length : undefined,
        });
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        logger.error("tool error", {
          tool: name,
          error: String(error),
        });
        return {
          isError: true,
          content: [{ type: "text", text: String(error) }],
        };
      } finally {
        db.close();
      }
    },
  );

  // Log prompt requests
  server.setRequestHandler(ListPromptsRequestSchema, () => {
    logger.debug("list prompts requested");
    return {
      prompts: [
        {
          name: "token-stats",
          description:
            "Show token usage statistics (input, output, cache reads) for your current project in a table",
          arguments: [
            {
              name: "directory",
              description:
                "Optional directory to filter by. If omitted, the current project directory will be detected.",
              required: false,
            },
          ],
        },
        {
          name: "cost-project",
          description:
            "Show projected costs for your current project across different Zen models, comparing to actual cost",
          arguments: [
            {
              name: "directory",
              description:
                "Optional directory to filter by. If omitted, the current project directory will be detected.",
              required: false,
            },
          ],
        },
      ],
    };
  });

  logger.info("ocv MCP server started");

  return server;
}
