import { mkdirSync } from "node:fs";
import { join } from "node:path";
import DatabaseConstructor from "better-sqlite3";
import type { Database as SqliteDatabase } from "better-sqlite3";

export const MEMORY_DB_FILENAME = "memory.db";

export function memoryDbPath(appDataPath: string): string {
  return join(appDataPath, MEMORY_DB_FILENAME);
}

export function openMemoryDatabase(appDataPath: string, path = memoryDbPath(appDataPath)): SqliteDatabase {
  mkdirSync(appDataPath, { recursive: true });
  const db = new DatabaseConstructor(path, {
    timeout: 5000
  });
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.pragma("journal_mode = WAL");
  initializeMemorySchema(db);
  return db;
}

export function initializeMemoryDatabase(appDataPath: string, path = memoryDbPath(appDataPath)): void {
  const db = openMemoryDatabase(appDataPath, path);
  db.close();
}

export const MEMORY_SCHEMA_VERSION = 1;

const NODES_TABLE_DDL = (name: string) => `CREATE TABLE ${name} (
  id           INTEGER PRIMARY KEY,
  type         TEXT NOT NULL CHECK (type IN ('query','preference','script','fact','scope','decision')),
  content      TEXT NOT NULL,
  embedding    BLOB,
  tenant       TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL
);`;

export function initializeMemorySchema(db: SqliteDatabase): void {
  const version = db.pragma("user_version", { simple: true }) as number;
  if (objectExists(db, "nodes") && version < 1) {
    migrateNodesToV1(db);
  }

  if (!objectExists(db, "nodes")) {
    db.exec(NODES_TABLE_DDL("nodes"));
  }

  if (!objectExists(db, "nodes_fts")) {
    db.exec(`CREATE VIRTUAL TABLE nodes_fts USING fts5(
  content, content='nodes', content_rowid='id', tokenize='porter'
);`);
    db.exec("INSERT INTO nodes_fts(nodes_fts) VALUES('rebuild');");
  }

  if (!objectExists(db, "edges")) {
    db.exec(`CREATE TABLE edges (
  source   INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  target   INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  relation TEXT NOT NULL CHECK (relation IN ('used','depends_on','needs','prefers')),
  weight   REAL NOT NULL DEFAULT 1.0,
  PRIMARY KEY (source, target, relation)
);`);
  }

  db.exec(`
CREATE TRIGGER IF NOT EXISTS nodes_ai AFTER INSERT ON nodes BEGIN
  INSERT INTO nodes_fts(rowid, content) VALUES (new.id, new.content);
END;

CREATE TRIGGER IF NOT EXISTS nodes_au AFTER UPDATE ON nodes BEGIN
  INSERT INTO nodes_fts(nodes_fts, rowid, content) VALUES('delete', old.id, old.content);
  INSERT INTO nodes_fts(rowid, content) VALUES (new.id, new.content);
END;

CREATE TRIGGER IF NOT EXISTS nodes_ad AFTER DELETE ON nodes BEGIN
  INSERT INTO nodes_fts(nodes_fts, rowid, content) VALUES('delete', old.id, old.content);
END;

CREATE INDEX IF NOT EXISTS idx_nodes_tenant_type_created ON nodes(tenant, type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_nodes_tenant_last_used ON nodes(tenant, last_used_at);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target);
`);

  db.pragma(`user_version = ${MEMORY_SCHEMA_VERSION}`);
}

function migrateNodesToV1(db: SqliteDatabase): void {
  db.pragma("foreign_keys = OFF");
  try {
    db.transaction(() => {
      db.exec("DROP TRIGGER IF EXISTS nodes_ai;");
      db.exec("DROP TRIGGER IF EXISTS nodes_au;");
      db.exec("DROP TRIGGER IF EXISTS nodes_ad;");
      db.exec(NODES_TABLE_DDL("nodes_new"));
      db.exec(`INSERT INTO nodes_new (id, type, content, embedding, tenant, created_at, last_used_at)
SELECT id, type, content, embedding, tenant, created_at, last_used_at FROM nodes;`);
      db.exec("DROP TABLE nodes;");
      db.exec("ALTER TABLE nodes_new RENAME TO nodes;");
      if (objectExists(db, "nodes_fts")) {
        db.exec("INSERT INTO nodes_fts(nodes_fts) VALUES('rebuild');");
      }
    })();
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

function objectExists(db: SqliteDatabase, name: string): boolean {
  const row = db.prepare("SELECT 1 FROM sqlite_master WHERE name = ? LIMIT 1").get(name);
  return Boolean(row);
}
