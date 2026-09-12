import { mkdtemp, mkdir, readFile, writeFile, symlink, readlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, it, expect, vi } from "vitest";
import { readGreybeardConfig, updateGreybeardConfig } from "@greybeard/graph";
import { MemoryService } from "@greybeard/memory";
import { runCli } from "./index.js";
import { supportedAction } from "./mentor.js";
import { startSetupUi } from "./setupUi.js";
import { type CliRuntime } from "./runtime.js";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "greybeard-mentor-"));
  const home = join(root, "home"), appData = join(root, "data"), repoRoot = join(root, "repo");
  await mkdir(home); await mkdir(join(repoRoot, ".agents", "skills"), { recursive: true });
  let output = "", errors = "";
  const stdin = new PassThrough() as NodeJS.ReadStream;
  const authFactory = vi.fn(async () => { throw new Error("Mentor must not authenticate"); });
  const fetcher = vi.fn(async () => { throw new Error("Mentor must not fetch"); });
  const runtime: CliRuntime = { env: { GREYBEARD_APP_DATA: appData }, cwd: repoRoot, homeDir: home, platform: "linux", nodePath: process.execPath, repoRoot, stdin, stdout: { write: (value: string) => { output += value; return true; } }, stderr: { write: (value: string) => { errors += value; return true; } }, authFactory, fetcher, findExecutable: async name => name === "claude" ? "/bin/claude" : null, confirm: async () => "non-interactive", runCommand: async () => ({ code: 0, stdout: "", stderr: "" }) };
  return { root, home, appData, runtime, authFactory, fetcher, output: () => output, errors: () => errors, reset: () => { output = ""; errors = ""; } };
}

async function hook(f: Awaited<ReturnType<typeof fixture>>, command: string, session = "one") {
  const stdin = new PassThrough() as NodeJS.ReadStream;
  stdin.end(JSON.stringify({ hook_event_name: "PreToolUse", session_id: session, tool_name: "Bash", tool_input: { command } }));
  return runCli(["mentor", "pre-tool"], { ...f.runtime, stdin });
}

describe("mentor 0.1", () => {
  it("sets up mentor-only without auth/network and binds client env and hooks", async () => {
    const f = await fixture();
    expect(await runCli(["setup", "--yes"], f.runtime)).toBe(0);
    expect(f.authFactory).not.toHaveBeenCalled(); expect(f.fetcher).not.toHaveBeenCalled();
    const config = JSON.parse(await readFile(join(f.home, ".claude.json"), "utf8"));
    expect(Object.keys(config.mcpServers)).toEqual(["greybeard-memory"]);
    expect(config.mcpServers["greybeard-memory"].env).toMatchObject({ GREYBEARD_APP_DATA: f.appData, GREYBEARD_PROFILE_ID: "local" });
    const settings = JSON.parse(await readFile(join(f.home, ".claude", "settings.json"), "utf8"));
    expect(settings.hooks.PreToolUse[0].hooks[0].command).toContain("'mentor' 'event'");
    expect(settings.hooks.PreToolUse[0].hooks[0].args).toBeUndefined();
    expect((await readGreybeardConfig(f.appData)).updateMode).toBe("notify");
    expect(await runCli(["setup", "--writes"], f.runtime)).toBe(1);
    expect(f.authFactory).not.toHaveBeenCalled();
    expect(await runCli(["doctor"], f.runtime)).toBe(0);
    expect(f.authFactory).not.toHaveBeenCalled();
  });
  it("only recalls confirmed relevant device lessons, deduplicates and honors pause", async () => {
    const f = await fixture(); await runCli(["setup", "--yes"], f.runtime);
    const service = new MemoryService({ appDataPath: f.appData });
    const candidate = await service.remember({ type: "preference", content: "Keep month-end devices through reporting.", scope: "devices" });
    const node = (await service.export()).nodes.find(n => n.id === candidate.id)!;
    f.reset(); await hook(f, "Remove-MgDevice -DeviceId example"); expect(f.output()).toBe("");
    await service.confirm({ id: node.id, expectedRevision: node.revision });
    await hook(f, "Remove-MgDevice -DeviceId example");
    expect(f.output()).toContain("Keep month-end devices");
    expect(JSON.parse(f.output()).hookSpecificOutput.hookEventName).toBe("PreToolUse");
    f.reset(); await hook(f, "Remove-MgDevice -DeviceId example"); expect(f.output()).toBe("");
    await hook(f, "echo devices"); expect(f.output()).toBe("");
    await runCli(["memory", "pause"], f.runtime); f.reset(); await hook(f, "Remove-MgDevice -DeviceId other"); expect(f.output()).toBe("");
    service.close();
  });
  it("refuses piped confirmation even with --yes and keeps candidate untrusted", async () => {
    const f = await fixture(); await runCli(["setup", "--yes"], f.runtime);
    const service = new MemoryService({ appDataPath: f.appData });
    const candidate = await service.remember({ type: "preference", content: "Keep month-end devices." });
    const node = (await service.export()).nodes.find(n => n.id === candidate.id)!;
    expect(await runCli(["memory", "confirm", "--id", String(node.id), "--yes"], { ...f.runtime, confirm: async () => "confirmed" })).toBe(1);
    expect(f.errors()).toContain("interactive terminal");
    expect((await service.export()).nodes[0].status).toBe("candidate");
    service.close();
  });
  it("preserves foreign hook and skills while removing owned integrations", async () => {
    const f = await fixture();
    await mkdir(join(f.home, ".claude", "skills"), { recursive: true });
    await mkdir(join(f.runtime.repoRoot, ".agents", "skills", "lesson"));
    await writeFile(join(f.runtime.repoRoot, ".agents", "skills", "lesson", "SKILL.md"), "---\nname: lesson\ndescription: Lesson\n---\n");
    const foreign = join(f.root, "foreign"); await mkdir(foreign);
    await symlink(foreign, join(f.home, ".claude", "skills", "lesson"));
    await writeFile(join(f.home, ".claude", "settings.json"), JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo foreign" }] }] } }));
    await runCli(["setup", "--yes"], f.runtime); await runCli(["setup", "--yes", "--no-memory-hook"], f.runtime);
    let settings = JSON.parse(await readFile(join(f.home, ".claude", "settings.json"), "utf8"));
    expect(settings.hooks.PreToolUse).toHaveLength(1);
    expect(settings.hooks.PreToolUse[0].hooks[0].command).toBe("echo foreign");
    expect(await readlink(join(f.home, ".claude", "skills", "lesson"))).toBe(foreign);
    await runCli(["uninstall"], f.runtime);
    expect(JSON.parse(await readFile(join(f.home, ".claude.json"), "utf8")).mcpServers).toEqual({});
    expect((await readGreybeardConfig(f.appData)).profileId).toBe("local");
  });
  it("rejects unknown and compound shell commands", () => {
    const event = (command: string) => ({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command } });
    expect(supportedAction(event("echo Remove-MgDevice"))).toBeUndefined();
    expect(supportedAction(event("Remove-MgDevice; echo done"))).toBeUndefined();
    expect(supportedAction(event('pwsh -NoProfile -Command "Remove-MgDevice -DeviceId example"'))?.scope).toBe("devices");
  });
  it("protects local UI API with session and exact origin and confirms exact preview", async () => {
    const f = await fixture();
    await updateGreybeardConfig(f.appData, c => ({ ...c, profileId: "local" }));
    const { server, url } = await startSetupUi(f.runtime, f.appData);
    try {
      const parsed = new URL(url), token = parsed.hash.slice(1), origin = parsed.origin;
      expect((await fetch(origin + "/state", { method: "POST" })).status).toBe(403);
      const headers = { "Content-Type": "application/json", "X-Greybeard-Session": token, Origin: "https://evil.example" };
      expect((await fetch(origin + "/state", { method: "POST", headers, body: "{}" })).status).toBe(403);
      headers.Origin = origin;
      expect((await fetch(origin + "/state", { method: "POST", headers, body: "{}" })).status).toBe(200);
      const service = new MemoryService({ appDataPath: f.appData });
      const candidate = await service.remember({ type: "preference", content: "Keep month-end devices." });
    const node = (await service.export()).nodes.find(n => n.id === candidate.id)!;
      expect((await fetch(origin + "/confirm", { method: "POST", headers, body: JSON.stringify({ id: node.id, content: "changed", revision: node.revision }) })).status).toBe(409);
      expect((await fetch(origin + "/confirm", { method: "POST", headers, body: JSON.stringify({ id: node.id, content: node.content, revision: node.revision }) })).status).toBe(200);
      expect((await service.export()).nodes[0].status).toBe("confirmed");
      expect((await fetch(origin + "/correct", { method: "POST", headers, body: JSON.stringify({ id: node.id, content: "Keep devices until finance reports close." }) })).status).toBe(200);
      const afterCorrection = await service.export();
      expect(afterCorrection.nodes).toHaveLength(2);
      expect(afterCorrection.nodes[1].status).toBe("candidate");
      expect((await fetch(origin + "/forget", { method: "POST", headers, body: JSON.stringify({ id: afterCorrection.nodes[1].id }) })).status).toBe(200);
      expect((await fetch(origin + "/connect", { method: "POST", headers, body: JSON.stringify({}) })).status).toBe(400);
      expect((await fetch(origin + "/connect", { method: "POST", headers, body: JSON.stringify({ tenant: "invalid", clientId: "invalid", certificate: "/no-file", privateKey: "/no-file", capabilities: ["devices"] }) })).status).toBe(400);
      expect(f.fetcher).not.toHaveBeenCalled();
      service.close();
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });
});
