import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { writeGreybeardConfig } from "@greybeard/graph";
import {
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
      expect(nodesSql).toContain("type         TEXT NOT NULL CHECK (type IN ('query','preference','script','fact','scope'))");
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
