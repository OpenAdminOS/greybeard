import { mkdir, readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import {
  type AccountInfo,
  type AuthenticationResult,
  type Configuration,
  PublicClientApplication
} from "@azure/msal-node";
import {
  DataProtectionScope,
  type IPersistence,
  type IPersistenceConfiguration,
  PersistenceCachePlugin,
  PersistenceCreator
} from "@azure/msal-node-extensions";
import { getGreybeardAppDataPath, safePathPart } from "./appData.js";
import { activeScopeLeases, readGreybeardConfig, updateGreybeardConfig } from "./config.js";
import { buildAdminConsentUrl, isAdminConsentError, isWriteScope, scopeJustification } from "./consent.js";
import { GreybeardGraphError } from "./errors.js";
import {
  AddScopeInput,
  AddScopeResult,
  AuthStatus,
  AuthToken,
  CacheProtection,
  ClientIdKind,
  CredentialMode,
  DEFAULT_TIER1_SCOPES,
  FetchLike,
  GRAPH_CLI_CLIENT_ID,
  GraphAuthProvider,
  RemoveScopeInput,
  RemoveScopeResult
} from "./types.js";
import { ScopeAuditLog } from "./scopeAudit.js";

type MsalAuthProviderOptions = {
  tenantId?: string;
  clientId?: string;
  clientIdKind?: ClientIdKind;
  credentialMode?: CredentialMode;
  writesConfigured?: boolean;
  appDataPath?: string;
  fetcher?: FetchLike;
};

type CacheSetup = {
  plugin: PersistenceCachePlugin;
  protection: CacheProtection;
};

export class MsalGraphAuthProvider implements GraphAuthProvider {
  private readonly app: PublicClientApplication;
  private readonly tenantId: string;
  private readonly clientId: string;
  private readonly clientIdKind: ClientIdKind;
  private readonly credentialMode: CredentialMode;
  private readonly writesConfigured: boolean;
  private readonly cacheProtection: CacheProtection;
  private readonly fetcher: FetchLike;
  private readonly appDataPath: string;
  private readonly scopeAudit: ScopeAuditLog;

  private constructor(params: {
    app: PublicClientApplication;
    tenantId: string;
    clientId: string;
    clientIdKind: ClientIdKind;
    credentialMode: CredentialMode;
    writesConfigured: boolean;
    cacheProtection: CacheProtection;
    fetcher: FetchLike;
    appDataPath: string;
  }) {
    this.app = params.app;
    this.tenantId = params.tenantId;
    this.clientId = params.clientId;
    this.clientIdKind = params.clientIdKind;
    this.credentialMode = params.credentialMode;
    this.writesConfigured = params.writesConfigured;
    this.cacheProtection = params.cacheProtection;
    this.fetcher = params.fetcher;
    this.appDataPath = params.appDataPath;
    this.scopeAudit = new ScopeAuditLog(params.appDataPath);
  }

  static async create(options: MsalAuthProviderOptions = {}): Promise<MsalGraphAuthProvider> {
    const tenantId = options.tenantId ?? process.env.GREYBEARD_TENANT_ID ?? "organizations";
    const clientId = options.clientId ?? GRAPH_CLI_CLIENT_ID;
    const appDataPath = options.appDataPath ?? getGreybeardAppDataPath();
    const cache = await createCachePlugin({
      appDataPath,
      clientId
    });

    const config: Configuration = {
      auth: {
        clientId,
        authority: `https://login.microsoftonline.com/${tenantId}`
      },
      cache: {
        cachePlugin: cache.plugin
      }
    };

    return new MsalGraphAuthProvider({
      app: new PublicClientApplication(config),
      tenantId,
      clientId,
      clientIdKind: options.clientIdKind ?? "first-party",
      credentialMode: options.credentialMode ?? "read-only",
      writesConfigured: options.writesConfigured ?? false,
      cacheProtection: cache.protection,
      fetcher: options.fetcher ?? (globalThis.fetch as unknown as FetchLike),
      appDataPath
    });
  }

  async getToken(scopes: string[]): Promise<AuthToken> {
    const account = await this.findAccount();
    let result: AuthenticationResult | null = null;

    if (account) {
      try {
        result = await this.app.acquireTokenSilent({ account, scopes });
      } catch {
        result = null;
      }
    }

    result ??= await this.app.acquireTokenInteractive({
      scopes,
      openBrowser
    });

    if (!result.accessToken || !result.account) {
      throw new GreybeardGraphError({
        code: "graph-request-failed",
        message: "MSAL did not return an access token.",
        guidance: "Run greybeard setup and sign in again."
      });
    }

    return this.toAuthToken(result);
  }

  async getStatus(): Promise<AuthStatus> {
    const account = await this.findAccount();
    if (!account) {
      return this.unsignedStatus();
    }

    let result: AuthenticationResult | null = null;
    try {
      result = await this.app.acquireTokenSilent({
        account,
        scopes: [...DEFAULT_TIER1_SCOPES]
      });
    } catch {
      return this.unsignedStatus();
    }

    const token = this.toAuthToken(result);
    const [entraP1, directoryRoleProbe] = await Promise.all([
      this.detectEntraP1(token.accessToken),
      this.detectDirectoryRoles(token.accessToken)
    ]);

    return {
      signedIn: true,
      account: token.account,
      tenantId: token.tenantId,
      tenantDomain: token.tenantDomain,
      activeTenantAlias: token.activeTenantAlias,
      credentialMode: token.credentialMode,
      clientId: token.clientId,
      clientIdKind: token.clientIdKind,
      grantedScopes: token.grantedScopes,
      entraP1,
      directoryRoles: directoryRoleProbe.roles,
      directoryRolesStatus: directoryRoleProbe.status,
      cacheProtection: token.cacheProtection,
      gate: {
        pendingPlan: null,
        writesConfigured: this.writesConfigured
      }
    };
  }

  async addScopes(input: AddScopeInput): Promise<AddScopeResult> {
    const requestedScopes = unique(input.scopes);
    if (requestedScopes.length === 0 || !input.reason.trim()) {
      throw new GreybeardGraphError({
        code: "E_SCOPE_REQUEST_INVALID",
        message: "Scope requests require at least one scope and a reason.",
        guidance: "Provide the exact delegated scopes and a concise business reason."
      });
    }
    if (input.leaseMinutes !== undefined && (!Number.isInteger(input.leaseMinutes) || input.leaseMinutes < 1 || input.leaseMinutes > 43_200)) {
      throw new GreybeardGraphError({
        code: "E_SCOPE_REQUEST_INVALID",
        message: "leaseMinutes must be an integer from 1 to 43200.",
        guidance: "Use a temporary lease of at most 30 days, or omit leaseMinutes for a persistent request."
      });
    }
    const leaseExpiresAt = input.leaseMinutes === undefined
      ? undefined
      : new Date(Date.now() + input.leaseMinutes * 60_000).toISOString();
    await this.scopeAudit.append({
      event: "requested",
      scopes: requestedScopes,
      reason: input.reason,
      leaseExpiresAt
    });
    const writeScopes = requestedScopes.filter(isWriteScope);
    if (this.credentialMode === "read-only" && writeScopes.length > 0) {
      throw new GreybeardGraphError({
        code: "E_WRITES_NOT_CONFIGURED",
        message: "Write scopes require Greybeard writes mode.",
        guidance: "Tell the admin to run greybeard setup --writes before requesting write consent.",
        details: {
          requestedScopes: writeScopes
        }
      });
    }

    const currentToken = await this.getToken([...DEFAULT_TIER1_SCOPES]);
    const grantedSet = new Set(currentToken.grantedScopes.map((scope) => scope.toLowerCase()));
    const alreadyGranted = requestedScopes.filter((scope) => grantedSet.has(scope.toLowerCase()));
    const missing = requestedScopes.filter((scope) => !grantedSet.has(scope.toLowerCase()));

    if (missing.length === 0) {
      await this.persistScopeLeases(requestedScopes, input.reason, leaseExpiresAt);
      await this.scopeAudit.append({
        event: "granted",
        scopes: requestedScopes,
        reason: input.reason,
        leaseExpiresAt,
        details: { alreadyGranted: true }
      });
      return {
        granted: true,
        alreadyGranted,
        requestedScopes,
        grantedScopes: currentToken.grantedScopes,
        leaseExpiresAt
      };
    }

    try {
      const result = await this.app.acquireTokenInteractive({
        scopes: missing,
        openBrowser
      });
      await this.persistScopeLeases(requestedScopes, input.reason, leaseExpiresAt);
      await this.scopeAudit.append({
        event: "granted",
        scopes: requestedScopes,
        reason: input.reason,
        leaseExpiresAt
      });
      return {
        granted: true,
        alreadyGranted,
        requestedScopes,
        grantedScopes: unique([...(result.scopes ?? []), ...currentToken.grantedScopes]),
        leaseExpiresAt
      };
    } catch (error) {
      if (isAdminConsentError(error)) {
        await this.scopeAudit.append({
          event: "consent_required",
          scopes: missing,
          reason: input.reason,
          leaseExpiresAt
        });
        return {
          granted: false,
          alreadyGranted,
          requestedScopes,
          grantedScopes: currentToken.grantedScopes,
          consentUrl: buildAdminConsentUrl({
            tenantId: currentToken.tenantId,
            clientId: currentToken.clientId,
            scopes: missing,
            ...(currentToken.clientIdKind === "workspace" ? { redirectUri: "http://localhost" } : {})
          }),
          justifications: Object.fromEntries(missing.map((scope) => [scope, scopeJustification(scope)])),
          guidance: "Give this admin-consent URL and scope justification list to an admin who can grant tenant-wide consent."
        };
      }

      throw error;
    }
  }

  async removeScopes(input: RemoveScopeInput): Promise<RemoveScopeResult> {
    const requested = unique(input.scopes);
    if (!input.confirm || requested.length === 0 || !input.reason.trim()) {
      throw new GreybeardGraphError({
        code: "E_SCOPE_RELEASE_CONFIRMATION_REQUIRED",
        message: "Removing configured scopes requires confirm=true, at least one scope, and a reason.",
        guidance: "Review the affected workflows, then repeat with explicit confirmation."
      });
    }

    const tier1 = new Set(DEFAULT_TIER1_SCOPES.map((scope) => scope.toLowerCase()));
    const protectedScopes = requested.filter((scope) => tier1.has(scope.toLowerCase()));
    if (protectedScopes.length > 0) {
      throw new GreybeardGraphError({
        code: "E_SCOPE_RELEASE_BLOCKED",
        message: `Tier 1 scopes cannot be removed through remove-scope: ${protectedScopes.join(", ")}.`,
        guidance: "Re-run setup with a different base-scope policy instead of weakening the active credential implicitly."
      });
    }

    const config = await readGreybeardConfig(this.appDataPath);
    const configured = new Set([
      ...(config.scopeLeases ?? []).map((lease) => lease.scope),
      ...(config.requestedWriteScopes ?? [])
    ].map((scope) => scope.toLowerCase()));
    const removedScopes = requested.filter((scope) => configured.has(scope.toLowerCase()));
    const notConfigured = requested.filter((scope) => !configured.has(scope.toLowerCase()));
    const removedSet = new Set(removedScopes.map((scope) => scope.toLowerCase()));
    await updateGreybeardConfig(this.appDataPath, (current) => ({
      ...current,
      scopeLeases: (current.scopeLeases ?? []).filter((lease) => !removedSet.has(lease.scope.toLowerCase())),
      requestedWriteScopes: (current.requestedWriteScopes ?? []).filter((scope) => !removedSet.has(scope.toLowerCase()))
    }));
    await this.scopeAudit.append({
      event: "released",
      scopes: removedScopes,
      reason: input.reason,
      details: { notConfigured }
    });

    return {
      removedScopes,
      notConfigured,
      requiresTenantConsentRevocation: removedScopes.length > 0,
      guidance: removedScopes.length > 0
        ? "Greybeard stopped requesting these scopes. An Entra administrator must also revoke the delegated consent grant to remove tenant-side consent immediately."
        : "No matching configured scopes were found."
    };
  }

  private async persistScopeLeases(scopes: string[], reason: string, expiresAt?: string): Promise<void> {
    const requestedAt = new Date().toISOString();
    const incoming = new Set(scopes.map((scope) => scope.toLowerCase()));
    await updateGreybeardConfig(this.appDataPath, (current) => ({
      ...current,
      scopeLeases: [
        ...activeScopeLeases(current).filter((lease) => !incoming.has(lease.scope.toLowerCase())),
        ...scopes.map((scope) => ({
          scope,
          reason,
          requestedAt,
          ...(expiresAt ? { expiresAt } : {})
        }))
      ]
    }));
  }

  private async findAccount(): Promise<AccountInfo | null> {
    const accounts = await this.app.getAllAccounts();
    return accounts.find((account) => account.tenantId === this.tenantId) ?? accounts[0] ?? null;
  }

  private toAuthToken(result: AuthenticationResult): AuthToken {
    const account = result.account;
    const username = account?.username ?? "unknown";
    const tenantId = result.tenantId || account?.tenantId || this.tenantId;
    const tenantDomain = domainFromUsername(username);

    return {
      accessToken: result.accessToken,
      account: username,
      tenantId,
      tenantDomain,
      activeTenantAlias: tenantDomain.split(".")[0] ?? tenantDomain,
      clientId: this.clientId,
      clientIdKind: this.clientIdKind,
      credentialMode: this.credentialMode,
      grantedScopes: unique(result.scopes ?? []),
      cacheProtection: this.cacheProtection,
      writesConfigured: this.writesConfigured
    };
  }

  private unsignedStatus(): AuthStatus {
    return {
      signedIn: false,
      instruction: "run greybeard setup",
      account: null,
      tenantId: null,
      tenantDomain: null,
      activeTenantAlias: this.tenantId,
      credentialMode: this.credentialMode,
      clientId: this.clientId,
      clientIdKind: this.clientIdKind,
      grantedScopes: [],
      entraP1: null,
      directoryRoles: null,
      directoryRolesStatus: {
        state: "not-signed-in"
      },
      cacheProtection: this.cacheProtection,
      gate: {
        pendingPlan: null,
        writesConfigured: this.writesConfigured
      }
    };
  }

  private async detectEntraP1(accessToken: string): Promise<boolean | null> {
    try {
      const data = await this.graphStatusGet("/beta/subscribedSkus?$select=skuPartNumber,servicePlans", accessToken);
      if (!isObject(data) || !Array.isArray(data.value)) {
        return null;
      }

      return data.value.some((sku) => {
        if (!isObject(sku)) {
          return false;
        }

        const skuPartNumber = String(sku.skuPartNumber ?? "");
        const servicePlans = Array.isArray(sku.servicePlans) ? sku.servicePlans : [];
        return /AAD_PREMIUM/i.test(skuPartNumber) || servicePlans.some((plan) => {
          return isObject(plan) && /AAD_PREMIUM/i.test(String(plan.servicePlanName ?? ""));
        });
      });
    } catch {
      return null;
    }
  }

  private async detectDirectoryRoles(accessToken: string): Promise<{
    roles: string[] | null;
    status: { state: "available" | "unavailable"; diagnostic?: string };
  }> {
    try {
      const data = await this.graphStatusGet("/beta/me/memberOf/microsoft.graph.directoryRole?$select=displayName", accessToken);
      if (!isObject(data) || !Array.isArray(data.value)) {
        return {
          roles: null,
          status: {
            state: "unavailable",
            diagnostic: "Graph returned an unexpected directory-role response."
          }
        };
      }

      return {
        roles: data.value
          .map((role) => (isObject(role) ? role.displayName : undefined))
          .filter((role): role is string => typeof role === "string"),
        status: { state: "available" }
      };
    } catch (error) {
      return {
        roles: null,
        status: {
          state: "unavailable",
          diagnostic: error instanceof Error ? error.message : String(error)
        }
      };
    }
  }

  private async graphStatusGet(path: string, accessToken: string): Promise<unknown> {
    const response = await this.fetcher(`https://graph.microsoft.com${path}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
      throw new Error(`Graph status probe failed with HTTP ${response.status}.`);
    }

    return response.json();
  }
}

async function createCachePlugin(params: {
  appDataPath: string;
  clientId: string;
}): Promise<CacheSetup> {
  const cachePath = join(
    params.appDataPath,
    "auth",
    safePathPart(params.clientId),
    "msal-cache.json"
  );
  await mkdir(dirname(cachePath), { recursive: true });

  const baseConfig = {
    cachePath,
    serviceName: "greybeard",
    accountName: params.clientId,
    dataProtectionScope: DataProtectionScope.CurrentUser
  };

  if (process.platform === "linux") {
    try {
      const persistence = await PersistenceCreator.createPersistence({
        ...baseConfig,
        usePlaintextFileOnLinux: false
      });
      await migrateLegacyTokenCache({
        appDataPath: params.appDataPath,
        clientId: params.clientId,
        unifiedPersistence: persistence,
        protection: "libsecret"
      });
      return {
        plugin: new PersistenceCachePlugin(persistence),
        protection: "libsecret"
      };
    } catch {
      const persistence = await PersistenceCreator.createPersistence({
        ...baseConfig,
        usePlaintextFileOnLinux: true
      });
      await migrateLegacyTokenCache({
        appDataPath: params.appDataPath,
        clientId: params.clientId,
        unifiedPersistence: persistence,
        protection: "plaintext"
      });
      return {
        plugin: new PersistenceCachePlugin(persistence),
        protection: "plaintext"
      };
    }
  }

  const persistence = await PersistenceCreator.createPersistence(baseConfig);
  await migrateLegacyTokenCache({
    appDataPath: params.appDataPath,
    clientId: params.clientId,
    unifiedPersistence: persistence,
    protection: process.platform === "darwin" ? "keychain" : "dpapi"
  });
  return {
    plugin: new PersistenceCachePlugin(persistence),
    protection: process.platform === "darwin" ? "keychain" : "dpapi"
  };
}

async function migrateLegacyTokenCache(params: {
  appDataPath: string;
  clientId: string;
  unifiedPersistence: IPersistence;
  protection: CacheProtection;
}): Promise<void> {
  const current = await params.unifiedPersistence.load();
  if (cacheHasAccounts(current)) {
    return;
  }

  const legacyCaches = await legacyCacheCandidates(params.appDataPath, params.clientId);
  for (const legacy of legacyCaches) {
    const contents = await loadLegacyCache({
      cachePath: legacy.cachePath,
      tenantKey: legacy.tenantKey,
      clientId: params.clientId,
      protection: params.protection
    });
    if (!cacheHasAccounts(contents)) {
      continue;
    }

    await params.unifiedPersistence.save(contents as string);
    console.error("migrated legacy token cache");
    return;
  }
}

async function legacyCacheCandidates(appDataPath: string, clientId: string): Promise<Array<{
  cachePath: string;
  tenantKey: string;
  mtimeMs: number;
}>> {
  const authDir = join(appDataPath, "auth");
  let entries;
  try {
    entries = await readdir(authDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const candidates: Array<{ cachePath: string; tenantKey: string; mtimeMs: number }> = [];
  const safeClientId = safePathPart(clientId);
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === safeClientId) {
      continue;
    }

    const cachePath = join(authDir, entry.name, safeClientId, "msal-cache.json");
    let cacheStat;
    try {
      cacheStat = await stat(cachePath);
    } catch {
      continue;
    }

    candidates.push({
      cachePath,
      tenantKey: entry.name,
      mtimeMs: cacheStat.mtimeMs
    });
  }

  return candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
}

async function loadLegacyCache(params: {
  cachePath: string;
  tenantKey: string;
  clientId: string;
  protection: CacheProtection;
}): Promise<string | null> {
  for (const config of legacyPersistenceConfigs(params)) {
    try {
      const persistence = await PersistenceCreator.createPersistence(config);
      const contents = await persistence.load();
      if (cacheHasAccounts(contents)) {
        return contents;
      }
    } catch {
      continue;
    }
  }

  return null;
}

function legacyPersistenceConfigs(params: {
  cachePath: string;
  tenantKey: string;
  clientId: string;
  protection: CacheProtection;
}): IPersistenceConfiguration[] {
  const baseConfig = {
    cachePath: params.cachePath,
    serviceName: "greybeard",
    accountName: `${params.tenantKey}.${params.clientId}`,
    dataProtectionScope: DataProtectionScope.CurrentUser
  };

  if (process.platform !== "linux") {
    return [baseConfig];
  }

  const preferredPlaintext = params.protection === "plaintext";
  return [
    {
      ...baseConfig,
      usePlaintextFileOnLinux: preferredPlaintext
    },
    {
      ...baseConfig,
      usePlaintextFileOnLinux: !preferredPlaintext
    }
  ];
}

function cacheHasAccounts(contents: string | null): boolean {
  if (!contents) {
    return false;
  }

  try {
    const parsed: unknown = JSON.parse(contents);
    if (!isObject(parsed)) {
      return false;
    }

    const accounts = parsed.Account;
    return isObject(accounts) && Object.keys(accounts).length > 0;
  } catch {
    return false;
  }
}

async function openBrowser(url: string): Promise<void> {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore"
    });
    child.on("error", reject);
    child.on("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

function domainFromUsername(username: string): string {
  const domain = username.split("@")[1];
  return domain || "unknown";
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
