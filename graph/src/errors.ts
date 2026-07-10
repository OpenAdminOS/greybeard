export type GreybeardErrorCode =
  | "E_WRITE_BLOCKED"
  | "E_WRITES_NOT_CONFIGURED"
  | "E_PLAN_INVALID"
  | "E_PLAN_SCOPE_MISSING"
  | "E_PLAN_PENDING"
  | "E_PLAN_NOT_FOUND"
  | "E_CHANNEL_UNAVAILABLE"
  | "E_TOKEN_INVALID"
  | "E_TOKEN_EXPIRED"
  | "E_PLAN_ALREADY_EXECUTED"
  | "E_REFERENCE_UNRESOLVED"
  | "E_SCOPE_REQUEST_INVALID"
  | "E_SCOPE_RELEASE_CONFIRMATION_REQUIRED"
  | "E_SCOPE_RELEASE_BLOCKED"
  | "E_SCOPE_RELEASE_UNAVAILABLE"
  | "missing-scope"
  | "missing-Entra-P1-license"
  | "missing-directory-role"
  | "graph-request-failed";

export type GreybeardErrorPayload = {
  code: GreybeardErrorCode;
  message: string;
  guidance: string;
  httpStatus?: number;
  missingScope?: string;
  consentUrl?: string;
  requiredLicense?: string;
  requiredRoles?: string[];
  details?: Record<string, unknown>;
};

export class GreybeardGraphError extends Error {
  readonly payload: GreybeardErrorPayload;

  constructor(payload: GreybeardErrorPayload) {
    super(payload.message);
    this.name = "GreybeardGraphError";
    this.payload = payload;
  }

  toJSON(): GreybeardErrorPayload {
    return this.payload;
  }
}

export function isGreybeardGraphError(error: unknown): error is GreybeardGraphError {
  return error instanceof GreybeardGraphError;
}
