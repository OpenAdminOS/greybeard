import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createRuntime } from "./runtime.js";
import { startSetupUi } from "./setupUi.js";

it("authenticates local companion actions and preserves exact confirmation and correction", async () => {
  const directory = await mkdtemp(join(tmpdir(), "greybeard-companion-api-"));
  const { server, url } = await startSetupUi(createRuntime(), directory, { desktop: true });
  const address = new URL(url);
  const call = async (path: string, body: object = {}, headers: Record<string,string> = {}) => {
    const response = await fetch(address.origin + path, { method: "POST", headers: { origin: address.origin, "content-type": "application/json", "x-greybeard-session": address.hash.slice(1), ...headers }, body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  try {
    expect((await call("/add", { type: "decision", content: "Windows pilot requires helpdesk review." }, { origin: "https://example.com" })).status).toBe(403);
    expect((await call("/add", {}, { "x-greybeard-session": "wrong" })).status).toBe(403);
    const inheritedTenant = process.env.GREYBEARD_TENANT_ID;
    const inheritedProfile = process.env.GREYBEARD_PROFILE_ID;
    process.env.GREYBEARD_TENANT_ID = "different-bound-tenant";
    process.env.GREYBEARD_PROFILE_ID = "different-bound-profile";
    try { expect((await call("/export")).data).toMatchObject({ tenant: "local", profileId: "local" }); }
    finally {
      if (inheritedTenant === undefined) delete process.env.GREYBEARD_TENANT_ID; else process.env.GREYBEARD_TENANT_ID = inheritedTenant;
      if (inheritedProfile === undefined) delete process.env.GREYBEARD_PROFILE_ID; else process.env.GREYBEARD_PROFILE_ID = inheritedProfile;
    }
    const add = await call("/add", { type: "decision", content: "Windows pilot requires helpdesk review.", evidenceKind: "rule", scope: "devices" });
    expect(add.data.status).toBe("candidate");
    const node = (await call("/memories", { query: "helpdesk", scope: "devices", status: "candidate" })).data.results[0];
    expect((await call("/confirm", { id: node.id, content: "Wrong text", revision: node.revision })).status).toBe(409);
    expect((await call("/forget", { id: node.id, content: "Wrong text", revision: node.revision })).status).toBe(409);
    expect((await call("/confirm", { id: node.id, content: node.content, revision: node.revision })).status).toBe(200);
    await call("/correct", { id: node.id, content: "Windows pilot requires 72 hours of observation and helpdesk review." });
    const memories = (await call("/memories")).data.results;
    expect(memories).toHaveLength(2);
    expect(memories.find((n: { id: number }) => n.id === node.id).supersededAt).toBe(null);
    expect(memories[0].evidenceKind).toBe("rule");
    expect((await call("/summary")).data).toEqual({ active: 2, confirmed: 1, candidates: 1 });
    expect((await call("/capability-preview")).data.configured).toBe(false);
    await call("/pause", { paused: true });
    expect((await call("/outcome", { lesson: "Review rollout evidence", outcome: "Helpdesk identified a kiosk issue." })).status).toBe(400);
    expect((await call("/export")).data.nodes).toHaveLength(2);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); }
});
