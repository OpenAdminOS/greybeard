import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { GraphService } from "./graphService.js";
import { inspectApplicationToken, expectedApplicationRoles } from "./appOnlyAuth.js";
import { readGreybeardConfig, updateGreybeardConfig } from "./config.js";
import type { AppOnlyProfile } from "./writeGateTypes.js";
import type { AuthToken, GraphAuthProvider, FetchLike } from "./types.js";

const profile: AppOnlyProfile = { tenantId: "11111111-1111-1111-1111-111111111111", clientId: "22222222-2222-2222-2222-222222222222", certificatePath: "/not-used/public.pem", privateKeyPath: "/not-used/private.pem", capabilities: ["users"] };
const token: AuthToken = { accessToken: "fixture-token", tenantId: profile.tenantId, clientId: profile.clientId, account: "application", tenantDomain: "fixture", activeTenantAlias: "fixture", clientIdKind: "workspace", credentialMode: "read-only", grantedScopes: ["User.Read.All"], cacheProtection: "memory", writesConfigured: false };
function auth(): GraphAuthProvider { return { getToken: async () => token, getStatus: async () => { throw new Error("unused"); }, addScopes: async () => { throw new Error("unused"); } }; }
function jwt(overrides: Record<string, unknown> = {}): string { return `header.${Buffer.from(JSON.stringify({ tid: profile.tenantId, appid: profile.clientId, aud: "https://graph.microsoft.com", exp: Date.now() / 1000 + 3600, roles: ["User.Read.All"], ...overrides })).toString("base64url")}.signature`; }

describe("application role and identity boundaries", () => {
  it("requires explicit capability selection and rejects unknown capabilities", () => {
    expect(() => expectedApplicationRoles({ ...profile, capabilities: [] })).toThrow(/Select/);
    expect(() => expectedApplicationRoles({ ...profile, capabilities: ["write-everything"] })).toThrow(/Select/);
    expect(inspectApplicationToken(jwt(), profile)).toEqual(["User.Read.All"]);
  });
  it.each([
    [{ roles: [] }, /Missing application roles/],
    [{ roles: ["User.Read.All", "Directory.Read.All"] }, /Excess application roles/],
    [{ tid: profile.clientId }, /identity/],
    [{ appid: profile.tenantId }, /identity/],
    [{ aud: "https://untrusted.example" }, /audience/],
    [{ scp: "User.Read" }, /identity/],
    [{ exp: 1 }, /expired/]
  ])("rejects unsuitable token claims %#", (claims, error) => {
    expect(() => inspectApplicationToken(jwt(claims), profile)).toThrow(error);
  });
  it("does not accept opaque tokens as proof of role selection", () => {
    expect(() => inspectApplicationToken("opaque", profile)).toThrow(/inactive/);
  });
});

describe("configuration concurrency", () => {
  it("serializes concurrent read-modify-write operations and uses private files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gb-config-"));
    await Promise.all(Array.from({ length: 20 }, (_, i) => updateGreybeardConfig(dir, current => ({ ...current, mcpServers: { ...current.mcpServers, [`server-${i}`]: true } }))));
    const config = await readGreybeardConfig(dir);
    expect(config.configRevision).toBe(20);
    expect(Object.keys(config.mcpServers ?? {})).toHaveLength(20);
    expect(JSON.parse(await readFile(join(dir, "config.json"), "utf8"))).toEqual(config);
    if (process.platform !== "win32") expect((await stat(join(dir, "config.json"))).mode & 0o777).toBe(0o600);
  });
});

describe("Graph read transport boundaries", () => {
  it.each(["https://untrusted.example/beta/users", "https://graph.microsoft.com/v1.0/users", "https://graph.microsoft.com/beta/groups", "https://graph.microsoft.com/beta/users#fragment"])("does not forward bearer credentials to an unsuitable nextLink %s", async nextLink => {
    const fetcher = vi.fn<FetchLike>().mockResolvedValue(new Response(JSON.stringify({ value: [], "@odata.nextLink": nextLink })));
    const service = new GraphService({ auth: auth(), fetcher });
    await expect(service.graph({ path: "/users", fetchAll: true })).rejects.toThrow(/Untrusted/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("stops cyclic empty pagination", async () => {
    const fetcher = vi.fn<FetchLike>().mockResolvedValue(new Response(JSON.stringify({ value: [], "@odata.nextLink": "https://graph.microsoft.com/beta/users" })));
    await expect(new GraphService({ auth: auth(), fetcher }).graph({ path: "/users", fetchAll: true })).rejects.toThrow(/repeated/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("reads an error body once and prevents redirect following", async () => {
    const fetcher = vi.fn<FetchLike>().mockImplementation(async () => new Response("upstream unavailable", { status: 502 }));
    await expect(new GraphService({ auth: auth(), fetcher }).graph({ path: "/users" })).rejects.toThrow();
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ redirect: "error" });
  });
  it("bounds the response stream and rejects path traversal and other API versions", async () => {
    const fetcher = vi.fn<FetchLike>().mockResolvedValue(new Response("x".repeat(4 * 1024 * 1024 + 1)));
    const service = new GraphService({ auth: auth(), fetcher });
    await expect(service.graph({ path: "/users" })).rejects.toThrow(/size limit/);
    await expect(service.graph({ path: "/%2e%2e/v1.0/users" })).rejects.toThrow(/path/);
    await expect(service.graph({ path: "/users", apiVersion: "v1.0" })).rejects.toThrow(/beta/);
  });
  it("rejects malformed batch entries and production mutation entry points", async () => {
    const fetcher = vi.fn<FetchLike>();
    const service = new GraphService({ auth: auth(), fetcher });
    await expect(service.graph({ method: "POST", path: "/$batch", body: { requests: [null] } })).rejects.toThrow();
    expect(() => service.planWrite({ summary: "x", rollback: "x", requiredScopes: [], operations: [] })).toThrow(/disabled/);
    expect(() => service.executePlan({ planId: "x", token: "x" })).toThrow(/disabled/);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
