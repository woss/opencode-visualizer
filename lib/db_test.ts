// deno-lint-ignore-file no-import-prefix

import { Database } from "@db/sqlite";
import { assertAlmostEquals, assertEquals } from "jsr:@std/assert@^1.0.0";
import { getDirectoryOverview } from "./db.ts";

function createTestDb(): Database {
  const db = new Database(":memory:", { int64: true });
  db.exec(`
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
      time_created INTEGER
    )
  `);

  // dir-a: 2 sessions (1 main + 1 sub), both active
  db.prepare(
    `INSERT INTO session (id, directory, parent_id, time_archived, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write, cost, time_created)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "s1",
    "dir-a",
    null,
    null,
    100,
    50,
    10,
    20,
    5,
    0.0015,
    1000,
  );

  db.prepare(
    `INSERT INTO session (id, directory, parent_id, time_archived, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write, cost, time_created)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "s2",
    "dir-a",
    "s1",
    null,
    200,
    100,
    20,
    40,
    10,
    0.003,
    2000,
  );

  // dir-b: 1 session (main), archived
  db.prepare(
    `INSERT INTO session (id, directory, parent_id, time_archived, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write, cost, time_created)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "s3",
    "dir-b",
    null,
    5000,
    50,
    25,
    5,
    10,
    2,
    0.00075,
    3000,
  );

  return db;
}

Deno.test("returns all directories when no filter", () => {
  const db = createTestDb();
  try {
    const rows = getDirectoryOverview(db);

    assertEquals(rows.length, 2);

    const row0 = rows[0];
    assertEquals(row0.directory, "dir-a");
    assertEquals(row0.total, 2);
    assertEquals(row0.active, 2);
    assertEquals(row0.archived, 0);
    assertEquals(row0.main_count, 1);
    assertEquals(row0.sub_count, 1);
    assertEquals(row0.tokens_input, 300);
    assertEquals(row0.tokens_output, 150);
    assertEquals(row0.tokens_reasoning, 30);
    assertEquals(row0.tokens_cache_read, 60);
    assertEquals(row0.tokens_cache_write, 15);
    assertAlmostEquals(row0.cost, 0.0045);
    assertEquals(row0.last_active, 2000);

    const row1 = rows[1];
    assertEquals(row1.directory, "dir-b");
    assertEquals(row1.total, 1);
    assertEquals(row1.active, 0);
    assertEquals(row1.archived, 1);
    assertEquals(row1.main_count, 1);
    assertEquals(row1.sub_count, 0);
    assertEquals(row1.tokens_input, 50);
    assertEquals(row1.tokens_output, 25);
    assertEquals(row1.tokens_reasoning, 5);
    assertEquals(row1.tokens_cache_read, 10);
    assertEquals(row1.tokens_cache_write, 2);
    assertAlmostEquals(row1.cost, 0.00075);
    assertEquals(row1.last_active, 3000);
  } finally {
    db.close();
  }
});

Deno.test("filters to one directory when filter provided", () => {
  const db = createTestDb();
  try {
    const rows = getDirectoryOverview(db, "dir-a");

    assertEquals(rows.length, 1);
    const row = rows[0];
    assertEquals(row.directory, "dir-a");
    assertEquals(row.total, 2);
    assertEquals(row.active, 2);
    assertEquals(row.archived, 0);
    assertEquals(row.main_count, 1);
    assertEquals(row.sub_count, 1);
    assertEquals(row.tokens_input, 300);
    assertEquals(row.tokens_output, 150);
    assertEquals(row.tokens_reasoning, 30);
    assertEquals(row.tokens_cache_read, 60);
    assertEquals(row.tokens_cache_write, 15);
    assertAlmostEquals(row.cost, 0.0045);
    assertEquals(row.last_active, 2000);
  } finally {
    db.close();
  }
});

Deno.test("returns empty for non-existent directory", () => {
  const db = createTestDb();
  try {
    const rows = getDirectoryOverview(db, "__nonexistent__");
    assertEquals(rows.length, 0);
  } finally {
    db.close();
  }
});
