import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { MemoryService, GreybeardMemoryError, type MemoryServiceOptions } from "@greybeard/memory";
import { saveClientSecret, loadClientSecret, removeClientSecret, readGreybeardConfig } from "@greybeard/graph";
import { withClientConfigLock, writeClientConfigAtomic } from "./clientConfigFile.js";

export const SHARED_PROTOCOL = 1;
export const MAX_SHARED_BYTES = 4 * 1024 * 1024;
const label = z.string().min(1).max(256).regex(/^[^\r\n\0]+$/u);
export const bindingSchema = z.object({ version: z.literal(1), mode: z.literal("remote"), url: z.string().url(), serverId: z.string().uuid(), deviceId: z.string().uuid(), profile: label, tenant: label, agentRef: z.string().regex(/^[a-f0-9]{64}$/), reviewRef: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict();
export type RemoteBinding = z.infer<typeof bindingSchema>;
export type MemoryBackend = Pick<MemoryService, "tenant" | "profileId" | "close" | "recall" | "remember" | "confirm" | "list" | "export" | "forget" | "discoverScopes" | "proposeOutcome" | "recordAdviceFeedback" | "adviceMetrics" | "adviceHistory" | "clearAdviceMetrics">;
export type CredentialStore = { save: typeof saveClientSecret; load: typeof loadClientSecret; remove: typeof removeClientSecret };
export const credentials: CredentialStore = { save: saveClientSecret, load: loadClientSecret, remove: removeClientSecret };
export function sharedUrl(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("Use an HTTPS server origin with a trusted certificate, without a path or credentials.");
  return url.origin;
}
const configPath = (appData: string) => join(appData, "memory-backend.json");
export async function readMemoryBinding(appData: string): Promise<RemoteBinding | undefined> {
  try {
    const text = await readFile(configPath(appData), "utf8");
    if (text.length > 8192) throw new Error("Invalid shared memory configuration.");
    const parsed = JSON.parse(text);
    if (parsed.version === 1 && parsed.mode === "local") return undefined;
    const binding = bindingSchema.parse(parsed); sharedUrl(binding.url); return binding;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error("Shared memory configuration is invalid. Repair it in Advanced settings; local memory has not been substituted.");
  }
}
export function bindingKey(binding?: RemoteBinding): string { return binding ? `${binding.serverId}:${binding.deviceId}:${binding.profile}:${binding.tenant}` : "local"; }
export async function saveMemoryBinding(appData: string, binding?: RemoteBinding): Promise<void> {
  await withClientConfigLock(configPath(appData), () => writeClientConfigAtomic(configPath(appData), JSON.stringify(binding ?? { version: 1, mode: "local" }) + "\n"));
}
export function operationId(): string { return `${Date.now()}.${randomUUID()}`; }
export async function boundedJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Shared memory returned an empty response.");
  let bytes = 0; const chunks: Uint8Array[] = [];
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > MAX_SHARED_BYTES) throw new Error("Shared memory response exceeds the limit. Narrow the request."); chunks.push(value); }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export async function sharedRequest(url: string, path: string, body: unknown, token?: string, options: { signal?: AbortSignal; serverId?: string; operation?: string; fetcher?: typeof fetch } = {}): Promise<any> {
  sharedUrl(url);
  const response = await (options.fetcher ?? fetch)(url + path, { method: "POST", redirect: "error", signal: options.signal ?? AbortSignal.timeout(5000), headers: { "content-type": "application/json", "x-greybeard-protocol": String(SHARED_PROTOCOL), ...(token ? { authorization: `Bearer ${token}` } : {}), ...(options.serverId ? { "x-greybeard-store": options.serverId } : {}), ...(options.operation ? { "x-greybeard-operation": options.operation } : {}) }, body: JSON.stringify(body) });
  const result = await boundedJson(response) as Record<string, any>;
  if (!response.ok) {
    const messages: Record<number, string> = { 400: "Invalid shared memory request or incompatible protocol.", 401: "Shared memory credentials expired or were revoked. Pair this device again.", 403: "This device is not authorized for that shared memory action.", 409: "Shared memory changed or this operation is unresolved. Refresh and review again.", 413: "Shared memory request or response exceeds the limit. Narrow the request.", 429: "Shared memory is busy. Try again later." };
    throw new Error(messages[response.status] ?? "Shared memory is unavailable. The operation may have completed; inspect its result before repeating it.");
  }
  return result;
}
const handshake = z.object({ protocol: z.literal(SHARED_PROTOCOL), serverId: z.string().uuid(), deviceId: z.string().uuid(), profile: label, tenant: label, paused: z.boolean(), capabilities: z.array(z.string()) });
export class RemoteMemory implements MemoryBackend {
  readonly tenant: string; readonly profileId: string;
  constructor(readonly appData: string, readonly binding: RemoteBinding, private readonly review = false, private readonly store = credentials) { this.tenant = binding.tenant; this.profileId = binding.profile; }
  close() { /* Requests own and close their transports. */ }
  async token(signal?: AbortSignal) { const ref = this.review ? this.binding.reviewRef : this.binding.agentRef; if (!ref) throw new Error("This device has no review authority. Pair again with a review-enabled code from the server owner."); return this.store.load(this.appData, ref, signal); }
  async request(path: string, body: unknown = {}, signal?: AbortSignal, operation?: string) { return sharedRequest(this.binding.url, path, body, await this.token(signal), { signal, serverId: this.binding.serverId, operation }); }
  async status() { const result = handshake.parse(await this.request("/status")); if (result.serverId !== this.binding.serverId || result.deviceId !== this.binding.deviceId || result.profile !== this.profileId || result.tenant !== this.tenant) throw new Error("Shared memory identity changed. Pair again after verifying the server."); return result; }
  private async model<T>(name: string, input: object): Promise<T> {
    const config = await readGreybeardConfig(this.appData);
    if (config.learningEnabled === false) {
      if (name === "recall") return { tenant: this.tenant, results: [], recallStatus: "paused", attribution: {kind:"none",statement:"Learning and advice are paused on this device."}, serializedBytes: 0, byteBudget: 800, budgetUnit:"utf8-bytes", estimatedTokens:0, tokenBudget:800, budgetScope:"serialized-recalled-nodes" } as T;
      if (name === "discover_scopes") return {scopes:[],paused:true} as T;
      if (["remember", "propose_outcome"].includes(name)) throw new Error("Learning is paused on this device.");
    }
    const token = await this.store.load(this.appData, this.binding.agentRef);
    const signal = AbortSignal.timeout(5000);
    const client = new Client({ name: "greybeard-shared-adapter", version: "0.1.2" });
    const transport = new StreamableHTTPClientTransport(new URL(this.binding.url + "/mcp"), { requestInit: { headers: { "x-greybeard-protocol": String(SHARED_PROTOCOL), authorization: `Bearer ${token}`, "x-greybeard-store": this.binding.serverId, "x-greybeard-operation": operationId() } }, fetch: async (url, init) => {
      if (new URL(String(url)).origin !== this.binding.url) throw new Error("Unexpected shared memory origin.");
      const response = await fetch(url, { ...init, signal, redirect: "error" });
      // Server uses bounded JSON responses; do not consume an unbounded MCP stream.
      if (response.status === 202 || response.status === 204) return response;
      if (!response.ok) throw new Error("Shared memory request failed. Check the connection and inspect changes before retrying.");
      const json = await boundedJson(response);
      return new Response(JSON.stringify(json), { status: response.status, headers: response.headers });
    } });
    try {
      await client.connect(transport);
      const result = await client.callTool({ name, arguments: input as Record<string, unknown> });
      if (result.isError) throw new GreybeardMemoryError({ code: "invalid-input", message: "Shared memory rejected the operation. Refresh the record and check learning and connection status.", guidance: "Do not assume the operation succeeded." });
      return result.structuredContent as T;
    } finally { await client.close().catch(() => {}); await transport.close().catch(() => {}); }
  }
  private async control<T>(method: string, input: unknown = {}, mutate = false): Promise<T> { return (await this.request("/review", { method, input }, undefined, mutate ? operationId() : undefined)).result as T; }
  recall: MemoryService["recall"] = input => this.model("recall", input);
  remember: MemoryService["remember"] = input => this.review ? this.control("remember", input, true) : this.model("remember", input);
  list: MemoryService["list"] = (input = {}) => this.review ? this.control("list", input) : this.model("list", input);
  forget: MemoryService["forget"] = (input, candidatesOnly) => this.review && !candidatesOnly ? this.control("forget", input, true) : this.model("forget", input);
  discoverScopes: MemoryService["discoverScopes"] = (input = {}) => this.model("discover_scopes", input);
  proposeOutcome: MemoryService["proposeOutcome"] = input => this.review ? this.control("proposeOutcome", input, true) : this.model("propose_outcome", input);
  confirm: MemoryService["confirm"] = input => this.control("confirm", input, true);
  export: MemoryService["export"] = async () => {
    const result: Awaited<ReturnType<MemoryService["export"]>> = {version:1,tenant:this.tenant,profileId:this.profileId,nodes:[],edges:[]};
    let cursor = 0; let snapshot: string | undefined; let bytes = 0;
    for (let page = 0; page < 1000; page++) {
      const part = await this.control<Awaited<ReturnType<MemoryService["export"]>> & {nextCursor?:number;snapshot:string}>("export",{cursor,...(snapshot?{snapshot}:{})});
      if (part.tenant !== this.tenant || part.profileId !== this.profileId || !Array.isArray(part.nodes) || !Array.isArray(part.edges) || snapshot && part.snapshot !== snapshot) throw new Error("Shared export changed. Start a new export.");
      bytes += Buffer.byteLength(JSON.stringify(part)); if (bytes > 64 * 1024 * 1024) throw new Error("Shared export exceeds 64 MiB. Use a server-side backup.");
      result.nodes.push(...part.nodes); result.edges.push(...part.edges); snapshot=part.snapshot;
      if (part.nextCursor === undefined) return result;
      if (!Number.isSafeInteger(part.nextCursor) || part.nextCursor <= cursor) throw new Error("Invalid shared export continuation.");
      cursor=part.nextCursor;
    }
    throw new Error("Shared export exceeds the page limit. Use a server-side backup.");
  };
  recordAdviceFeedback: MemoryService["recordAdviceFeedback"] = input => this.control("recordAdviceFeedback", input, true);
  adviceMetrics: MemoryService["adviceMetrics"] = () => this.control("adviceMetrics");
  adviceHistory: MemoryService["adviceHistory"] = limit => this.control("adviceHistory", { limit });
  clearAdviceMetrics: MemoryService["clearAdviceMetrics"] = () => this.control("clearAdviceMetrics", {}, true);
}
export async function openMemoryBackend(options: MemoryServiceOptions, review = false, selected?: RemoteBinding | null): Promise<MemoryBackend> {
  const binding = selected === undefined ? await readMemoryBinding(options.appDataPath) : selected ?? undefined;
  if (!binding) return new MemoryService(options);
  if (options.profileId && options.profileId !== binding.profile || options.tenantId && options.tenantId !== binding.tenant) throw new Error("This shared store is bound to a different profile or environment. Select its configured identity.");
  return new RemoteMemory(options.appDataPath, binding, review);
}
export async function pairMemory(appData: string, url: string, code: string, store = credentials): Promise<RemoteBinding> {
  url = sharedUrl(url);
  if (await readMemoryBinding(appData)) throw new Error("Disconnect the current shared store before pairing another.");
  const enrolled = z.object({ protocol: z.literal(1), serverId: z.string().uuid(), deviceId: z.string().uuid(), profile: label, tenant: label, agentToken: z.string().regex(/^[a-f0-9]{64}$/), reviewToken: z.string().regex(/^[a-f0-9]{64}$/).optional() }).parse(await sharedRequest(url, "/pair", { code }));
  let agentRef: string | undefined; let reviewRef: string | undefined;
  try {
    agentRef = await store.save(appData, enrolled.agentToken);
    if (enrolled.reviewToken) reviewRef = await store.save(appData, enrolled.reviewToken);
    const binding: RemoteBinding = { version: 1, mode: "remote", url, serverId: enrolled.serverId, deviceId: enrolled.deviceId, profile: enrolled.profile, tenant: enrolled.tenant, agentRef, ...(reviewRef ? { reviewRef } : {}) };
    await new RemoteMemory(appData, binding, false, store).status();
    await withClientConfigLock(configPath(appData), async () => { if (await readMemoryBinding(appData)) throw new Error("Another connection was configured. Disconnect it first."); await writeClientConfigAtomic(configPath(appData), JSON.stringify(binding) + "\n"); });
    return binding;
  } catch (error) {
    await sharedRequest(url, "/revoke-self", {}, enrolled.agentToken, { serverId: enrolled.serverId }).catch(() => {});
    for (const ref of [agentRef, reviewRef]) if (ref) await store.remove(appData, ref).catch(() => {});
    throw error;
  }
}
export async function disconnectMemory(appData: string, store = credentials): Promise<{ revoked: boolean; credentialsRemoved: boolean }> {
  return withClientConfigLock(configPath(appData), async () => {
    const binding = await readMemoryBinding(appData); if (!binding) return { revoked: true, credentialsRemoved: true };
    let revoked = false; let credentialsRemoved = true;
    try { await new RemoteMemory(appData, binding, false, store).request("/revoke-self"); revoked = true; } catch { /* Offline removal remains possible. */ }
    for (const ref of [binding.agentRef, binding.reviewRef]) if (ref) try { await store.remove(appData, ref); } catch { credentialsRemoved = false; }
    await writeClientConfigAtomic(configPath(appData), JSON.stringify({ version: 1, mode: "local" }) + "\n");
    return { revoked, credentialsRemoved };
  });
}
