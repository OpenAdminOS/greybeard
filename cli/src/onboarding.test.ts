import { mkdtemp, mkdir, readFile, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createRuntime } from "./runtime.js";
import { startSetupUi } from "./setupUi.js";
import { discoveryRuntime } from "./workspaceStatus.js";
import { readGreybeardConfig, updateGreybeardConfig } from "@greybeard/graph";

it("detects, configures, verifies and remembers setup without modifying unselected tools", async () => {
  const home = await mkdtemp(join(tmpdir(), "greybeard-onboarding-"));
  const data = join(home, "data");
  const base = createRuntime();
  const runtime = { ...base, homeDir: home, platform: "win32" as const, env: { PATH: "", APPDATA: join(home, "appdata"), LOCALAPPDATA: join(home, "localappdata"), CODEX_HOME: join(home, ".codex"), CLAUDE_CONFIG_DIR: join(home, ".claude") }, findExecutable: async (name: string) => ["codex", "claude"].includes(name) ? join(home, name) : null };
  await mkdir(join(home, ".claude"), { recursive: true });
  const unrelated = '{"userPreference":"keep me"}\n';
  await writeFile(join(home, ".claude", "settings.json"), unrelated);
  const { server, url } = await startSetupUi(runtime, data, { desktop: true });
  const address = new URL(url);
  const call = async (path: string, body = {}) => {
    const response = await fetch(address.origin + path, { method: "POST", headers: { origin: address.origin, "content-type": "application/json", "x-greybeard-session": address.hash.slice(1) }, body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  try {
    const initial = (await call("/state")).data;
    expect(initial.setupCompleted).toBe(false);
    expect(initial.toolStatus).toHaveLength(6);
    expect(initial.clients).toEqual(expect.arrayContaining(["Claude Code", "Codex CLI"]));
    expect(await readGreybeardConfig(data)).toEqual({});
    expect((await call("/setup", { clients: ["not a tool"], updateMode: "notify" })).status).toBe(400);
    // Existing user skill folders must not be silently overwritten or called ready.
    const conflict = join(home, ".agents", "skills", "change-plan");
    await mkdir(conflict, { recursive: true });
    await writeFile(join(conflict, "SKILL.md"), "User-owned skill");
    const blocked = (await call("/setup", { clients: ["Codex CLI"], mentor: true, enableLearning: true, updateMode: "notify" })).data;
    expect(blocked.configured).toBe(false);
    expect(blocked.tools.find((t: { name: string }) => t.name === "Codex CLI").issues).toContain("Some Greybeard skills are missing or blocked by existing files.");
    expect((await readGreybeardConfig(data)).companionSetupCompleted).not.toBe(true);
    expect(await readFile(join(conflict, "SKILL.md"), "utf8")).toBe("User-owned skill");
    await rm(conflict, { recursive: true });
    const success = (await call("/setup", { clients: ["Codex CLI"], mentor: true, enableLearning: true, updateMode: "notify" })).data;
    expect(success.configured).toBe(true);
    expect(success.tools.find((t: { name: string }) => t.name === "Codex CLI").ready).toBe(true);
    expect(await readFile(join(home, ".claude", "settings.json"), "utf8")).toBe(unrelated);
    expect((await call("/state")).data.setupCompleted).toBe(true);
    expect((await call("/summary")).data.active).toBe(0);
    const foreign = '[mcp_servers.greybeard-memory]\ncommand = "someone-elses-server"\n';
    await writeFile(join(home, ".codex", "config.toml"), foreign);
    const preserved = (await call("/setup", { clients: ["Codex CLI"], mentor: true, updateMode: "notify" })).data;
    expect(preserved.configured).toBe(false);
    expect(preserved.tools.find((t: { name: string }) => t.name === "Codex CLI").issues.join(" ")).toContain("existing entry was preserved");
    expect(await readFile(join(home, ".codex", "config.toml"), "utf8")).toContain('command = "someone-elses-server"');
    await updateGreybeardConfig(data, current => ({ ...current, learningEnabled: false }));
    await call("/setup-later");
    expect((await readGreybeardConfig(data)).learningEnabled).toBe(false);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); await rm(home, { recursive: true, force: true }); }
});

it("finds a CLI in a GUI user's local bin without invoking it", async () => {
  const home = await mkdtemp(join(tmpdir(), "greybeard-discovery-"));
  try {
    const executable = join(home, ".local", "bin", process.platform === "win32" ? "claude.exe" : "claude");
    await mkdir(join(home, ".local", "bin"), { recursive: true });
    await writeFile(executable, "This fixture is never executed."); await chmod(executable, 0o700);
    const runtime = discoveryRuntime({ ...createRuntime(), homeDir: home, env: {}, findExecutable: async () => null });
    expect(await runtime.findExecutable("claude")).toBe(executable);
  } finally { await rm(home, { recursive: true, force: true }); }
});

it("lists all supported tools when none are installed and allows exploration without enabling integrations", async () => {
  const home = await mkdtemp(join(tmpdir(), "greybeard-empty-start-"));
  const data = join(home, "data");
  const runtime = { ...createRuntime(), homeDir: home, platform: "win32" as const, env: { PATH: "", APPDATA: join(home, "appdata"), LOCALAPPDATA: join(home, "localappdata"), CODEX_HOME: join(home, ".codex"), CLAUDE_CONFIG_DIR: join(home, ".claude") }, findExecutable: async () => null };
  const { server, url } = await startSetupUi(runtime, data, { desktop: true });
  const address = new URL(url);
  const call = async (path: string, body = {}) => {
    const response = await fetch(address.origin + path, { method: "POST", headers: { origin: address.origin, "content-type": "application/json", "x-greybeard-session": address.hash.slice(1) }, body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  try {
    const state = (await call("/state")).data;
    expect(state.clients).toEqual([]);
    expect(state.toolStatus).toHaveLength(6);
    expect(state.setupCompleted).toBe(false);
    expect((await call("/setup", { clients: ["Codex CLI"], updateMode: "notify" })).status).toBe(400);
    await call("/setup-later");
    expect((await call("/state")).data.setupCompleted).toBe(true);
    expect((await call("/state")).data.configuredClients).toEqual([]);
    await expect(readFile(join(home, ".codex", "config.toml"))).rejects.toMatchObject({ code: "ENOENT" });
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); await rm(home, { recursive: true, force: true }); }
});
