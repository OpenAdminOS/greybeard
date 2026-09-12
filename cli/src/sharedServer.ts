import { createServer, type Server } from "node:http";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";
import { z } from "zod";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { MemoryService, AutomaticMentorStore, openMemoryDatabase, createGreybeardMemoryMcpServer, type MentorHost } from "@greybeard/memory";
import { readGreybeardConfig, updateGreybeardConfig } from "@greybeard/graph";
import { processMentorEvent } from "./automaticMentor.js";
import { readBoundedInput } from "./mentor.js";
import { SHARED_PROTOCOL, MAX_SHARED_BYTES, sharedUrl, type MemoryBackend } from "./sharedMemory.js";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const secret = () => randomBytes(32).toString("hex");
const label = z.string().min(1).max(256).regex(/^[^\r\n\0]+$/u);
const text = z.string().min(1).max(16384);
const id = z.number().int().positive();
const type = z.enum(["query", "preference", "script", "fact", "scope", "decision"]);
const rememberSchema = z.object({ type, content: text, scope: label.optional(), source: label.optional(), evidenceKind: z.enum(["rule", "observation", "inference", "context"]).optional(), observedAt: z.number().int().nonnegative().optional(), supersedes: id.optional(), expectedOriginalRevision: z.string().optional(), outcome: z.string().max(2048).optional() }).strict();
const listSchema = z.object({ query: z.string().max(512).optional(), scope: label.optional(), type: type.optional(), status: z.enum(["candidate", "confirmed"]).optional(), limit: z.number().int().min(1).max(200).optional(), cursor: id.optional() }).strict();
const empty = z.object({}).strict();
const reviewSchemas = {
  list: listSchema, export: z.object({cursor:z.number().int().nonnegative().optional(),snapshot:z.string().regex(/^[a-f0-9]{64}$/).optional()}).strict(), remember: rememberSchema,
  confirm: z.object({ id, expectedRevision: z.string().min(1).max(256), confirmationChannel: z.enum(["local-ui", "local-cli"]).optional() }).strict(),
  forget: z.object({ id, expectedRevision: z.string().min(1).max(256) }).strict(),
  proposeOutcome: z.object({ lesson: text, outcome: z.string().min(1).max(2048), source: label, scope: label.optional(), observedAt: z.number().int().nonnegative().optional() }).strict(),
  recordAdviceFeedback: z.object({ recallId: z.string().max(256), feedback: z.enum(["accepted", "ignored", "irrelevant"]) }).strict(),
  adviceMetrics: empty, adviceHistory: z.object({ limit: z.number().int().min(1).max(100).optional() }).strict(), clearAdviceMetrics: empty,
  pause: z.object({ paused: z.boolean() }).strict(), activity: empty
};
const eventSchema = z.object({ host: z.enum(["claude", "codex", "cursor", "gemini", "copilot"]), kind: z.enum(["start", "prompt", "tool", "after-tool", "stop"]), session: z.string().min(1).max(256), turn: z.string().max(256), text: z.string().max(8192).refine(value => Buffer.byteLength(value) <= 8192) }).strict();
type Device = { id: string; profile: string; tenant: string; role: "agent" | "review" };
class HttpError extends Error { constructor(readonly status: number) { super("Shared memory request rejected."); } }
export class SharedServerStore {
  readonly db: Database; readonly serverId: string;
  constructor(readonly appData: string) {
    this.db = openMemoryDatabase(appData);
    this.db.exec(`CREATE TABLE IF NOT EXISTS shared_identity(id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS shared_enrollment(hash TEXT PRIMARY KEY, profile TEXT NOT NULL, tenant TEXT NOT NULL, review INTEGER NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS shared_devices(id TEXT PRIMARY KEY, agent_hash TEXT NOT NULL UNIQUE, review_hash TEXT UNIQUE, profile TEXT NOT NULL, tenant TEXT NOT NULL, created INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS shared_operations(device TEXT NOT NULL, id TEXT NOT NULL, method TEXT NOT NULL, fingerprint TEXT NOT NULL, result TEXT, created INTEGER NOT NULL, PRIMARY KEY(device,id,method));`);
    this.db.transaction(() => { if (!this.db.prepare("SELECT id FROM shared_identity").get()) this.db.prepare("INSERT INTO shared_identity VALUES (?)").run(randomUUID()); })();
    this.serverId = (this.db.prepare("SELECT id FROM shared_identity").get() as { id: string }).id;
  }
  close() { this.db.close(); }
  enroll(profile: string, tenant: string, review = false): string {
    label.parse(profile); label.parse(tenant);
    const code = secret();
    this.db.prepare("DELETE FROM shared_enrollment WHERE expires < ?").run(Date.now());
    this.db.prepare("INSERT INTO shared_enrollment VALUES (?,?,?,?,?)").run(hash(code), profile, tenant, Number(review), Date.now() + 10 * 60_000);
    return code;
  }
  pair(code: string) {
    return this.db.transaction(() => {
      const row = this.db.prepare("SELECT * FROM shared_enrollment WHERE hash=? AND expires>?").get(hash(code), Date.now()) as { profile: string; tenant: string; review: number } | undefined;
      if (!row) throw new HttpError(401);
      const deviceId = randomUUID(); const agentToken = secret(); const reviewToken = row.review ? secret() : undefined;
      this.db.prepare("DELETE FROM shared_enrollment WHERE hash=?").run(hash(code));
      this.db.prepare("INSERT INTO shared_devices(id,agent_hash,review_hash,profile,tenant,created) VALUES (?,?,?,?,?,?)").run(deviceId, hash(agentToken), reviewToken ? hash(reviewToken) : null, row.profile, row.tenant, Date.now());
      return { protocol: SHARED_PROTOCOL, serverId: this.serverId, deviceId, profile: row.profile, tenant: row.tenant, agentToken, ...(reviewToken ? { reviewToken } : {}) };
    })();
  }
  authenticate(authorization: string | undefined): Device {
    const token = /^Bearer ([a-f0-9]{64})$/u.exec(authorization ?? "")?.[1]; if (!token) throw new HttpError(401);
    const digest = hash(token);
    const row = this.db.prepare("SELECT id,profile,tenant,review_hash FROM shared_devices WHERE revoked=0 AND (agent_hash=? OR review_hash=?)").get(digest, digest) as { id: string; profile: string; tenant: string; review_hash: string } | undefined;
    if (!row) throw new HttpError(401);
    return { id: row.id, profile: row.profile, tenant: row.tenant, role: row.review_hash === digest ? "review" : "agent" };
  }
  revoke(device: string) { this.db.prepare("UPDATE shared_devices SET revoked=1 WHERE id=?").run(device); }
  devices() { return this.db.prepare("SELECT id,profile,tenant,created,revoked FROM shared_devices").all(); }
  resetCredentials() {
    this.db.transaction(() => { this.db.prepare("UPDATE shared_devices SET revoked=1").run(); this.db.prepare("DELETE FROM shared_enrollment").run(); this.db.prepare("UPDATE shared_identity SET id=?").run(randomUUID()); })();
  }
  async mutation<T>(device: string, operation: string | undefined, method: string, input: unknown, run: () => Promise<T>): Promise<T> {
    const parsed = /^(\d{13})\.([a-f0-9-]{36})$/u.exec(operation ?? "");
    if (!parsed || Number(parsed[1]) > Date.now() + 60_000 || Number(parsed[1]) < Date.now() - 86400_000) throw new HttpError(409);
    this.db.prepare("DELETE FROM shared_operations WHERE created<?").run(Date.now() - 2 * 86400_000);
    const fingerprint = hash(JSON.stringify(input));
    const prior = this.db.prepare("SELECT fingerprint,result FROM shared_operations WHERE device=? AND id=? AND method=?").get(device, operation!, method) as { fingerprint: string; result: string | null } | undefined;
    if (prior) { if (prior.fingerprint !== fingerprint || prior.result === null) throw new HttpError(409); return JSON.parse(prior.result) as T; }
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = await run(); const serialized = JSON.stringify(result ?? null);
      if (Buffer.byteLength(serialized) > MAX_SHARED_BYTES) throw new HttpError(413);
      this.db.prepare("INSERT INTO shared_operations VALUES (?,?,?,?,?,?)").run(device, operation!, method, fingerprint, serialized, Date.now());
      this.db.exec("COMMIT"); return result;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
}
export async function startSharedServer(options: { appData: string; publicUrl: string; port?: number }): Promise<{ server: Server; port: number; close: () => Promise<void> }> {
  const publicOrigin = sharedUrl(options.publicUrl);
  const store = new SharedServerStore(options.appData);
  let queue: Promise<unknown> = Promise.resolve(); let pending = 0; let pairAttempts = 0; let requests = 0; let windowStart = Date.now();
  let localHost = "";
  const server = createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store"); response.setHeader("X-Content-Type-Options", "nosniff");
    const json = (status: number, body: unknown) => { const serialized = JSON.stringify(body ?? {}); if (Buffer.byteLength(serialized) > MAX_SHARED_BYTES) { response.writeHead(413, { "content-type": "application/json" }); response.end('{"error":"Response too large"}'); } else { response.writeHead(status, { "content-type": "application/json" }); response.end(serialized); } };
    try {
      if (![new URL(publicOrigin).host, localHost].includes(request.headers.host ?? "") || request.headers.origin && request.headers.origin !== publicOrigin) throw new HttpError(403);
      if (Date.now() - windowStart > 60_000) { windowStart = Date.now(); pairAttempts = 0; requests = 0; }
      if (++requests > 600 || pending >= 16) throw new HttpError(429);
      if (request.method !== "POST") { json(405, { error: "Use POST." }); return; }
      if (request.headers["content-type"]?.split(";")[0] !== "application/json") throw new HttpError(400);
      const path = request.url;
      if (request.headers["x-greybeard-protocol"] !== String(SHARED_PROTOCOL)) throw new HttpError(400);
      if (path === "/pair" && ++pairAttempts > 10) throw new HttpError(429);
      const body: unknown = JSON.parse(await readBoundedInput(request, 64 * 1024, 1500));
      pending++;
      const work = queue.then(async () => {
        if (response.destroyed) return;
        if (path === "/pair") { json(200, store.pair(z.object({ code: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(body).code)); return; }
        const device = store.authenticate(request.headers.authorization);
        if (request.headers["x-greybeard-store"] !== store.serverId) throw new HttpError(409);
        if (path === "/status") { const config = await readGreybeardConfig(options.appData); json(200, { protocol: SHARED_PROTOCOL, serverId: store.serverId, deviceId: device.id, profile: device.profile, tenant: device.tenant, paused: config.learningEnabled === false, capabilities: ["memory-tools", "mentor-events", "paged-export", "human-review"] }); return; }
        if (path === "/revoke-self") { store.revoke(device.id); json(200, { revoked: true }); return; }
        const service = new MemoryService({ appDataPath: options.appData, profileId: device.profile, tenantId: device.tenant, db: store.db, allowConfirmationWhilePaused: true });
        const forget: MemoryService["forget"] = async (input, candidatesOnly = false) => {
          const result = await service.forget(input, candidatesOnly);
          // Keep replay tombstones, but discard response snapshots that could retain forgotten text.
          if (result.deleted) store.db.prepare("UPDATE shared_operations SET result=NULL WHERE device IN (SELECT id FROM shared_devices WHERE profile=? AND tenant=?) AND method IN ('remember','confirm','proposeOutcome')").run(device.profile,device.tenant);
          return result;
        };
        const operation = typeof request.headers["x-greybeard-operation"] === "string" ? request.headers["x-greybeard-operation"] : undefined;
        if (path === "/mcp") {
          if (device.role !== "agent") throw new HttpError(403);
          const guarded: Pick<MemoryBackend, "recall" | "list" | "remember" | "forget" | "discoverScopes" | "proposeOutcome"> = {
            recall: input => service.recall(input), list: input => service.list(input), discoverScopes: input => service.discoverScopes(input),
            remember: input => store.mutation(device.id, operation, "remember", input, () => service.remember(input)),
            forget: input => store.mutation(device.id, operation, "forget", input, () => forget(input, true)),
            proposeOutcome: input => store.mutation(device.id, operation, "proposeOutcome", input, () => service.proposeOutcome(input))
          };
          const mcp = createGreybeardMemoryMcpServer(guarded);
          const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
          try { await mcp.connect(transport); await transport.handleRequest(request, response, body); }
          finally { await mcp.close(); await transport.close(); }
          return;
        }
        if (path === "/event") {
          if (device.role !== "agent") throw new HttpError(403);
          const event = eventSchema.parse(body);
          const input = { session_id: hash(device.id + ":" + event.session), turn_id: event.turn, ...(event.kind === "start" ? { initialPrompt: event.text } : event.kind === "prompt" || event.kind === "stop" ? { prompt: event.text, transformedPrompt: event.text } : { command: event.text }) };
          json(200, await processMentorEvent({ appData: options.appData, profile: device.profile, tenant: device.tenant, host: event.host as MentorHost, kind: event.kind, input })); return;
        }
        if (path !== "/review") throw new HttpError(404);
        if (device.role !== "review") throw new HttpError(403);
        const command = z.object({ method: z.enum(Object.keys(reviewSchemas) as [keyof typeof reviewSchemas, ...Array<keyof typeof reviewSchemas>]), input: z.unknown() }).strict().parse(body);
        const input = reviewSchemas[command.method].parse(command.input) as any;
        if (command.method === "pause") { await updateGreybeardConfig(options.appData, current => ({ ...current, learningEnabled: !input.paused })); json(200, { result: { paused: input.paused } }); return; }
        if (command.method === "activity") { const activity = new AutomaticMentorStore(options.appData, device.profile, device.tenant); try { json(200, { result: { ...activity.summary(), paused: (await readGreybeardConfig(options.appData)).learningEnabled === false } }); } finally { activity.close(); } return; }
        const run = async () => {
          switch (command.method) {
            case "list": return service.list(input);
            case "export": {
              const all = await service.export(); const snapshot = hash(JSON.stringify(all));
              if (input.snapshot && input.snapshot !== snapshot) throw new HttpError(409);
              const remaining = all.nodes.filter(node => node.id > (input.cursor ?? 0)); const nodes = remaining.slice(0,25); const ids = new Set(nodes.map(node=>node.id));
              return {...all,nodes,edges:all.edges.filter(edge=>ids.has(edge.source)),snapshot,...(remaining.length>nodes.length?{nextCursor:nodes.at(-1)!.id}:{})};
            }
            case "remember": {
              if (input.supersedes) { const node = (await service.export()).nodes.find(n => n.id === input.supersedes); if (!node || node.revision !== input.expectedOriginalRevision) throw new HttpError(409); }
              const { expectedOriginalRevision: _, ...record } = input; return service.remember(record);
            }
            case "confirm": { const node = (await service.export()).nodes.find(n => n.id === input.id); if (!node || node.status !== "candidate") throw new HttpError(409); return service.confirm(input); }
            case "forget": { const node = (await service.export()).nodes.find(n => n.id === input.id); if (!node || node.revision !== input.expectedRevision) throw new HttpError(409); return forget({ id: input.id }); }
            case "proposeOutcome": return service.proposeOutcome(input);
            case "recordAdviceFeedback": return service.recordAdviceFeedback(input);
            case "adviceMetrics": return service.adviceMetrics();
            case "adviceHistory": return service.adviceHistory(input.limit);
            case "clearAdviceMetrics": return service.clearAdviceMetrics();
          }
        };
        const mutates = ["remember", "confirm", "forget", "proposeOutcome", "recordAdviceFeedback", "clearAdviceMetrics"].includes(command.method);
        const result = mutates ? await store.mutation(device.id, operation, command.method, input, run) : await run();
        if (command.method === "clearAdviceMetrics") { const activity = new AutomaticMentorStore(options.appData, device.profile, device.tenant); try { activity.clear(); } finally { activity.close(); } }
        json(200, { result: result ?? null });
      });
      queue = work.catch(() => {});
      try { await work; } finally { pending--; }
    } catch (error) { if (!response.headersSent) json(error instanceof HttpError ? error.status : error instanceof z.ZodError || error instanceof SyntaxError ? 400 : error instanceof Error && error.message === "Input exceeds limit." ? 413 : 409, { error: "Shared memory request could not complete. Refresh and check the connection before retrying." }); else response.destroy(); }
  });
  server.requestTimeout = 5000; server.headersTimeout = 5000; server.maxConnections = 32;
  try { await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(options.port ?? 0, "127.0.0.1", resolve); }); }
  catch (error) { store.close(); throw error; }
  const port = (server.address() as { port: number }).port; localHost = `127.0.0.1:${port}`;
  return { server, port, close: async () => { await new Promise<void>(resolve => { server.close(() => resolve()); server.closeIdleConnections(); }); await queue; store.close(); } };
}
