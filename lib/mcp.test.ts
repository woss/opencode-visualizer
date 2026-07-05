// deno-lint-ignore-file no-import-prefix

import {
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "jsr:@std/assert@^1.0.0";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "./mcp.ts";
import { openDb } from "./db.ts";

/**
 * Helper: create a temporary SQLite DB with the session table and one row.
 * Uses openDb with readonly=false first so the DB is in WAL journal mode,
 * which is required for createMcpServer's readonly open to succeed.
 */
function createTempDb(): { path: string; cleanup: () => void } {
  const path = Deno.makeTempFileSync({ suffix: ".db" });
  const db = openDb(path, false);
  // getDbStats queries project, session, message, part, and todo tables
  db.exec(`
    CREATE TABLE project (id TEXT PRIMARY KEY, worktree TEXT);
    CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT);
    CREATE TABLE part (id TEXT PRIMARY KEY, session_id TEXT);
    CREATE TABLE todo (id TEXT PRIMARY KEY, session_id TEXT);
    CREATE TABLE session (
      id TEXT PRIMARY KEY,
      directory TEXT NOT NULL,
      parent_id TEXT,
      time_archived INTEGER,
      tokens_input INTEGER DEFAULT 0,
      tokens_output INTEGER DEFAULT 0,
      tokens_reasoning INTEGER DEFAULT 0,
      tokens_cache_read INTEGER DEFAULT 0,
      tokens_cache_write INTEGER DEFAULT 0,
      cost REAL DEFAULT 0,
      time_created INTEGER,
      version TEXT,
      model TEXT
    )
  `);
  db.prepare(
    `INSERT INTO session (id, directory, parent_id, time_archived, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write, cost, time_created)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("test1", "test-proj", null, null, 1000, 500, 100, 200, 50, 0.05, 1000);
  db.close();
  return {
    path,
    cleanup: () => {
      for (const ext of ["", "-wal", "-shm"]) {
        try {
          Deno.removeSync(path + ext);
        } catch { /* ignore */ }
      }
    },
  };
}

/**
 * Minimal JSON-RPC client over InMemoryTransport that handles request/response matching
 * and performs the MCP initialize handshake automatically.
 */
class TestMcpClient {
  private transport: InMemoryTransport;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private nextId = 1;

  constructor(transport: InMemoryTransport) {
    this.transport = transport;
    this.transport.onmessage = (message: Record<string, unknown>) => {
      const id = message.id as number;
      const handler = this.pending.get(id);
      if (!handler) return;
      if (message.error) {
        const err = message.error as { message?: string };
        handler.reject(new Error(err.message ?? "Unknown error"));
      } else {
        handler.resolve(message.result);
      }
      this.pending.delete(id);
    };
  }

  /** Send a JSON-RPC request and await the result. */
  async request(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++;
    const req = { jsonrpc: "2.0", id, method, params };
    const promise = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    await this.transport.send(req);
    return promise;
  }

  /** Send a one-way JSON-RPC notification. */
  async notify(method: string, params?: unknown): Promise<void> {
    await this.transport.send({ jsonrpc: "2.0", method, params } as never);
  }

  /** Perform the MCP initialization handshake. */
  async initialize(): Promise<void> {
    const result = await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test-client", version: "0.0.0" },
    }) as { protocolVersion: string };
    assertEquals(typeof result.protocolVersion, "string");
    await this.notify("notifications/initialized");
  }
}

/**
 * Set up a full server + client pair connected via InMemoryTransport.
 */
async function setup(): Promise<
  { client: TestMcpClient; cleanup: () => void }
> {
  const db = createTempDb();
  const server = createMcpServer(db.path);
  const [clientTransport, serverTransport] = InMemoryTransport
    .createLinkedPair();
  await server.connect(serverTransport);
  const client = new TestMcpClient(clientTransport);
  await client.initialize();
  return {
    client,
    cleanup: db.cleanup,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

Deno.test({
  name:
    "ListPromptsRequestSchema returns both prompts with correct names and descriptions",
  async fn() {
    const { client, cleanup } = await setup();
    try {
      const result = await client.request("prompts/list") as {
        prompts: unknown[];
      };
      assertExists(result);
      const prompts = result.prompts as Array<{
        name: string;
        description: string;
        arguments?: Array<{ name: string; required: boolean }>;
      }>;
      assertEquals(prompts.length, 2);

      const tokenStats = prompts.find((p) => p.name === "token-stats");
      assertExists(tokenStats, "token-stats prompt not found");
      assertStringIncludes(tokenStats.description, "token usage statistics");
      assertExists(tokenStats.arguments);
      assertEquals(tokenStats.arguments!.length, 1);
      assertEquals(tokenStats.arguments![0].name, "directory");
      assertEquals(tokenStats.arguments![0].required, false);

      const costProject = prompts.find((p) => p.name === "cost-project");
      assertExists(costProject, "cost-project prompt not found");
      assertStringIncludes(costProject.description, "projected costs");
      assertExists(costProject.arguments);
      assertEquals(costProject.arguments!.length, 1);
      assertEquals(costProject.arguments![0].name, "directory");
      assertEquals(costProject.arguments![0].required, false);
    } finally {
      cleanup();
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name:
    "GetPromptRequestSchema token-stats returns user message with get_overview instruction",
  async fn() {
    const { client, cleanup } = await setup();
    try {
      const result = await client.request("prompts/get", {
        name: "token-stats",
      }) as { messages: unknown[] };
      assertExists(result);
      assertEquals(result.messages.length, 1);
      const msg = result.messages[0] as {
        role: string;
        content: { type: string; text: string };
      };
      assertEquals(msg.role, "user");
      assertEquals(msg.content.type, "text");
      assertStringIncludes(msg.content.text, "get_overview");
      assertStringIncludes(msg.content.text, "Show token usage statistics");
      // Should contain the default current directory path
      assertStringIncludes(msg.content.text, "opencode-visualizer");
    } finally {
      cleanup();
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name:
    "GetPromptRequestSchema cost-project returns user message with get_overview and project_cost instructions",
  async fn() {
    const { client, cleanup } = await setup();
    try {
      const result = await client.request("prompts/get", {
        name: "cost-project",
      }) as { messages: unknown[] };
      assertExists(result);
      assertEquals(result.messages.length, 1);
      const msg = result.messages[0] as {
        role: string;
        content: { type: string; text: string };
      };
      assertEquals(msg.role, "user");
      assertEquals(msg.content.type, "text");
      assertStringIncludes(msg.content.text, "get_overview");
      assertStringIncludes(msg.content.text, "project_cost");
      assertStringIncludes(msg.content.text, "Projected Total");
      // Should not contain the old pricing fetch instructions
      assertEquals(
        msg.content.text.includes("https://opencode.ai/docs/zen/#pricing"),
        false,
      );
    } finally {
      cleanup();
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: "token-stats prompt passes directory argument when provided",
  async fn() {
    const { client, cleanup } = await setup();
    try {
      const result = await client.request("prompts/get", {
        name: "token-stats",
        arguments: { directory: "my-project" },
      }) as { messages: unknown[] };
      const msg = result.messages[0] as { content: { text: string } };
      assertStringIncludes(msg.content.text, "my-project");
      assertStringIncludes(msg.content.text, "The user provided directory");
    } finally {
      cleanup();
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: "cost-project prompt passes directory argument when provided",
  async fn() {
    const { client, cleanup } = await setup();
    try {
      const result = await client.request("prompts/get", {
        name: "cost-project",
        arguments: { directory: "another-dir" },
      }) as { messages: unknown[] };
      const msg = result.messages[0] as { content: { text: string } };
      assertStringIncludes(msg.content.text, "another-dir");
      assertStringIncludes(msg.content.text, "The user provided directory");
    } finally {
      cleanup();
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name:
    "token-stats prompt falls back to context inference when directory omitted",
  async fn() {
    const { client, cleanup } = await setup();
    try {
      const result = await client.request("prompts/get", {
        name: "token-stats",
        arguments: {},
      }) as { messages: unknown[] };
      const msg = result.messages[0] as { content: { text: string } };
      assertStringIncludes(msg.content.text, "current project directory");
      assertStringIncludes(msg.content.text, "opencode-visualizer");
    } finally {
      cleanup();
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name:
    "cost-project prompt falls back to context inference when directory omitted",
  async fn() {
    const { client, cleanup } = await setup();
    try {
      const result = await client.request("prompts/get", {
        name: "cost-project",
        arguments: {},
      }) as { messages: unknown[] };
      const msg = result.messages[0] as { content: { text: string } };
      assertStringIncludes(msg.content.text, "current project directory");
      assertStringIncludes(msg.content.text, "opencode-visualizer");
    } finally {
      cleanup();
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: "unknown prompt name throws error with correct message",
  async fn() {
    const { client, cleanup } = await setup();
    try {
      const result = await client.request("prompts/get", {
        name: "nonexistent-prompt",
      });
      // If we get here without error, fail
      assertEquals(
        true,
        false,
        "Expected error but got result: " + JSON.stringify(result),
      );
    } catch (e: unknown) {
      const err = e as Error;
      assertStringIncludes(err.message, "Unknown prompt");
      assertStringIncludes(err.message, "nonexistent-prompt");
    } finally {
      cleanup();
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: "ListToolsRequestSchema still returns all original tools",
  async fn() {
    const { client, cleanup } = await setup();
    try {
      const result = await client.request("tools/list") as { tools: unknown[] };
      assertExists(result);
      const tools = result.tools as Array<{ name: string }>;
      const toolNames = tools.map((t) => t.name);
      assertEquals(toolNames.includes("get_stats"), true);
      assertEquals(toolNames.includes("get_overview"), true);
      assertEquals(toolNames.includes("list_sessions"), true);
      assertEquals(toolNames.includes("get_session"), true);
      assertEquals(toolNames.includes("search_sessions"), true);
      assertEquals(toolNames.includes("get_top_models"), true);
      assertEquals(toolNames.includes("get_top_providers"), true);
      assertEquals(toolNames.includes("get_weekly_activity"), true);
      assertEquals(toolNames.includes("project_cost"), true);
      assertEquals(toolNames.length, 9);
    } finally {
      cleanup();
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: "CallToolRequestSchema get_overview still works via prompt tool call",
  async fn() {
    const { client, cleanup } = await setup();
    try {
      const result = await client.request("tools/call", {
        name: "get_overview",
      }) as { content: Array<{ text: string }> };
      assertExists(result);
      assertEquals(result.content.length, 1);
      const parsed = JSON.parse(result.content[0].text);
      assertEquals(Array.isArray(parsed), true);
      // Our test DB has one session in test-proj
      assertEquals(parsed.length, 1);
      assertEquals(parsed[0].directory, "test-proj");
    } finally {
      cleanup();
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: "CallToolRequestSchema get_stats still works",
  async fn() {
    const { client, cleanup } = await setup();
    try {
      const result = await client.request("tools/call", {
        name: "get_stats",
      }) as { content: Array<{ text: string }> };
      assertExists(result);
      const parsed = JSON.parse(result.content[0].text);
      assertEquals(typeof parsed.sessions, "number");
      assertEquals(parsed.sessions, 1);
    } finally {
      cleanup();
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name:
    "CallToolRequestSchema project_cost returns projections sorted with actual row first",
  async fn() {
    const { client, cleanup } = await setup();
    try {
      const result = await client.request("tools/call", {
        name: "project_cost",
        arguments: {
          tokens_input: 2_000_000,
          tokens_output: 500_000,
          tokens_cache_read: 100_000,
          tokens_cache_write: 0,
          actual_cost: 0.05,
        },
      }) as { content: Array<{ text: string }> };
      assertExists(result);
      const parsed = JSON.parse(result.content[0].text) as Array<{
        model: string;
        inputCost: number | null;
        outputCost: number | null;
        projectedTotal: number | null;
        vsActual: string | null;
      }>;
      assertEquals(Array.isArray(parsed), true);
      // First row is the actual cost reference
      assertEquals(parsed[0].model, "Actual");
      assertEquals(parsed[0].projectedTotal, 0.05);
      assertEquals(parsed[0].vsActual, null);
      // Big Pickle should project to $0 (all zeros)
      const bigPickle = parsed.find((p) => p.model === "Big Pickle");
      assertExists(bigPickle);
      assertEquals(bigPickle.inputCost, 0);
      assertEquals(bigPickle.outputCost, 0);
      assertEquals(bigPickle.projectedTotal, 0);
      // Since actualCost > 0, ratio is 0 / 0.05 = 0.0x
      assertEquals(bigPickle.vsActual, "0.0x");
      // DeepSeek V4 Flash: 2M input * 0.14/1M = 0.28, 0.5M output * 0.28/1M = 0.14
      // cache read: 0.1M * 0.028/1M = 0.0028 -> 0.00
      const flash = parsed.find((p) => p.model === "DeepSeek V4 Flash");
      assertExists(flash);
      assertEquals(flash.inputCost, 0.28);
      assertEquals(flash.outputCost, 0.14);
      // projectedTotal = 0.28 + 0.14 = 0.42 (cache rounds to 0.00)
      assertEquals(flash.projectedTotal, 0.42);
      assertEquals(flash.vsActual, "8.4x");
      // Results should be sorted by projectedTotal ascending after actual row
      for (let i = 2; i < parsed.length - 1; i++) {
        const a = parsed[i].projectedTotal;
        const b = parsed[i + 1].projectedTotal;
        if (a !== null && b !== null) {
          assertEquals(a <= b, true, `Row ${i} not sorted: ${a} > ${b}`);
        }
      }
    } finally {
      cleanup();
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name:
    "CallToolRequestSchema project_cost with actual_cost = 0 (free project)",
  async fn() {
    const { client, cleanup } = await setup();
    try {
      const result = await client.request("tools/call", {
        name: "project_cost",
        arguments: {
          tokens_input: 1_000_000,
          tokens_output: 100_000,
          tokens_cache_read: 0,
          tokens_cache_write: 0,
          actual_cost: 0,
        },
      }) as { content: Array<{ text: string }> };
      const parsed = JSON.parse(result.content[0].text) as Array<{
        model: string;
        vsActual: string | null;
      }>;
      // First row should say Big Pickle
      assertEquals(parsed[0].model, "Actual (Big Pickle)");
      assertEquals(parsed[0].vsActual, null);
      // Big Pickle should be Free
      const bigPickle = parsed.find((p) => p.model === "Big Pickle");
      assertExists(bigPickle);
      assertEquals(bigPickle.vsActual, "Free");
      // Non-free models should show N/A (free)
      const flash = parsed.find((p) => p.model === "DeepSeek V4 Flash");
      assertExists(flash);
      assertEquals(flash.vsActual, "N/A (free)");
    } finally {
      cleanup();
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name:
    "CallToolRequestSchema project_cost returns error for missing required arguments",
  async fn() {
    const { client, cleanup } = await setup();
    try {
      const result = await client.request("tools/call", {
        name: "project_cost",
        arguments: {
          tokens_input: 1000,
          tokens_output: 500,
          // missing tokens_cache_read, tokens_cache_write, actual_cost
        },
      }) as { isError?: boolean; content: Array<{ text: string }> };
      assertEquals(result.isError, true);
      assertStringIncludes(
        result.content[0].text,
        "Missing or invalid arguments",
      );
    } finally {
      cleanup();
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});
