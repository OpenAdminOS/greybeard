import { createHash } from "node:crypto";
import { openMemoryDatabase } from "./database.js";
import type { Database } from "better-sqlite3";

export type MentorHost = "claude" | "codex" | "cursor" | "gemini" | "copilot";
export type MentorEventStatus = "context" | "companion" | "quiet" | "paused" | "duplicate" | "error";
type LedgerEvent = {id:number;host:MentorHost;event:string;createdAt:number;status:MentorEventStatus;bytes:number;memory_ids:string;rule_ids:string;candidateId:number|null;diagnostic:string|null};
export const MENTOR_RULES: Record<string, string> = {
  broad: "Broad rollout: establish the affected population, start with a representative pilot, and define stop conditions and recovery before expanding.",
  destructive: "Destructive change: verify the exact target and dependencies, preserve recovery evidence, and explain what cannot be undone before proceeding.",
  access: "Access change: check dependent sign-in paths and recovery access before rollout. A successful configuration change does not prove users can still access their resources.",
  evidence: "Current-state question: distinguish confirmed observations from assumptions. Use authorized read-only evidence before claiming what is configured or affected."
};

/** Bounded metadata only. Raw prompts, responses, credentials and transcripts are not persisted. */
export class AutomaticMentorStore {
  readonly db: Database;
  constructor(appDataPath: string, readonly profile: string, readonly tenant: string) {
    this.db = openMemoryDatabase(appDataPath, undefined, 200);
    this.db.exec(`CREATE TABLE IF NOT EXISTS automatic_mentor_events (
      id INTEGER PRIMARY KEY, profile TEXT NOT NULL, tenant TEXT NOT NULL, host TEXT NOT NULL,
      event TEXT NOT NULL, created_at INTEGER NOT NULL, status TEXT NOT NULL,
      bytes INTEGER NOT NULL, memory_ids TEXT NOT NULL, rule_ids TEXT NOT NULL,
      candidate_id INTEGER, fingerprint TEXT NOT NULL, diagnostic TEXT
    );
    CREATE INDEX IF NOT EXISTS automatic_mentor_recent ON automatic_mentor_events(profile,tenant,created_at);
    CREATE TABLE IF NOT EXISTS automatic_mentor_delivery (
      profile TEXT NOT NULL, tenant TEXT NOT NULL, fingerprint TEXT NOT NULL, created_at INTEGER NOT NULL,
      PRIMARY KEY(profile,tenant,fingerprint)
    );
    CREATE TABLE IF NOT EXISTS automatic_mentor_proposals (
      profile TEXT NOT NULL, tenant TEXT NOT NULL, fingerprint TEXT NOT NULL, created_at INTEGER NOT NULL,
      PRIMARY KEY(profile,tenant,fingerprint)
    );`);
  }
  close() { this.db.close(); }
  recentDuplicate(fingerprint: string, now = Date.now()) {
    return Boolean(this.db.prepare("SELECT 1 FROM automatic_mentor_events WHERE profile=? AND tenant=? AND fingerprint=? AND created_at>? AND status NOT IN ('error','paused') LIMIT 1").get(this.profile, this.tenant, fingerprint, now - 10_000));
  }
  claimContext(fingerprint: string, now = Date.now()): boolean {
    return this.db.prepare("INSERT INTO automatic_mentor_delivery VALUES (?,?,?,?) ON CONFLICT(profile,tenant,fingerprint) DO UPDATE SET created_at=excluded.created_at WHERE automatic_mentor_delivery.created_at<?")
      .run(this.profile,this.tenant,fingerprint,now,now-600_000).changes === 1;
  }
  claimProposal(content: string, now = Date.now()): boolean {
    const fingerprint = digest(content.toLowerCase().replace(/\s+/gu, " ").trim());
    if (this.db.prepare("SELECT 1 FROM nodes WHERE profile_id=? AND tenant=? AND lower(trim(content))=lower(trim(?)) LIMIT 1").get(this.profile, this.tenant, content)) return false;
    return this.db.prepare("INSERT OR IGNORE INTO automatic_mentor_proposals VALUES (?,?,?,?)").run(this.profile, this.tenant, fingerprint, now).changes === 1;
  }
  releaseProposal(content: string) {
    this.db.prepare("DELETE FROM automatic_mentor_proposals WHERE profile=? AND tenant=? AND fingerprint=?").run(this.profile, this.tenant, digest(content.toLowerCase().replace(/\s+/gu," ").trim()));
  }
  record(input: { host: MentorHost; event: string; status: MentorEventStatus; bytes?: number; memoryIds?: number[]; ruleIds?: string[]; candidateId?: number; fingerprint: string; diagnostic?: string }, now = Date.now()) {
    this.db.prepare("INSERT INTO automatic_mentor_events(profile,tenant,host,event,created_at,status,bytes,memory_ids,rule_ids,candidate_id,fingerprint,diagnostic) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(this.profile, this.tenant, input.host, input.event, now, input.status, input.bytes ?? 0, JSON.stringify(input.memoryIds ?? []), JSON.stringify(input.ruleIds ?? []), input.candidateId ?? null, input.fingerprint, input.diagnostic ?? null);
    this.db.prepare("DELETE FROM automatic_mentor_events WHERE profile=? AND tenant=? AND (created_at<? OR id NOT IN (SELECT id FROM automatic_mentor_events WHERE profile=? AND tenant=? ORDER BY id DESC LIMIT 1000))")
      .run(this.profile, this.tenant, now - 7 * 86400_000, this.profile, this.tenant);
    this.db.prepare("DELETE FROM automatic_mentor_delivery WHERE profile=? AND tenant=? AND created_at<?").run(this.profile,this.tenant,now-600_000);
    this.db.prepare("DELETE FROM automatic_mentor_proposals WHERE profile=? AND tenant=? AND created_at<?").run(this.profile,this.tenant,now - 90 * 86400_000);
  }
  summary() {
    this.db.prepare("DELETE FROM automatic_mentor_events WHERE profile=? AND tenant=? AND created_at<?").run(this.profile,this.tenant,Date.now()-7*86400_000);
    const hosts = this.db.prepare("SELECT host, MAX(created_at) AS lastSeen, COUNT(*) AS events, SUM(bytes) AS contextBytes, SUM(status IN ('context','companion')) AS adviceEvents, SUM(candidate_id IS NOT NULL) AS proposals FROM automatic_mentor_events WHERE profile=? AND tenant=? GROUP BY host").all(this.profile,this.tenant) as Array<{host:MentorHost;lastSeen:number;events:number;contextBytes:number;adviceEvents:number;proposals:number}>;
    const recent = (this.db.prepare("SELECT id,host,event,created_at AS createdAt,status,bytes,memory_ids,rule_ids,candidate_id AS candidateId,diagnostic FROM automatic_mentor_events WHERE profile=? AND tenant=? ORDER BY id DESC LIMIT 30").all(this.profile,this.tenant) as LedgerEvent[]).map(row => {
      const ids = JSON.parse(String(row.memory_ids)) as number[];
      const rules = JSON.parse(String(row.rule_ids)) as string[];
      const memories = ids.flatMap(id => {
        const memory = this.db.prepare("SELECT id,content FROM nodes WHERE id=? AND tenant=? AND profile_id=? AND status='confirmed' AND superseded_at IS NULL").get(id,this.tenant,this.profile) as {id:number;content:string}|undefined;
        return memory ? [memory] : [];
      });
      const { memory_ids, rule_ids, ...rest } = row;
      return { ...rest, memories, reminders: rules.flatMap(id => MENTOR_RULES[id] ? [MENTOR_RULES[id]] : []) };
    });
    return { hosts, recent, retentionDays: 7, storesPrompts: false };
  }
  clear() { this.db.prepare("DELETE FROM automatic_mentor_events WHERE profile=? AND tenant=?").run(this.profile,this.tenant); }
}
export function digest(text: string) { return createHash("sha256").update(text).digest("hex"); }
