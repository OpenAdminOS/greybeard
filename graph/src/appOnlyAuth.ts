import { loadClientSecret, validateClientSecret } from "./clientSecretStore.js";
import { readWindowsProtectedKey } from "./windowsCredential.js";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { createPrivateKey, X509Certificate } from "node:crypto";
import { ConfidentialClientApplication } from "@azure/msal-node";
import { readGreybeardConfig } from "./config.js";
import type { AppOnlyProfile } from "./writeGateTypes.js";
import type { AddScopeInput, AddScopeResult, AuthStatus, AuthToken, GraphAuthProvider } from "./types.js";

export const APPLICATION_CAPABILITIES = {
  users: { permission: "User.Read.All", path: "/users", select: "id,displayName,department,jobTitle", label: "User profiles and organizational attributes" },
  groups: { permission: "GroupMember.Read.All", path: "/groups", select: "id,displayName", label: "Basic groups and ordinary membership" },
  devices: { permission: "DeviceManagementManagedDevices.Read.All", path: "/deviceManagement/managedDevices", select: "id,deviceName,operatingSystem,complianceState,lastSyncDateTime", label: "Intune inventory and current compliance" },
  compliance: { permission: "DeviceManagementConfiguration.Read.All", path: "/deviceManagement/deviceCompliancePolicies", select: "id,displayName,lastModifiedDateTime,version", label: "Intune compliance policies, assignments and noncompliance actions" },
  "conditional-access": { permission: "Policy.Read.ConditionalAccess", path: "/identity/conditionalAccess/policies", select: "id,displayName,state,conditions,grantControls", label: "Conditional Access policy review (minimal grant validation pending)" }
} as const;
export type ApplicationCapability = keyof typeof APPLICATION_CAPABILITIES;

function sameProfile(a: AppOnlyProfile | undefined, b: AppOnlyProfile): boolean {
  const fields = (p: AppOnlyProfile) => [p.tenantId, p.clientId, p.authMethod ?? "certificate", p.certificatePath, p.privateKeyPath, p.secretRef, p.capabilities];
  return Boolean(a && JSON.stringify(fields(a)) === JSON.stringify(fields(b)));
}

export function validateAppOnlyProfile(profile: AppOnlyProfile): void {
  const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!guid.test(profile.tenantId) || !guid.test(profile.clientId)) throw new Error("Tenant ID and Client ID must be GUIDs from your own app registration.");
  if (!profile.capabilities.length || profile.capabilities.some((key) => !Object.hasOwn(APPLICATION_CAPABILITIES, key))) throw new Error("Select at least one known capability. No permissions are selected by default.");
  if (new Set(profile.capabilities).size !== profile.capabilities.length) throw new Error("Duplicate capability selection.");
}

export function expectedApplicationRoles(profile: AppOnlyProfile): string[] {
  validateAppOnlyProfile(profile);
  return profile.capabilities.map((key) => APPLICATION_CAPABILITIES[key as ApplicationCapability].permission);
}

// The response came directly from MSAL over the configured Microsoft authority.
// This is a fail-closed identity/role check, not an independent JWT verifier.
export function inspectApplicationToken(accessToken: string, profile: AppOnlyProfile, now = Date.now()): string[] {
  let claims: Record<string, unknown>;
  try {
    const parts = accessToken.split(".");
    if (parts.length !== 3) throw new Error();
    claims = JSON.parse(Buffer.from(parts[1] as string, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch { throw new Error("Cannot inspect the application token. Connection remains inactive."); }
  if (!claims || claims.tid !== profile.tenantId || (claims.appid ?? claims.azp) !== profile.clientId || claims.scp !== undefined) throw new Error("Application token identity does not match this profile.");
  if (!["00000003-0000-0000-c000-000000000000", "https://graph.microsoft.com", "https://graph.microsoft.com/"].includes(String(claims.aud))) throw new Error("Application token has an unexpected audience.");
  if (typeof claims.exp !== "number" || claims.exp * 1000 <= now + 30_000) throw new Error("Application token is expired or too close to expiry.");
  if (!Array.isArray(claims.roles) || !claims.roles.every((role) => typeof role === "string")) throw new Error("No inspectable application roles. Grant only the selected application permissions in Entra.");
  const roles = claims.roles as string[];
  const expected = expectedApplicationRoles(profile);
  const missing = expected.filter((role) => !roles.includes(role));
  const excess = roles.filter((role) => !expected.includes(role));
  if (missing.length || excess.length) throw new Error(`Connection inactive. Missing application roles: ${missing.join(", ") || "none"}. Excess application roles: ${excess.join(", ") || "none"}. Update consent in Entra; Greybeard cannot narrow existing token grants.`);
  return roles;
}

async function readCredentialFile(path: string, privateKey: boolean): Promise<string> {
  if (privateKey && process.platform === "win32") return readWindowsProtectedKey(path);
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > 64 * 1024) throw new Error("Certificate credentials must be regular files no larger than 64 KiB.");
    if (privateKey) {
      if ((info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()) throw new Error("Private key must be owned by this user and accessible only to this user (mode 0600 or 0400).");
    }
    return await handle.readFile("utf8");
  } finally { await handle.close(); }
}

export class AppOnlyGraphAuthProvider implements GraphAuthProvider {
  private constructor(private readonly profile: AppOnlyProfile, private readonly app: Pick<ConfidentialClientApplication, "acquireTokenByClientCredential">, private readonly appDataPath?: string, private readonly certificateExpiresAt = Number.POSITIVE_INFINITY) {}

  static async create(profile: AppOnlyProfile, appDataPath?: string, suppliedSecret?: string): Promise<AppOnlyGraphAuthProvider> {
    validateAppOnlyProfile(profile);
    if (profile.authMethod === "client-secret") {
      if (!/^[a-f0-9]{64}$/.test(profile.secretRef)) throw new Error("Invalid local credential reference.");
      const clientSecret = suppliedSecret ?? (appDataPath ? await loadClientSecret(appDataPath, profile.secretRef) : undefined);
      if (!clientSecret) throw new Error("Client secret is unavailable. Reconnect using the companion.");
      validateClientSecret(clientSecret);
      const app = new ConfidentialClientApplication({ auth: { clientId: profile.clientId,
        authority: `https://login.microsoftonline.com/${profile.tenantId}`, clientSecret },
        system: { loggerOptions: { piiLoggingEnabled: false, loggerCallback: () => {} } } });
      return new AppOnlyGraphAuthProvider(structuredClone(profile), app, appDataPath);
    }
    const certificate = new X509Certificate(await readCredentialFile(profile.certificatePath, false));
    const privateKey = await readCredentialFile(profile.privateKeyPath, true);
    const now = Date.now();
    if (Date.parse(certificate.validFrom) > now || Date.parse(certificate.validTo) <= now) throw new Error("Certificate is not yet valid or has expired. Replace it with a valid customer-provisioned certificate.");
    if (!certificate.checkPrivateKey(createPrivateKey(privateKey))) throw new Error("The private key does not match the selected public certificate.");
    const app = new ConfidentialClientApplication({ auth: {
      clientId: profile.clientId,
      authority: `https://login.microsoftonline.com/${profile.tenantId}`,
      clientCertificate: { thumbprintSha256: certificate.fingerprint256.replaceAll(":", ""), privateKey }
    }, system: { loggerOptions: { piiLoggingEnabled: false, loggerCallback: () => {} } } });
    return new AppOnlyGraphAuthProvider(structuredClone(profile), app, appDataPath, Date.parse(certificate.validTo));
  }

  async getToken(_scopes: string[]): Promise<AuthToken> {
    if (this.appDataPath) {
      const current = (await readGreybeardConfig(this.appDataPath)).appOnlyProfile;
      if (!sameProfile(current, this.profile)) throw new Error("Tenant connection changed or was removed. Reconnect the AI client before another tenant read.");
    }
    if (Date.now() >= this.certificateExpiresAt) throw new Error("Certificate has expired. Reconfigure the connection with a valid customer certificate.");
    const result = await this.app.acquireTokenByClientCredential({ scopes: ["https://graph.microsoft.com/.default"] }).catch(() => {
      throw new Error("Application authentication failed. Check the tenant ID, application ID, credential value and expiry in Entra, then reconnect. Existing configuration was not changed.");
    });
    if (this.appDataPath && !sameProfile((await readGreybeardConfig(this.appDataPath)).appOnlyProfile, this.profile)) throw new Error("Tenant connection changed during authentication. Reconnect the AI client.");
    if (!result?.accessToken) throw new Error("Application authentication returned no access token.");
    const roles = inspectApplicationToken(result.accessToken, this.profile);
    return { accessToken: result.accessToken, account: `application:${this.profile.clientId}`, tenantId: this.profile.tenantId,
      tenantDomain: this.profile.tenantId, activeTenantAlias: this.profile.tenantId, clientId: this.profile.clientId,
      clientIdKind: "workspace", credentialMode: "read-only", grantedScopes: roles, cacheProtection: "memory", writesConfigured: false };
  }

  authorizeRead(path: string): void {
    const allowed = this.profile.capabilities.some((capability) => {
      const root = APPLICATION_CAPABILITIES[capability as ApplicationCapability].path;
      if (path === root || new RegExp(`^${root}/[0-9a-f-]{36}$`, "i").test(path)) return true;
      if (capability === "compliance" && /^\/deviceManagement\/deviceCompliancePolicies\/[0-9a-f-]{36}\/(assignments|scheduledActionsForRule)$/i.test(path)) return true;
      return capability === "groups" && /^\/groups\/[0-9a-f-]{36}\/members$/i.test(path);
    });
    if (!allowed) throw new Error("This endpoint is outside the selected read capabilities. Configure a suitable capability locally; access is never escalated automatically.");
  }

  async getStatus(): Promise<AuthStatus> {
    const token = await this.getToken([]);
    const { accessToken: _secret, writesConfigured: _writes, ...safe } = token;
    return { ...safe, signedIn: true, entraP1: null, directoryRoles: null,
      directoryRolesStatus: { state: "unavailable", diagnostic: "App-only identity; user roles are not probed." }, gate: { pendingPlan: null, writesConfigured: false } };
  }

  async addScopes(_input: AddScopeInput): Promise<AddScopeResult> {
    throw new Error("Configure application permissions on your own registration in Entra. Greybeard 0.1 does not request or grant permissions.");
  }
}
