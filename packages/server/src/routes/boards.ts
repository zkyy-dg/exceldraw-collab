import { Hono } from "hono";
import { getDb } from "../db/index.js";

const boards = new Hono();

// Create a new board
boards.post("/", async (c) => {
  const body = await c.req.json<{ name?: string }>();
  const db = getDb();

  const result = db
    .prepare("INSERT INTO boards (name) VALUES (?) RETURNING id, name, created_at, updated_at")
    .bind(body.name ?? "Untitled Board")
    .get() as { id: string; name: string; created_at: number; updated_at: number };

  // Initialize empty elements
  db.prepare("INSERT INTO board_elements (board_id, elements_json) VALUES (?, '[]')").bind(result.id).run();

  return c.json(result, 201);
});

// List all boards
boards.get("/", (c) => {
  const db = getDb();
  const rows = db.prepare("SELECT id, name, created_at, updated_at FROM boards ORDER BY updated_at DESC").all();
  return c.json(rows);
});

// Get a single board
boards.get("/:id", (c) => {
  const db = getDb();
  const row = db.prepare("SELECT id, name, created_at, updated_at FROM boards WHERE id = ?").bind(c.req.param("id")).get();
  if (!row) {
    return c.json({ error: "Board not found" }, 404);
  }
  return c.json(row);
});

// Get board elements
boards.get("/:id/elements", (c) => {
  const db = getDb();
  const row = db.prepare("SELECT elements_json, updated_at FROM board_elements WHERE board_id = ?").bind(c.req.param("id")).get() as { elements_json: string; updated_at: number } | undefined;
  if (!row) {
    return c.json({ elements: [] }, 200);
  }
  return c.json({ elements: JSON.parse(row.elements_json), updatedAt: row.updated_at });
});

// Save board elements (upsert)
boards.put("/:id/elements", async (c) => {
  const body = await c.req.json<{ elements: unknown[] }>();
  const db = getDb();

  db.prepare(
    `INSERT INTO board_elements (board_id, elements_json, updated_at) VALUES (?, ?, unixepoch())
     ON CONFLICT(board_id) DO UPDATE SET elements_json = excluded.elements_json, updated_at = excluded.updated_at`
  ).bind(c.req.param("id"), JSON.stringify(body.elements)).run();

  // Update board's updated_at
  db.prepare("UPDATE boards SET updated_at = unixepoch() WHERE id = ?").bind(c.req.param("id")).run();

  return c.json({ ok: true });
});

export default boards;
