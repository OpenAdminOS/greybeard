import type { Database as SqliteDatabase } from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { openMemoryDatabase } from "./database.js";
import {
  GreybeardMemoryError, MEMORY_TYPES, EDGE_RELATIONS, memoryTypePolicy,
  type ConfirmInput, type EdgeRelation, type ForgetInput, type ForgetResult,
  type ListInput, type ListResult, type MemoryExport, type MemoryLinkInput,
  type MemoryNode, type MemoryStatus, type MemoryType, type RecallInput,
  type RecallResult, type RecallResultNode, type RememberInput, type RememberResult
} from "./types.js";

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 50;
const DEFAULT_SOFT_CAP = 2000;
const DEFAULT_TOKEN_BUDGET = 800;
const QUERY_TTL_DAYS = 90;
const JSON_PRIVACY_BYTE_THRESHOLD = 2048;
const SECONDS_PER_DAY = 24 * 60 * 60;
const PRIVACY_GUIDANCE = "Store the intent, preference, threshold, or report shape instead of raw tenant output.";

type NowProvider = () => number | Date;
export type MemoryServiceOptions = {
  appDataPath: string;
  profileId?: string;
  tenantId?: string;
  dbPath?: string;
  db?: SqliteDatabase;
  now?: NowProvider;
  softCap?: number;
  queryTtlDays?: number;
};

type NodeRow = {
  id: number; revision: string; type: MemoryType; content: string; tenant: string;
  created_at: number; last_used_at: number; profile_id: string;
  status: MemoryStatus; source: string; scope: string; confirmed_at: number | null;
  confirmed_by: string | null; supersedes: number | null; superseded_at: number | null;
};
type MatchRow = NodeRow & { rank: number };

// The service identity is bound once at construction. A concurrently selected
// tenant/profile in another client must not redirect an existing session.
export class MemoryService {
  private readonly appDataPath: string;
  private readonly db: SqliteDatabase;
  private readonly ownsDb: boolean;
  private readonly nowProvider: NowProvider;
  private readonly softCap: number;
  private readonly queryTtlDays: number;
  readonly tenant: string;
  readonly profileId: string;

  constructor(options: MemoryServiceOptions) {
    this.appDataPath = options.appDataPath;
    const config = readLocalConfig(this.appDataPath);
    this.tenant = options.tenantId ?? nonEmpty(process.env.GREYBEARD_TENANT_ID) ?? nonEmpty(config.activeTenantId) ?? "local";
    validateLabel(this.tenant, "tenantId");
    this.profileId = options.profileId ?? nonEmpty(process.env.GREYBEARD_PROFILE_ID) ?? nonEmpty(config.profileId) ?? this.tenant;
    validateLabel(this.profileId, "profileId");
    this.db = options.db ?? openMemoryDatabase(options.appDataPath, options.dbPath);
    this.ownsDb = !options.db;
    this.nowProvider = options.now ?? (() => Date.now());
    this.softCap = options.softCap ?? DEFAULT_SOFT_CAP;
    this.queryTtlDays = options.queryTtlDays ?? QUERY_TTL_DAYS;
  }

  close(): void { if (this.ownsDb) this.db.close(); }

  async recall(input: RecallInput): Promise<RecallResult> {
    const limit = normalizeLimit(input.limit, DEFAULT_LIMIT);
    const tokenBudget = normalizeBudget(input.tokenBudget);
    const query = input.query.trim();
    if (!query || Buffer.byteLength(query,"utf8") > 512) throw invalid("Recall query must be between 1 and 512 UTF-8 bytes.");
    const scope = input.scope ?? "global";
    validateLabel(scope, "scope");
    const now = this.nowSeconds();
    this.expireQueries(now);
    const matches = this.searchMatches(query, scope, limit);
    const matched = matches.map(row => ({ ...toRecallMemory(row), matched: true, score: this.scoreMatch(row, now) }));
    const expanded = this.expandOneHop(matched, scope);
    const results: RecallResultNode[] = [];
    let estimatedTokens = 0;
    // An applicable exception is more specific than the matched general rule.
    // If the exception cannot fit, suppress its parent rather than returning a
    // misleading general rule without the qualification.
    const exceptions = expanded.filter(node => node.relation === "exception_to");
    const qualifiedParents = new Set(exceptions.map(node => node.linkedFrom));
    const ordered = [...exceptions, ...matched.filter(node => !qualifiedParents.has(node.id)),
      ...expanded.filter(node => node.relation !== "exception_to")];
    for (const node of ordered) {
      // UTF-8 bytes conservatively bound byte-based tokenizers, including all
      // recalled node metadata and JSON escaping. This is a budget, not billing.
      const cost = Buffer.byteLength(JSON.stringify(node), "utf8") + 1;
      if (results.some(result => result.id === node.id)) continue;
      if (results.length >= limit) break;
      if (estimatedTokens + cost > tokenBudget) continue;
      results.push(node);
      estimatedTokens += cost;
    }
    this.refreshLastUsed(results.map(node => node.id), now);
    return {
      tenant: this.tenant, message: results.length ? "memory recalled" : "no memory for this yet",
      results, estimatedTokens, tokenBudget, budgetScope: "serialized-recalled-nodes"
    };
  }

  async remember(input: RememberInput): Promise<RememberResult> {
    this.assertLearningEnabled();
    if (!MEMORY_TYPES.includes(input.type)) throw invalid("Unknown memory type.");
    const content = input.content.trim();
    if (!content || Buffer.byteLength(content, "utf8") > 16384) throw invalid("Memory content must be between 1 and 16384 UTF-8 bytes.");
    enforcePrivacy(content, input.type);
    const source = input.source ?? "agent-proposal";
    const scope = input.scope ?? "global";
    validateLabel(source, "source");
    validateLabel(scope, "scope");
    enforcePrivacy(source);
    enforcePrivacy(scope);
    const now = this.nowSeconds();
    return this.db.transaction(() => {
      if (input.supersedes !== undefined) {
        const original = this.requireNode(input.supersedes);
        if (original.scope !== scope || original.type !== input.type) {
          throw invalid("Corrections must keep the original type and scope. Use a linked exception for a narrower rule.");
        }
      }
      const result = this.db.prepare(`INSERT INTO nodes
        (type,content,tenant,profile_id,created_at,last_used_at,status,source,scope,supersedes,revision)
        VALUES (@type,@content,@tenant,@profile,@now,@now,'candidate',@source,@scope,@supersedes,@revision)`)
        .run({ type: input.type, content, ...this.identity(), now, source, scope, supersedes: input.supersedes ?? null, revision: randomUUID() });
      const id = Number(result.lastInsertRowid);
      const linked = this.writeLinks(id, input.links ?? []);
      this.evictCandidates(now, id);
      return { tenant: this.tenant, action: "inserted" as const, id, type: input.type, content, linked, status: "candidate" as const };
    })();
  }

  /** Trusted local control only. Deliberately absent from the MCP tool surface.
   * This is a product trust boundary, not isolation from same-user shell access. */
  async confirm(input: ConfirmInput): Promise<MemoryNode> {
    this.assertLearningEnabled();
    return this.db.transaction(() => {
      const node = this.requireNode(input.id);
      if (typeof input.expectedRevision !== "string" || !input.expectedRevision || node.revision !== input.expectedRevision) {
        throw invalid("This memory changed after it was displayed. Review the current record before confirming.");
      }
      enforcePrivacy(node.content, node.type);
      if (node.superseded_at !== null) throw invalid("This memory was superseded. Review its latest correction instead.");
      if (node.status === "confirmed") return toMemoryNode(node);
      if (node.supersedes !== null) {
        const original = this.requireNode(node.supersedes);
        if (original.superseded_at !== null) throw invalid("This memory already has a confirmed correction. Correct the latest record instead.");
        if (original.scope !== node.scope || original.type !== node.type) throw invalid("Correction scope no longer matches.");
        const existing = this.db.prepare(`SELECT id FROM nodes WHERE supersedes = @id
          AND status = 'confirmed' AND tenant = @tenant AND profile_id = @profile AND id != @self`)
          .get({ ...this.identity(), id: node.supersedes, self: node.id });
        if (existing) throw invalid("This memory already has a confirmed correction. Correct the latest record instead.");
      }
      const channel = input.confirmationChannel ?? "local-cli";
      if (channel !== "local-cli" && channel !== "local-ui") throw invalid("Invalid confirmation channel.");
      this.db.prepare(`UPDATE nodes SET status = 'confirmed', confirmed_at = COALESCE(confirmed_at,@now),
        confirmed_by = COALESCE(confirmed_by,@channel) WHERE id = @id AND tenant = @tenant AND profile_id = @profile`)
        .run({ ...this.identity(), id: input.id, now: this.nowSeconds(), channel });
      if (node.supersedes !== null) {
        this.db.prepare("UPDATE nodes SET superseded_at=@now WHERE id=@id AND tenant=@tenant AND profile_id=@profile")
          .run({ ...this.identity(), id: node.supersedes, now: this.nowSeconds() });
      }
      return toMemoryNode(this.requireNode(input.id));
    })();
  }

  async list(input: ListInput = {}): Promise<ListResult> {
    const limit = normalizeLimit(input.limit, MAX_LIMIT);
    if (input.cursor !== undefined && (!Number.isSafeInteger(input.cursor) || input.cursor < 1)) throw invalid("Invalid list cursor.");
    if (input.status !== undefined && !["candidate", "confirmed"].includes(input.status)) throw invalid("Invalid memory status.");
    const rows = this.db.prepare(`SELECT * FROM nodes WHERE tenant = @tenant AND profile_id = @profile
      AND (@type IS NULL OR type = @type) AND (@status IS NULL OR status = @status)
      AND (@cursor IS NULL OR id < @cursor) ORDER BY id DESC LIMIT @limit`)
      .all({ ...this.identity(), type: input.type ?? null, status: input.status ?? null, cursor: input.cursor ?? null, limit: limit + 1 }) as NodeRow[];
    const page = rows.slice(0, limit);
    return { tenant: this.tenant, results: page.map(toMemoryNode), ...(rows.length > limit ? { nextCursor: page.at(-1)!.id } : {}) };
  }

  /** Complete local export; intentionally not an MCP tool to avoid unbounded context. */
  async export(): Promise<MemoryExport> {
    return this.db.transaction(() => ({
      version: 1 as const, tenant: this.tenant, profileId: this.profileId,
      nodes: (this.db.prepare("SELECT * FROM nodes WHERE tenant = @tenant AND profile_id = @profile ORDER BY id")
        .all(this.identity()) as NodeRow[]).map(toMemoryNode),
      edges: this.db.prepare(`SELECT e.* FROM edges e JOIN nodes n ON n.id=e.source JOIN nodes t ON t.id=e.target
        WHERE n.tenant=@tenant AND n.profile_id=@profile AND t.tenant=@tenant AND t.profile_id=@profile
        ORDER BY e.source,e.target,e.relation`).all(this.identity()) as MemoryExport["edges"]
    }))();
  }

  async forget(input: ForgetInput, candidatesOnly = false): Promise<ForgetResult> {
    const hasId = typeof input.id === "number";
    const hasAge = typeof input.olderThanDays === "number";
    if (hasId === hasAge) throw invalid("forget requires either id or olderThanDays plus type.");
    let deleted: number;
    if (hasId) {
      if (!Number.isSafeInteger(input.id) || input.id! < 1) throw invalid("Invalid memory id.");
      deleted = this.db.prepare("DELETE FROM nodes WHERE id=@id AND tenant=@tenant AND profile_id=@profile AND (@candidatesOnly=0 OR status='candidate')")
        .run({ ...this.identity(), id: input.id, candidatesOnly: Number(candidatesOnly) }).changes;
    } else {
      if (!input.type || !Number.isFinite(input.olderThanDays) || input.olderThanDays! <= 0) throw invalid("Age pruning requires a positive olderThanDays and type.");
      deleted = this.db.prepare(`DELETE FROM nodes WHERE tenant=@tenant AND profile_id=@profile
        AND type=@type AND last_used_at < @cutoff AND (@candidatesOnly=0 OR status='candidate')`).run({ ...this.identity(), type: input.type, candidatesOnly:Number(candidatesOnly),
        cutoff: this.nowSeconds() - Math.floor(input.olderThanDays! * SECONDS_PER_DAY) }).changes;
    }
    return { tenant: this.tenant, deleted };
  }

  private identity() { return { tenant: this.tenant, profile: this.profileId }; }
  private nowSeconds(): number {
    const value = this.nowProvider();
    return Math.floor((value instanceof Date ? value.getTime() : value) / 1000);
  }
  private assertLearningEnabled(): void {
    if (readLocalConfig(this.appDataPath).learningEnabled === false) {
      throw new GreybeardMemoryError({ code: "learning-disabled", message: "Learning is paused.", guidance: "Resume learning in Greybeard's local settings before proposing or confirming memories." });
    }
  }
  private requireNode(id: number): NodeRow {
    if (!Number.isSafeInteger(id) || id < 1) throw invalid("Invalid memory id.");
    const row = this.db.prepare("SELECT * FROM nodes WHERE id=@id AND tenant=@tenant AND profile_id=@profile")
      .get({ ...this.identity(), id }) as NodeRow | undefined;
    if (!row) throw new GreybeardMemoryError({ code: "target-not-found", message: "Memory target was not found in this profile.", guidance: "List this profile's memories and use a returned id." });
    return row;
  }
  private writeLinks(source: number, links: MemoryLinkInput[]): number {
    if (links.length > 50) throw invalid("A memory can have at most 50 links.");
    for (const link of links) {
      this.requireNode(link.target);
      if (!EDGE_RELATIONS.includes(link.relation) || !Number.isFinite(link.weight ?? 1) || (link.weight ?? 1) <= 0) throw invalid("Invalid memory link.");
      this.db.prepare(`INSERT INTO edges(source,target,relation,weight) VALUES(?,?,?,?)
        ON CONFLICT(source,target,relation) DO UPDATE SET weight=excluded.weight`)
        .run(source, link.target, link.relation, Math.min(link.weight ?? 1, 100));
    }
    return links.length;
  }
  private searchMatches(query: string, scope: string, limit: number): MatchRow[] {
    const tokens = tokenizeForSearch(query);
    const all = ftsAllQuery(tokens);
    if (!all) return [];
    const exact = this.runFtsSearch(all, scope, limit);
    if (exact.length || tokens.length <= 1) return exact;
    return this.runFtsSearch(ftsAnyQuery(tokens)!, scope, limit);
  }
  private runFtsSearch(match: string, scope: string, limit: number): MatchRow[] {
    const rows = this.db.prepare(`SELECT n.*,bm25(nodes_fts) AS rank FROM nodes_fts
      JOIN nodes n ON n.id=nodes_fts.rowid WHERE nodes_fts MATCH @match AND ${applicableSql()}
      ORDER BY rank ASC LIMIT @limit`).all({ ...this.identity(), match, scope, limit: limit * 3 }) as MatchRow[];
    return rows.sort((a,b) => this.scoreMatch(b,this.nowSeconds()) - this.scoreMatch(a,this.nowSeconds())).slice(0,limit);
  }
  private scoreMatch(row: MatchRow, now: number): number {
    return -Number(row.rank) + memoryTypePolicy(row.type).recallBoost + Math.max(0,30-(now-row.last_used_at)/SECONDS_PER_DAY);
  }
  private expandOneHop(matched: RecallResultNode[], scope: string): RecallResultNode[] {
    const seen = new Set(matched.map(n => n.id));
    const expanded: RecallResultNode[] = [];
    for (const node of matched) {
      const rows = this.db.prepare(`SELECT n.*,e.relation,e.weight,e.source FROM edges e
        JOIN nodes n ON n.id=CASE WHEN e.source=@id THEN e.target ELSE e.source END
        WHERE (e.source=@id OR e.target=@id) AND ${applicableSql()}
        ORDER BY CASE WHEN e.relation='exception_to' AND e.target=@id THEN 0 ELSE 1 END,e.weight DESC,n.id DESC LIMIT 50`)
        .all({ ...this.identity(), id: node.id, scope }) as Array<NodeRow & { relation: EdgeRelation; weight: number; source: number }>;
      for (const row of rows) {
        if (row.relation === "exception_to" && row.source !== row.id) continue;
        if (seen.has(row.id) && row.relation !== "exception_to") continue;
        seen.add(row.id);
        expanded.push({ ...toRecallMemory(row), matched: false, score: node.score-0.001, linkedFrom: node.id, relation: row.relation, edgeWeight: row.weight });
      }
    }
    return expanded;
  }
  private refreshLastUsed(ids: number[], now: number): void {
    const update = this.db.prepare("UPDATE nodes SET last_used_at=@now WHERE id=@id AND tenant=@tenant AND profile_id=@profile");
    this.db.transaction(() => { for (const id of ids) update.run({ ...this.identity(), id, now }); })();
  }
  private expireQueries(now: number): void {
    this.db.prepare(`DELETE FROM nodes WHERE tenant=@tenant AND profile_id=@profile AND type='query'
      AND last_used_at < @cutoff`).run({ ...this.identity(), cutoff: now-this.queryTtlDays*SECONDS_PER_DAY });
  }
  private evictCandidates(now: number, insertedId: number): void {
    this.expireQueries(now);
    // Confirmed guidance is human-owned: pressure from agent proposals must not
    // silently evict it. The cap applies only to unconfirmed proposals.
    this.db.prepare(`DELETE FROM nodes WHERE id IN (
      SELECT id FROM nodes WHERE tenant=@tenant AND profile_id=@profile AND status='candidate' AND id!=@insertedId
      ORDER BY id DESC LIMIT -1 OFFSET @keep)`)
      .run({ ...this.identity(), insertedId, keep: Math.max(0,this.softCap-1) });
  }
}

function applicableSql(): string {
  return `n.tenant=@tenant AND n.profile_id=@profile AND n.status='confirmed' AND n.superseded_at IS NULL
    AND (n.scope='global' OR n.scope=@scope)
    AND NOT EXISTS (SELECT 1 FROM nodes newer WHERE newer.supersedes=n.id AND newer.status='confirmed'
      AND newer.tenant=n.tenant AND newer.profile_id=n.profile_id)`;
}
function readLocalConfig(appDataPath: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(appDataPath,"config.json"),"utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid Greybeard configuration.");
    return parsed as Record<string,unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}
function nonEmpty(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value : undefined; }
function validateLabel(value: string, field: string): void {
  if (!value.trim() || value.length>256 || /[\r\n\u0000]/u.test(value)) throw invalid(`Invalid ${field}.`);
}
function invalid(message: string): GreybeardMemoryError {
  return new GreybeardMemoryError({ code: "invalid-input", message, guidance: "Check the local memory request and try again." });
}
function normalizeLimit(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(1,Math.min(MAX_LIMIT,Math.floor(value))) : fallback;
}
function normalizeBudget(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0,Math.min(DEFAULT_TOKEN_BUDGET,Math.floor(value))) : DEFAULT_TOKEN_BUDGET;
}
function toMemoryNode(row: NodeRow): MemoryNode {
  return { id: row.id,revision: row.revision,type: row.type,content: row.content,tenant: row.tenant,createdAt: row.created_at,lastUsedAt: row.last_used_at,
    profileId: row.profile_id,status: row.status,source: row.source,scope: row.scope,confirmedAt: row.confirmed_at,
    confirmationChannel: row.confirmed_by,supersedes: row.supersedes,supersededAt: row.superseded_at };
}
function toRecallMemory(row: NodeRow): Omit<MemoryNode, "revision" | "confirmationChannel" | "supersedes" | "supersededAt"> {
  const { revision: _revision, confirmationChannel: _channel, supersedes: _supersedes, supersededAt: _supersededAt, ...context } = toMemoryNode(row);
  return context;
}

export function enforcePrivacy(content: string, type?: MemoryType): void {
  const credentialPattern = /-----BEGIN (?:[A-Z ]*PRIVATE KEY|CERTIFICATE)-----|\bBearer\s+[A-Za-z0-9._~+/-]+=*|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|["']?(?:client[_-]?secret|access[_-]?token|refresh[_-]?token|api[_-]?key|password|secretText|private[_-]?key)["']?\s*[:=]\s*\S+|\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-(?:proj-|ant-)?[A-Za-z0-9_-]{16,})/iu;
  if (credentialPattern.test(content)) {
    throw new GreybeardMemoryError({ code: "privacy-rejected", message: "Memory content appears to contain credentials.", guidance: PRIVACY_GUIDANCE, details: { reason: "credentials" } });
  }
  try {
    const parsed: unknown = JSON.parse(content);
    if (Array.isArray(parsed) || (parsed && typeof parsed === "object" && ("value" in parsed || "@odata.context" in parsed))) {
      throw new GreybeardMemoryError({ code: "privacy-rejected", message: "Memory content appears to be raw service output.", guidance: PRIVACY_GUIDANCE, details: { reason: "raw-json" } });
    }
  } catch (error) {
    if (error instanceof GreybeardMemoryError) throw error;
  }
  const guids = content.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu) ?? [];
  const guidLimit = memoryTypePolicy(type).guidPrivacyThreshold;
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
