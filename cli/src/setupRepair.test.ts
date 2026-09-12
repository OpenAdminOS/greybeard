import { mkdtemp, mkdir, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createRuntime } from "./runtime.js";
import { getClientAdapter, summarizeSkillWiring } from "./clients.js";
import { previewSetupRepair, repairSetup } from "./setupRepair.js";

it("upgrades previous packaged skill links for Claude, Cursor and Codex, including removed runtimes", async () => {
  const home = await mkdtemp(join(tmpdir(), "greybeard-upgrade-"));
  const data = join(home, "data");
  const previous = join(data, "runtime", "a".repeat(64));
  const current = join(data, "runtime", "b".repeat(64));
  const skill = ".agents/skills/write/change-plan";
  const runtime = { ...createRuntime(), homeDir: home, packaged: true, env: { GREYBEARD_APP_DATA: data, CLAUDE_CONFIG_DIR: join(home, ".claude") }, repoRoot: previous };
  try {
    for (const root of [previous, current]) { await mkdir(join(root, skill), { recursive: true, mode: 0o700 }); await writeFile(join(root, skill, "SKILL.md"), "A bundled skill."); }
    for (const name of ["Claude Code", "Cursor", "Codex CLI"] as const) {
      const adapter = getClientAdapter(name);
      expect(summarizeSkillWiring(await adapter.wireSkills(runtime)).ok).toBe(true);
    }
    await rm(previous, { recursive: true });
    for (const name of ["Claude Code", "Cursor", "Codex CLI"] as const) {
      const adapter = getClientAdapter(name);
      const result = await adapter.wireSkills({ ...runtime, repoRoot: current });
      expect(result.entries[0].status).toBe("replaced-stale-symlink");
      expect(await readFile(join(result.entries[0].target, "SKILL.md"), "utf8")).toBe("A bundled skill.");
      expect(summarizeSkillWiring(await adapter.inspectSkills({ ...runtime, repoRoot: current })).ok).toBe(true);
    }
    // Similar-looking paths outside this application's cache are still user owned.
    const target = join(home, ".agents/skills/change-plan");
    await rm(target); const foreign = join(home, "other", "runtime", "c".repeat(64), skill);
    await symlink(foreign, target, process.platform === "win32" ? "junction" : "dir");
    expect((await getClientAdapter("Codex CLI").wireSkills({ ...runtime, repoRoot: current })).entries[0].status).toBe("blocked");
    expect(await readlink(target)).toContain("other");
  } finally { await rm(home, { recursive: true, force: true }); }
});

it("backs up a reviewed legacy Desktop connection and user skills without changing other MCP entries", async () => {
  const home = await mkdtemp(join(tmpdir(), "greybeard-repair-"));
  const data = join(home, "data");
  const runtime = { ...createRuntime(), homeDir: home, platform: "darwin" as const, env: { GREYBEARD_APP_DATA: data, CLAUDE_CONFIG_DIR: join(home, ".claude") } };
  try {
    const configPath = (await getClientAdapter("Claude Desktop").inspectMcpConfig(runtime)).path;
    await mkdir(join(home, "Library/Application Support/Claude"), { recursive: true });
    const original = JSON.stringify({ preference: "keep", mcpServers: { "greybeard-memory": { command: "old-custom-greybeard", args: [] }, other: { command: "keep-this-server", env: { PRIVATE_VALUE: "fixture" } } } });
    await writeFile(configPath, original);
    const preview = await previewSetupRepair(runtime, "Claude Desktop");
    expect(await readFile(configPath, "utf8")).toBe(original);
    const repaired = await repairSetup(runtime, data, preview);
    expect(await readFile(join(repaired.backupPath, "configuration.backup"), "utf8")).toBe(original);
    const updated = JSON.parse(await readFile(configPath, "utf8"));
    expect(updated.preference).toBe("keep");
    expect(updated.mcpServers.other).toEqual(JSON.parse(original).mcpServers.other);
    expect(updated.mcpServers["greybeard-memory"].env.GREYBEARD_MANAGED).toBe("0.1");

    const conflict = join(home, ".agents/skills/change-plan");
    await mkdir(conflict, { recursive: true }); await writeFile(join(conflict, "SKILL.md"), "My personal skill");
    const codexPlan = await previewSetupRepair(runtime, "Codex CLI");
    const codexRepair = await repairSetup(runtime, data, codexPlan);
    const restore = JSON.parse(await readFile(join(codexRepair.backupPath, "restore.json"), "utf8"));
    expect(restore.skills).toHaveLength(1);
    expect(restore.skills[0].backup).not.toContain("/skills/");
    expect(await readFile(join(restore.skills[0].backup, "SKILL.md"), "utf8")).toBe("My personal skill");
    expect(summarizeSkillWiring(await getClientAdapter("Codex CLI").inspectSkills(runtime)).ok).toBe(true);
    const stale = await previewSetupRepair(runtime, "Claude Desktop");
    await writeFile(configPath, original);
    await expect(repairSetup(runtime, data, stale)).rejects.toThrow("changed since you reviewed");
    expect(await readFile(configPath, "utf8")).toBe(original);
  } finally { await rm(home, { recursive: true, force: true }); }
});
