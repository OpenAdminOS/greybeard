import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { writeGreybeardConfig } from "@greybeard/graph";
import {
  MEMORY_TYPES,
  MemoryService,
  initializeMemoryDatabase,
  memoryDbPath
} from "./public.js";

const BASE_TIME = Date.UTC(2026, 6, 4, 12, 0, 0);
const DAY_MS = 24 * 60 * 60 * 1000;

describe("greybeard memory", () => {
  it("creates the schema idempotently with WAL, FTS5, triggers, and cascade edges", async () => {
    const appDataPath = await tempAppData("tenant-a");
    initializeMemoryDatabase(appDataPath);
    initializeMemoryDatabase(appDataPath);

    const db = new Database(memoryDbPath(appDataPath));
    try {
      expect(db.pragma("journal_mode", { simple: true })).toBe("wal");
      const nodesSql = schemaSql(db, "nodes");
      expect(nodesSql).toContain("CREATE TABLE nodes");
      // The CHECK constraint must stay in lockstep with MEMORY_TYPES; a type
      // added to the constant without a schema version bump fails here.
      expect(nodesSql).toContain(`type IN (${MEMORY_TYPES.map((type) => `'${type}'`).join(",")})`);
      expect(db.pragma("user_version", { simple: true })).toBe(1);
      expect(schemaSql(db, "nodes_fts")).toContain("tokenize='porter'");
      expect(schemaSql(db, "edges")).toContain("ON DELETE CASCADE");
      const triggerCount = db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'trigger' AND name IN ('nodes_ai','nodes_au','nodes_ad')")
        .get() as { count: number };
      expect(triggerCount.count).toBe(3);

      db.prepare("INSERT INTO nodes (type, content, embedding, tenant, created_at, last_used_at) VALUES ('fact', 'DeviceComplianceOrg table', NULL, 'tenant-a', 1, 1)")
        .run();
      const match = db.prepare("SELECT rowid FROM nodes_fts WHERE nodes_fts MATCH ?")
        .get("\"DeviceComplianceOrg\"") as { rowid: number } | undefined;
      expect(match?.rowid).toBe(1);
    } finally {
      db.close();
    }
  });

  it("ranks preference nodes above query nodes on the same match", async () => {
    const appDataPath = await tempAppData("tenant-a");
    const service = new MemoryService({ appDataPath, now: () => BASE_TIME });
    try {
      await service.remember({
        type: "query",
        content: "Intune compliance reports use DeviceComplianceOrg table"
      });
      await service.remember({
        type: "preference",
        content: "For Intune compliance reports, use DeviceComplianceOrg table."
      });

      const result = await service.recall({
        query: "Intune compliance reports DeviceComplianceOrg table",
        limit: 5
      });

      expect(result.results[0]?.type).toBe("preference");
      expect(result.results[0]?.matched).toBe(true);
    } finally {
      service.close();
    }
  });

  it("escapes hostile FTS input containing operators, parens, and unbalanced quotes", async () => {
    const appDataPath = await tempAppData("tenant-a");
    const service = new MemoryService({ appDataPath, now: () => BASE_TIME });
    try {
      await service.remember({
        type: "fact",
        content: "Use DeviceComplianceOrg table for Intune compliance reports."
      });

      await expect(service.recall({
        query: "DeviceComplianceOrg AND OR (compliance reports \"",
        limit: 5
      })).resolves.toEqual(expect.objectContaining({
        message: "memory recalled"
      }));
    } finally {
      service.close();
    }
  });

  it("expands one hop over edges for linked nodes", async () => {
    const appDataPath = await tempAppData("tenant-a");
    const service = new MemoryService({ appDataPath, now: () => BASE_TIME });
    try {
      const query = await service.remember({
        type: "query",
        content: "Compliance report table choice"
      });
      const preference = await service.remember({
        type: "preference",
        content: "Use DeviceComplianceOrg always.",
        links: [
          {
            target: query.id,
            relation: "prefers"
          }
        ]
      });

      const result = await service.recall({
        query: "Compliance report table choice",
        limit: 5
      });

      expect(result.results).toContainEqual(expect.objectContaining({
        id: query.id,
        matched: true
      }));
      expect(result.results).toContainEqual(expect.objectContaining({
        id: preference.id,
        matched: false,
        linkedFrom: query.id,
        relation: "prefers"
      }));
    } finally {
      service.close();
    }
  });

  it("isolates memory by the active tenant from config", async () => {
    const appDataPath = await tempAppData("tenant-a");
    const service = new MemoryService({ appDataPath, now: () => BASE_TIME });
    try {
      await service.remember({
        type: "preference",
        content: "Use DeviceComplianceOrg for compliance reports."
      });

      await writeGreybeardConfig(appDataPath, { activeTenantId: "tenant-b" });
      const tenantB = await service.recall({
        query: "DeviceComplianceOrg compliance reports",
        limit: 5
      });
      expect(tenantB.message).toBe("no memory for this yet");

      await writeGreybeardConfig(appDataPath, { activeTenantId: "tenant-a" });
      const tenantA = await service.recall({
        query: "DeviceComplianceOrg compliance reports",
        limit: 5
      });
      expect(tenantA.results).toHaveLength(1);
      expect(tenantA.results[0]?.tenant).toBe("tenant-a");
    } finally {
      service.close();
    }
  });

  it("migrates a version 0 database in place and keeps nodes, edges, and FTS intact", async () => {
    const appDataPath = await tempAppData("tenant-a");
    const dbPath = memoryDbPath(appDataPath);
    const legacy = new Database(dbPath);
    try {
      legacy.pragma("journal_mode = WAL");
      legacy.exec(`CREATE TABLE nodes (
  id           INTEGER PRIMARY KEY,
  type         TEXT NOT NULL CHECK (type IN ('query','preference','script','fact','scope')),
  content      TEXT NOT NULL,
  embedding    BLOB,
  tenant       TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL
);
CREATE VIRTUAL TABLE nodes_fts USING fts5(content, content='nodes', content_rowid='id', tokenize='porter');
CREATE TABLE edges (
  source   INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  target   INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  relation TEXT NOT NULL CHECK (relation IN ('used','depends_on','needs','prefers')),
  weight   REAL NOT NULL DEFAULT 1.0,
  PRIMARY KEY (source, target, relation)
);
CREATE TRIGGER nodes_ai AFTER INSERT ON nodes BEGIN
  INSERT INTO nodes_fts(rowid, content) VALUES (new.id, new.content);
END;
INSERT INTO nodes (id, type, content, embedding, tenant, created_at, last_used_at)
VALUES (1, 'fact', 'Legacy DeviceComplianceOrg fact', NULL, 'tenant-a', 1, 1),
       (2, 'preference', 'Use DeviceComplianceOrg for compliance reports.', NULL, 'tenant-a', 1, 1);
INSERT INTO edges (source, target, relation, weight) VALUES (2, 1, 'depends_on', 1.0);`);
      expect(legacy.pragma("user_version", { simple: true })).toBe(0);
    } finally {
      legacy.close();
    }

    const service = new MemoryService({ appDataPath, now: () => BASE_TIME });
    try {
      const recalled = await service.recall({ query: "DeviceComplianceOrg compliance", limit: 5 });
      expect(recalled.results.map((node) => node.id)).toContain(1);

      const decision = await service.remember({
        type: "decision",
        content: "Decision: keep DeviceComplianceOrg. Because: trend table is incomplete. Decided: 2026-07-08."
      });
      expect(decision.action).toBe("inserted");
    } finally {
      service.close();
    }

    const migrated = new Database(dbPath);
    try {
      expect(migrated.pragma("user_version", { simple: true })).toBe(1);
      expect(schemaSql(migrated, "nodes")).toContain("'decision'");
      const edge = migrated.prepare("SELECT COUNT(*) AS count FROM edges WHERE source = 2 AND target = 1").get() as { count: number };
      expect(edge.count).toBe(1);
      const rows = migrated.prepare("SELECT COUNT(*) AS count FROM nodes").get() as { count: number };
      expect(rows.count).toBe(3);
    } finally {
      migrated.close();
    }
  });

  it("rejects raw tenant-output shapes and accepts a legitimate preference", async () => {
    const appDataPath = await tempAppData("tenant-a");
    const service = new MemoryService({ appDataPath, now: () => BASE_TIME });
    try {
      await expect(service.remember({
        type: "fact",
        content: "Users 11111111-1111-4111-8111-111111111111 and 22222222-2222-4222-8222-222222222222 were returned."
      })).rejects.toMatchObject({
        code: "privacy-rejected"
      });

      await expect(service.remember({
        type: "fact",
        content: "Users admin@contoso.com and user@contoso.com were returned."
      })).rejects.toMatchObject({
        code: "privacy-rejected"
      });

      await expect(service.remember({
        type: "fact",
        content: JSON.stringify({ value: Array.from({ length: 200 }, (_, index) => ({ id: index, displayName: `User ${index}` })) })
      })).rejects.toMatchObject({
        code: "privacy-rejected"
      });

      await expect(service.remember({
        type: "preference",
        content: "For Intune compliance reports, use DeviceComplianceOrg instead of DeviceComplianceTrend."
      })).resolves.toMatchObject({
        action: "inserted"
      });

      await expect(service.remember({
        type: "decision",
        content: "Decision: CA policy 11111111-1111-4111-8111-111111111111 excludes group 22222222-2222-4222-8222-222222222222 and app 33333333-3333-4333-8333-333333333333. Because: warehouse scanners cannot do MFA. Decided: 2026-07-08."
      })).resolves.toMatchObject({
        action: "inserted"
      });

      await expect(service.remember({
        type: "decision",
        content: "Objects 11111111-1111-4111-8111-111111111111, 22222222-2222-4222-8222-222222222222, 33333333-3333-4333-8333-333333333333, 44444444-4444-4444-8444-444444444444 were returned."
      })).rejects.toMatchObject({
        code: "privacy-rejected"
      });
    } finally {
      service.close();
    }
  });

  it("supersedes matching preferences in place and preserves edges", async () => {
    const appDataPath = await tempAppData("tenant-a");
    const service = new MemoryService({ appDataPath, now: () => BASE_TIME });
    try {
      const query = await service.remember({
        type: "query",
        content: "Compliance report table choice"
      });
      const first = await service.remember({
        type: "preference",
        content: "For Intune compliance reports, use DeviceComplianceOrg table.",
        links: [
          {
            target: query.id,
            relation: "prefers"
          }
        ]
      });
      const second = await service.remember({
        type: "preference",
        content: "For Intune compliance reports, prefer DeviceComplianceOrg over DeviceComplianceTrend."
      });

      expect(second.action).toBe("updated");
      expect(second.id).toBe(first.id);
      const listed = await service.list({ type: "preference", limit: 10 });
      expect(listed.results).toHaveLength(1);
      expect(listed.results[0]?.content).toBe("For Intune compliance reports, prefer DeviceComplianceOrg over DeviceComplianceTrend.");

      const db = new Database(memoryDbPath(appDataPath));
      try {
        const edgeCount = db.prepare("SELECT COUNT(*) AS count FROM edges WHERE source = ? AND target = ? AND relation = 'prefers'")
          .get(first.id, query.id) as { count: number };
        expect(edgeCount.count).toBe(1);
      } finally {
        db.close();
      }
    } finally {
      service.close();
    }
  });

  it("evicts by TTL and soft cap while preserving refreshed queries and sticky preferences", async () => {
    const appDataPath = await tempAppData("tenant-a");
    let now = BASE_TIME - 100 * DAY_MS;
    const ttlService = new MemoryService({
      appDataPath,
      now: () => now,
      softCap: 10
    });
    try {
      const oldQuery = await ttlService.remember({
        type: "query",
        content: "Old compliance report question"
      });
      now = BASE_TIME;
      await ttlService.recall({
        query: "Old compliance report question",
        limit: 5
      });
      await ttlService.remember({
        type: "fact",
        content: "A new report fact."
      });
      const queries = await ttlService.list({ type: "query", limit: 10 });
      expect(queries.results.map((node) => node.id)).toContain(oldQuery.id);
    } finally {
      ttlService.close();
    }

    const stickyAppDataPath = await tempAppData("tenant-a");
    const stickyService = new MemoryService({
      appDataPath: stickyAppDataPath,
      now: () => BASE_TIME,
      softCap: 2
    });
    try {
      const script = await stickyService.remember({
        type: "script",
        content: "Script reference for compliance reporting."
      });
      const preference = await stickyService.remember({
        type: "preference",
        content: "Use the compliance reporting script when the admin asks for export-ready output.",
        links: [
          {
            target: script.id,
            relation: "depends_on"
          }
        ]
      });
      await stickyService.remember({
        type: "fact",
        content: "Temporary fact one."
      });
      await stickyService.remember({
        type: "fact",
        content: "Temporary fact two."
      });

      const all = await stickyService.list({ limit: 10 });
      expect(all.results.map((node) => node.id)).toContain(preference.id);
      expect(all.results.length).toBeLessThanOrEqual(2);
    } finally {
      stickyService.close();
    }

    const decisionAppDataPath = await tempAppData("tenant-a");
    const decisionService = new MemoryService({
      appDataPath: decisionAppDataPath,
      now: () => BASE_TIME,
      softCap: 2
    });
    try {
      const query = await decisionService.remember({
        type: "query",
        content: "Why does the warehouse group skip MFA?"
      });
      const decision = await decisionService.remember({
        type: "decision",
        content: "Decision: warehouse group stays excluded from MFA policy. Because: scanners cannot do MFA. Decided: 2026-07-08.",
        links: [
          {
            target: query.id,
            relation: "used"
          }
        ]
      });
      await decisionService.remember({
        type: "fact",
        content: "Temporary decision-pressure fact one."
      });
      await decisionService.remember({
        type: "fact",
        content: "Temporary decision-pressure fact two."
      });

      const all = await decisionService.list({ limit: 10 });
      expect(all.results.map((node) => node.id)).toContain(decision.id);
    } finally {
      decisionService.close();
    }
  });

  it("forgets by id and cascades edges", async () => {
    const appDataPath = await tempAppData("tenant-a");
    const service = new MemoryService({ appDataPath, now: () => BASE_TIME });
    try {
      const query = await service.remember({
        type: "query",
        content: "Compliance report table choice"
      });
      await service.remember({
        type: "preference",
        content: "Use DeviceComplianceOrg for compliance reports.",
        links: [
          {
            target: query.id,
            relation: "prefers"
          }
        ]
      });

      const forgotten = await service.forget({ id: query.id });
      expect(forgotten.deleted).toBe(1);

      const db = new Database(memoryDbPath(appDataPath));
      try {
        const edgeCount = db.prepare("SELECT COUNT(*) AS count FROM edges")
          .get() as { count: number };
        expect(edgeCount.count).toBe(0);
      } finally {
        db.close();
      }
    } finally {
      service.close();
    }
  });

  it("forgets by olderThanDays and type for the active tenant", async () => {
    const appDataPath = await tempAppData("tenant-a");
    let now = BASE_TIME - 120 * DAY_MS;
    const service = new MemoryService({ appDataPath, now: () => now, queryTtlDays: 365 });
    try {
      const oldQuery = await service.remember({
        type: "query",
        content: "Old query to prune"
      });
      now = BASE_TIME;
      const newQuery = await service.remember({
        type: "query",
        content: "New query to keep"
      });

      const forgotten = await service.forget({
        olderThanDays: 90,
        type: "query"
      });
      expect(forgotten.deleted).toBe(1);
      const listed = await service.list({ type: "query", limit: 10 });
      expect(listed.results.map((node) => node.id)).not.toContain(oldQuery.id);
      expect(listed.results.map((node) => node.id)).toContain(newQuery.id);
    } finally {
      service.close();
    }
  });

  it("allows two better-sqlite3 connections to write through WAL", async () => {
    const appDataPath = await tempAppData("tenant-a");
    const left = new MemoryService({ appDataPath, now: () => BASE_TIME });
    const right = new MemoryService({ appDataPath, now: () => BASE_TIME });
    try {
      await Promise.all(Array.from({ length: 10 }, async (_, index) => {
        const service = index % 2 === 0 ? left : right;
        await service.remember({
          type: "fact",
          content: `Concurrent WAL fact ${index}`
        });
      }));

      const listed = await left.list({ type: "fact", limit: 20 });
      expect(listed.results).toHaveLength(10);

      const db = new Database(memoryDbPath(appDataPath));
      try {
        expect(db.pragma("journal_mode", { simple: true })).toBe("wal");
      } finally {
        db.close();
      }
    } finally {
      left.close();
      right.close();
    }
  });
});

async function tempAppData(tenant: string): Promise<string> {
  const appDataPath = await mkdtemp(join(tmpdir(), "greybeard-memory-"));
  await writeGreybeardConfig(appDataPath, { activeTenantId: tenant });
  return appDataPath;
}

function schemaSql(db: Database.Database, name: string): string {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE name = ?")
    .get(name) as { sql: string } | undefined;
  expect(row, name).toBeDefined();
  return row?.sql ?? "";
}
