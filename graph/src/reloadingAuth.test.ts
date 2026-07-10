import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { updateGreybeardConfig, writeGreybeardConfig } from "./config.js";
import { ConfigReloadingAuthProvider } from "./reloadingAuth.js";
import { AuthStatus, GraphAuthProvider } from "./types.js";

describe("ConfigReloadingAuthProvider", () => {
  it("recreates auth after setup changes config without replacing the MCP transport", async () => {
    const appDataPath = await mkdtemp(join(tmpdir(), "greybeard-reload-"));
    await mkdir(appDataPath, { recursive: true });
    await writeGreybeardConfig(appDataPath, {
      configRevision: 1,
      activeTenantId: "tenant-id",
      credentialMode: "read-only"
    });
    const created: Array<{ clientId: string; credentialMode: string }> = [];
    const authFactory = vi.fn(async (options): Promise<GraphAuthProvider> => {
      created.push({
        clientId: options.clientId,
        credentialMode: options.credentialMode
      });
      return mockProvider(options.clientId, options.credentialMode, options.writesConfigured);
    });
    const proxy = new ConfigReloadingAuthProvider({ appDataPath, authFactory });

    expect((await proxy.getStatus()).clientIdKind).toBe("first-party");
    await updateGreybeardConfig(appDataPath, (current) => ({
      ...current,
      credentialMode: "writes",
      workspaceAppId: "workspace-client-id"
    }));
    const status = await proxy.getStatus();

    expect(status).toMatchObject({
      clientId: "workspace-client-id",
      clientIdKind: "workspace",
      credentialMode: "writes",
      gate: { writesConfigured: true }
    });
    expect(created).toEqual([
      { clientId: "14d82eec-204b-4c2f-b7e8-296a70dab67e", credentialMode: "read-only" },
      { clientId: "workspace-client-id", credentialMode: "writes" }
    ]);
    expect(authFactory).toHaveBeenCalledTimes(2);
  });
});

function mockProvider(clientId: string, credentialMode: "read-only" | "writes", writesConfigured: boolean): GraphAuthProvider {
  const status: AuthStatus = {
    signedIn: true,
    account: "admin@contoso.com",
    tenantId: "tenant-id",
    tenantDomain: "contoso.com",
    activeTenantAlias: "contoso",
    credentialMode,
    clientId,
    clientIdKind: credentialMode === "writes" ? "workspace" : "first-party",
    grantedScopes: [],
    entraP1: null,
    directoryRoles: null,
    directoryRolesStatus: { state: "unavailable", diagnostic: "not probed" },
    cacheProtection: "keychain",
    gate: { pendingPlan: null, writesConfigured }
  };
  return {
    async getToken() {
      throw new Error("unused");
    },
    async getStatus() {
      return status;
    },
    async addScopes(input) {
      return {
        granted: true,
        alreadyGranted: input.scopes,
        requestedScopes: input.scopes,
        grantedScopes: input.scopes
      };
    }
  };
}
