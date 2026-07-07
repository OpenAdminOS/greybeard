import { GRAPH_CLI_CLIENT_ID } from "./types.js";

export function normalizeGraphScope(scope: string): string {
  if (scope.includes("://")) {
    return scope;
  }

  return `https://graph.microsoft.com/${scope}`;
}

export function buildAdminConsentUrl(params: {
  tenantId: string;
  clientId?: string;
  scopes: string[];
}): string {
  const clientId = params.clientId ?? GRAPH_CLI_CLIENT_ID;
  const scope = params.scopes.map(normalizeGraphScope).join(" ");
  const url = new URL(`https://login.microsoftonline.com/${encodeURIComponent(params.tenantId)}/v2.0/adminconsent`);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("scope", scope);
  return url.toString();
}

export function scopeJustification(scope: string): string {
  const known: Record<string, string> = {
    "User.Read.All": "Read users for identity and account hygiene reports.",
    "Group.Read.All": "Read groups and memberships for tenant analysis.",
    "Policy.Read.All": "Read Conditional Access and policy configuration.",
    "Organization.Read.All": "Read tenant and license information.",
    "AuditLog.Read.All": "Read audit and sign-in activity for security posture.",
    "Reports.Read.All": "Read reporting endpoints for MFA and usage posture.",
    "Device.Read.All": "Read devices for device inventory and stale device reports.",
    "DeviceManagementConfiguration.Read.All": "Read Intune configuration profiles.",
    "DeviceManagementManagedDevices.Read.All": "Read Intune managed device state.",
    "DeviceManagementApps.Read.All": "Read Intune application configuration.",
    "DeviceManagementServiceConfig.Read.All": "Read Intune service configuration and Autopilot data.",
    "Application.Read.All": "Read app registrations and service principals.",
    "Application.ReadWrite.All": "Create the Greybeard workspace app registration and service principal during setup. This broadly manages app registrations and should be revoked from the first-party app after bootstrap if not needed.",
    "RoleManagement.Read.Directory": "Read directory roles and role assignments.",
    "IdentityRiskyUser.Read.All": "Read Identity Protection risky users.",
    "SecurityEvents.Read.All": "Read secure score and security event data.",
    "User.ReadWrite.All": "Apply approved user lifecycle changes.",
    "Group.ReadWrite.All": "Apply approved group and membership changes.",
    "Policy.ReadWrite.ConditionalAccess": "Apply approved Conditional Access policy changes.",
    "DeviceManagementConfiguration.ReadWrite.All": "Apply approved Intune configuration changes.",
    "DeviceManagementManagedDevices.ReadWrite.All": "Apply approved managed device changes.",
    "DeviceManagementApps.ReadWrite.All": "Apply approved Intune app changes."
  };

  return known[scope] ?? `Grant ${scope} for the requested Microsoft Graph access.`;
}

export function isWriteScope(scope: string): boolean {
  const lower = scope.toLowerCase();
  return lower.includes("readwrite") || lower.includes(".write.") || lower.endsWith(".write") || lower.endsWith(".write.all");
}

export function isAdminConsentError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return /admin consent|AADSTS65001|AADSTS90094|consent_required/i.test(text);
}
