import { withClientConfigLock, writeClientConfigAtomic } from "./clientConfigFile.js";
import { lstat, readFile, readlink, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { getGreybeardAppDataPath } from "@greybeard/graph";
import { readMemoryBinding, disconnectMemory } from "./sharedMemory.js";
import { flagValue, flagValues, type ParsedArgs } from "./args.js";
import { CLIENT_ADAPTERS, removeTomlTable, extractTomlTable, removeClaudeMemoryHook, listSkillSourceDirs, repoSkillsDir } from "./clients.js";
import { SERVER_CATALOG, isGreybeardManagedEntry } from "./serverCatalog.js";
import { hostForClient, removeAutomaticHooks } from "./automaticHooks.js";
import { type CliRuntime, writeLine } from "./runtime.js";

export async function runUninstall(_args: ParsedArgs, runtime: CliRuntime): Promise<number> {
  const selected = flagValues(_args, "client");
  if (selected.length === 0 || selected.includes("Claude Code")) await removeClaudeMemoryHook(runtime);
  for (const [name, adapter] of Object.entries(CLIENT_ADAPTERS)) {
    if (selected.length && !selected.includes(name)) continue;
    // Desktop Chat has its own MCP entry; automatic Desktop Code shares Claude Code hooks.
    if (name !== "Claude Desktop") await removeAutomaticHooks(runtime,hostForClient(name as import("./clients.js").KnownClientName));
    const client = await adapter.detect(runtime);
    try {
      await lstat(client.userConfigPath);
      await withClientConfigLock(client.userConfigPath, async () => {
      const text = await readFile(client.userConfigPath, "utf8");
      if (client.name === "Codex CLI") {
        let next = text;
        for (const server of SERVER_CATALOG) {
          const table = extractTomlTable(next, `mcp_servers.${server.name}`);
          if (table && isGreybeardManagedEntry(server, table, runtime.repoRoot)) {
            next = removeTomlTable(next, `mcp_servers.${server.name}`);
            next = removeTomlTable(next, `mcp_servers.${server.name}.env`);
          }
        }
        if (next !== text) await writeClientConfigAtomic(client.userConfigPath, next);
      } else {
        const data = JSON.parse(text) as Record<string, unknown>;
        const servers = data.mcpServers;
        if (servers && typeof servers === "object" && !Array.isArray(servers)) {
          let changed = false;
          for (const server of SERVER_CATALOG) {
            const entry = (servers as Record<string, unknown>)[server.name];
            if (entry && isGreybeardManagedEntry(server, JSON.stringify(entry), runtime.repoRoot)) { delete (servers as Record<string, unknown>)[server.name]; changed = true; }
          }
          if (changed) await writeClientConfigAtomic(client.userConfigPath, JSON.stringify(data, null, 2) + "\n");
        }
      }
      });
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") writeLine(runtime.stderr, `Preserved ${client.name} configuration: could not safely edit it.`); }
    const inspected = await adapter.inspectSkills(runtime);
    const source = await listSkillSourceDirs(repoSkillsDir(runtime.repoRoot));
    for (const skill of source.sources) {
      const path = join(inspected.targetDir, skill.name);
      try {
        if ((await lstat(path)).isSymbolicLink() && resolve(dirname(path), await readlink(path)) === resolve(skill.path)) await unlink(path);
      } catch { /* Missing or foreign paths stay untouched. */ }
    }
    const fallback = await adapter.inspectFallback?.(runtime);
    if (fallback) {
      try {
        await lstat(fallback.path);
        await withClientConfigLock(fallback.path, async () => {
        const text = await readFile(fallback.path, "utf8");
        const next = text.replace(/<!-- GREYBEARD SKILLS START -->[\s\S]*?<!-- GREYBEARD SKILLS END -->\n?/gu, "");
        if (next !== text) await writeClientConfigAtomic(fallback.path, next);
        });
      } catch { /* Preserve unreadable user files. */ }
    }
  }
  if (!selected.length) {
    const appData = flagValue(_args, "app-data") || runtime.env.GREYBEARD_APP_DATA || getGreybeardAppDataPath();
    if (await readMemoryBinding(appData)) {
      const cleanup = await disconnectMemory(appData);
      if (!cleanup.revoked || !cleanup.credentialsRemoved) writeLine(runtime.stderr, "Shared memory disconnected locally. Server revocation or OS credential cleanup is still pending.");
    }
  }
  writeLine(runtime.stdout, "Removed recognized Greybeard integrations. Your memories and configuration remain available. You may now delete the executable.");
  return 0;
}
