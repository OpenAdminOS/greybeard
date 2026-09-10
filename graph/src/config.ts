import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { GRAPH_CLI_CLIENT_ID } from "./types.js";
import { GreybeardConfig, ScopeLease } from "./writeGateTypes.js";

export async function readGreybeardConfig(appDataPath: string): Promise<GreybeardConfig> {
  try {
    const raw = await readFile(join(appDataPath, "config.json"), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!isObject(parsed)) {
      return {};
    }

    const clients = isObject(parsed.clients) ? parsed.clients : undefined;
    const gate = isObject(parsed.gate) ? parsed.gate : undefined;
    return {
      profileId: typeof parsed.profileId === "string" ? parsed.profileId : undefined,
      learningEnabled: typeof parsed.learningEnabled === "boolean" ? parsed.learningEnabled : undefined,
      updateMode: parsed.updateMode === "automatic" || parsed.updateMode === "notify" || parsed.updateMode === "manual" ? parsed.updateMode : undefined,
      appOnlyProfile: parseAppOnlyProfile(parsed.appOnlyProfile),
      configRevision: typeof parsed.configRevision === "number" && Number.isSafeInteger(parsed.configRevision)
        ? parsed.configRevision
        : undefined,
      activeTenantId: typeof parsed.activeTenantId === "string" ? parsed.activeTenantId : undefined,
      credentialMode: parsed.credentialMode === "writes" ? "writes" : parsed.credentialMode === "read-only" ? "read-only" : undefined,
      workspaceAppId: typeof parsed.workspaceAppId === "string" ? parsed.workspaceAppId : undefined,
      bootstrapCleanupPending: parsed.bootstrapCleanupPending === true,
      grantedReadScopes: stringArray(parsed.grantedReadScopes),
      requestedWriteScopes: stringArray(parsed.requestedWriteScopes),
      scopeLeases: scopeLeaseArray(parsed.scopeLeases),
      skillUpdate: parsed.skillUpdate === "weekly" || parsed.skillUpdate === "login" || parsed.skillUpdate === "off"
        ? parsed.skillUpdate
        : undefined,
      serverUpdate: parsed.serverUpdate === "latest" || parsed.serverUpdate === "pinned"
        ? parsed.serverUpdate
        : undefined,
      serverPackageSource: parsed.serverPackageSource === "local" || parsed.serverPackageSource === "npm"
        ? parsed.serverPackageSource
        : undefined,
      mcpServers: booleanRecord(parsed.mcpServers),
      memoryHook: typeof parsed.memoryHook === "boolean" ? parsed.memoryHook : undefined,
      clients: clients
        ? {
            githubCopilot: clients.githubCopilot === true
          }
        : undefined,
      gate: gate
        ? {
            cliApprove: gate.cliApprove === true
          }
        : undefined
    };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return {};
    }

    throw error;
  }
}

export async function writeGreybeardConfig(appDataPath: string, config: GreybeardConfig): Promise<void> {
  await withConfigLock(appDataPath, () => writeConfigUnlocked(appDataPath, config));
}

async function writeConfigUnlocked(appDataPath: string, config: GreybeardConfig): Promise<void> {
  const path = join(appDataPath, "config.json");
  const tempPath = join(appDataPath, `config.json.${process.pid}.${randomUUID()}.tmp`);
  try {
  await writeFile(tempPath, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  await rename(tempPath, path);
  } finally {
    await rm(tempPath, { force: true });
  }
}

export async function updateGreybeardConfig(
  appDataPath: string,
  updater: (config: GreybeardConfig) => GreybeardConfig
): Promise<GreybeardConfig> {
  return withConfigLock(appDataPath, async () => {
  const current = await readGreybeardConfig(appDataPath);
  const next = {
    ...updater(current),
    configRevision: (current.configRevision ?? 0) + 1
  };
  await writeConfigUnlocked(appDataPath, next);
  return next;
  });
}

async function withConfigLock<T>(appDataPath: string, action: () => Promise<T>): Promise<T> {
  await mkdir(appDataPath, { recursive: true, mode: 0o700 });
  const path = join(appDataPath, "config.lock");
  const deadline = Date.now() + 10_000;
  let lock;
  while (!lock) {
    try {
      lock = await open(path, "wx", 0o600);
    } catch (error) {
      if (!isNodeError(error) || error.code !== "EEXIST") throw error;
      if (Date.now() >= deadline) throw new Error("Configuration is locked. Close other Greybeard processes; remove config.lock only if a crashed process left it behind.");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  try {
    await lock.writeFile(String(process.pid));
    return await action();
  } finally {
    await lock.close();
    await rm(path, { force: true });
  }
}

function parseAppOnlyProfile(value: unknown): GreybeardConfig["appOnlyProfile"] {
  if (value === undefined) return undefined;
  if (!isObject(value) || ![value.tenantId, value.clientId, value.certificatePath, value.privateKeyPath].every(isNonEmptyString)
      || !Array.isArray(value.capabilities) || !value.capabilities.every((item) => typeof item === "string")) {
    throw new Error("Invalid app-only connection configuration. Reconfigure the connection locally.");
  }
  return { tenantId: value.tenantId as string, clientId: value.clientId as string, certificatePath: value.certificatePath as string,
    privateKeyPath: value.privateKeyPath as string, capabilities: value.capabilities as string[] };
}

export function activeScopeLeases(config: GreybeardConfig, now = Date.now()): ScopeLease[] {
  return (config.scopeLeases ?? []).filter((lease) => {
    return lease.expiresAt === undefined || Date.parse(lease.expiresAt) > now;
  });
}

export function graphAuthConfig(config: GreybeardConfig): {
  tenantId?: string;
  clientId: string;
  clientIdKind: "first-party" | "workspace";
  credentialMode: "read-only" | "writes";
  writesConfigured: boolean;
} {
  const writesConfigured = config.credentialMode === "writes" && isNonEmptyString(config.workspaceAppId);
  return {
    tenantId: config.activeTenantId,
    clientId: writesConfigured ? config.workspaceAppId as string : GRAPH_CLI_CLIENT_ID,
    clientIdKind: writesConfigured ? "workspace" : "first-party",
    credentialMode: writesConfigured ? "writes" : "read-only",
    writesConfigured
  };
}

function booleanRecord(value: unknown): Record<string, boolean> | undefined {
  if (!isObject(value)) {
    return undefined;
  }

  const entries = Object.entries(value).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean");
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const filtered = value.filter((item): item is string => typeof item === "string");
  return filtered.length > 0 ? filtered : undefined;
}

function scopeLeaseArray(value: unknown): ScopeLease[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const leases = value.flatMap((item): ScopeLease[] => {
    if (!isObject(item) || !isNonEmptyString(item.scope) || !isNonEmptyString(item.reason) || !isNonEmptyString(item.requestedAt)) {
      return [];
    }

    return [{
      scope: item.scope,
      reason: item.reason,
      requestedAt: item.requestedAt,
      ...(isNonEmptyString(item.expiresAt) ? { expiresAt: item.expiresAt } : {})
    }];
  });
  return leases.length > 0 ? leases : undefined;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
