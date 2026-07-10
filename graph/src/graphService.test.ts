import { describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GreybeardGraphError } from "./errors.js";
import { GraphService } from "./graphService.js";
import { readGreybeardConfig, writeGreybeardConfig } from "./config.js";
import {
  AuthStatus,
  AuthToken,
  FetchLike,
  GraphAuthProvider,
  ResponseLike
} from "./types.js";

const token: AuthToken = {
  accessToken: "token",
  account: "admin@contoso.com",
  tenantId: "tenant-id",
  tenantDomain: "contoso.com",
  activeTenantAlias: "contoso",
  clientId: "14d82eec-204b-4c2f-b7e8-296a70dab67e",
  clientIdKind: "first-party",
  credentialMode: "read-only",
  grantedScopes: [
    "User.Read.All",
    "Group.Read.All",
    "Policy.Read.All",
    "Organization.Read.All",
    "AuditLog.Read.All",
    "Reports.Read.All"
  ],
  cacheProtection: "keychain",
  writesConfigured: false
};

const signedInStatus: AuthStatus = {
  signedIn: true,
  account: token.account,
  tenantId: token.tenantId,
  tenantDomain: token.tenantDomain,
  activeTenantAlias: token.activeTenantAlias,
  credentialMode: "read-only",
  clientId: token.clientId,
  clientIdKind: "first-party",
  grantedScopes: token.grantedScopes,
  entraP1: true,
  directoryRoles: ["Global Reader"],
  directoryRolesStatus: { state: "available" },
  cacheProtection: "keychain",
  gate: {
    pendingPlan: null,
    writesConfigured: false
  }
};

class MockAuth implements GraphAuthProvider {
  constructor(private readonly authToken: AuthToken = token) {}

  async getToken(_scopes: string[]): Promise<AuthToken> {
    return this.authToken;
  }

  async getStatus(): Promise<AuthStatus> {
    return signedInStatus;
  }

  async addScopes(input: { scopes: string[]; reason: string }) {
    return {
      granted: true,
      alreadyGranted: [],
      requestedScopes: input.scopes,
      grantedScopes: [...this.authToken.grantedScopes, ...input.scopes]
    };
  }
}

class CapturingAuth extends MockAuth {
  readonly requestedScopes: string[][] = [];

  override async getToken(scopes: string[]): Promise<AuthToken> {
    this.requestedScopes.push([...scopes]);
    return super.getToken(scopes);
  }
}

describe("GraphService", () => {
  it("requests active scope leases and expires stale leases before a read", async () => {
    const appDataPath = await mkdtemp(join(tmpdir(), "greybeard-scope-read-"));
    await writeGreybeardConfig(appDataPath, {
      scopeLeases: [
        {
          scope: "Device.Read.All",
          reason: "active inventory",
          requestedAt: "2026-07-10T10:00:00.000Z",
          expiresAt: "2099-01-01T00:00:00.000Z"
        },
        {
          scope: "Application.Read.All",
          reason: "old inventory",
          requestedAt: "2026-07-09T10:00:00.000Z",
          expiresAt: "2000-01-01T00:00:00.000Z"
        }
      ]
    });
    const auth = new CapturingAuth();
    const fetcher = vi.fn<FetchLike>().mockResolvedValue(jsonResponse({ value: [] }));
    const service = new GraphService({ auth, fetcher, appDataPath });

    await service.graph({ path: "/devices", query: { "$select": "id" } });

    expect(auth.requestedScopes[0]).toContain("Device.Read.All");
    expect(auth.requestedScopes[0]).not.toContain("Application.Read.All");
    expect((await readGreybeardConfig(appDataPath)).scopeLeases?.map((lease) => lease.scope)).toEqual(["Device.Read.All"]);
    const auditFile = (await readdir(join(appDataPath, "audit")))[0] as string;
    expect(await readFile(join(appDataPath, "audit", auditFile), "utf8")).toContain('"event":"expired"');
  });

  it("performs a select-scoped read", async () => {
    const fetcher = vi.fn<FetchLike>().mockResolvedValue(jsonResponse({ value: [{ id: "1" }] }));
    const service = new GraphService({ auth: new MockAuth(), fetcher });

    const result = await service.graph({
      path: "/users",
      query: {
        "$select": "id,displayName,accountEnabled",
        "$filter": "accountEnabled eq false"
      }
    });

    expect(result.data).toEqual({ value: [{ id: "1" }] });
    expect(result.meta).toMatchObject({
      requests: 1,
      pages: 1,
      truncated: false,
      apiVersion: "beta",
      usedBeta: true,
      notes: [],
      warnings: []
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://graph.microsoft.com/beta/users?%24select=id%2CdisplayName%2CaccountEnabled&%24filter=accountEnabled+eq+false",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer token"
        })
      })
    );
  });

  it("paginates fetchAll and flags truncation at maxItems", async () => {
    const fetcher = vi.fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse({
        value: [{ id: "1" }, { id: "2" }],
        "@odata.nextLink": "https://graph.microsoft.com/beta/users?$skiptoken=two"
      }))
      .mockResolvedValueOnce(jsonResponse({
        value: [{ id: "3" }, { id: "4" }],
        "@odata.nextLink": "https://graph.microsoft.com/beta/users?$skiptoken=three"
      }));
    const service = new GraphService({ auth: new MockAuth(), fetcher });

    const result = await service.graph({
      path: "/users",
      query: {
        "$select": "id",
        "$filter": "accountEnabled eq true"
      },
      fetchAll: true,
      maxItems: 3
    });

    expect(result.data).toEqual({
      value: [{ id: "1" }, { id: "2" }, { id: "3" }]
    });
    expect(result.meta).toMatchObject({
      requests: 2,
      pages: 2,
      truncated: true
    });
  });

  it("flags truncation when one page exceeds maxItems without a next link", async () => {
    const fetcher = vi.fn<FetchLike>().mockResolvedValue(jsonResponse({
      value: Array.from({ length: 10 }, (_value, index) => ({ id: String(index + 1) }))
    }));
    const service = new GraphService({ auth: new MockAuth(), fetcher });

    const result = await service.graph({
      path: "/users",
      query: {
        "$select": "id",
        "$filter": "accountEnabled eq true"
      },
      fetchAll: true,
      maxItems: 5
    });

    expect(result.data).toEqual({
      value: [
        { id: "1" },
        { id: "2" },
        { id: "3" },
        { id: "4" },
        { id: "5" }
      ]
    });
    expect(result.meta).toMatchObject({
      requests: 1,
      pages: 1,
      truncated: true
    });
  });

  it("honors Retry-After for 429 and retries", async () => {
    const sleep = vi.fn(async (_ms: number) => undefined);
    const fetcher = vi.fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse({
        error: {
          code: "TooManyRequests",
          message: "slow down"
        }
      }, 429, { "Retry-After": "2" }))
      .mockResolvedValueOnce(jsonResponse({ value: [] }));
    const service = new GraphService({ auth: new MockAuth(), fetcher, sleep });

    const result = await service.graph({
      path: "/users",
      query: {
        "$select": "id"
      }
    });

    expect(result.meta).toMatchObject({
      requests: 2,
      pages: 1,
      throttled: 1
    });
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it("passes through an all-GET batch", async () => {
    const fetcher = vi.fn<FetchLike>().mockResolvedValue(jsonResponse({
      responses: [
        {
          id: "1",
          status: 200,
          body: {
            value: []
          }
        }
      ]
    }));
    const service = new GraphService({ auth: new MockAuth(), fetcher });

    const result = await service.graph({
      method: "POST",
      path: "/$batch",
      body: {
        requests: [
          {
            id: "1",
            method: "GET",
            url: "/users?$select=id"
          }
        ]
      }
    });

    expect(result.data).toEqual({
      responses: [
        {
          id: "1",
          status: 200,
          body: {
            value: []
          }
        }
      ]
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://graph.microsoft.com/beta/$batch",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          requests: [
            {
              id: "1",
              method: "GET",
              url: "/users?$select=id"
            }
          ]
        })
      })
    );
  });

  it("rejects batch inner writes", async () => {
    const service = new GraphService({
      auth: new MockAuth(),
      fetcher: vi.fn<FetchLike>()
    });

    await expect(service.graph({
      method: "POST",
      path: "/$batch",
      body: {
        requests: [
          {
            id: "safe",
            method: "GET",
            url: "/users"
          },
          {
            id: "write",
            method: "PATCH",
            url: "/users/1",
            body: {
              accountEnabled: false
            }
          }
        ]
      }
    })).rejects.toMatchObject({
      payload: {
        code: "E_WRITE_BLOCKED",
        details: {
          offendingRequestIds: ["write"]
        }
      }
    });
  });

  it("rejects non-GET direct writes", async () => {
    const service = new GraphService({
      auth: new MockAuth(),
      fetcher: vi.fn<FetchLike>()
    });

    await expect(service.graph({
      method: "PATCH",
      path: "/users/1",
      body: {
        accountEnabled: false
      }
    })).rejects.toMatchObject({
      payload: {
        code: "E_WRITE_BLOCKED"
      }
    });
  });

  it("classifies a missing scope with admin-consent URL", async () => {
    const fetcher = vi.fn<FetchLike>().mockResolvedValue(jsonResponse({
      error: {
        code: "Authorization_RequestDenied",
        message: "Insufficient privileges to complete the operation."
      }
    }, 403));
    const service = new GraphService({ auth: new MockAuth(), fetcher });

    await expectGraphError(service.graph({
      path: "/devices",
      query: {
        "$select": "id"
      }
    }), (payload) => {
      expect(payload).toMatchObject({
        code: "missing-scope",
        missingScope: "Device.Read.All"
      });
      expect(payload.consentUrl).toContain("/tenant-id/");
      expect(payload.consentUrl).toContain("Device.Read.All");
    });
  });

  it("classifies audit log sign-ins as missing scope when AuditLog.Read.All is not granted", async () => {
    const fetcher = vi.fn<FetchLike>().mockResolvedValue(jsonResponse({
      error: {
        code: "Authorization_RequestDenied",
        message: "Insufficient privileges to complete the operation."
      }
    }, 403));
    const service = new GraphService({
      auth: new MockAuth(withoutScope(token, "AuditLog.Read.All")),
      fetcher
    });

    await expectGraphError(service.graph({
      path: "/auditLogs/signIns"
    }), (payload) => {
      expect(payload).toMatchObject({
        code: "missing-scope",
        missingScope: "AuditLog.Read.All"
      });
      expect(payload.consentUrl).toContain("/tenant-id/");
      expect(payload.consentUrl).toContain("AuditLog.Read.All");
    });
  });

  it("classifies audit log sign-ins as missing Entra P1 when AuditLog.Read.All is granted", async () => {
    const fetcher = vi.fn<FetchLike>().mockResolvedValue(jsonResponse({
      error: {
        code: "Authorization_RequestDenied",
        message: "Insufficient privileges to complete the operation."
      }
    }, 403));
    const service = new GraphService({ auth: new MockAuth(), fetcher });

    await expectGraphError(service.graph({
      path: "/auditLogs/signIns"
    }), (payload) => {
      expect(payload).toMatchObject({
        code: "missing-Entra-P1-license",
        requiredLicense: "Microsoft Entra ID P1"
      });
      expect(payload.consentUrl).toBeUndefined();
    });
  });

  it("classifies a missing Entra P1 license", async () => {
    const fetcher = vi.fn<FetchLike>().mockResolvedValue(jsonResponse({
      error: {
        code: "Authentication_RequestFromNonPremiumTenantOrB2CTenant",
        message: "The tenant does not have the required premium license."
      }
    }, 403));
    const service = new GraphService({ auth: new MockAuth(), fetcher });

    await expectGraphError(service.graph({
      path: "/users",
      query: {
        "$select": "id,signInActivity"
      }
    }), (payload) => {
      expect(payload).toMatchObject({
        code: "missing-Entra-P1-license",
        requiredLicense: "Microsoft Entra ID P1"
      });
      expect(payload.consentUrl).toBeUndefined();
    });
  });

  it("classifies a missing directory role", async () => {
    const fetcher = vi.fn<FetchLike>().mockResolvedValue(jsonResponse({
      error: {
        code: "Authorization_RequestDenied",
        message: "The signed-in user is not in a required Reports Reader directory role."
      }
    }, 403));
    const service = new GraphService({ auth: new MockAuth(), fetcher });

    await expectGraphError(service.graph({
      path: "/reports/getEmailActivityUserDetail(period='D7')"
    }), (payload) => {
      expect(payload).toMatchObject({
        code: "missing-directory-role",
        requiredRoles: ["Reports Reader", "Security Reader", "Global Reader"]
      });
      expect(payload.consentUrl).toBeUndefined();
    });
  });

  it("reports metadata warnings and accumulates them in session metadata", async () => {
    const fetcher = vi.fn<FetchLike>().mockResolvedValue(jsonResponse({ value: [] }));
    const service = new GraphService({ auth: new MockAuth(), fetcher });

    const result = await service.graph({
      apiVersion: "v1.0",
      path: "/users",
      fetchAll: true
    });

    expect(result.meta.apiVersion).toBe("v1.0");
    expect(result.meta.usedBeta).toBe(false);
    expect(result.meta.notes).toEqual([
      "v1.0 used explicitly; Greybeard defaults to beta"
    ]);
    expect(result.meta.warnings).toEqual([
      "no $select on collection read: consider selecting only needed fields",
      "fetchAll without $filter: consider narrowing the collection before paging"
    ]);
    expect(service.getSessionMetadata()).toMatchObject({
      requests: 1,
      pages: 1,
      throttled: 0,
      warnings: result.meta.warnings
    });
  });
});

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): ResponseLike {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: statusText(status),
    headers: {
      get(name: string) {
        const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
        return key ? headers[key] ?? null : null;
      }
    },
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    }
  };
}

async function expectGraphError(
  promise: Promise<unknown>,
  assertion: (payload: GreybeardGraphError["payload"]) => void
): Promise<void> {
  try {
    await promise;
    throw new Error("Expected graph call to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(GreybeardGraphError);
    assertion((error as GreybeardGraphError).payload);
  }
}

function statusText(status: number): string {
  if (status === 200) {
    return "OK";
  }

  if (status === 403) {
    return "Forbidden";
  }

  if (status === 429) {
    return "Too Many Requests";
  }

  return String(status);
}

function withoutScope(authToken: AuthToken, scope: string): AuthToken {
  return {
    ...authToken,
    grantedScopes: authToken.grantedScopes.filter((grantedScope) => grantedScope !== scope)
  };
}
