import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readlink, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { readGreybeardConfig } from "@greybeard/graph";
import { getClientAdapter, removeTomlTable, writeClaudeMemoryHook, type KnownClientName } from "./clients.js";
import { withClientConfigLock, writeClientConfigAtomic } from "./clientConfigFile.js";
import { serverOptionsFromConfig } from "./serverCatalog.js";
import type { CliRuntime } from "./runtime.js";

export async function previewSetupRepair(runtime: CliRuntime, client: KnownClientName) {
  const adapter = getClientAdapter(client);
  const mcp = await adapter.inspectMcpConfig(runtime);
  if (mcp.error) throw new Error("The tool configuration cannot be read. Check its format and file permissions first.");
  let content = "";
  try { content = await readFile(mcp.path, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const skills = await adapter.inspectSkills(runtime);
  const blocked = [];
  for (const entry of skills.entries.filter(entry => entry.status === "blocked")) {
    let info;
    try { info = await lstat(entry.target); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
    blocked.push({ name: entry.name, path: entry.target, identity: [info.ino, info.size, info.mtimeMs, info.isSymbolicLink() ? await readlink(entry.target) : ""], reason: entry.message });
  }
  return {
    client, configPath: mcp.path, skills: blocked,
    revision: createHash("sha256").update(JSON.stringify({ content, blocked })).digest("hex")
  };
}

/** Called only after the user reviews and confirms this exact repair preview. */
export async function repairSetup(runtime: CliRuntime, appDataPath: string, preview: Awaited<ReturnType<typeof previewSetupRepair>>) {
  const config = await readGreybeardConfig(appDataPath);
  const bound = { ...runtime, env: { ...runtime.env, GREYBEARD_APP_DATA: appDataPath, GREYBEARD_PROFILE_ID: config.profileId ?? "local", GREYBEARD_TENANT_ID: config.activeTenantId ?? "local" } };
  const adapter = getClientAdapter(preview.client);
  const id = randomUUID();
  const backup = join(appDataPath, "integration-backups", id);
  // The same lock protects comparison, backup and editing from another setup.
  await withClientConfigLock(preview.configPath, async () => {
    const current = await previewSetupRepair(bound, preview.client);
    if (current.revision !== preview.revision) throw new Error("The integration changed since you reviewed it. Review the repair again.");
    await mkdir(backup, { recursive: true, mode: 0o700 });
    let content: string;
    try { content = await readFile(preview.configPath, "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; content = preview.client === "Codex CLI" ? "" : "{}"; }
    await writeFile(join(backup, "configuration.backup"), content, { mode: 0o600, flag: "wx" });
    let next: string;
    if (preview.client === "Codex CLI") next = removeTomlTable(content, "mcp_servers.greybeard-memory");
    else {
      const root = JSON.parse(content);
      if (!root || typeof root !== "object" || Array.isArray(root)) throw new Error("Tool configuration must be a JSON object.");
      if (root.mcpServers) delete root.mcpServers["greybeard-memory"];
      next = JSON.stringify(root, null, 2) + "\n";
    }
    // Skill backups sit outside the host's skills directory so they cannot be loaded twice.
    const moves = preview.skills.map(skill => ({ original: skill.path, backup: join(dirname(dirname(skill.path)), "greybeard-backups", id, basename(skill.path)) }));
    await writeFile(join(backup, "restore.json"), JSON.stringify({ configPath: preview.configPath, configuration: "configuration.backup", skills: moves }, null, 2), { mode: 0o600, flag: "wx" });
    for (const move of moves) {
      await mkdir(dirname(move.backup), { recursive: true, mode: 0o700 });
      await rename(move.original, move.backup);
    }
    await writeClientConfigAtomic(preview.configPath, next);
  });
  await adapter.writeMcpConfig(bound, serverOptionsFromConfig(config));
  await adapter.wireSkills(bound);
  if (adapter.writeFallback) await adapter.writeFallback(bound);
  if (preview.client === "Claude Code" && config.memoryHook !== false) await writeClaudeMemoryHook(bound);
  return { backupPath: backup };
}
