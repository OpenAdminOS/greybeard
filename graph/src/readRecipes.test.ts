import { describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GraphService } from "./graphService.js";
import { GreybeardGraphError } from "./errors.js";
import { classifyGraphFailure } from "./classify.js";
import { previewCapabilities } from "./capabilityPreview.js";
import { runReadRecipe } from "./readRecipes.js";
import type { AppOnlyProfile } from "./writeGateTypes.js";
import type { AuthToken, GraphAuthProvider, GraphToolResult } from "./types.js";
const id = "11111111-2222-3333-4444-555555555555";
const profile: AppOnlyProfile = { tenantId: id, clientId: id, certificatePath: "unused", privateKeyPath: "unused", capabilities: ["groups"] };
function response(data: unknown): GraphToolResult { return { data, meta: { requests: 1, pages: 1, truncated: false, throttled: 0, apiVersion: "beta", usedBeta: true, warnings: [], notes: [], session: { requests: 1, pages: 1, throttled: 0, warnings: [] } } }; }
function failure(status: number, message = "Insufficient privileges to complete the operation.") { return new GreybeardGraphError({ code: "graph-request-failed", httpStatus: status, message, guidance: "No escalation", details: { graphCode: status === 403 ? "Authorization_RequestDenied" : "BadRequest", graphMessage: message } }); }

describe("bounded read recipes", () => {
  it("uses full identified policy and parent action expansion, never a subtype-select or unsupported action route", async () => {
    const graph = vi.fn().mockResolvedValue(response({ id, scheduledActionsForRule: [] }));
    await runReadRecipe({ graph }, { recipe: "compliance-policy", policyId: id });
    expect(graph.mock.calls[0][0]).toMatchObject({ apiVersion: "beta", method: "GET", path: `/deviceManagement/deviceCompliancePolicies/${id}`, query: {} });
    await runReadRecipe({ graph }, { recipe: "compliance-actions", policyId: id });
    expect(graph.mock.calls[1][0].query).toEqual({ "$expand": "scheduledActionsForRule($expand=scheduledActionConfigurations)" });
    expect(graph.mock.calls[1][0].path).not.toContain("/scheduledActionsForRule");
  });
  it("retries only the same scoped assignment collection once for a select400 and never for403", async () => {
    const graph = vi.fn().mockRejectedValueOnce(failure(400, "Parsing OData Select failed: property unsupported.")).mockResolvedValue(response({ value: [] }));
    const result = await runReadRecipe({ graph }, { recipe: "compliance-assignments", policyId: id });
    expect(graph).toHaveBeenCalledTimes(2);
    expect(graph.mock.calls[1][0]).toMatchObject({ path: graph.mock.calls[0][0].path, query: {}, maxPages: 5, maxItems: 100 });
    expect(result.evidence.fallbacks).toHaveLength(1);
    graph.mockReset().mockRejectedValue(failure(403));
    await expect(runReadRecipe({ graph }, { recipe: "compliance-assignments", policyId: id })).rejects.toMatchObject({ payload: { httpStatus: 403 } });
    expect(graph).toHaveBeenCalledTimes(1);
  });
  it("marks unconsumed nested continuations incomplete and rejects missing evidence/unsafe IDs", async () => {
    const graph = vi.fn().mockResolvedValue(response({ id, scheduledActionsForRule: [{ "scheduledActionConfigurations@odata.nextLink": "https://graph.microsoft.com/beta/example" }] }));
    const result = await runReadRecipe({ graph }, { recipe: "compliance-actions", policyId: id });
    expect(result.evidence.complete).toBe(false);
    graph.mockResolvedValue(response({ id }));
    await expect(runReadRecipe({ graph }, { recipe: "compliance-actions", policyId: id })).rejects.toThrow("unavailable");
    await expect(runReadRecipe({ graph }, { recipe: "compliance-policy", policyId: "../users" })).rejects.toThrow("GUID");
    await expect(runReadRecipe({ graph }, { recipe: "groups", maxPages: 51 })).rejects.toThrow("maxPages");
  });
  it("follows opaque paging exactly, limits pages, and marks one-page previews partial", async () => {
    const appDataPath = await mkdtemp(join(tmpdir(), "gb-graph-recipes-"));
    const token = { account: "application:fixture", grantedScopes: [] } as unknown as AuthToken;
    const auth = { getToken: async () => token } as unknown as GraphAuthProvider;
    const next = "https://graph.microsoft.com/beta/groups?$skiptoken=opaque%2Btoken";
    const fetcher = vi.fn().mockImplementation(async (url: string) => new Response(JSON.stringify({ value: [{ id: url.includes("skiptoken") ? "second" : "first" }], "@odata.nextLink": url.includes("skiptoken") ? "https://graph.microsoft.com/beta/groups?$skiptoken=third" : next }), { status: 200 }));
    const service = new GraphService({ auth, fetcher, appDataPath });
    try {
      const result = await runReadRecipe(service, { recipe: "groups", maxPages: 2 });
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(fetcher.mock.calls[1][0]).toBe(next);
      expect(result.meta.pages).toBe(2);
      expect(result.meta.truncated).toBe(true);
      expect(result.evidence.complete).toBe(false);
      const preview = await service.graph({ apiVersion: "beta", path: "/groups", fetchAll: false });
      expect(preview.meta.truncated).toBe(true);
    } finally { await service.close(); await rm(appDataPath, { recursive: true, force: true }); }
  });
});

describe("capability readiness", () => {
  it("never treats configuration as verification or probes unselected capabilities", async () => {
    const configured = await previewCapabilities(profile);
    expect(configured.capabilities.find((x) => x.key === "groups")?.state).toBe("unverified");
    const graph = vi.fn().mockResolvedValue(response({ value: [] }));
    const ready = await previewCapabilities(profile, { graph });
    expect(graph).toHaveBeenCalledTimes(1);
    expect(graph.mock.calls[0][0]).toMatchObject({ method: "GET", apiVersion: "beta", path: "/groups", fetchAll: false });
    expect(ready.capabilities.find((x) => x.key === "groups")?.state).toBe("ready");
    expect(ready.minimumGrantsVerified).toBe(false);
  });
  it("preserves exact403 without escalation and rejects invalid shape", async () => {
    const graph = vi.fn().mockRejectedValue(failure(403));
    const result = await previewCapabilities(profile, { graph });
    expect(result.capabilities.find((x) => x.key === "groups")).toMatchObject({ state: "blocked", diagnostic: { httpStatus: 403, graphCode: "Authorization_RequestDenied", message: "Insufficient privileges to complete the operation." } });
    graph.mockResolvedValue(response({ wrong: true }));
    expect((await previewCapabilities(profile, { graph })).capabilities.find((x) => x.key === "groups")?.state).toBe("error");
  });
  it("does not invent consent/license/user-role causes for app-only403", () => {
    const token = { account: "application:fixture", grantedScopes: ["AuditLog.Read.All"] } as unknown as AuthToken;
    const error = classifyGraphFailure({ status: 403, path: "/auditLogs/signIns", query: new URLSearchParams(), graphError: { error: { code: "Authorization_RequestDenied", message: "Insufficient privileges to complete the operation." } }, token });
    expect(error.payload.code).toBe("graph-request-failed");
    expect(error.payload).not.toHaveProperty("consentUrl");
    expect(error.payload).not.toHaveProperty("requiredLicense");
    expect(error.payload.details?.graphCode).toBe("Authorization_RequestDenied");
  });
});
