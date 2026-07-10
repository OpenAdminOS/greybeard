export const GRAPH_CLI_CLIENT_ID = "14d82eec-204b-4c2f-b7e8-296a70dab67e";

export const DEFAULT_TIER1_SCOPES = [
  "User.Read.All",
  "Group.Read.All",
  "Policy.Read.All",
  "Organization.Read.All",
  "AuditLog.Read.All",
  "Reports.Read.All"
] as const;

export const TIER2_SCOPES = [
  "Device.Read.All",
  "DeviceManagementConfiguration.Read.All",
  "DeviceManagementManagedDevices.Read.All",
  "DeviceManagementApps.Read.All",
  "DeviceManagementServiceConfig.Read.All",
  "Application.Read.All",
  "RoleManagement.Read.Directory",
  "IdentityRiskyUser.Read.All",
  "SecurityEvents.Read.All"
] as const;

export const DEFAULT_WRITE_SCOPES = [
  "User.ReadWrite.All",
  "Group.ReadWrite.All",
  "Policy.ReadWrite.ConditionalAccess"
] as const;

export type CredentialMode = "read-only" | "writes";
export type ClientIdKind = "first-party" | "workspace";
export type CacheProtection = "keychain" | "dpapi" | "libsecret" | "plaintext";

export type AuthToken = {
  accessToken: string;
  account: string;
  tenantId: string;
  tenantDomain: string;
  activeTenantAlias: string;
  clientId: string;
  clientIdKind: ClientIdKind;
  credentialMode: CredentialMode;
  grantedScopes: string[];
  cacheProtection: CacheProtection;
  writesConfigured: boolean;
};

export type AuthStatus =
  | {
      signedIn: true;
      account: string;
      tenantId: string;
      tenantDomain: string;
      activeTenantAlias: string;
      credentialMode: CredentialMode;
      clientId: string;
      clientIdKind: ClientIdKind;
      grantedScopes: string[];
      entraP1: boolean | null;
      directoryRoles: string[] | null;
      directoryRolesStatus: DirectoryRolesStatus;
      cacheProtection: CacheProtection;
      gate: {
        pendingPlan: string | null;
        writesConfigured: boolean;
      };
    }
  | {
      signedIn: false;
      instruction: "run greybeard setup";
      account: null;
      tenantId: null;
      tenantDomain: null;
      activeTenantAlias: string;
      credentialMode: CredentialMode;
      clientId: string;
      clientIdKind: ClientIdKind;
      grantedScopes: string[];
      entraP1: null;
      directoryRoles: null;
      directoryRolesStatus: DirectoryRolesStatus;
      cacheProtection: CacheProtection;
      gate: {
        pendingPlan: string | null;
        writesConfigured: boolean;
      };
    };

export type AddScopeInput = {
  scopes: string[];
  reason: string;
  leaseMinutes?: number;
};

export type AddScopeResult = {
  granted: boolean;
  alreadyGranted: string[];
  requestedScopes: string[];
  grantedScopes: string[];
  consentUrl?: string;
  justifications?: Record<string, string>;
  guidance?: string;
  leaseExpiresAt?: string;
};

export type RemoveScopeInput = {
  scopes: string[];
  reason: string;
  confirm: boolean;
};

export type RemoveScopeResult = {
  removedScopes: string[];
  notConfigured: string[];
  requiresTenantConsentRevocation: boolean;
  guidance: string;
};

export type DirectoryRolesStatus = {
  state: "available" | "unavailable" | "not-signed-in";
  diagnostic?: string;
};

export interface GraphAuthProvider {
  getToken(scopes: string[]): Promise<AuthToken>;
  getStatus(): Promise<AuthStatus>;
  addScopes(input: AddScopeInput): Promise<AddScopeResult>;
  removeScopes?(input: RemoveScopeInput): Promise<RemoveScopeResult>;
}

export type GraphToolInput = {
  method?: string;
  apiVersion?: "v1.0" | "beta";
  path: string;
  query?: Record<string, string | number | boolean | Array<string | number | boolean> | null | undefined>;
  headers?: Record<string, string>;
  body?: unknown;
  fetchAll?: boolean;
  maxItems?: number;
};

export type GraphMeta = {
  requests: number;
  pages: number;
  truncated: boolean;
  throttled: number;
  apiVersion: "v1.0" | "beta";
  usedBeta: boolean;
  notes: string[];
  warnings: string[];
  session: {
    requests: number;
    pages: number;
    throttled: number;
    warnings: string[];
  };
};

export type GraphToolResult = {
  data: unknown;
  meta: GraphMeta;
};

export type ResponseLike = {
  ok: boolean;
  status: number;
  statusText: string;
  headers: {
    get(name: string): string | null;
  };
  json(): Promise<unknown>;
  text(): Promise<string>;
};

export type FetchLike = (url: string, init: RequestInit) => Promise<ResponseLike>;
