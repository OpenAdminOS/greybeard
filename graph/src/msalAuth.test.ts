import { mkdir, mkdtemp, readFile, readdir, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FetchLike, GRAPH_CLI_CLIENT_ID, ResponseLike } from "./types.js";
import { readGreybeardConfig } from "./config.js";

const fakeMsalApp = {
  getAllAccounts: vi.fn(),
  acquireTokenSilent: vi.fn(),
  acquireTokenInteractive: vi.fn()
};

const createPersistence = vi.fn();
const persistenceRecords: MockPersistence[] = [];
const persistenceContents = new Map<string, string | null>();

type MockPersistence = {
  config: Record<string, unknown>;
  load: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
};

vi.mock("@azure/msal-node", () => {
  return {
    PublicClientApplication: vi.fn(function PublicClientApplication() {
      return fakeMsalApp;
    })
  };
});

vi.mock("@azure/msal-node-extensions", () => {
  return {
    DataProtectionScope: {
      CurrentUser: "CurrentUser"
    },
    PersistenceCachePlugin: vi.fn(function PersistenceCachePlugin(this: { persistence: unknown }, persistence: unknown) {
      this.persistence = persistence;
    }),
    PersistenceCreator: {
      createPersistence
    }
  };
});

describe("MsalGraphAuthProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    persistenceRecords.length = 0;
    persistenceContents.clear();
    createPersistence.mockImplementation(async (config: Record<string, unknown>) => {
      const cachePath = String(config.cachePath);
      const record: MockPersistence = {
        config,
        load: vi.fn(async () => persistenceContents.get(cachePath) ?? null),
        save: vi.fn(async (contents: string) => {
          persistenceContents.set(cachePath, contents);
        })
      };
      persistenceRecords.push(record);
      return record;
    });
    fakeMsalApp.getAllAccounts.mockResolvedValue([
      {
        tenantId: "tenant-id",
        username: "admin@contoso.com"
      }
    ]);
    fakeMsalApp.acquireTokenSilent.mockResolvedValue({
      accessToken: "token",
      tenantId: "tenant-id",
      account: {
        tenantId: "tenant-id",
        username: "admin@contoso.com"
      },
      scopes: ["User.Read.All", "Reports.Read.All"]
    });
    fakeMsalApp.acquireTokenInteractive.mockResolvedValue({
      accessToken: "token",
      tenantId: "tenant-id",
      account: {
        tenantId: "tenant-id",
        username: "admin@contoso.com"
      },
      scopes: ["Device.Read.All"]
    });
  });

  it("returns auth status with mocked MSAL and mocked Graph probes", async () => {
    const { MsalGraphAuthProvider } = await import("./msalAuth.js");
    const appDataPath = await tempAppData();
    const fetcher = vi.fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse({
        value: [
          {
            skuPartNumber: "AAD_PREMIUM",
            servicePlans: []
          }
        ]
      }))
      .mockResolvedValueOnce(jsonResponse({
        value: [
          {
            displayName: "Global Reader"
          }
        ]
      }));

    const provider = await MsalGraphAuthProvider.create({
      tenantId: "tenant-id",
      appDataPath,
      fetcher
    });

    const status = await provider.getStatus();

    expect(status).toMatchObject({
      signedIn: true,
      account: "admin@contoso.com",
      tenantId: "tenant-id",
      tenantDomain: "contoso.com",
      activeTenantAlias: "contoso",
      credentialMode: "read-only",
      clientId: "14d82eec-204b-4c2f-b7e8-296a70dab67e",
      clientIdKind: "first-party",
      grantedScopes: ["User.Read.All", "Reports.Read.All"],
      entraP1: true,
      directoryRoles: ["Global Reader"],
      directoryRolesStatus: { state: "available" },
      gate: {
        pendingPlan: null,
        writesConfigured: false
      }
    });
    expect(["keychain", "dpapi", "libsecret"]).toContain(status.cacheProtection);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("uses one app cache so an alias sign-in is visible to a tenant-specific provider", async () => {
    const { MsalGraphAuthProvider } = await import("./msalAuth.js");
    const appDataPath = await tempAppData();
    const aliasProvider = await MsalGraphAuthProvider.create({
      tenantId: "organizations",
      appDataPath
    });

    await aliasProvider.getToken(["User.Read.All"]);

    const fetcher = vi.fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse({
        value: []
      }))
      .mockResolvedValueOnce(jsonResponse({
        value: []
      }));
    const tenantProvider = await MsalGraphAuthProvider.create({
      tenantId: "tenant-id",
      appDataPath,
      fetcher
    });

    const status = await tenantProvider.getStatus();

    expect(status.signedIn).toBe(true);
    const expectedCachePath = join(appDataPath, "auth", GRAPH_CLI_CLIENT_ID, "msal-cache.json");
    expect(new Set(persistenceRecords.map((record) => record.config.cachePath))).toEqual(new Set([expectedCachePath]));
    expect(persistenceRecords.every((record) => record.config.accountName === GRAPH_CLI_CLIENT_ID)).toBe(true);
  });

  it("tries legacy caches by mtime until one with accounts can be migrated", async () => {
    const { MsalGraphAuthProvider } = await import("./msalAuth.js");
    const appDataPath = await tempAppData();
    const newerEmptyLegacyPath = join(appDataPath, "auth", "tenant-id", GRAPH_CLI_CLIENT_ID, "msal-cache.json");
    const olderAccountLegacyPath = join(appDataPath, "auth", "organizations", GRAPH_CLI_CLIENT_ID, "msal-cache.json");
    const unifiedPath = join(appDataPath, "auth", GRAPH_CLI_CLIENT_ID, "msal-cache.json");
    await mkdir(join(appDataPath, "auth", "tenant-id", GRAPH_CLI_CLIENT_ID), { recursive: true });
    await mkdir(join(appDataPath, "auth", "organizations", GRAPH_CLI_CLIENT_ID), { recursive: true });
    await writeFile(newerEmptyLegacyPath, "", "utf8");
    await writeFile(olderAccountLegacyPath, "keychain-companion", "utf8");
    await utimes(olderAccountLegacyPath, new Date("2026-07-04T17:31:00Z"), new Date("2026-07-04T17:31:00Z"));
    await utimes(newerEmptyLegacyPath, new Date("2026-07-04T17:32:00Z"), new Date("2026-07-04T17:32:00Z"));
    const legacyContent = JSON.stringify({
      Account: {
        organizations: {
          tenantId: "tenant-id"
        }
      }
    });
    persistenceContents.set(newerEmptyLegacyPath, JSON.stringify({
      Account: {}
    }));
    persistenceContents.set(olderAccountLegacyPath, legacyContent);
    const stderr = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await MsalGraphAuthProvider.create({
      tenantId: "tenant-id",
      appDataPath
    });

    const unifiedPersistence = persistenceRecords.find((record) => record.config.cachePath === unifiedPath);
    expect(unifiedPersistence?.save).toHaveBeenCalledWith(legacyContent);
    const legacyRecordPaths = persistenceRecords.map((record) => record.config.cachePath);
    expect(legacyRecordPaths).toContain(newerEmptyLegacyPath);
    expect(legacyRecordPaths).toContain(olderAccountLegacyPath);
    expect(legacyRecordPaths.indexOf(newerEmptyLegacyPath)).toBeLessThan(legacyRecordPaths.indexOf(olderAccountLegacyPath));
    expect(stderr).toHaveBeenCalledWith("migrated legacy token cache");
    stderr.mockRestore();
  });

  it("reports null entraP1 when the license probe cannot determine status", async () => {
    const { MsalGraphAuthProvider } = await import("./msalAuth.js");
    const fetcher = vi.fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse({
        error: {
          code: "Authorization_RequestDenied",
          message: "Insufficient privileges to complete the operation."
        }
      }, 403))
      .mockResolvedValueOnce(jsonResponse({
        value: []
      }));

    const provider = await MsalGraphAuthProvider.create({
      tenantId: "tenant-id",
      appDataPath: await tempAppData(),
      fetcher
    });

    const status = await provider.getStatus();

    expect(status).toMatchObject({
      signedIn: true,
      entraP1: null,
      directoryRoles: [],
      directoryRolesStatus: { state: "available" }
    });
  });

  it("reports directory roles as unknown with diagnostics when the probe fails", async () => {
    const { MsalGraphAuthProvider } = await import("./msalAuth.js");
    const fetcher = vi.fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse({ value: [] }))
      .mockResolvedValueOnce(jsonResponse({
        error: { code: "Authorization_RequestDenied", message: "role probe denied" }
      }, 403));
    const provider = await MsalGraphAuthProvider.create({
      tenantId: "tenant-id",
      appDataPath: await tempAppData(),
      fetcher
    });

    const status = await provider.getStatus();

    expect(status).toMatchObject({
      signedIn: true,
      directoryRoles: null,
      directoryRolesStatus: {
        state: "unavailable",
        diagnostic: "Graph status probe failed with HTTP 403."
      }
    });
  });


  it("refuses write scopes in read-only mode", async () => {
    const { MsalGraphAuthProvider } = await import("./msalAuth.js");
    const provider = await MsalGraphAuthProvider.create({
      tenantId: "tenant-id",
      appDataPath: await tempAppData()
    });

    await expect(provider.addScopes({
      scopes: ["Group.ReadWrite.All"],
      reason: "write test"
    })).rejects.toMatchObject({
      payload: {
        code: "E_WRITES_NOT_CONFIGURED"
      }
    });
  });

  it("returns an admin-consent handoff URL when incremental consent needs an admin", async () => {
    fakeMsalApp.acquireTokenInteractive.mockRejectedValueOnce(new Error("AADSTS65001 admin consent required"));
    const { MsalGraphAuthProvider } = await import("./msalAuth.js");
    const provider = await MsalGraphAuthProvider.create({
      tenantId: "tenant-id",
      appDataPath: await tempAppData()
    });

    const result = await provider.addScopes({
      scopes: ["Device.Read.All"],
      reason: "device report"
    });

    expect(result).toMatchObject({
      granted: false,
      requestedScopes: ["Device.Read.All"],
      grantedScopes: ["User.Read.All", "Reports.Read.All"],
      justifications: {
        "Device.Read.All": "Read devices for device inventory and stale device reports."
      }
    });
    expect(result.consentUrl).toContain("/tenant-id/");
    expect(result.consentUrl).toContain("Device.Read.All");
  });

  it("audits temporary scope leases and supports guarded release", async () => {
    const { MsalGraphAuthProvider } = await import("./msalAuth.js");
    const appDataPath = await tempAppData();
    const provider = await MsalGraphAuthProvider.create({ tenantId: "tenant-id", appDataPath });

    const added = await provider.addScopes({
      scopes: ["Device.Read.All"],
      reason: "temporary device inventory",
      leaseMinutes: 15
    });
    expect(added).toMatchObject({ granted: true, requestedScopes: ["Device.Read.All"] });
    expect(added.leaseExpiresAt).toBeDefined();
    expect((await readGreybeardConfig(appDataPath)).scopeLeases).toMatchObject([{
      scope: "Device.Read.All",
      reason: "temporary device inventory"
    }]);

    const removed = await provider.removeScopes({
      scopes: ["Device.Read.All"],
      reason: "inventory complete",
      confirm: true
    });
    expect(removed).toMatchObject({
      removedScopes: ["Device.Read.All"],
      requiresTenantConsentRevocation: true
    });
    expect((await readGreybeardConfig(appDataPath)).scopeLeases).toBeUndefined();

    const auditFiles = await readdir(join(appDataPath, "audit"));
    const auditText = await readFile(join(appDataPath, "audit", auditFiles[0] as string), "utf8");
    expect(auditText).toContain('"event":"requested"');
    expect(auditText).toContain('"reason":"temporary device inventory"');
    expect(auditText).toContain('"event":"released"');
  });
});

async function tempAppData(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "greybeard-test-"));
  await mkdir(root, { recursive: true });
  return root;
}

function jsonResponse(body: unknown, status = 200): ResponseLike {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : String(status),
    headers: {
      get() {
        return null;
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
