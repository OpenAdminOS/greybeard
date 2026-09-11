export const MEMORY_TYPES = ["query", "preference", "script", "fact", "scope", "decision"] as const;
export const EDGE_RELATIONS = ["used", "depends_on", "needs", "prefers", "exception_to"] as const;

export type MemoryType = typeof MEMORY_TYPES[number];
export type EdgeRelation = typeof EDGE_RELATIONS[number];

export type MemoryTypePolicy = {
  guidPrivacyThreshold: number;
  recallBoost: number;
  evictionSticky: boolean;
};

const DEFAULT_TYPE_POLICY: MemoryTypePolicy = {
  guidPrivacyThreshold: 2,
  recallBoost: 0,
  evictionSticky: false
};

export const MEMORY_TYPE_POLICY: Record<MemoryType, MemoryTypePolicy> = {
  query: DEFAULT_TYPE_POLICY,
  script: DEFAULT_TYPE_POLICY,
  fact: DEFAULT_TYPE_POLICY,
  scope: DEFAULT_TYPE_POLICY,
  preference: {
    guidPrivacyThreshold: 2,
    recallBoost: 1000,
    evictionSticky: true
  },
  decision: {
    // A decision rationale legitimately names a policy and a group or app.
    guidPrivacyThreshold: 4,
    recallBoost: 500,
    evictionSticky: true
  }
};

export function memoryTypePolicy(type: MemoryType | string | undefined): MemoryTypePolicy {
  return MEMORY_TYPE_POLICY[type as MemoryType] ?? DEFAULT_TYPE_POLICY;
}

export function stickyMemoryTypes(): MemoryType[] {
  return MEMORY_TYPES.filter((type) => MEMORY_TYPE_POLICY[type].evictionSticky);
}

export type MemoryLinkInput = {
  target: number;
  relation: EdgeRelation;
  weight?: number;
};

export type RecallInput = {
  query: string;
  limit?: number;
  /** Only global and this exact scope are applicable. */
  scope?: string;
  /** UTF-8 byte budget for recalled nodes, capped at 800; excludes the envelope. */
  byteBudget?: number;
  /** @deprecated Alias for byteBudget. This is not a model token count. */
  tokenBudget?: number;
};

export type EvidenceKind = "rule" | "observation" | "inference" | "context";

export type RememberInput = {
  type: MemoryType;
  content: string;
  links?: MemoryLinkInput[];
  source?: string;
  scope?: string;
  evidenceKind?: EvidenceKind;
  /** UTC epoch seconds when evidence was observed, not when recalled. */
  observedAt?: number;
  outcome?: string;
  /** Explicit correction target; the original remains until confirmation. */
  supersedes?: number;
};

export type MemoryStatus = "candidate" | "confirmed";
export type ConfirmInput = { id: number; expectedRevision: string; confirmationChannel?: "local-cli" | "local-ui" };

export type ListInput = {
  query?: string;
  scope?: string;
  type?: MemoryType;
  status?: MemoryStatus;
  limit?: number;
  cursor?: number;
};

export type ForgetInput = {
  id?: number;
  olderThanDays?: number;
  type?: MemoryType;
};

export type MemoryNode = {
  id: number;
  revision: string;
  type: MemoryType;
  content: string;
  tenant: string;
  createdAt: number;
  lastUsedAt: number;
  profileId: string;
  status: MemoryStatus;
  source: string;
  scope: string;
  confirmedAt: number | null;
  confirmationChannel: string | null;
  supersedes: number | null;
  supersededAt: number | null;
  evidenceKind?: EvidenceKind;
  observedAt?: number | null;
  outcome?: string | null;
};

/** Compact context; full timestamps and review metadata remain in list/export. */
export type RecallResultNode = Pick<MemoryNode, "id" | "type" | "content" | "status" | "source" | "scope"> & {
  evidenceKind: EvidenceKind;
  observedAt: number | null;
  verificationRequired: boolean;
  evidenceAgeSeconds: number | null;
  matched: boolean;
  linkedFrom?: number;
  relation?: EdgeRelation;
};

export type RecallStatus = "recalled" | "no-match" | "budget-excluded" | "paused";
export type RecallResult = {
  recallId?: string;
  tenant: string;
  profileId: string;
  message: string;
  results: RecallResultNode[];
  recallStatus: RecallStatus;
  /** Describes retrieval, not whether the host applied advice or assessed a tenant. */
  attribution: { kind: "confirmed-guidance" | "none"; statement: string };
  /** Sum of compact node JSON bytes plus one separator byte per node; excludes the envelope. */
  serializedBytes: number;
  byteBudget: number;
  budgetUnit: "utf8-bytes";
  /** @deprecated Alias for serializedBytes; not measured or estimated model billing. */
  estimatedTokens: number;
  /** @deprecated Alias for byteBudget; not a model token count. */
  tokenBudget: number;
  budgetScope: "serialized-recalled-nodes";
};

export type RememberResult = {
  tenant: string;
  action: "inserted" | "updated";
  id: number;
  type: MemoryType;
  content: string;
  linked: number;
  status: "candidate";
};

export type ListResult = {
  tenant: string;
  results: MemoryNode[];
  nextCursor?: number;
};

export type MemoryExport = {
  version: 1;
  tenant: string;
  profileId: string;
  nodes: MemoryNode[];
  edges: Array<{ source: number; target: number; relation: EdgeRelation; weight: number }>;
};

export type ForgetResult = {
  tenant: string;
  deleted: number;
};

export type MemoryErrorCode =
  | "privacy-rejected"
  | "invalid-input"
  | "target-not-found"
  | "learning-disabled";

export class GreybeardMemoryError extends Error {
  readonly code: MemoryErrorCode;
  readonly guidance: string;
  readonly details?: Record<string, unknown>;

  constructor(params: {
    code: MemoryErrorCode;
    message: string;
    guidance: string;
    details?: Record<string, unknown>;
  }) {
    super(params.message);
    this.name = "GreybeardMemoryError";
    this.code = params.code;
    this.guidance = params.guidance;
    this.details = params.details;
  }

  toJSON(): {
    code: MemoryErrorCode;
    message: string;
    guidance: string;
    details?: Record<string, unknown>;
  } {
    return {
      code: this.code,
      message: this.message,
      guidance: this.guidance,
      ...(this.details ? { details: this.details } : {})
    };
  }
}

export function isGreybeardMemoryError(error: unknown): error is GreybeardMemoryError {
  return error instanceof GreybeardMemoryError;
}

export type DiscoverScopesInput = { query?: string; limit?: number; cursor?: string };
export type DiscoverScopesResult = { tenant: string; profileId: string; scopes: Array<{ scope: string; confirmedCount: number }>; nextCursor?: string; paused: boolean; guidance: string };
export type OutcomeInput = { lesson: string; outcome: string; source: string; scope?: string; observedAt?: number };
export type AdviceFeedback = "accepted" | "ignored" | "irrelevant";
export type AdviceEvent = { recallId: string; createdAt: number; serializedBytes: number; memoryIds: number[]; memories: Array<{ id: number; content: string | null }>; feedback: AdviceFeedback | null };
export type AdviceMetrics = {
  recalls: number; guidanceRecalls: number; recalledBytes: number; accepted: number; ignored: number; irrelevant: number;
  rated: number; irrelevantRate: number | null; acceptedPerKiB: number | null;
  measurement: "local-retrieval-and-explicit-feedback"; billing: "not-measured";
};
