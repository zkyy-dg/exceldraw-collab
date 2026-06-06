/**
 * Unit tests for REST API routes (routes/boards.ts)
 *
 * Covers:
 * - POST /api/boards — create board, validate return format, default name
 * - GET /api/boards — list boards, ordering by updated_at DESC
 * - GET /api/boards/:id — existing board, non-existent board (404)
 * - PUT /api/boards/:id/elements — save elements (insert and upsert)
 * - GET /api/boards/:id/elements — load elements, empty board default return
 *
 * Strategy: We mock the Hono app testing with @hono/testing or create a test app
 * and mock getDb() to use an in-memory better-sqlite3 database.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

// Mock the db module to use an in-memory database
const mockDbInstances: Map<string, Database.Database> = new Map();

// Create a fresh in-memory DB for each test
function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS boards (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      name TEXT NOT NULL DEFAULT 'Untitled Board',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS board_elements (
      board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      elements_json TEXT NOT NULL DEFAULT '[]',
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (board_id)
    );
  `);
  return db;
}

// We need to mock getDb() before importing the routes module.
// Since the module uses dynamic import paths, we'll mock the db module.
vi.mock("../src/db/index.js", () => {
  let db: Database.Database | null = null;

  return {
    getDb: () => {
      if (!db) {
        db = createTestDb();
      }
      return db;
    },
    // Expose a way to reset the DB for test isolation
    _resetDb: () => {
      if (db) {
        db.close();
      }
      db = null;
    },
  };
});

// Import after mocking
import boards from "../src/routes/boards.js";
import { _resetDb } from "../src/db/index.js";

// Helper to create a test Hono app with the boards routes
import { Hono } from "hono";

function createTestApp() {
  const app = new Hono();
  app.route("/api/boards", boards);
  return app;
}

// Helper to make requests against the test app
async function request(
  app: Hono,
  method: string,
  path: string,
  body?: object
): Promise<{ status: number; body: any }> {
  const req = new Request(`http://localhost${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });

  const res = await app.fetch(req);
  const responseBody = await res.json();
  return { status: res.status, body: responseBody };
}

describe("REST API — POST /api/boards (Create Board)", () => {
  let app: Hono;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T00:00:00Z"));
    // @ts-ignore - accessing the mocked _resetDb
    _resetDb();
    app = createTestApp();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should create a board with default name 'Untitled Board'", async () => {
    const res = await request(app, "POST", "/api/boards", {});

    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Untitled Board");
    expect(res.body.id).toBeDefined();
    expect(typeof res.body.id).toBe("string");
    expect(res.body.id.length).toBeGreaterThan(0);
    expect(res.body.created_at).toBeDefined();
    expect(res.body.updated_at).toBeDefined();
  });

  it("should create a board with the provided name", async () => {
    const res = await request(app, "POST", "/api/boards", { name: "My Test Board" });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe("My Test Board");
    expect(res.body.id).toBeDefined();
  });

  it("should return 201 status code on success", async () => {
    const res = await request(app, "POST", "/api/boards", { name: "Board 1" });

    expect(res.status).toBe(201);
  });

  it("should return different IDs for different boards", async () => {
    const res1 = await request(app, "POST", "/api/boards", { name: "Board 1" });
    const res2 = await request(app, "POST", "/api/boards", { name: "Board 2" });

    expect(res1.body.id).not.toBe(res2.body.id);
  });

  it("should initialize empty elements for the new board", async () => {
    const createRes = await request(app, "POST", "/api/boards", { name: "Test" });
    const elementsRes = await request(app, "GET", `/api/boards/${createRes.body.id}/elements`);

    expect(elementsRes.status).toBe(200);
    expect(elementsRes.body.elements).toEqual([]);
  });
});

describe("REST API — GET /api/boards (List Boards)", () => {
  let app: Hono;

  beforeEach(() => {
    // @ts-ignore
    _resetDb();
    app = createTestApp();
  });

  it("should return empty array when no boards exist", async () => {
    const res = await request(app, "GET", "/api/boards");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("should list all created boards", async () => {
    await request(app, "POST", "/api/boards", { name: "Board A" });
    await request(app, "POST", "/api/boards", { name: "Board B" });

    const res = await request(app, "GET", "/api/boards");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    const names = res.body.map((b: any) => b.name);
    expect(names).toContain("Board A");
    expect(names).toContain("Board B");
  });

  it("should return boards ordered by updated_at DESC (most recent first)", async () => {
    // Create board A
    const resA = await request(app, "POST", "/api/boards", { name: "Board A" });

    // Wait a small delay so SQLite's unixepoch() produces a different value for Board B
    await new Promise((resolve) => setTimeout(resolve, 1100));

    // Create board B
    const resB = await request(app, "POST", "/api/boards", { name: "Board B" });

    const res = await request(app, "GET", "/api/boards");

    // Board B should come first (more recent updated_at)
    expect(res.body[0].name).toBe("Board B");
    expect(res.body[1].name).toBe("Board A");
    expect(res.body[0].updated_at).toBeGreaterThan(res.body[1].updated_at);
  });

  it("should not include elements in the board list response", async () => {
    const createRes = await request(app, "POST", "/api/boards", { name: "Test Board" });
    // Save some elements
    await request(app, "PUT", `/api/boards/${createRes.body.id}/elements`, {
      elements: [{ id: "el-1", type: "rectangle" }],
    });

    const listRes = await request(app, "GET", "/api/boards");

    // Each board should have id, name, created_at, updated_at but NOT elements
    const board = listRes.body[0];
    expect(board.id).toBeDefined();
    expect(board.name).toBeDefined();
    expect(board.created_at).toBeDefined();
    expect(board.updated_at).toBeDefined();
    expect(board.elements).toBeUndefined();
  });
});

describe("REST API — GET /api/boards/:id (Get Single Board)", () => {
  let app: Hono;

  beforeEach(() => {
    // @ts-ignore
    _resetDb();
    app = createTestApp();
  });

  it("should return the board when it exists", async () => {
    const created = await request(app, "POST", "/api/boards", { name: "Target Board" });

    const res = await request(app, "GET", `/api/boards/${created.body.id}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(created.body.id);
    expect(res.body.name).toBe("Target Board");
    expect(res.body.created_at).toBeDefined();
    expect(res.body.updated_at).toBeDefined();
  });

  it("should return 404 for a non-existent board", async () => {
    const res = await request(app, "GET", "/api/boards/nonexistent-id-12345");

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Board not found");
  });
});

describe("REST API — PUT /api/boards/:id/elements (Save Elements)", () => {
  let app: Hono;

  beforeEach(() => {
    // @ts-ignore
    _resetDb();
    app = createTestApp();
  });

  it("should save elements for an existing board", async () => {
    const created = await request(app, "POST", "/api/boards", { name: "Test Board" });
    const elements = [
      { id: "el-1", type: "rectangle", x: 10, y: 20, width: 100, height: 50 },
      { id: "el-2", type: "ellipse", x: 200, y: 300, width: 80, height: 80 },
    ];

    const res = await request(app, "PUT", `/api/boards/${created.body.id}/elements`, { elements });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("should persist elements (upsert: subsequent PUT overwrites)", async () => {
    const created = await request(app, "POST", "/api/boards", { name: "Test Board" });

    // First save
    const save1 = await request(app, "PUT", `/api/boards/${created.body.id}/elements`, {
      elements: [{ id: "el-1", type: "rectangle" }],
    });
    expect(save1.body.ok).toBe(true);

    // Second save (overwrite)
    const save2 = await request(app, "PUT", `/api/boards/${created.body.id}/elements`, {
      elements: [{ id: "el-2", type: "ellipse" }, { id: "el-3", type: "text" }],
    });
    expect(save2.body.ok).toBe(true);

    // Verify only the latest elements are stored
    const load = await request(app, "GET", `/api/boards/${created.body.id}/elements`);
    expect(load.body.elements).toHaveLength(2);
    expect(load.body.elements[0].id).toBe("el-2");
    expect(load.body.elements[1].id).toBe("el-3");
  });

  it("should update the board's updated_at timestamp when saving elements", async () => {
    const created = await request(app, "POST", "/api/boards", { name: "Test Board" });
    const createdAt = created.body.updated_at;

    // Wait so SQLite's unixepoch() produces a different timestamp
    await new Promise((resolve) => setTimeout(resolve, 1100));

    await request(app, "PUT", `/api/boards/${created.body.id}/elements`, {
      elements: [{ id: "el-1" }],
    });

    // Fetch the board again and check updated_at changed
    const board = await request(app, "GET", `/api/boards/${created.body.id}`);
    expect(board.body.updated_at).toBeGreaterThan(createdAt);
  });

  it("should handle empty elements array", async () => {
    const created = await request(app, "POST", "/api/boards", { name: "Test Board" });

    const res = await request(app, "PUT", `/api/boards/${created.body.id}/elements`, { elements: [] });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Verify empty elements are persisted
    const load = await request(app, "GET", `/api/boards/${created.body.id}/elements`);
    expect(load.body.elements).toEqual([]);
  });
});

describe("REST API — GET /api/boards/:id/elements (Load Elements)", () => {
  let app: Hono;

  beforeEach(() => {
    // @ts-ignore
    _resetDb();
    app = createTestApp();
  });

  it("should return empty elements array for a board with no saved elements (default)", async () => {
    const created = await request(app, "POST", "/api/boards", { name: "Test Board" });

    const res = await request(app, "GET", `/api/boards/${created.body.id}/elements`);

    expect(res.status).toBe(200);
    expect(res.body.elements).toEqual([]);
  });

  it("should return saved elements", async () => {
    const created = await request(app, "POST", "/api/boards", { name: "Test Board" });
    const testElements = [
      { id: "el-1", type: "rectangle", version: 1, x: 10, y: 20 },
      { id: "el-2", type: "text", version: 2, text: "hello" },
    ];

    await request(app, "PUT", `/api/boards/${created.body.id}/elements`, { elements: testElements });

    const res = await request(app, "GET", `/api/boards/${created.body.id}/elements`);

    expect(res.status).toBe(200);
    expect(res.body.elements).toHaveLength(2);
    expect(res.body.elements[0]).toEqual(testElements[0]);
    expect(res.body.elements[1]).toEqual(testElements[1]);
    expect(res.body.updatedAt).toBeDefined();
  });

  it("should handle non-existent board gracefully (return empty elements)", async () => {
    const res = await request(app, "GET", "/api/boards/nonexistent-id/elements");

    expect(res.status).toBe(200);
    expect(res.body.elements).toEqual([]);
  });

  it("should return elements with correct updatedAt timestamp", async () => {
    const created = await request(app, "POST", "/api/boards", { name: "Test Board" });

    await request(app, "PUT", `/api/boards/${created.body.id}/elements`, {
      elements: [{ id: "el-1" }],
    });

    const load = await request(app, "GET", `/api/boards/${created.body.id}/elements`);
    expect(load.body.updatedAt).toBeDefined();
    expect(typeof load.body.updatedAt).toBe("number");
  });
});
