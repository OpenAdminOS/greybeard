import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { AutomaticMentorStore, memoryDbPath } from "@greybeard/memory";
import { inspectAutomaticHooks, hostForClient } from "./automaticHooks.js";
import { readGreybeardConfig } from "@greybeard/graph";
import { detectAllClients, getClientAdapter, summarizeSkillWiring, extractTomlTable } from "./clients.js";
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
  const activity = readAutomaticActivity(appDataPath,config.profileId ?? "local",config.activeTenantId ?? "local");
  const clients = await detectAllClients(runtime);
  return Promise.all(clients.map(async client => {
    const adapter = getClientAdapter(client.name);
    const issues: string[] = [];
    let configured = false;
    let memoryReady = false;
    let manualSkills = false;
    const automatic = await inspectAutomaticHooks(bound,hostForClient(client.name));
    try {
      const mcp = await adapter.inspectMcpConfig(bound, serverOptionsFromConfig(config));
      configured = mcp.configured;
      if (!mcp.configured) issues.push(mcp.error ? "Could not read the tool configuration. Check its file permissions and format." : "Memory connection needs setup.");
      if (mcp.configured) {
        const text = await readFile(mcp.path, "utf8");
        const entry = client.name === "Codex CLI" ? extractTomlTable(text, "mcp_servers.greybeard-memory") : JSON.stringify(JSON.parse(text).mcpServers?.["greybeard-memory"]);
        memoryReady = Boolean(entry && isGreybeardManagedEntry(findCatalogServer("greybeard-memory")!, entry, runtime.repoRoot));
        if (!memoryReady) issues.push("An existing memory connection could not be identified as managed by this installation. Your existing entry was preserved. Review the repair to back it up and reconnect.");
      }
      if (client.detected) {
        const skills = await adapter.inspectSkills(bound);
        manualSkills = skills.channel === "manual-zip";
        if (!manualSkills && !summarizeSkillWiring(skills).ok) {
          issues.push("Some Greybeard skills are missing or blocked by existing files.");
          for (const entry of skills.entries.filter(entry => entry.status === "blocked")) issues.push(`${entry.name}: ${entry.message ?? "Needs setup"} (${entry.target})`);
        }
        if (adapter.inspectFallback && !(await adapter.inspectFallback(bound)).configured) issues.push("Greybeard's tool instructions need setup.");
        if (config.memoryHook !== false && !automatic.configured) issues.push("Automatic mentoring hooks need setup.");
      }
    } catch { issues.push("Could not inspect this integration. Run installation checks or try setup again."); }
    const observed = activity.hosts.find(item => item.host === automatic.host);
    const latest = activity.recent.find(item => item.host === automatic.host);
    const mentoring = {...automatic, mode:client.name === "Claude Desktop" ? "Code mode automatic; Chat MCP-assisted" : automatic.host === "cursor" ? "Companion prompt advice and host tool context" : "Automatic prompt and tool context",
      status: config.learningEnabled === false || config.memoryHook === false ? "paused" : automatic.disabled ? "disabled-in-host" : !automatic.configured ? "not-configured" : latest?.status === "error" ? "error" : observed ? "observed" : "awaiting-event",
      lastSeen:observed?.lastSeen ?? null, eventsObserved:observed?.events ?? 0, contextBytes:observed?.contextBytes ?? 0};
    return { name: client.name, detected: client.detected, configured, memoryReady, mentoring, ready: client.detected && configured && issues.length === 0, issues,
      configPath: client.userConfigPath, channel: adapter.ambientChannel, manualSkills,
      guidance: client.name === "Claude Desktop" ? "Automatic mentoring in Code mode. Ordinary Chat uses MCP-assisted memory. Code shares the Claude Code integration."
        : automatic.host === "cursor" ? "Prompts trigger local companion advice. Supported tool results can receive context automatically."
        : "Automatic prompt checks, relevant advice and proposed lessons. Host approval may be needed once.",
      warnings: client.warnings ?? [] };
  }));
}

export function readAutomaticActivity(appData: string,profile: string,tenant: string): ReturnType<AutomaticMentorStore["summary"]> {
  if (!existsSync(memoryDbPath(appData))) return {hosts:[],recent:[],retentionDays:7,storesPrompts:false};
  const store = new AutomaticMentorStore(appData,profile,tenant);
  try { return store.summary(); }
  finally {store.close();}
}
