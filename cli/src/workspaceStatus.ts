import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { readGreybeardConfig } from "@greybeard/graph";
import { detectAllClients, getClientAdapter, inspectClaudeMemoryHook, summarizeSkillWiring, extractTomlTable } from "./clients.js";
import { findExecutable, type CliRuntime } from "./runtime.js";
import { serverOptionsFromConfig, findCatalogServer, isGreybeardManagedEntry } from "./serverCatalog.js";

// Finder and Start-menu launches often inherit a smaller PATH than a terminal.
// Check known install locations without executing a shell or the discovered tool.
export function discoveryRuntime(runtime: CliRuntime): CliRuntime {
  const home = runtime.homeDir;
  const directories = runtime.platform === "win32"
    ? [join(runtime.env.APPDATA || join(home, "AppData", "Roaming"), "npm"), join(runtime.env.LOCALAPPDATA || join(home, "AppData", "Local"), "Microsoft", "WinGet", "Links"), join(home, ".local", "bin")]
    : [join(home, ".local", "bin"), join(home, ".npm-global", "bin"), join(home, ".volta", "bin"), join(home, ".nvm", "current", "bin"), "/opt/homebrew/bin", "/usr/local/bin"];
  return { ...runtime, findExecutable: async command => await runtime.findExecutable(command) || findExecutable(command, { ...runtime.env, PATH: directories.join(runtime.platform === "win32" ? ";" : ":") }, runtime.platform) };
}

export async function inspectWorkspace(runtime: CliRuntime, appDataPath: string) {
  const config = await readGreybeardConfig(appDataPath);
  const bound = { ...runtime, env: { ...runtime.env, GREYBEARD_APP_DATA: appDataPath, GREYBEARD_PROFILE_ID: config.profileId ?? "local", GREYBEARD_TENANT_ID: config.activeTenantId ?? "local" } };
  const clients = await detectAllClients(runtime);
  return Promise.all(clients.map(async client => {
    const adapter = getClientAdapter(client.name);
    const issues: string[] = [];
    let configured = false;
    let manualSkills = false;
    try {
      const mcp = await adapter.inspectMcpConfig(bound, serverOptionsFromConfig(config));
      configured = mcp.configured;
      if (!mcp.configured) issues.push(mcp.error ? "Could not read the tool configuration. Check its file permissions and format." : "Memory connection needs setup.");
      if (mcp.configured) {
        const text = await readFile(mcp.path, "utf8");
        const entry = client.name === "Codex CLI" ? extractTomlTable(text, "mcp_servers.greybeard-memory") : JSON.stringify(JSON.parse(text).mcpServers?.["greybeard-memory"]);
        if (!entry || !isGreybeardManagedEntry(findCatalogServer("greybeard-memory")!, entry, runtime.repoRoot)) issues.push("A different memory connection already uses Greybeard's name. Your existing entry was preserved; inspect it before replacing it.");
      }
      if (client.detected) {
        const skills = await adapter.inspectSkills(bound);
        manualSkills = skills.channel === "manual-zip";
        if (!manualSkills && !summarizeSkillWiring(skills).ok) issues.push("Some Greybeard skills are missing or blocked by existing files.");
        if (adapter.inspectFallback && !(await adapter.inspectFallback(bound)).configured) issues.push("Greybeard's tool instructions need setup.");
        if (adapter.ambientChannel === "memory-hook" && config.memoryHook !== false && !(await inspectClaudeMemoryHook(bound)).configured) issues.push("The advisory hook needs setup.");
      }
    } catch { issues.push("Could not inspect this integration. Run installation checks or try setup again."); }
    return { name: client.name, detected: client.detected, configured, ready: client.detected && configured && issues.length === 0, issues,
      configPath: client.userConfigPath, channel: adapter.ambientChannel, manualSkills,
      guidance: adapter.ambientChannel === "memory-hook" ? "Command advice and remembered lessons. Advice does not block commands."
        : adapter.ambientChannel === "none-manual" ? "Memory tools are available when requested. Skills need a separate manual import."
        : "Instructions and skills help this tool bring relevant lessons into your work.",
      warnings: client.warnings ?? [] };
  }));
}
