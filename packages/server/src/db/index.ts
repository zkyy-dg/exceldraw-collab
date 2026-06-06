import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, "../../../data/collab.db");

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    // Ensure data directory exists
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    initSchema(db);
  }
  return db;
}

function initSchema(db: Database.Database): void {
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
}
