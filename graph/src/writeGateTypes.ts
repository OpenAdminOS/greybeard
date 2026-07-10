import { AuthToken, CredentialMode } from "./types.js";

export type WriteMethod = "POST" | "PATCH" | "PUT" | "DELETE";
export type ApprovalChannelName = "elicitation" | "browser" | "cli";
export type DecisionValue = "approved" | "rejected";
export type SkillUpdateMode = "weekly" | "login" | "off";
export type ServerUpdateMode = "latest" | "pinned";
export type ServerPackageSource = "local" | "npm";

export type PlanWriteOperationInput = {
  method: string;
  apiVersion?: "v1.0" | "beta";
  path: string;
  body?: unknown;
  reason: string;
};

export type PlanWriteInput = {
  summary: string;
  rollback: string;
  requiredScopes: string[];
  stopOnError?: boolean;
  prefetch?: boolean;
  operations: PlanWriteOperationInput[];
};

export type CheckPlanInput = {
  planId: string;
};

export type ExecutePlanInput = {
  planId: string;
  token: string;
};

export type NormalizedWriteOperation = {
  method: WriteMethod;
  apiVersion: "v1.0" | "beta";
  path: string;
  body: unknown;
  reason: string;
  hash: string;
  bodyBytes: number;
  prefetch?: PatchPrefetch;
};

export type PatchPrefetch = {
  verified: boolean;
  fields: Array<{
    field: string;
    current?: unknown;
    next: unknown;
  }>;
  error?: string;
};

export type ApprovalDecision = {
  decision: DecisionValue;
  reason: string;
  channel: ApprovalChannelName;
};

export type RenderPlanInput = {
  planId: string;
  summary: string;
  rollback: string;
  requiredScopes: string[];
  stopOnError: boolean;
  operations: NormalizedWriteOperation[];
  authToken: AuthToken;
  clientName: string;
  sessionStartedAt: string;
  approvalDeadline: string;
};

export type OperationExecutionResult = {
  index: number;
  status: "success" | "failed" | "skipped";
  httpStatus?: number;
  body?: unknown;
  error?: string;
  missingScope?: string;
  consentUrl?: string;
};

export type TerminalPlanStatus = "completed" | "partial" | "failed";

export type GreybeardConfig = {
  configRevision?: number;
  activeTenantId?: string;
  credentialMode?: CredentialMode;
  workspaceAppId?: string;
  bootstrapCleanupPending?: boolean;
  grantedReadScopes?: string[];
  requestedWriteScopes?: string[];
  scopeLeases?: ScopeLease[];
  skillUpdate?: SkillUpdateMode;
  serverUpdate?: ServerUpdateMode;
  serverPackageSource?: ServerPackageSource;
  mcpServers?: Record<string, boolean>;
  memoryHook?: boolean;
  clients?: {
    githubCopilot?: boolean;
  };
  gate?: {
    cliApprove?: boolean;
  };
};

export type ScopeLease = {
  scope: string;
  reason: string;
  requestedAt: string;
  expiresAt?: string;
};
