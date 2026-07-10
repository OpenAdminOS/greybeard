import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { NormalizedWriteOperation, OperationExecutionResult } from "./writeGateTypes.js";

export class AuditLog {
  private readonly appDataPath: string;
  private readonly now: () => number;

  constructor(params: {
    appDataPath: string;
    now?: () => number;
  }) {
    this.appDataPath = params.appDataPath;
    this.now = params.now ?? Date.now;
  }

  async created(record: CommonAuditFields & {
    operations: NormalizedWriteOperation[];
    requiredScopes?: string[];
  }): Promise<void> {
    await this.append({
      event: "created",
      ...this.commonRecord(record),
      requiredScopes: record.requiredScopes ?? [],
      operations: record.operations.map((operation, index) => ({
        index,
        method: operation.method,
        apiVersion: operation.apiVersion,
        path: operation.path,
        hash: operation.hash
      }))
    });
  }

  async decided(record: CommonAuditFields & {
    channel: string;
    decision: "approved" | "rejected";
    reason: string;
    operations: NormalizedWriteOperation[];
    requiredScopes?: string[];
  }): Promise<void> {
    await this.append({
      event: "decided",
      ...this.commonRecord(record),
      channel: record.channel,
      decision: record.decision,
      reason: record.reason,
      requiredScopes: record.requiredScopes ?? [],
      operations: record.operations.map((operation, index) => ({
        index,
        method: operation.method,
        apiVersion: operation.apiVersion,
        path: operation.path,
        hash: operation.hash
      }))
    });
  }

  async executed(record: CommonAuditFields & {
    status: "completed" | "partial" | "failed";
    operations: NormalizedWriteOperation[];
    results: OperationExecutionResult[];
    requiredScopes?: string[];
  }): Promise<void> {
    const hashesByIndex = new Map(record.operations.map((operation, index) => [index, operation.hash]));
    await this.append({
      event: "executed",
      ...this.commonRecord(record),
      status: record.status,
      requiredScopes: record.requiredScopes ?? [],
      results: record.results.map((result) => ({
        index: result.index,
        hash: hashesByIndex.get(result.index),
        status: result.status,
        httpStatus: result.httpStatus,
        error: result.error,
        missingScope: result.missingScope
      }))
    });
  }

  private commonRecord(record: CommonAuditFields) {
    return {
      timestamp: new Date(this.now()).toISOString(),
      sessionId: record.sessionId,
      planId: record.planId,
      tenantId: record.tenantId,
      tenantDomain: record.tenantDomain,
      account: record.account,
      clientName: record.clientName
    };
  }

  private async append(record: Record<string, unknown>): Promise<void> {
    const path = this.auditPath();
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify(record)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
  }

  private auditPath(): string {
    const date = new Date(this.now());
    const month = `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    return join(this.appDataPath, "audit", `plans-${month}.jsonl`);
  }
}

export type CommonAuditFields = {
  sessionId: string;
  planId: string;
  tenantId: string;
  tenantDomain: string;
  account: string;
  clientName: string;
};
