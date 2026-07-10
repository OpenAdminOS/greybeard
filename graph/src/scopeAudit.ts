import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

export type ScopeAuditEvent = "requested" | "granted" | "consent_required" | "released" | "expired";

export class ScopeAuditLog {
  constructor(
    private readonly appDataPath: string,
    private readonly now: () => number = Date.now
  ) {}

  async append(record: {
    event: ScopeAuditEvent;
    scopes: string[];
    reason: string;
    leaseExpiresAt?: string;
    details?: Record<string, unknown>;
  }): Promise<void> {
    const timestamp = new Date(this.now()).toISOString();
    const date = new Date(this.now());
    const month = `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    const path = join(this.appDataPath, "audit", `scopes-${month}.jsonl`);
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify({ timestamp, ...record })}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
  }
}
