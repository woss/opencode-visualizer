import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { CallToolRequest } from "@modelcontextprotocol/sdk/types.js";
import {
  CallToolRequestSchema,
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
    { capabilities: { tools: {} } },
  );

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
          properties: {},
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
    ],
  }));

  server.setRequestHandler(
    CallToolRequestSchema,
    async (request: CallToolRequest) => {
      const { name, arguments: args } = request.params;
      const db = openDb(dbPath);
      try {
        let result: unknown;
        switch (name) {
          case "get_stats":
            result = await getDbStats(db, dbPath);
            break;
          case "get_overview":
            result = getDirectoryOverview(db);
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
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: String(error) }],
        };
      } finally {
        db.close();
      }
    },
  );

  console.error("ocv MCP server started");

  return server;
}
