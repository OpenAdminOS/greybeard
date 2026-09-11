import { chmodSync, existsSync, lstatSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import DatabaseConstructor from "better-sqlite3";
import type { Database as SqliteDatabase } from "better-sqlite3";

export const MEMORY_DB_FILENAME = "memory.db";

export function memoryDbPath(appDataPath: string): string {
  return join(appDataPath, MEMORY_DB_FILENAME);
}

export function openMemoryDatabase(appDataPath: string, path = memoryDbPath(appDataPath)): SqliteDatabase {
  mkdirSync(appDataPath, { recursive: true, mode: 0o700 });
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  for (const directory of new Set([appDataPath, dirname(path)])) {
    const info = lstatSync(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Memory data directories must be real directories.");
    if (process.platform !== "win32" && (info.uid !== process.getuid?.() || (info.mode & 0o022) !== 0)) {
      throw new Error("Memory data directories must be owned by this user and not writable by other users.");
    }
  }
  // Secure existing databases before SQLite opens or creates WAL sidecars.
  for (const file of [path, `${path}-wal`, `${path}-shm`]) {
    let info;
    try { info = lstatSync(file); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (info) {
      if (info.isSymbolicLink()) throw new Error("Memory database files cannot be symbolic links.");
      if (!info.isFile()) throw new Error("Memory database files must be regular files.");
      if (process.platform !== "win32" && info.uid !== process.getuid?.()) throw new Error("Memory database files must be owned by this user.");
      chmodSync(file, 0o600);
    }
  }
  const db = new DatabaseConstructor(path, {
    timeout: 5000
  });
  if (path !== ":memory:") chmodSync(path, 0o600);
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.pragma("journal_mode = WAL");
  try {
    initializeMemorySchema(db);
    for (const file of [`${path}-wal`, `${path}-shm`]) {
      if (existsSync(file)) chmodSync(file, 0o600);
    }
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

export function initializeMemoryDatabase(appDataPath: string, path = memoryDbPath(appDataPath)): void {
  const db = openMemoryDatabase(appDataPath, path);
  db.close();
}

export const MEMORY_SCHEMA_VERSION = 4;

// This is the LIVE latest schema, shared by fresh creates and the rebuild
// migration. A future schema version must either rebuild-to-latest again or
// account for older databases already carrying newer columns.
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
  if (version > MEMORY_SCHEMA_VERSION) throw new Error("This memory database requires a newer Greybeard version.");
  if (version === MEMORY_SCHEMA_VERSION) {
    return;
  }

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

  // An explicit confirmation did not exist in older releases. Preserve all
  // records and links, but never promote historical agent output to trusted memory.
  if (version < 2) db.transaction(() => {
    db.exec(`
ALTER TABLE nodes ADD COLUMN profile_id TEXT NOT NULL DEFAULT '';
ALTER TABLE nodes ADD COLUMN status TEXT NOT NULL DEFAULT 'candidate' CHECK(status IN ('candidate','confirmed'));
ALTER TABLE nodes ADD COLUMN source TEXT NOT NULL DEFAULT 'legacy-unverified';
ALTER TABLE nodes ADD COLUMN scope TEXT NOT NULL DEFAULT 'global';
ALTER TABLE nodes ADD COLUMN confirmed_at INTEGER;
ALTER TABLE nodes ADD COLUMN confirmed_by TEXT;
ALTER TABLE nodes ADD COLUMN supersedes INTEGER;
ALTER TABLE nodes ADD COLUMN superseded_at INTEGER;
UPDATE nodes SET profile_id = tenant;
CREATE INDEX idx_nodes_profile_status ON nodes(profile_id, tenant, status);
CREATE INDEX idx_nodes_supersedes ON nodes(supersedes);
ALTER TABLE edges RENAME TO edges_legacy;
CREATE TABLE edges (
  source INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  target INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  relation TEXT NOT NULL CHECK(relation IN ('used','depends_on','needs','prefers','exception_to')),
  weight REAL NOT NULL DEFAULT 1.0,
  PRIMARY KEY(source,target,relation)
);
INSERT INTO edges SELECT * FROM edges_legacy;
DROP TABLE edges_legacy;
CREATE INDEX idx_edges_target ON edges(target);
`);
    db.pragma("user_version = 2");
  })();
  db.transaction(() => {
    const columns = db.prepare("PRAGMA table_info(nodes)").all() as Array<{name:string}>;
    if (!columns.some(column => column.name === "revision")) {
      db.exec("ALTER TABLE nodes ADD COLUMN revision TEXT NOT NULL DEFAULT '';");
    }
    db.exec("UPDATE nodes SET revision=lower(hex(randomblob(16))) WHERE revision='';");
    if (!columns.some(column => column.name === "evidence_kind")) {
      db.exec(`ALTER TABLE nodes ADD COLUMN evidence_kind TEXT NOT NULL DEFAULT 'context';
ALTER TABLE nodes ADD COLUMN observed_at INTEGER;
ALTER TABLE nodes ADD COLUMN outcome TEXT;
UPDATE nodes SET evidence_kind=CASE WHEN type IN ('preference','decision') THEN 'rule' WHEN type='fact' THEN 'observation' ELSE 'context' END;`);
    }
    db.exec(`CREATE TABLE IF NOT EXISTS advice_events (
      id TEXT PRIMARY KEY, tenant TEXT NOT NULL, profile_id TEXT NOT NULL,
      created_at INTEGER NOT NULL, status TEXT NOT NULL, bytes INTEGER NOT NULL, node_ids TEXT NOT NULL DEFAULT '[]',
      feedback TEXT CHECK(feedback IN ('accepted','ignored','irrelevant'))
    );
    CREATE INDEX IF NOT EXISTS idx_advice_identity ON advice_events(tenant,profile_id,created_at);`);
    db.pragma(`user_version = ${MEMORY_SCHEMA_VERSION}`);
  })();
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
