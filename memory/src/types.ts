export const MEMORY_TYPES = ["query", "preference", "script", "fact", "scope"] as const;
export const EDGE_RELATIONS = ["used", "depends_on", "needs", "prefers"] as const;

export type MemoryType = typeof MEMORY_TYPES[number];
export type EdgeRelation = typeof EDGE_RELATIONS[number];

export type MemoryLinkInput = {
  target: number;
  relation: EdgeRelation;
  weight?: number;
};

export type RecallInput = {
  query: string;
  limit?: number;
};

export type RememberInput = {
  type: MemoryType;
  content: string;
  links?: MemoryLinkInput[];
};

export type ListInput = {
  type?: MemoryType;
  limit?: number;
};

export type ForgetInput = {
  id?: number;
  olderThanDays?: number;
  type?: MemoryType;
};

export type MemoryNode = {
  id: number;
  type: MemoryType;
  content: string;
  tenant: string;
  createdAt: number;
  lastUsedAt: number;
};

export type RecallResultNode = MemoryNode & {
  matched: boolean;
  score: number;
  linkedFrom?: number;
  relation?: EdgeRelation;
  edgeWeight?: number;
};

export type RecallResult = {
  tenant: string;
  query: string;
  message: string;
  results: RecallResultNode[];
};

export type RememberResult = {
  tenant: string;
  action: "inserted" | "updated";
  id: number;
  type: MemoryType;
  content: string;
  linked: number;
};

export type ListResult = {
  tenant: string;
  results: MemoryNode[];
};

export type ForgetResult = {
  tenant: string;
  deleted: number;
};

export type MemoryErrorCode =
  | "privacy-rejected"
  | "invalid-input"
  | "target-not-found";

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
