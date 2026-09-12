import { createHmac, randomBytes as nodeRandomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { GreybeardGraphError } from "./errors.js";
import { classifyGraphFailure, GraphErrorBody } from "./classify.js";
import { FetchLike, GraphAuthProvider, ResponseLike, AuthToken } from "./types.js";
import { isWriteScope } from "./consent.js";
import { AuditLog } from "./auditLog.js";
import { ApprovalChannelCoordinator, ApprovalChannelHandle, ApprovalClientContext, BrowserOpen } from "./approvalChannels.js";
import { canonicalJson, sha256Buffer, sha256Hex } from "./canonicalJson.js";
import { activeScopeLeases, readGreybeardConfig } from "./config.js";
import { renderPlan } from "./planRendering.js";
import {
  ApprovalDecision,
  CheckPlanInput,
  ExecutePlanInput,
  NormalizedWriteOperation,
  OperationExecutionResult,
  PlanWriteInput,
  PlanWriteOperationInput,
  TerminalPlanStatus,
  WriteMethod
} from "./writeGateTypes.js";

const GRAPH_ROOT = "https://graph.microsoft.com";
const MAX_OPERATIONS = 50;
const MAX_BODY_BYTES = 256 * 1024;
const APPROVAL_TTL_MS = 600_000;
const TOKEN_TTL_MS = 300_000;
const CHECK_LONG_POLL_MS = 55_000;
const RESULT_BODY_BYTES = 4096;
const TOKEN_PATTERN = /^gbt_[A-Za-z0-9_-]{43}$/;
const REFERENCE_PATTERN = /{{\s*op\[(\d+)]\.response\.body\.([a-zA-Z0-9_.@$-]+)\s*}}/g;
const TEMPLATE_PATTERN = /{{[^}]+}}/g;

export class WriteGate {
  private readonly auth: GraphAuthProvider;
  private readonly fetcher: FetchLike;
  private readonly appDataPath: string;
  private readonly randomBytes: (size: number) => Buffer;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly approvalChannels: ApprovalChannelCoordinator;
  private readonly audit: AuditLog;
  private readonly sessionId = randomUUID();
  private readonly sessionStartedAt: string;
  private readonly tokenSecret: Buffer;
  private clientContext: () => ApprovalClientContext;
  private readonly plans = new Map<string, PlanRecord>();

  constructor(params: {
    auth: GraphAuthProvider;
    fetcher: FetchLike;
    appDataPath: string;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
    randomBytes?: (size: number) => Buffer;
    browserOpen?: BrowserOpen;
    stderr?: Pick<NodeJS.WriteStream, "write">;
    clientContext?: () => ApprovalClientContext;
  }) {
    this.auth = params.auth;
    this.fetcher = params.fetcher;
    this.appDataPath = params.appDataPath;
    this.sleep = params.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = params.now ?? Date.now;
    this.randomBytes = params.randomBytes ?? nodeRandomBytes;
    this.sessionStartedAt = new Date(this.now()).toISOString();
    this.tokenSecret = this.randomBytes(32);
    this.clientContext = params.clientContext ?? (() => ({}));
    this.approvalChannels = new ApprovalChannelCoordinator({
      appDataPath: this.appDataPath,
      browserOpen: params.browserOpen,
      stderr: params.stderr,
      randomBytes: this.randomBytes,
      clientContext: () => this.clientContext()
    });
    this.audit = new AuditLog({
      appDataPath: this.appDataPath,
      now: this.now
    });
  }

  setClientContextProvider(provider: () => ApprovalClientContext): void {
    this.clientContext = provider;
  }

  async close(): Promise<void> {
    for (const plan of this.plans.values()) {
      await plan.approvalHandle?.close();
    }
    this.plans.clear();
  }

  getPendingPlanId(): string | null {
    for (const plan of this.plans.values()) {
      if (plan.status === "awaiting_approval" && this.now() < plan.approvalDeadlineMs) {
        return plan.id;
      }
    }

    return null;
  }

  async planWrite(input: PlanWriteInput) {
    const authStatus = await this.auth.getStatus();
    if (authStatus.credentialMode !== "writes" || !authStatus.gate.writesConfigured) {
      throw writesNotConfigured();
    }

    await this.cleanupTimedPlans();
    if (this.getPendingPlanId()) {
      throw new GreybeardGraphError({
        code: "E_PLAN_PENDING",
        message: "Another write plan is awaiting approval in this session.",
        guidance: "Poll check-plan for the pending plan before creating a new one."
      });
    }

    const operations = normalizePlanInput(input);
    const requiredScopes = normalizeRequiredScopes(input.requiredScopes);
    const scopeConfig = await readGreybeardConfig(this.appDataPath);
    assertConfiguredPlanScopes(scopeConfig, requiredScopes, this.now());
    const authToken = await this.auth.getToken(requiredScopes);
    if (authToken.credentialMode !== "writes" || !authToken.writesConfigured) {
      throw writesNotConfigured();
    }
    assertTokenScopes(authToken, requiredScopes);

    if (input.prefetch !== false) {
      await this.prefetchPatchDiffs(operations, authToken);
    }

    const plan = this.createPlan({
      input,
      operations,
      requiredScopes,
      authToken
    });
    const rendered = renderPlan({
      planId: plan.id,
      summary: plan.summary,
      rollback: plan.rollback,
      requiredScopes: plan.requiredScopes,
      stopOnError: plan.stopOnError,
      operations: plan.operations,
      authToken,
      clientName: plan.clientName,
      sessionStartedAt: this.sessionStartedAt,
      approvalDeadline: new Date(plan.approvalDeadlineMs).toISOString()
    });
    const config = await readGreybeardConfig(this.appDataPath);
    const handle = await this.approvalChannels.establish({
      planId: plan.id,
      rendered,
      cliApprove: config.gate?.cliApprove === true,
      isAwaiting: () => plan.status === "awaiting_approval" && this.now() < plan.approvalDeadlineMs,
      onDecision: (decision) => this.applyDecision(plan, decision)
    });

    if (!handle) {
      throw new GreybeardGraphError({
        code: "E_CHANNEL_UNAVAILABLE",
        message: "No approval channel could be established.",
        guidance: "Tell the admin to run greybeard doctor."
      });
    }

    plan.approvalHandle = handle;
    this.plans.set(plan.id, plan);
    await this.audit.created(this.auditFields(plan));

    return {
      status: "awaiting_approval",
      planId: plan.id,
      approvalDeadline: new Date(plan.approvalDeadlineMs).toISOString()
    };
  }

  async checkPlan(input: CheckPlanInput) {
    const plan = this.plans.get(input.planId);
    if (!plan) {
      throw new GreybeardGraphError({
        code: "E_PLAN_NOT_FOUND",
        message: "Unknown planId.",
        guidance: "A new plan-write is required."
      });
    }

    await this.refreshPlanState(plan);
    if (plan.status === "awaiting_approval") {
      await this.waitForPlanChange(plan);
      await this.refreshPlanState(plan);
    }

    return this.checkResult(plan);
  }

  async executePlan(input: ExecutePlanInput) {
    if (!TOKEN_PATTERN.test(input.token)) {
      throw tokenInvalid();
    }

    const plan = this.plans.get(input.planId);
    if (!plan) {
      throw tokenInvalid();
    }

    await this.refreshPlanState(plan);
    if (plan.status === "completed" || plan.status === "partial" || plan.status === "failed" || plan.tokenConsumed) {
      throw new GreybeardGraphError({
        code: "E_PLAN_ALREADY_EXECUTED",
        message: "This plan token has already been consumed.",
        guidance: "Report the stored execution results and create a new plan for further changes."
      });
    }

    if ((plan.status !== "approved" && plan.status !== "expired") || !plan.tokenHash) {
      throw tokenInvalid();
    }

    const presentedHash = sha256Buffer(input.token);
    if (!timingSafeEqual(plan.tokenHash, presentedHash)) {
      throw tokenInvalid();
    }

    if (plan.status === "expired" || (plan.expiresAtMs && this.now() >= plan.expiresAtMs)) {
      plan.status = "expired";
      this.notify(plan);
      throw new GreybeardGraphError({
        code: "E_TOKEN_EXPIRED",
        message: "The approved plan token expired before execution.",
        guidance: "Create a new plan-write and tell the admin the previous approval expired after 300 seconds."
      });
    }

    plan.tokenConsumed = true;
    plan.status = "executing";
    this.notify(plan);

    const results: OperationExecutionResult[] = [];
    let status: TerminalPlanStatus;
    try {
      const authToken = await this.auth.getToken(plan.requiredScopes);
      if (authToken.credentialMode !== "writes" || !authToken.writesConfigured) {
        throw writesNotConfigured();
      }
      assertTokenScopes(authToken, plan.requiredScopes);
      assertSameCredential(plan.authToken, authToken);
      // Local permission removal or lease expiry invalidates an old approval,
      // even if an access token still carries its original consented scopes.
      assertConfiguredPlanScopes(await readGreybeardConfig(this.appDataPath), plan.requiredScopes, this.now());

      await this.replayOperations(plan, authToken, results);
      status = summarizeExecution(results);
      plan.status = status;
      plan.results = results;
    } catch (error) {
      await this.markConsumedPlanFailed(plan, results);
      throw error;
    }

    await this.audit.executed({
      ...this.auditFields(plan),
      status,
      operations: plan.operations,
      results
    });
    this.notify(plan);

    return {
      status,
      results
    };
  }

  private createPlan(params: {
    input: PlanWriteInput;
    operations: NormalizedWriteOperation[];
    requiredScopes: string[];
    authToken: AuthToken;
  }): PlanRecord {
    const id = this.nextPlanId();
    const createdAtMs = this.now();
    return {
      id,
      summary: params.input.summary,
      rollback: params.input.rollback,
      stopOnError: params.input.stopOnError ?? true,
      operations: params.operations,
      requiredScopes: params.requiredScopes,
      authToken: { ...params.authToken, grantedScopes: [...params.authToken.grantedScopes] },
      clientName: clientName(this.clientContext()),
      createdAtMs,
      approvalDeadlineMs: createdAtMs + APPROVAL_TTL_MS,
      status: "awaiting_approval",
      tokenDelivered: false,
      tokenConsumed: false,
      waiters: new Set()
    };
  }

  private nextPlanId(): string {
    for (let attempt = 0; attempt < 1000; attempt += 1) {
      const id = `gbp_${this.randomBytes(4).toString("hex")}`;
      if (!this.plans.has(id)) {
        return id;
      }
    }

    throw new Error("Unable to allocate a unique plan id.");
  }

  private async applyDecision(plan: PlanRecord, decision: ApprovalDecision): Promise<void> {
    if (plan.status !== "awaiting_approval") {
      return;
    }

    if (this.now() >= plan.approvalDeadlineMs) {
      plan.status = "timed_out";
      this.notify(plan);
      // A browser decision runs inside the approval HTTP handler. Do not wait
      // for that server to close before its current response can complete.
      void plan.approvalHandle?.close().catch(() => undefined);
      return;
    }

    if (decision.decision === "rejected") {
      plan.status = "rejected";
      plan.rejectionReason = decision.reason;
      if (decision.channel === "elicitation") {
        await plan.approvalHandle?.close();
      }
      await this.audit.decided({
        ...this.auditFields(plan),
        channel: decision.channel,
        decision: "rejected",
        reason: decision.reason,
        operations: plan.operations
      });
      this.notify(plan);
      return;
    }

    const approvedAtMs = this.now();
    plan.status = "approved";
    plan.approvedAtMs = approvedAtMs;
    plan.expiresAtMs = approvedAtMs + TOKEN_TTL_MS;
    const token = this.deriveToken(plan);
    plan.tokenHash = sha256Buffer(token);
    if (decision.channel === "elicitation") {
      await plan.approvalHandle?.close();
    }
    await this.audit.decided({
      ...this.auditFields(plan),
      channel: decision.channel,
      decision: "approved",
      reason: decision.reason,
      operations: plan.operations
    });
    this.notify(plan);
  }

  private deriveToken(plan: PlanRecord): string {
    const expiresAt = plan.expiresAtMs ?? 0;
    const material = [
      plan.id,
      this.sessionId,
      String(expiresAt),
      ...plan.requiredScopes,
      ...plan.operations.map((operation) => operation.hash)
    ].join("\n");
    const tokenBytes = createHmac("sha256", this.tokenSecret).update(material).digest();
    return `gbt_${tokenBytes.toString("base64url")}`;
  }

  private async prefetchPatchDiffs(operations: NormalizedWriteOperation[], authToken: AuthToken): Promise<void> {
    for (const operation of operations) {
      if (operation.method !== "PATCH") {
        continue;
      }

      const patchFields = objectEntries(operation.body);
      try {
        const response = await this.fetcher(buildGraphUrl(operation.apiVersion, operation.path), {
          method: "GET",
          headers: requestHeaders(authToken.accessToken, false)
        });
        if (!response.ok) {
          operation.prefetch = {
            verified: false,
            fields: patchFields.map(([field, next]) => ({ field, next })),
            error: `Prefetch returned HTTP ${response.status}; showing new values only.`
          };
          continue;
        }

        const current = await parseResponseData(response);
        operation.prefetch = {
          verified: isObject(current),
          fields: patchFields.map(([field, next]) => ({
            field,
            current: isObject(current) ? current[field] : undefined,
            next
          })),
          ...(isObject(current) ? {} : { error: "Prefetch response was not an object; showing new values only." })
        };
      } catch {
        operation.prefetch = {
          verified: false,
          fields: patchFields.map(([field, next]) => ({ field, next })),
          error: "Prefetch failed; showing new values only."
        };
      }
    }
  }

  private async refreshPlanState(plan: PlanRecord): Promise<void> {
    if (plan.status === "awaiting_approval" && this.now() >= plan.approvalDeadlineMs) {
      plan.status = "timed_out";
      await plan.approvalHandle?.close();
      this.notify(plan);
      return;
    }

    if (plan.status === "approved" && plan.expiresAtMs && this.now() >= plan.expiresAtMs) {
      plan.status = "expired";
      this.notify(plan);
    }
  }

  private async cleanupTimedPlans(): Promise<void> {
    for (const plan of this.plans.values()) {
      await this.refreshPlanState(plan);
    }
  }

  private async waitForPlanChange(plan: PlanRecord): Promise<void> {
    const waitMs = Math.min(CHECK_LONG_POLL_MS, Math.max(0, plan.approvalDeadlineMs - this.now()));
    if (waitMs <= 0) {
      return;
    }

    await new Promise<void>((resolve) => {
      let resolved = false;
      const finish = () => {
        if (resolved) {
          return;
        }

        resolved = true;
        clearTimeout(timer);
        plan.waiters.delete(finish);
        resolve();
      };
      const timer = setTimeout(finish, waitMs);
      plan.waiters.add(finish);
    });
  }

  private checkResult(plan: PlanRecord) {
    switch (plan.status) {
      case "awaiting_approval":
        return {
          status: "awaiting_approval",
          approvalDeadline: new Date(plan.approvalDeadlineMs).toISOString()
        };
      case "approved":
        if (plan.tokenDelivered) {
          return {
            status: "approved",
            tokenDelivered: true
          };
        }

        plan.tokenDelivered = true;
        return {
          status: "approved",
          token: this.deriveToken(plan),
          expiresAt: new Date(plan.expiresAtMs ?? 0).toISOString(),
          operations: plan.operations.map((operation, index) => ({
            index,
            hash: operation.hash
          }))
        };
      case "rejected":
        return {
          status: "rejected",
          reason: plan.rejectionReason ?? ""
        };
      case "timed_out":
        return {
          status: "timed_out"
        };
      case "expired":
        return {
          status: "expired"
        };
      case "completed":
      case "partial":
      case "failed":
        return {
          status: plan.status,
          results: plan.results ?? []
        };
      case "executing":
        return {
          status: "approved",
          tokenDelivered: true
        };
    }
  }

  private async replayOperations(
    plan: PlanRecord,
    authToken: AuthToken,
    results: OperationExecutionResult[]
  ): Promise<void> {
    const responseBodies = new Map<number, unknown>();

    for (const [index, operation] of plan.operations.entries()) {
      const result = await this.executeOperation({
        operation,
        index,
        authToken,
        responseBodies
      });
      results.push(result);

      if (result.status === "success") {
        responseBodies.set(index, result.body);
      }

      if (result.status === "failed" && plan.stopOnError) {
        for (let skipped = index + 1; skipped < plan.operations.length; skipped += 1) {
          results.push({
            index: skipped,
            status: "skipped"
          });
        }
        break;
      }
    }
  }

  private async executeOperation(params: {
    operation: NormalizedWriteOperation;
    index: number;
    authToken: AuthToken;
    responseBodies: Map<number, unknown>;
  }): Promise<OperationExecutionResult> {
    let path: string;
    let body: unknown;
    try {
      path = resolveReferencesInString(params.operation.path, params.responseBodies);
      body = resolveReferencesInBody(params.operation.body, params.responseBodies);
    } catch (error) {
      if (error instanceof ReferenceUnresolvedError) {
        return {
          index: params.index,
          status: "failed",
          error: "E_REFERENCE_UNRESOLVED"
        };
      }

      throw error;
    }

    try {
      const hasBody = body !== undefined;
      const response = await this.fetcher(buildGraphUrl(params.operation.apiVersion, path), {
        method: params.operation.method,
        headers: requestHeaders(params.authToken.accessToken, hasBody),
        ...(hasBody ? { body: JSON.stringify(body) } : {})
      });
      if (response.ok) {
        const parsedBody = await parseResponseData(response);
        return {
          index: params.index,
          status: "success",
          httpStatus: response.status,
          ...(parsedBody === null ? {} : { body: truncateResponseBody(parsedBody) })
        };
      }

      const graphError = await parseGraphError(response);
      const payload = classifyGraphFailure({
        status: response.status,
        path,
        query: new URLSearchParams(),
        graphError,
        token: params.authToken
      }).payload;
      return {
        index: params.index,
        status: "failed",
        httpStatus: response.status,
        error: truncateText(String(payload.details?.graphCode || payload.message), RESULT_BODY_BYTES),
        missingScope: payload.missingScope,
        consentUrl: payload.consentUrl
      };
    } catch (error) {
      return {
        index: params.index,
        status: "failed",
        error: truncateText(error instanceof Error ? error.message : String(error), RESULT_BODY_BYTES)
      };
    }
  }

  private async markConsumedPlanFailed(plan: PlanRecord, results: OperationExecutionResult[]): Promise<void> {
    plan.status = "failed";
    plan.results = results;
    try {
      await this.audit.executed({
        ...this.auditFields(plan),
        status: "failed",
        operations: plan.operations,
        results
      });
    } catch {
      // The original execute-plan failure should remain the surfaced error.
    }
    this.notify(plan);
  }

  private auditFields(plan: PlanRecord) {
    return {
      sessionId: this.sessionId,
      planId: plan.id,
      tenantId: plan.authToken.tenantId,
      tenantDomain: plan.authToken.tenantDomain,
      account: plan.authToken.account,
      clientName: plan.clientName,
      requiredScopes: plan.requiredScopes,
      operations: plan.operations
    };
  }

  private notify(plan: PlanRecord): void {
    for (const waiter of [...plan.waiters]) {
      waiter();
    }
  }
}

type PlanStatus =
  | "awaiting_approval"
  | "approved"
  | "rejected"
  | "timed_out"
  | "expired"
  | "executing"
  | TerminalPlanStatus;

type PlanRecord = {
  id: string;
  summary: string;
  rollback: string;
  stopOnError: boolean;
  operations: NormalizedWriteOperation[];
  requiredScopes: string[];
  authToken: AuthToken;
  clientName: string;
  createdAtMs: number;
  approvalDeadlineMs: number;
  approvedAtMs?: number;
  expiresAtMs?: number;
  tokenHash?: Buffer;
  tokenDelivered: boolean;
  tokenConsumed: boolean;
  status: PlanStatus;
  rejectionReason?: string;
  results?: OperationExecutionResult[];
  approvalHandle?: ApprovalChannelHandle;
  waiters: Set<() => void>;
};

function normalizePlanInput(input: PlanWriteInput): NormalizedWriteOperation[] {
  if (!isNonEmptyString(input.summary)) {
    throw invalidPlan("summary is required.");
  }

  if (!isNonEmptyString(input.rollback)) {
    throw invalidPlan("rollback is required.");
  }

  if (!Array.isArray(input.operations) || input.operations.length < 1 || input.operations.length > MAX_OPERATIONS) {
    throw invalidPlan("operations must contain 1 to 50 entries.");
  }

  const operations = input.operations.map((operation, index) => normalizeOperation(operation, index));
  validateResponseReferences(operations);
  return operations;
}

function normalizeRequiredScopes(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw invalidPlan("requiredScopes must contain at least one delegated write scope.");
  }

  const scopes: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!isNonEmptyString(item)) {
      throw invalidPlan("requiredScopes must contain only non-empty scope names.");
    }
    if (!isWriteScope(item)) {
      throw invalidPlan(`requiredScopes contains a non-write scope: ${item}.`);
    }
    const key = item.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      scopes.push(item);
    }
  }
  return scopes.sort((a, b) => a.localeCompare(b));
}

function assertTokenScopes(token: AuthToken, requiredScopes: string[]): void {
  const granted = new Set(token.grantedScopes.map((scope) => scope.toLowerCase()));
  const missingScopes = requiredScopes.filter((scope) => !granted.has(scope.toLowerCase()));
  if (missingScopes.length === 0) {
    return;
  }

  throw new GreybeardGraphError({
    code: "E_PLAN_SCOPE_MISSING",
    message: `The workspace credential is missing required delegated scopes: ${missingScopes.join(", ")}.`,
    guidance: "Request the exact missing scopes with add-scope before asking for plan approval.",
    details: {
      requiredScopes,
      missingScopes
    }
  });
}

function assertSameCredential(planned: AuthToken, current: AuthToken): void {
  const fields = ["tenantId", "clientId", "account", "clientIdKind", "credentialMode"] as const;
  if (fields.some(field => !planned[field] || planned[field] !== current[field])) {
    throw new GreybeardGraphError({
      code: "E_PLAN_INVALID",
      message: "The execution credential differs from the credential shown in the approved plan.",
      guidance: "Select the intended tenant and account, then create a new plan for approval.",
      details: { reason: "credential-identity-changed" }
    });
  }
}

function assertConfiguredPlanScopes(
  config: Awaited<ReturnType<typeof readGreybeardConfig>>,
  requiredScopes: string[],
  now = Date.now()
): void {
  const configured = new Set([
    ...(config.requestedWriteScopes ?? []),
    ...activeScopeLeases(config, now).map((lease) => lease.scope)
  ].map((scope) => scope.toLowerCase()));
  const missingScopes = requiredScopes.filter((scope) => !configured.has(scope.toLowerCase()));
  if (missingScopes.length === 0) {
    return;
  }

  throw new GreybeardGraphError({
    code: "E_PLAN_SCOPE_MISSING",
    message: `The plan requests delegated scopes that Greybeard has not configured: ${missingScopes.join(", ")}.`,
    guidance: "Request and record the exact missing scopes with add-scope before asking for approval.",
    details: {
      requiredScopes,
      missingScopes,
      configuredScopes: [...configured]
    }
  });
}

function normalizeOperation(operation: PlanWriteOperationInput, index: number): NormalizedWriteOperation {
  if (!isNonEmptyString(operation.method)) {
    throw invalidPlan(`operations[${index}].method is required.`);
  }

  if (!isNonEmptyString(operation.reason)) {
    throw invalidPlan(`operations[${index}].reason is required.`);
  }

  const method = operation.method.toUpperCase();
  if (method === "GET") {
    throw invalidPlan("GET operations are reads and do not need a write plan.");
  }

  if (!isWriteMethod(method)) {
    throw invalidPlan(`operations[${index}].method must be POST, PATCH, PUT, or DELETE.`);
  }

  const apiVersion = operation.apiVersion ?? "beta";
  if (apiVersion !== "beta") {
    throw invalidPlan(`operations[${index}].apiVersion must be beta.`);
  }

  const path = normalizePath(operation.path);
  const bodyText = jsonText(operation.body ?? null);
  const bodyBytes = Buffer.byteLength(bodyText, "utf8");
  if (bodyBytes > MAX_BODY_BYTES) {
    throw invalidPlan(`operations[${index}].body exceeds 256 KB.`);
  }

  const body: unknown = operation.body === undefined ? undefined : JSON.parse(bodyText);
  let hash: string;
  try {
    hash = operationHash({
      method,
      apiVersion,
      path,
      body
    });
  } catch {
    throw invalidPlan("operation body must be JSON serializable.");
  }

  return {
    method,
    apiVersion,
    path,
    body,
    reason: operation.reason,
    hash,
    bodyBytes
  };
}

function validateResponseReferences(operations: NormalizedWriteOperation[]): void {
  for (const [index, operation] of operations.entries()) {
    for (const reference of referencesInOperation(operation)) {
      if (reference.index >= index) {
        throw invalidPlan(`operations[${index}] references operation ${reference.index}, but references must point to earlier operations only.`);
      }
    }
  }
}

function referencesInOperation(operation: NormalizedWriteOperation): Array<{ index: number; path: string }> {
  return [
    ...referencesInString(operation.path),
    ...referencesInBody(operation.body)
  ];
}

function referencesInBody(value: unknown): Array<{ index: number; path: string }> {
  if (typeof value === "string") {
    return referencesInString(value);
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => referencesInBody(item));
  }

  if (isObject(value)) {
    return Object.values(value).flatMap((item) => referencesInBody(item));
  }

  return [];
}

function referencesInString(value: string): Array<{ index: number; path: string }> {
  const references: Array<{ index: number; path: string }> = [];
  const templates = [...value.matchAll(TEMPLATE_PATTERN)];
  for (const template of templates) {
    const exact = template[0];
    REFERENCE_PATTERN.lastIndex = 0;
    const match = REFERENCE_PATTERN.exec(exact);
    if (!match) {
      throw invalidPlan(`Unsupported response reference syntax: ${exact}`);
    }

    references.push({
      index: Number(match[1]),
      path: match[2] ?? ""
    });
  }

  return references;
}

function resolveReferencesInBody(value: unknown, responses: Map<number, unknown>): unknown {
  if (typeof value === "string") {
    return resolveReferencesInString(value, responses);
  }

  if (Array.isArray(value)) {
    return value.map((item) => resolveReferencesInBody(item, responses));
  }

  if (isObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, entryValue]) => {
      return [key, resolveReferencesInBody(entryValue, responses)];
    }));
  }

  return value;
}

function resolveReferencesInString(value: string, responses: Map<number, unknown>): string {
  return value.replace(REFERENCE_PATTERN, (_match, rawIndex: string, rawPath: string) => {
    const response = responses.get(Number(rawIndex));
    const resolved = readDottedPath(response, rawPath);
    if (!isScalar(resolved)) {
      throw new ReferenceUnresolvedError();
    }

    return String(resolved);
  });
}

function readDottedPath(value: unknown, path: string): unknown {
  let current = value;
  for (const part of path.split(".")) {
    if (isObject(current) || Array.isArray(current)) {
      current = (current as Record<string, unknown>)[part];
      continue;
    }

    return undefined;
  }

  return current;
}

function operationHash(params: {
  method: WriteMethod;
  apiVersion: "v1.0" | "beta";
  path: string;
  body: unknown;
}): string {
  const material = [
    params.method,
    params.apiVersion,
    params.path,
    canonicalJson(params.body ?? null)
  ].join("\n");
  return `sha256:${sha256Hex(material)}`;
}

function buildGraphUrl(apiVersion: "v1.0" | "beta", path: string): string {
  return `${GRAPH_ROOT}/${apiVersion}${path}`;
}

function requestHeaders(accessToken: string, hasBody: boolean): HeadersInit {
  return {
    Accept: "application/json",
    ...(hasBody ? { "Content-Type": "application/json" } : {}),
    Authorization: `Bearer ${accessToken}`
  };
}

async function parseResponseData(response: ResponseLike): Promise<unknown> {
  if (response.status === 204) {
    return null;
  }

  try {
    return await response.json();
  } catch {
    return response.text();
  }
}

async function parseGraphError(response: ResponseLike): Promise<GraphErrorBody> {
  try {
    const data = await response.json();
    return isObject(data) ? (data as GraphErrorBody) : { message: String(data) };
  } catch {
    return { message: await response.text() };
  }
}

function truncateResponseBody(value: unknown): unknown {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (Buffer.byteLength(text, "utf8") <= RESULT_BODY_BYTES) {
    return value;
  }

  return {
    truncated: true,
    text: truncateText(text, RESULT_BODY_BYTES)
  };
}

function truncateText(value: string, maxBytes: number): string {
  const buffer = Buffer.from(value, "utf8");
  if (buffer.length <= maxBytes) {
    return value;
  }

  return buffer.subarray(0, maxBytes).toString("utf8");
}

function summarizeExecution(results: OperationExecutionResult[]): TerminalPlanStatus {
  const failed = results.some((result) => result.status === "failed");
  const skipped = results.some((result) => result.status === "skipped");
  const succeeded = results.some((result) => result.status === "success");
  if (!failed && !skipped) {
    return "completed";
  }

  return succeeded ? "partial" : "failed";
}

function objectEntries(value: unknown): Array<[string, unknown]> {
  return isObject(value) ? Object.entries(value) : [];
}

function jsonText(value: unknown): string {
  try {
    const text = JSON.stringify(value);
    if (text === undefined) {
      throw new Error("Value is not JSON serializable.");
    }

    return text;
  } catch {
    throw invalidPlan("operation body must be JSON serializable.");
  }
}

function normalizePath(path: string): string {
  if (!isNonEmptyString(path)) {
    throw invalidPlan("operation path is required.");
  }

  return path.startsWith("/") ? path : `/${path}`;
}

function isWriteMethod(value: string): value is WriteMethod {
  return value === "POST" || value === "PATCH" || value === "PUT" || value === "DELETE";
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isScalar(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function invalidPlan(message: string): GreybeardGraphError {
  return new GreybeardGraphError({
    code: "E_PLAN_INVALID",
    message,
    guidance: "Fix the plan structure and resubmit it."
  });
}

function writesNotConfigured(): GreybeardGraphError {
  return new GreybeardGraphError({
    code: "E_WRITES_NOT_CONFIGURED",
    message: "No writes app registration is configured for the active tenant.",
    guidance: "Tell the admin to run greybeard setup --writes."
  });
}

function tokenInvalid(): GreybeardGraphError {
  return new GreybeardGraphError({
    code: "E_TOKEN_INVALID",
    message: "The plan token is unknown or malformed.",
    guidance: "Nothing should be retried with this token. A new plan is required."
  });
}

function clientName(context: ApprovalClientContext): string {
  return context.clientInfo?.title ?? context.clientInfo?.name ?? "unknown";
}

class ReferenceUnresolvedError extends Error {}
