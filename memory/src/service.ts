import type { Database as SqliteDatabase } from "better-sqlite3";
import { readGreybeardConfig } from "@greybeard/graph";
import { openMemoryDatabase } from "./database.js";
import {
  GreybeardMemoryError,
  type EdgeRelation,
  type ForgetInput,
  type ForgetResult,
  type ListInput,
  type ListResult,
  type MemoryLinkInput,
  type MemoryNode,
  type MemoryType,
  type RecallInput,
  type RecallResult,
  type RecallResultNode,
  type RememberInput,
  type RememberResult
} from "./types.js";

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 50;
const DEFAULT_SOFT_CAP = 2000;
const QUERY_TTL_DAYS = 90;
const JSON_PRIVACY_BYTE_THRESHOLD = 2048;
const DEFAULT_GUID_PRIVACY_THRESHOLD = 2;
const DECISION_GUID_PRIVACY_THRESHOLD = 4;
const SECONDS_PER_DAY = 24 * 60 * 60;
const NO_MEMORY_MESSAGE = "no memory for this yet";
const RECALL_MESSAGE = "memory recalled";
const PRIVACY_GUIDANCE = "Store the intent, preference, threshold, or report shape instead of raw tenant output.";

type NowProvider = () => number | Date;

export type MemoryServiceOptions = {
  appDataPath: string;
  dbPath?: string;
  db?: SqliteDatabase;
  now?: NowProvider;
  softCap?: number;
  queryTtlDays?: number;
};

type NodeRow = {
  id: number;
  type: MemoryType;
  content: string;
  tenant: string;
  created_at: number;
  last_used_at: number;
};

type MatchRow = NodeRow & {
  rank: number;
};

type EdgeExpansionRow = NodeRow & {
  source: number;
  target: number;
  relation: EdgeRelation;
  weight: number;
};

type CandidateRow = NodeRow & {
  overlap_score: number;
};

export class MemoryService {
  private readonly appDataPath: string;
  private readonly db: SqliteDatabase;
  private readonly ownsDb: boolean;
  private readonly nowProvider: NowProvider;
  private readonly softCap: number;
  private readonly queryTtlDays: number;

  constructor(options: MemoryServiceOptions) {
    this.appDataPath = options.appDataPath;
    this.db = options.db ?? openMemoryDatabase(options.appDataPath, options.dbPath);
    this.ownsDb = !options.db;
    this.nowProvider = options.now ?? (() => Date.now());
    this.softCap = options.softCap ?? DEFAULT_SOFT_CAP;
    this.queryTtlDays = options.queryTtlDays ?? QUERY_TTL_DAYS;
  }

  close(): void {
    if (this.ownsDb) {
      this.db.close();
    }
  }

  async recall(input: RecallInput): Promise<RecallResult> {
    const tenant = await this.activeTenant();
    const limit = normalizeLimit(input.limit, DEFAULT_LIMIT);
    const query = input.query.trim();
    if (query.length === 0) {
      throw new GreybeardMemoryError({
        code: "invalid-input",
        message: "recall query must not be empty.",
        guidance: "Call recall with a short task summary."
      });
    }

    const now = this.nowSeconds();
    const matches = this.searchMatches(tenant, query, limit);
    if (matches.length === 0) {
      return {
        tenant,
        query,
        message: NO_MEMORY_MESSAGE,
        results: []
      };
    }

    this.refreshLastUsed(matches.map((row) => row.id), tenant, now);
    const matchedNodes = matches.map((row) => this.toRecallNode(row, true, this.scoreMatch(row, now)));
    const expanded = this.expandOneHop(tenant, matchedNodes);
    return {
      tenant,
      query,
      message: RECALL_MESSAGE,
      results: [...matchedNodes, ...expanded]
    };
  }

  async remember(input: RememberInput): Promise<RememberResult> {
    enforcePrivacy(input.content, input.type);
    const tenant = await this.activeTenant();
    const now = this.nowSeconds();
    const content = input.content.trim();
    if (content.length === 0) {
      throw new GreybeardMemoryError({
        code: "invalid-input",
        message: "remember content must not be empty.",
        guidance: "Store a concise intent or preference."
      });
    }

    const links = input.links ?? [];
    const transaction = this.db.transaction(() => {
      let id: number;
      let action: RememberResult["action"];

      if (input.type === "preference") {
        const existing = this.findPreferenceToSupersede(tenant, content);
        if (existing) {
          id = existing.id;
          action = "updated";
          this.db.prepare(`
            UPDATE nodes
            SET content = @content, last_used_at = @now
            WHERE id = @id AND tenant = @tenant
          `).run({ content, now, id, tenant });
        } else {
          id = this.insertNode(input.type, content, tenant, now);
          action = "inserted";
        }
      } else {
        id = this.insertNode(input.type, content, tenant, now);
        action = "inserted";
      }

      const linked = this.writeLinks(id, tenant, links);
      this.evictTenant(tenant, now);
      return {
        tenant,
        action,
        id,
        type: input.type,
        content,
        linked
      };
    });

    return transaction();
  }

  async list(input: ListInput = {}): Promise<ListResult> {
    const tenant = await this.activeTenant();
    const limit = normalizeLimit(input.limit, MAX_LIMIT);
    const rows = input.type
      ? this.db.prepare(`
          SELECT id, type, content, tenant, created_at, last_used_at
          FROM nodes
          WHERE tenant = @tenant AND type = @type
          ORDER BY created_at DESC, id DESC
          LIMIT @limit
        `).all({ tenant, type: input.type, limit }) as NodeRow[]
      : this.db.prepare(`
          SELECT id, type, content, tenant, created_at, last_used_at
          FROM nodes
          WHERE tenant = @tenant
          ORDER BY created_at DESC, id DESC
          LIMIT @limit
        `).all({ tenant, limit }) as NodeRow[];

    return {
      tenant,
      results: rows.map(toMemoryNode)
    };
  }

  async forget(input: ForgetInput): Promise<ForgetResult> {
    const tenant = await this.activeTenant();
    const hasId = typeof input.id === "number";
    const hasOlder = typeof input.olderThanDays === "number";
    if (hasId === hasOlder) {
      throw new GreybeardMemoryError({
        code: "invalid-input",
        message: "forget requires either id or olderThanDays plus type.",
        guidance: "Use forget by id for a specific node, or olderThanDays with type for pruning."
      });
    }

    if (hasId) {
      const result = this.db.prepare("DELETE FROM nodes WHERE id = @id AND tenant = @tenant")
        .run({ id: input.id, tenant });
      return {
        tenant,
        deleted: result.changes
      };
    }

    if (!input.type || !input.olderThanDays || input.olderThanDays <= 0) {
      throw new GreybeardMemoryError({
        code: "invalid-input",
        message: "forget by age requires a positive olderThanDays value and a type.",
        guidance: "Pass olderThanDays with one memory type."
      });
    }

    const cutoff = this.nowSeconds() - Math.floor(input.olderThanDays * SECONDS_PER_DAY);
    const result = this.db.prepare(`
      DELETE FROM nodes
      WHERE tenant = @tenant AND type = @type AND last_used_at < @cutoff
    `).run({ tenant, type: input.type, cutoff });
    return {
      tenant,
      deleted: result.changes
    };
  }

  private async activeTenant(): Promise<string> {
    const config = await readGreybeardConfig(this.appDataPath);
    return config.activeTenantId || "organizations";
  }

  private nowSeconds(): number {
    const value = this.nowProvider();
    return Math.floor(value instanceof Date ? value.getTime() / 1000 : value / 1000);
  }

  private insertNode(type: MemoryType, content: string, tenant: string, now: number): number {
    const result = this.db.prepare(`
      INSERT INTO nodes (type, content, embedding, tenant, created_at, last_used_at)
      VALUES (@type, @content, NULL, @tenant, @now, @now)
    `).run({ type, content, tenant, now });
    return Number(result.lastInsertRowid);
  }

  private writeLinks(source: number, tenant: string, links: MemoryLinkInput[]): number {
    let linked = 0;
    for (const link of links) {
      const target = this.db.prepare("SELECT id FROM nodes WHERE id = @id AND tenant = @tenant")
        .get({ id: link.target, tenant }) as { id: number } | undefined;
      if (!target) {
        throw new GreybeardMemoryError({
          code: "target-not-found",
          message: `memory link target ${link.target} was not found for the active tenant.`,
          guidance: "Recall or list memory for the active tenant and link only to returned ids.",
          details: { target: link.target }
        });
      }

      this.db.prepare(`
        INSERT INTO edges (source, target, relation, weight)
        VALUES (@source, @target, @relation, @weight)
        ON CONFLICT(source, target, relation) DO UPDATE SET weight = excluded.weight
      `).run({
        source,
        target: link.target,
        relation: link.relation,
        weight: link.weight ?? 1
      });
      linked += 1;
    }

    return linked;
  }

  private searchMatches(tenant: string, query: string, limit: number): MatchRow[] {
    const tokens = tokenizeForSearch(query);
    const allQuery = ftsAllQuery(tokens);
    if (!allQuery) {
      return [];
    }

    const exact = this.runFtsSearch(tenant, allQuery, limit);
    if (exact.length > 0 || tokens.length <= 1) {
      return exact.map((row) => ({
        ...row,
        rank: Number(row.rank)
      }));
    }

    const anyQuery = ftsAnyQuery(tokens);
    return anyQuery ? this.runFtsSearch(tenant, anyQuery, limit).map((row) => ({
      ...row,
      rank: Number(row.rank)
    })) : [];
  }

  private runFtsSearch(tenant: string, match: string, limit: number): MatchRow[] {
    try {
      const rows = this.db.prepare(`
        SELECT n.id, n.type, n.content, n.tenant, n.created_at, n.last_used_at, bm25(nodes_fts) AS rank
        FROM nodes_fts
        JOIN nodes n ON n.id = nodes_fts.rowid
        WHERE nodes_fts MATCH @match AND n.tenant = @tenant
        ORDER BY rank ASC
        LIMIT @limit
      `).all({ match, tenant, limit: Math.max(limit * 3, limit) }) as MatchRow[];

      return rows
        .sort((left, right) => this.scoreMatch(right, this.nowSeconds()) - this.scoreMatch(left, this.nowSeconds()))
        .slice(0, limit);
    } catch {
      return [];
    }
  }

  private scoreMatch(row: MatchRow, now: number): number {
    const base = -Number(row.rank);
    const typeBoost = row.type === "preference" ? 1000 : row.type === "decision" ? 500 : 0;
    const ageDays = Math.max(0, (now - row.last_used_at) / SECONDS_PER_DAY);
    const recencyBoost = Math.max(0, 30 - ageDays);
    return base + typeBoost + recencyBoost;
  }

  private refreshLastUsed(ids: number[], tenant: string, now: number): void {
    if (ids.length === 0) {
      return;
    }

    const placeholders = ids.map(() => "?").join(",");
    this.db.prepare(`UPDATE nodes SET last_used_at = ? WHERE tenant = ? AND id IN (${placeholders})`)
      .run(now, tenant, ...ids);
  }

  private expandOneHop(tenant: string, matchedNodes: RecallResultNode[]): RecallResultNode[] {
    const seen = new Set(matchedNodes.map((node) => node.id));
    const expanded: RecallResultNode[] = [];
    for (const matched of matchedNodes) {
      const rows = this.db.prepare(`
        SELECT n.id, n.type, n.content, n.tenant, n.created_at, n.last_used_at,
               e.source, e.target, e.relation, e.weight
        FROM edges e
        JOIN nodes n ON n.id = CASE WHEN e.source = @id THEN e.target ELSE e.source END
        WHERE (e.source = @id OR e.target = @id) AND n.tenant = @tenant
        ORDER BY e.weight DESC, n.last_used_at DESC, n.id ASC
      `).all({ id: matched.id, tenant }) as EdgeExpansionRow[];

      for (const row of rows) {
        if (seen.has(row.id)) {
          continue;
        }

        seen.add(row.id);
        expanded.push({
          ...toMemoryNode(row),
          matched: false,
          score: matched.score - 0.001,
          linkedFrom: matched.id,
          relation: row.relation,
          edgeWeight: row.weight
        });
      }
    }

    return expanded;
  }

  private toRecallNode(row: MatchRow, matched: boolean, score: number): RecallResultNode {
    return {
      ...toMemoryNode(row),
      matched,
      score
    };
  }

  private findPreferenceToSupersede(tenant: string, content: string): NodeRow | null {
    const tokens = tokenizeForOverlap(content);
    const match = ftsAnyQuery(tokens);
    if (!match) {
      return null;
    }

    const candidates = this.runPreferenceSearch(tenant, match).map((row) => ({
      ...row,
      overlap_score: overlapScore(content, row.content)
    }));
    const best = candidates
      .filter((row) => row.overlap_score >= 0.45)
      .sort((left, right) => right.overlap_score - left.overlap_score)[0];

    return best ?? null;
  }

  private runPreferenceSearch(tenant: string, match: string): CandidateRow[] {
    try {
      return this.db.prepare(`
        SELECT n.id, n.type, n.content, n.tenant, n.created_at, n.last_used_at, bm25(nodes_fts) AS overlap_score
        FROM nodes_fts
        JOIN nodes n ON n.id = nodes_fts.rowid
        WHERE nodes_fts MATCH @match AND n.tenant = @tenant AND n.type = 'preference'
        ORDER BY overlap_score ASC
        LIMIT 20
      `).all({ match, tenant }) as CandidateRow[];
    } catch {
      return [];
    }
  }

  private evictTenant(tenant: string, now: number): void {
    const ttlCutoff = now - Math.floor(this.queryTtlDays * SECONDS_PER_DAY);
    this.db.prepare(`
      DELETE FROM nodes
      WHERE tenant = @tenant AND type = 'query' AND last_used_at < @ttlCutoff
    `).run({ tenant, ttlCutoff });

    const countRow = this.db.prepare("SELECT COUNT(*) AS count FROM nodes WHERE tenant = ?")
      .get(tenant) as { count: number };
    const overage = countRow.count - this.softCap;
    if (overage <= 0) {
      return;
    }

    const victims = this.db.prepare(`
      SELECT n.id
      FROM nodes n
      LEFT JOIN edges e ON e.source = n.id OR e.target = n.id
      WHERE n.tenant = @tenant
        AND NOT (
          n.type IN ('preference','decision')
          AND EXISTS (SELECT 1 FROM edges sticky WHERE sticky.source = n.id OR sticky.target = n.id)
        )
      GROUP BY n.id
      ORDER BY (n.last_used_at + COALESCE(SUM(e.weight), 0) * 86400) ASC,
               CASE n.type WHEN 'query' THEN 0 WHEN 'fact' THEN 1 WHEN 'scope' THEN 2 WHEN 'script' THEN 3 ELSE 4 END ASC,
               n.id ASC
      LIMIT @overage
    `).all({ tenant, overage }) as Array<{ id: number }>;

    if (victims.length === 0) {
      return;
    }

    const placeholders = victims.map(() => "?").join(",");
    this.db.prepare(`DELETE FROM nodes WHERE tenant = ? AND id IN (${placeholders})`)
      .run(tenant, ...victims.map((victim) => victim.id));
  }
}

export function enforcePrivacy(content: string, type?: MemoryType): void {
  const guids = content.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu) ?? [];
  const guidLimit = type === "decision" ? DECISION_GUID_PRIVACY_THRESHOLD : DEFAULT_GUID_PRIVACY_THRESHOLD;
  if (guids.length >= guidLimit) {
    throw new GreybeardMemoryError({
      code: "privacy-rejected",
      message: "Memory content looks like raw tenant output because it contains multiple GUIDs.",
      guidance: PRIVACY_GUIDANCE,
      details: { reason: "multiple-guids" }
    });
  }

  const emails = content.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu) ?? [];
  if (emails.length >= 2) {
    throw new GreybeardMemoryError({
      code: "privacy-rejected",
      message: "Memory content looks like raw tenant output because it contains multiple UPN-like emails.",
      guidance: PRIVACY_GUIDANCE,
      details: { reason: "multiple-upns" }
    });
  }

  const trimmed = content.trim();
  if ((trimmed.startsWith("{") || trimmed.startsWith("[")) && Buffer.byteLength(trimmed, "utf8") > JSON_PRIVACY_BYTE_THRESHOLD) {
    try {
      JSON.parse(trimmed);
      throw new GreybeardMemoryError({
        code: "privacy-rejected",
        message: "Memory content looks like a raw tenant JSON payload.",
        guidance: PRIVACY_GUIDANCE,
        details: { reason: "oversized-json" }
      });
    } catch (error) {
      if (error instanceof GreybeardMemoryError) {
        throw error;
      }
    }
  }
}

function normalizeLimit(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(value)));
}

function toMemoryNode(row: NodeRow): MemoryNode {
  return {
    id: row.id,
    type: row.type,
    content: row.content,
    tenant: row.tenant,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at
  };
}

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "is",
  "it",
  "not",
  "of",
  "on",
  "or",
  "the",
  "this",
  "to",
  "use",
  "when",
  "with"
]);

function tokenizeForSearch(value: string): string[] {
  return uniqueTokens(value)
    .filter((token) => !STOP_WORDS.has(token))
    .slice(0, 12);
}

function tokenizeForOverlap(value: string): string[] {
  return uniqueTokens(value)
    .filter((token) => !STOP_WORDS.has(token))
    .slice(0, 20);
}

function uniqueTokens(value: string): string[] {
  const tokens = value.toLowerCase().match(/[a-z0-9_]+/gu) ?? [];
  return [...new Set(tokens.filter((token) => token.length >= 2))];
}

function ftsAllQuery(tokens: string[]): string | null {
  if (tokens.length === 0) {
    return null;
  }

  return tokens.map(quoteFtsToken).join(" ");
}

function ftsAnyQuery(tokens: string[]): string | null {
  if (tokens.length === 0) {
    return null;
  }

  return tokens.map(quoteFtsToken).join(" OR ");
}

function quoteFtsToken(token: string): string {
  return `"${token.replaceAll("\"", "\"\"")}"`;
}

function overlapScore(left: string, right: string): number {
  const leftTokens = new Set(tokenizeForOverlap(left));
  const rightTokens = new Set(tokenizeForOverlap(right));
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  const jaccard = intersection / union;
  const containment = intersection / Math.min(leftTokens.size, rightTokens.size);
  return Math.max(jaccard, containment * 0.75);
}
