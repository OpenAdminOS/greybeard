import { buildAdminConsentUrl } from "./consent.js";
import { AuthToken } from "./types.js";
import { GreybeardGraphError } from "./errors.js";

const endpointScopes: Array<{ test: RegExp; scope: string }> = [
  { test: /^\/users(?:\/|$)/i, scope: "User.Read.All" },
  { test: /^\/groups(?:\/|$)/i, scope: "Group.Read.All" },
  { test: /^\/identity\/conditionalAccess(?:\/|$)/i, scope: "Policy.Read.All" },
  { test: /^\/policies(?:\/|$)/i, scope: "Policy.Read.All" },
  { test: /^\/organization(?:\/|$)/i, scope: "Organization.Read.All" },
  { test: /^\/subscribedSkus(?:\/|$)/i, scope: "Organization.Read.All" },
  { test: /^\/auditLogs(?:\/|$)/i, scope: "AuditLog.Read.All" },
  { test: /^\/reports(?:\/|$)/i, scope: "Reports.Read.All" },
  { test: /^\/devices(?:\/|$)/i, scope: "Device.Read.All" },
  { test: /^\/deviceManagement\/managedDevices(?:\/|$)/i, scope: "DeviceManagementManagedDevices.Read.All" },
  { test: /^\/deviceManagement\/deviceConfigurations(?:\/|$)/i, scope: "DeviceManagementConfiguration.Read.All" },
  { test: /^\/deviceAppManagement\/mobileApps(?:\/|$)/i, scope: "DeviceManagementApps.Read.All" },
  { test: /^\/deviceManagement\/windowsAutopilotDeviceIdentities(?:\/|$)/i, scope: "DeviceManagementServiceConfig.Read.All" },
  { test: /^\/applications(?:\/|$)/i, scope: "Application.Read.All" },
  { test: /^\/servicePrincipals(?:\/|$)/i, scope: "Application.Read.All" },
  { test: /^\/roleManagement\/directory(?:\/|$)/i, scope: "RoleManagement.Read.Directory" },
  { test: /^\/identityProtection\/riskyUsers(?:\/|$)/i, scope: "IdentityRiskyUser.Read.All" },
  { test: /^\/security\/secureScores(?:\/|$)/i, scope: "SecurityEvents.Read.All" }
];

const p1Paths = [
  /signInActivity/i,
  /^\/reports\/authenticationMethods\/userRegistrationDetails(?:\/|$)/i,
  /^\/auditLogs\/signIns(?:\/|$)/i
];

const roleGatedPaths = [
  /^\/auditLogs\/signIns(?:\/|$)/i,
  /^\/reports(?:\/|$)/i
];

export function classifyGraphFailure(params: {
  status: number;
  path: string;
  query: URLSearchParams;
  graphError: GraphErrorBody;
  token: AuthToken;
  retryState?: Record<string, unknown>;
}): GreybeardGraphError {
  const messageText = graphErrorMessage(params.graphError);
  const codeText = graphErrorCode(params.graphError);
  const combined = `${codeText} ${messageText}`;
  // App-only 403s do not establish missing user roles, licensing or a particular grant.
  // Preserve Microsoft's exact diagnostic and never offer delegated consent escalation.
  if (params.token.account.startsWith("application:")) {
    return new GreybeardGraphError({
      code: "graph-request-failed", httpStatus: params.status,
      message: messageText || `Microsoft Graph returned HTTP ${params.status}.`,
      guidance: "Review the selected application capability and this diagnostic in your existing Entra workflow. No permissions were requested or changed. A 403 alone does not establish its cause.",
      details: { graphCode: codeText, graphMessage: messageText, path: params.path, retryState: params.retryState }
    });
  }
  const missingScope = scopeForRequest(params.path, params.query);
  const grantedScopes = new Set(params.token.grantedScopes.map((scope) => scope.toLowerCase()));
  const hasMappedScope = missingScope ? grantedScopes.has(missingScope.toLowerCase()) : false;

  if (params.status === 403 && isP1Failure(params.path, params.query, combined, hasMappedScope)) {
    return new GreybeardGraphError({
      code: "missing-Entra-P1-license",
      message: "Microsoft Graph rejected the request because the tenant needs Microsoft Entra ID P1.",
      guidance: "Do not ask for consent. Degrade this part of the answer and tell the admin the endpoint requires Microsoft Entra ID P1.",
      httpStatus: params.status,
      requiredLicense: "Microsoft Entra ID P1",
      details: {
        graphCode: codeText,
        graphMessage: messageText,
        path: params.path
      }
    });
  }

  if (params.status === 403 && isDirectoryRoleFailure(params.path, combined, hasMappedScope)) {
    return new GreybeardGraphError({
      code: "missing-directory-role",
      message: "Microsoft Graph rejected the request because the signed-in user lacks a required directory role.",
      guidance: "Do not ask for consent. Tell the admin to use Reports Reader, Security Reader, Global Reader, or a higher role.",
      httpStatus: params.status,
      requiredRoles: ["Reports Reader", "Security Reader", "Global Reader"],
      details: {
        graphCode: codeText,
        graphMessage: messageText,
        path: params.path
      }
    });
  }

  if (params.status === 403 && missingScope && !hasMappedScope) {
    return new GreybeardGraphError({
      code: "missing-scope",
      message: `Microsoft Graph rejected the request because ${missingScope} is not granted.`,
      guidance: "Ask the admin to grant the missing delegated scope. This is a consent problem, not a license or role problem.",
      httpStatus: params.status,
      missingScope,
      consentUrl: buildAdminConsentUrl({
        tenantId: params.token.tenantId,
        clientId: params.token.clientId,
        scopes: [missingScope],
        ...(params.token.clientIdKind === "workspace" ? { redirectUri: "http://localhost" } : {})
      }),
      details: {
        graphCode: codeText,
        graphMessage: messageText,
        path: params.path
      }
    });
  }

  return new GreybeardGraphError({
    code: "graph-request-failed",
    message: messageText || `Microsoft Graph returned HTTP ${params.status}.`,
    guidance: "Report the Graph error to the admin and avoid retrying unless the error explicitly says it is transient.",
    httpStatus: params.status,
    details: {
      graphCode: codeText,
      graphMessage: messageText,
      path: params.path,
      retryState: params.retryState
    }
  });
}

export type GraphErrorBody = {
  error?: {
    code?: string;
    message?: string;
    innerError?: Record<string, unknown>;
  };
  code?: string;
  message?: string;
};

function graphErrorCode(body: GraphErrorBody): string {
  return body.error?.code ?? body.code ?? "";
}

function graphErrorMessage(body: GraphErrorBody): string {
  return body.error?.message ?? body.message ?? "";
}

function scopeForRequest(path: string, query: URLSearchParams): string | undefined {
  const selectedFields = query.get("$select") ?? "";
  if (/signInActivity/i.test(selectedFields)) {
    return "AuditLog.Read.All";
  }

  return endpointScopes.find((entry) => entry.test.test(path))?.scope;
}

function isP1Failure(path: string, query: URLSearchParams, combined: string, hasMappedScope: boolean): boolean {
  const selectedFields = query.get("$select") ?? "";
  if (/premium|p1|license|licensed|aadpremium|nonpremium/i.test(combined)) {
    return true;
  }

  return hasMappedScope && p1Paths.some((pattern) => pattern.test(path) || pattern.test(selectedFields));
}

function isDirectoryRoleFailure(path: string, combined: string, hasMappedScope: boolean): boolean {
  if (/directory role|reports reader|security reader|global reader|role required|not in role/i.test(combined)) {
    return true;
  }

  return hasMappedScope && roleGatedPaths.some((pattern) => pattern.test(path));
}
