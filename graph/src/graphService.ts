import { GreybeardGraphError } from "./errors.js";
import { classifyGraphFailure, GraphErrorBody } from "./classify.js";
import { getGreybeardAppDataPath } from "./appData.js";
import { activeScopeLeases, readGreybeardConfig, updateGreybeardConfig } from "./config.js";
import { ScopeAuditLog } from "./scopeAudit.js";
import { isWriteScope } from "./consent.js";
import {
  AddScopeInput,
  AuthToken,
  AuthStatus,
  FetchLike,
  GraphAuthProvider,
  GraphMeta,
  GraphToolInput,
  GraphToolResult,
  RemoveScopeInput,
  ResponseLike
} from "./types.js";
import { ApprovalClientContext, BrowserOpen } from "./approvalChannels.js";
import { WriteGate } from "./writeGate.js";
import { CheckPlanInput, ExecutePlanInput, PlanWriteInput } from "./writeGateTypes.js";

const GRAPH_ROOT = "https://graph.microsoft.com";
const DEFAULT_MAX_ITEMS = 1000;
const HARD_MAX_ITEMS = 5000;
const MAX_RETRIES = 3;
const MAX_PAGES = 50;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

type SessionMetadata = {
  requests: number;
  pages: number;
  throttled: number;
  warnings: string[];
};

export class GraphService {
  private readonly auth: GraphAuthProvider;
  private readonly fetcher: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly writeGate: WriteGate;
  private readonly appDataPath: string;
  private readonly session: SessionMetadata = {
    requests: 0,
    pages: 0,
    throttled: 0,
    warnings: []
  };

  constructor(params: {
    auth: GraphAuthProvider;
    fetcher?: FetchLike;
    sleep?: (ms: number) => Promise<void>;
    appDataPath?: string;
    now?: () => number;
    randomBytes?: (size: number) => Buffer;
    browserOpen?: BrowserOpen;
    stderr?: Pick<NodeJS.WriteStream, "write">;
    clientContext?: () => ApprovalClientContext;
  }) {
    this.auth = params.auth;
    this.appDataPath = params.appDataPath ?? getGreybeardAppDataPath();
    this.fetcher = params.fetcher ?? (globalThis.fetch as unknown as FetchLike);
    this.sleep = params.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.writeGate = new WriteGate({
      auth: this.auth,
      fetcher: this.fetcher,
      appDataPath: this.appDataPath,
      sleep: this.sleep,
      now: params.now,
      randomBytes: params.randomBytes,
      browserOpen: params.browserOpen,
      stderr: params.stderr,
      clientContext: params.clientContext
    });
  }

  setClientContextProvider(provider: () => ApprovalClientContext): void {
    this.writeGate.setClientContextProvider(provider);
  }

  close(): Promise<void> {
    return this.writeGate.close();
  }

  getSessionMetadata(): SessionMetadata {
    return {
      requests: this.session.requests,
      pages: this.session.pages,
      throttled: this.session.throttled,
      warnings: [...this.session.warnings]
    };
  }

  async graph(input: GraphToolInput): Promise<GraphToolResult> {
    const normalized = normalizeInput(input);
    enforceReadGate(normalized);
    if (normalized.path === "/$batch" && this.auth.authorizeRead) {
      for (const request of (normalized.body as { requests: Array<{ url: string }> }).requests) this.auth.authorizeRead(normalizePath(request.url.split("?")[0] as string));
    } else { this.auth.authorizeRead?.(normalized.path); }

    const configuredScopes = await this.configuredReadScopes();
    const token = await this.auth.getToken(uniqueScopes(configuredScopes));
    const warnings = warningsFor(normalized);
    const notes = notesFor(normalized);
    this.addWarnings(warnings);

    const meta: GraphMeta = {
      requests: 0,
      pages: 0,
      truncated: false,
      throttled: 0,
      apiVersion: normalized.apiVersion,
      usedBeta: normalized.apiVersion === "beta",
      notes,
      warnings,
      session: this.getSessionMetadata()
    };

    if (normalized.method === "POST") {
      const url = buildGraphUrl(normalized.apiVersion, normalized.path, normalized.query);
      const response = await this.fetchWithRetry(url, {
        method: "POST",
        headers: requestHeaders(token.accessToken, normalized.headers, true),
        body: JSON.stringify(normalized.body)
      }, meta, token);
      const data = await parseResponseData(response);
      meta.pages += 1;
      this.session.pages += 1;
      meta.session = this.getSessionMetadata();
      return { data, meta };
    }

    const firstUrl = buildGraphUrl(normalized.apiVersion, normalized.path, normalized.query);
    if (!normalized.fetchAll) {
      const response = await this.fetchWithRetry(firstUrl, {
        method: "GET",
        headers: requestHeaders(token.accessToken, normalized.headers, false)
      }, meta, token);
      const data = await parseResponseData(response);
      meta.pages += 1;
      this.session.pages += 1;
      meta.session = this.getSessionMetadata();
      return { data, meta };
    }

    const maxItems = clampMaxItems(normalized.maxItems);
    const collected: unknown[] = [];
    let nextUrl: string | undefined = firstUrl;
    let lastPage: Record<string, unknown> | undefined;

    const visited = new Set<string>();
    while (nextUrl && collected.length < maxItems) {
      const continuation = new URL(nextUrl);
      if (continuation.origin !== GRAPH_ROOT || continuation.username || continuation.password || continuation.hash || continuation.pathname !== new URL(firstUrl).pathname) throw new Error("Untrusted Graph continuation URL; no credential was forwarded.");
      if (visited.has(nextUrl)) throw new Error("Graph paging repeated a continuation URL.");
      if (meta.pages >= MAX_PAGES) { meta.truncated = true; break; }
      visited.add(nextUrl);
      const response = await this.fetchWithRetry(nextUrl, {
        method: "GET",
        headers: requestHeaders(token.accessToken, normalized.headers, false)
      }, meta, token);
      const data = await parseResponseData(response);
      meta.pages += 1;
      this.session.pages += 1;

      if (!isObject(data) || !Array.isArray(data.value)) {
        meta.session = this.getSessionMetadata();
        return { data, meta };
      }

      lastPage = data;
      const remaining = maxItems - collected.length;
      if (data.value.length > remaining) {
        meta.truncated = true;
      }

      for (const item of data.value) {
        if (collected.length >= maxItems) {
          break;
        }
        collected.push(item);
      }

      const nextLink = typeof data["@odata.nextLink"] === "string" ? data["@odata.nextLink"] : undefined;
      nextUrl = nextLink && collected.length < maxItems ? nextLink : undefined;
      if (nextLink && collected.length >= maxItems) {
        meta.truncated = true;
      }
    }

    const data: Record<string, unknown> = {
      ...(lastPage ?? {}),
      value: collected
    };
    delete data["@odata.nextLink"];

    meta.session = this.getSessionMetadata();
    return { data, meta };
  }

  async getAuthStatus(): Promise<AuthStatus> {
    const status = await this.auth.getStatus();
    return {
      ...status,
      gate: {
        ...status.gate,
        pendingPlan: this.writeGate.getPendingPlanId()
      }
    } as AuthStatus;
  }

  addScope(input: AddScopeInput) {
    return this.auth.addScopes(input);
  }

  removeScope(input: RemoveScopeInput) {
    if (!this.auth.removeScopes) {
      throw new GreybeardGraphError({
        code: "E_SCOPE_RELEASE_UNAVAILABLE",
        message: "The active authentication provider cannot update scope configuration.",
        guidance: "Restart Greybeard with the built-in authentication provider and retry."
      });
    }
    return this.auth.removeScopes(input);
  }

  planWrite(_input: PlanWriteInput): never { return writesDisabled(); }

  checkPlan(_input: CheckPlanInput): never { return writesDisabled(); }

  executePlan(_input: ExecutePlanInput): never { return writesDisabled(); }

  private async configuredReadScopes(): Promise<string[]> {
    const config = await readGreybeardConfig(this.appDataPath);
    const active = activeScopeLeases(config);
    const activeKeys = new Set(active.map((lease) => `${lease.scope.toLowerCase()}\n${lease.requestedAt}`));
    const expired = (config.scopeLeases ?? []).filter((lease) => {
      return !activeKeys.has(`${lease.scope.toLowerCase()}\n${lease.requestedAt}`);
    });
    if (expired.length > 0) {
      await updateGreybeardConfig(this.appDataPath, (current) => ({
        ...current,
        scopeLeases: activeScopeLeases(current)
      }));
      await new ScopeAuditLog(this.appDataPath).append({
        event: "expired",
        scopes: expired.map((lease) => lease.scope),
        reason: "configured scope lease expired",
        details: {
          leases: expired.map((lease) => ({
            scope: lease.scope,
            reason: lease.reason,
            expiresAt: lease.expiresAt
          }))
        }
      });
    }
    return [...(config.grantedReadScopes ?? []), ...active.map((lease) => lease.scope)].filter((scope) => !isWriteScope(scope));
  }

  private async fetchWithRetry(url: string, init: RequestInit, meta: GraphMeta, token: AuthToken): Promise<ResponseLike> {
    let retries = 0;

    while (true) {
      const response = await this.fetcher(url, { ...init, redirect: "error", signal: AbortSignal.timeout(30_000) });
      meta.requests += 1;
      this.session.requests += 1;

      if (response.ok) {
        return response;
      }

      if ((response.status === 429 || response.status === 503) && retries < MAX_RETRIES) {
        retries += 1;
        meta.throttled += 1;
        this.session.throttled += 1;
        await response.body?.cancel();
        await this.sleep(parseRetryAfter(response.headers.get("Retry-After")));
        continue;
      }

      const graphError = await parseGraphError(response);
      const urlPath = new URL(url).pathname.replace(/^\/(v1\.0|beta)/, "") || "/";
      const urlQuery = new URL(url).searchParams;
      throw classifyGraphFailure({
        status: response.status,
        path: urlPath,
        query: urlQuery,
        graphError,
        token,
        retryState: {
          retries,
          throttled: meta.throttled
        }
      });
    }
  }

  private addWarnings(warnings: string[]): void {
    for (const warning of warnings) {
      if (!this.session.warnings.includes(warning)) {
        this.session.warnings.push(warning);
      }
    }
  }
}

function uniqueScopes(scopes: readonly string[]): string[] {
  const seen = new Set<string>();
  return scopes.filter((scope) => {
    const key = scope.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

type NormalizedGraphToolInput = Required<Pick<GraphToolInput, "method" | "apiVersion" | "path" | "fetchAll" | "maxItems">> & {
  query: NonNullable<GraphToolInput["query"]>;
  headers: NonNullable<GraphToolInput["headers"]>;
  body: unknown;
  apiVersionExplicitlySet: boolean;
};

function normalizeInput(input: GraphToolInput): NormalizedGraphToolInput {
  if (input.apiVersion && input.apiVersion !== "beta") throw new Error("Greybeard uses the Microsoft Graph beta endpoint.");
  const method = (input.method ?? "GET").toUpperCase();
  const path = normalizePath(input.path);
  return {
    method,
    apiVersion: input.apiVersion ?? "beta",
    path,
    query: input.query ?? {},
    headers: input.headers ?? {},
    body: method === "POST" && path === "/$batch" ? parseBatchBody(input.body) : input.body,
    fetchAll: input.fetchAll ?? false,
    maxItems: input.maxItems ?? DEFAULT_MAX_ITEMS,
    apiVersionExplicitlySet: input.apiVersion !== undefined
  };
}

// Agents routinely pass the batch body as a JSON string because the tool schema
// leaves body untyped; parse it so the read gate and the wire payload both see
// the object instead of rejecting or double-encoding it.
function parseBatchBody(body: unknown): unknown {
  if (typeof body !== "string") {
    return body;
  }

  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

function normalizePath(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  let decoded = normalized;
  try { for (let count = 0; count < 3; count += 1) decoded = decodeURIComponent(decoded); } catch { throw new Error("Invalid Graph path encoding."); }
  if (decoded.startsWith("//") || /[?#\\]/.test(decoded) || decoded.split("/").some((part) => part === "." || part === "..") || /[\x00-\x20]/.test(decoded)) throw new Error("Invalid Graph resource path. Supply query parameters separately.");
  return normalized;
}

function enforceReadGate(input: NormalizedGraphToolInput): void {
  if (input.method === "GET") {
    return;
  }

  if (input.method === "POST" && input.path === "/$batch") {
    const batch = input.body;
    if (!isObject(batch) || !Array.isArray(batch.requests) || batch.requests.length === 0 || batch.requests.length > 20 || batch.requests.some((request) => !isObject(request) || typeof request.url !== "string" || typeof request.method !== "string")) {
      throw new GreybeardGraphError({
        code: "E_WRITE_BLOCKED",
        message: "POST /$batch requires a requests array and every inner request must be GET.",
        guidance: "Use graph only for GET reads. Use plan-write for tenant writes."
      });
    }

    for (const request of batch.requests as Array<Record<string, unknown>>) {
      const url = String(request.url);
      normalizePath(url.split("?")[0] as string);
      if (/^https?:/i.test(url) || /^\/(?:v1\.0|beta)(?:\/|$)/i.test(url)) throw new Error("Batch resource URLs must be relative to the beta endpoint.");
    }
    const offending = batch.requests
      .filter((request) => isObject(request) && String(request.method ?? "").toUpperCase() !== "GET")
      .map((request) => (isObject(request) ? String(request.id ?? "unknown") : "unknown"));

    if (offending.length > 0) {
      throw new GreybeardGraphError({
        code: "E_WRITE_BLOCKED",
        message: `Batch contains non-GET inner requests: ${offending.join(", ")}.`,
        guidance: "Call plan-write with the intended operations instead of hiding writes in a batch.",
        details: {
          offendingRequestIds: offending
        }
      });
    }

    return;
  }

  throw new GreybeardGraphError({
    code: "E_WRITE_BLOCKED",
    message: `The graph tool is read-only and blocked ${input.method}.`,
    guidance: "Call plan-write with the intended operations."
  });
}

function buildGraphUrl(apiVersion: "v1.0" | "beta", path: string, query: NormalizedGraphToolInput["query"]): string {
  const url = new URL(`${GRAPH_ROOT}/${apiVersion}${path}`);
  for (const [key, rawValue] of Object.entries(query)) {
    if (rawValue === null || rawValue === undefined) {
      continue;
    }

    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const value of values) {
      url.searchParams.append(key, String(value));
    }
  }

  return url.toString();
}

function requestHeaders(accessToken: string, headers: Record<string, string>, hasBody: boolean): HeadersInit {
  const allowed: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!["consistencylevel", "prefer"].includes(name.toLowerCase()) || /[\r\n]/.test(value)) throw new Error("Only ConsistencyLevel and Prefer request headers are supported.");
    allowed[name] = value;
  }
  return { Accept: "application/json", ...(hasBody ? { "Content-Type": "application/json" } : {}), ...allowed, Authorization: `Bearer ${accessToken}` };
}

function warningsFor(input: NormalizedGraphToolInput): string[] {
  const warnings: string[] = [];

  if (input.method === "GET" && isLikelyCollectionPath(input.path) && !hasQueryKey(input.query, "$select")) {
    warnings.push("no $select on collection read: consider selecting only needed fields");
  }

  if (input.method === "GET" && input.fetchAll && !hasQueryKey(input.query, "$filter")) {
    warnings.push("fetchAll without $filter: consider narrowing the collection before paging");
  }

  return warnings;
}

function notesFor(input: NormalizedGraphToolInput): string[] {
  if (input.apiVersionExplicitlySet && input.apiVersion === "v1.0") {
    return ["v1.0 used explicitly; Greybeard defaults to beta"];
  }

  return [];
}

function isLikelyCollectionPath(path: string): boolean {
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) {
    return false;
  }

  const last = segments[segments.length - 1] ?? "";
  if (last.startsWith("$") || /\(.+\)$/.test(last)) {
    return false;
  }

  if (segments.length === 1) {
    return true;
  }

  return ["signIns", "userRegistrationDetails", "managedDevices", "mobileApps"].includes(last);
}

function hasQueryKey(query: NormalizedGraphToolInput["query"], key: string): boolean {
  return Object.keys(query).some((candidate) => candidate.toLowerCase() === key.toLowerCase());
}

function clampMaxItems(maxItems: number): number {
  if (!Number.isFinite(maxItems) || maxItems <= 0) {
    return DEFAULT_MAX_ITEMS;
  }

  return Math.min(Math.floor(maxItems), HARD_MAX_ITEMS);
}

function parseRetryAfter(value: string | null): number {
  if (!value) {
    return 1000;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.min(30_000, Math.max(0, seconds * 1000));
  }

  const date = Date.parse(value);
  if (Number.isFinite(date)) {
    return Math.min(30_000, Math.max(0, date - Date.now()));
  }

  return 1000;
}

async function responseText(response: ResponseLike): Promise<string> {
  if (Number(response.headers.get("Content-Length")) > MAX_RESPONSE_BYTES) throw new Error("Graph response exceeded the size limit. Narrow the query.");
  if (response.body) {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new Error("Graph response exceeded the size limit. Narrow the query."); }
        chunks.push(value);
      }
      return Buffer.concat(chunks).toString("utf8");
    } finally { reader.releaseLock(); }
  }
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) throw new Error("Graph response exceeded the size limit. Narrow the query.");
  return text;
}

async function parseResponseData(response: ResponseLike): Promise<unknown> {
  if (response.status === 204) return null;
  const text = await responseText(response);
  try { return JSON.parse(text); } catch { return text; }
}

async function parseGraphError(response: ResponseLike): Promise<GraphErrorBody> {
  const data = await parseResponseData(response);
  return isObject(data) ? data as GraphErrorBody : { message: String(data) };
}

function writesDisabled(): never {
  throw new GreybeardGraphError({ code: "E_WRITE_BLOCKED", message: "Production tenant writes are disabled in Greybeard 0.1.", guidance: "Use Greybeard to review and prepare changes. Execute them through your existing approved workflow." });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
