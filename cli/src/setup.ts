import { getGreybeardAppDataPath, readGreybeardConfig, updateGreybeardConfig, type GreybeardConfig } from "@greybeard/graph";
import { initializeMemoryDatabase } from "@greybeard/memory";
import { flagValue, flagValues, hasFlag, parseArgs, type ParsedArgs } from "./args.js";
import { detectAllClients, summarizeSkillWiring, wireAllClientSkills, writeAllClientMcpConfigs, writeAllClientSkillFallbacks, writeClaudeMemoryHook, removeClaudeMemoryHook, type ClientDetectionOptions, type ClientMcpConfigResult, type KnownClientName, type SkillFallbackResult, type SkillWireResult } from "./clients.js";
import { type CliRuntime, writeInfoLine, writeLine, writeStatusLine } from "./runtime.js";
import { hostForClient, writeAutomaticHooks, removeAutomaticHooks } from "./automaticHooks.js";
import { findCatalogServer, optionalCatalogServers, serverOptionsFromConfig } from "./serverCatalog.js";

export async function runSetup(args: ParsedArgs, runtime: CliRuntime): Promise<number> {
  if (hasFlag(args, "writes")) {
    writeLine(runtime.stderr, "Tenant writes are unavailable in Greybeard 0.1.");
    return 1;
  }
  if (hasFlag(args, "ui")) {
    const { runSetupUi } = await import("./setupUi.js");
    return runSetupUi(args, runtime);
  }
  const appDataPath = flagValue(args, "app-data") || runtime.env.GREYBEARD_APP_DATA || getGreybeardAppDataPath();
  const config = await readGreybeardConfig(appDataPath);
  const toggles = serverTogglesFromArgs(args, config.mcpServers);
  const requestedClients = flagValues(args, "client");
  if (requestedClients.some(name => name.toLowerCase() === "claude desktop") && !requestedClients.some(name => name.toLowerCase() === "claude code")) requestedClients.push("Claude Code");
  const clients = await detectAllClients(runtime, clientDetectionOptions(args, config));
  const names = new Map(clients.map(client => [client.name.toLowerCase(), client.name]));
  for (const name of requestedClients) {
    if (!names.has(name.toLowerCase())) throw new Error(`Unknown client: ${name}. Use the full client name, e.g. --client "Claude Code".`);
  }
  const detected = clients.filter(client => !hasFlag(args, "no-clients") && client.detected && (requestedClients.length === 0 || requestedClients.some(name => name.toLowerCase() === client.name.toLowerCase())));
  const mode = flagValue(args, "update-mode") ?? config.updateMode ?? "notify";
  if (!["automatic", "notify", "manual"].includes(mode)) throw new Error("--update-mode must be automatic, notify, or manual.");
  const updated = await updateGreybeardConfig(appDataPath, current => ({
    ...current,
    profileId: current.profileId ?? "local",
    learningEnabled: current.learningEnabled ?? true,
    updateMode: mode as "automatic" | "notify" | "manual",
    skillUpdate: "off",
    memoryHook: memoryHookFromArgs(args, current.memoryHook) ?? true,
    clients: clientsFromArgs(args, current.clients),
    mcpServers: { ...toggles, "greybeard-graph": Boolean(current.appOnlyProfile), "intuneautomation": false }
  }));
  initializeMemoryDatabase(appDataPath);
  const bound = { ...runtime, env: { ...runtime.env, GREYBEARD_APP_DATA: appDataPath, GREYBEARD_PROFILE_ID: updated.profileId, GREYBEARD_TENANT_ID: updated.activeTenantId ?? "local", GREYBEARD_CLIENT_ID: updated.appOnlyProfile?.clientId ?? "" } };
  writeLine(runtime.stdout, "Greybeard 0.1 - An IT mentor that learns how you work.");
  writeLine(runtime.stdout, "Local memory is ready. No tenant connection or model account is required for setup.");
  writeLine(runtime.stdout, "Your AI client supplies the model. Recalled context may add tokens; model-proposed lessons require your confirmation.");
  if (requestedClients.length || hasFlag(args, "no-clients")) {
    const deselected = clients.filter(client => !detected.some(selected => selected.name === client.name));
    if (deselected.length) {
      const { runUninstall } = await import("./uninstall.js");
      await runUninstall(parseArgs(["uninstall", ...deselected.flatMap(client => ["--client", client.name])]), { ...bound, stdout: { write: () => true } });
    }
  }
  const results = await writeAllClientMcpConfigs(bound, serverOptionsFromConfig(updated), detected);
  const skills = await wireAllClientSkills(bound, detected);
  const fallbacks = await writeAllClientSkillFallbacks(bound, detected);
  for (const client of detected) printClientLedgerLine({ runtime, client: client.name, mcp: results.find(r => r.client === client.name), skills: skills.find(r => r.client === client.name), fallback: fallbacks.find(r => r.client === client.name), verbose: hasFlag(args, "verbose") });
  const automaticHosts = [...new Set(detected.map(client => hostForClient(client.name)))];
  for (const host of automaticHosts) {
    if (host === "claude") { if (updated.memoryHook) await writeClaudeMemoryHook(bound); else await removeClaudeMemoryHook(bound); }
    else if (updated.memoryHook) await writeAutomaticHooks(bound,host);
    else await removeAutomaticHooks(bound,host);
  }
  if (detected.length === 0) writeLine(runtime.stdout, "No selected installed client detected. Install a supported client and rerun setup.");
  if (detected.length) writeLine(runtime.stdout, "Automatic mentoring hooks configured. Restart tools and approve Greybeard hooks where the host requires it. Claude Desktop automatic mentoring applies to Code mode; ordinary Chat remains MCP-assisted.");
  writeLine(runtime.stdout, `Updates: ${updated.updateMode}. Run greybeard update to check available releases.`);
  writeLine(runtime.stdout, "State an operating preference in your AI tool. Review proposed lessons with greybeard memory candidates.");
  return results.some(r => !r.configured) ? 1 : 0;
}

function printClientLedgerLine(params: {
  runtime: CliRuntime;
  client: KnownClientName;
  mcp: ClientMcpConfigResult | undefined;
  skills: SkillWireResult | undefined;
  fallback: SkillFallbackResult | undefined;
  verbose: boolean;
}): void {
  const configured: string[] = [];
  const problems: string[] = [];
  const notes: string[] = [];

  if (params.mcp) {
    if (params.mcp.configured) {
      configured.push("MCP servers");
      if (params.mcp.preservedServers && params.mcp.preservedServers.length > 0) {
        notes.push(`kept existing user-defined entries: ${params.mcp.preservedServers.join(", ")}`);
      }
    } else {
      problems.push(`MCP config failed: ${params.mcp.error ?? "unknown error"}`);
    }
  }

  if (params.skills) {
    if (params.skills.channel !== "manual-zip") {
      const summary = summarizeSkillWiring(params.skills);
      if (summary.ok) {
        configured.push(`${params.skills.entries.length} skills`);
      } else {
        problems.push(summary.detail);
      }
    }
  }

  if (params.fallback?.configured) {
    configured.push("context block");
  }

  const detail = [
    configured.length > 0 ? `${formatNameList(configured)} configured` : "",
    ...problems,
    ...notes
  ].filter((part) => part.length > 0).join("; ");
  writeStatusLine(params.runtime.stdout, problems.length === 0 ? "OK" : "WARN", params.client, detail);

  if (params.skills?.channel === "manual-zip") {
    writeInfoLine(params.runtime.stdout, "Skills", params.skills.manualInstruction ?? "manual ZIP upload required");
  }
  if (params.client === "Claude Desktop" && params.mcp?.configured) {
    writeInfoLine(params.runtime.stdout, "Restart", "fully quit and restart Claude Desktop to load the MCP config");
  }

  if (params.verbose) {
    if (params.mcp) {
      writeInfoLine(params.runtime.stdout, "MCP config", params.mcp.path);
    }

    if (params.skills && !params.skills.empty && params.skills.channel !== "manual-zip") {
      writeInfoLine(params.runtime.stdout, "Skills", params.skills.targetDir);
    }

    if (params.fallback) {
      writeInfoLine(params.runtime.stdout, "Context file", params.fallback.path);
    }
  }
}

export function formatNameList(names: readonly string[]): string {
  if (names.length <= 1) {
    return names[0] ?? "";
  }

  if (names.length === 2) {
    return `${names[0]} and ${names[1]}`;
  }

  return `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
}

function clientDetectionOptions(args: ParsedArgs, config: GreybeardConfig): ClientDetectionOptions {
  return {
    githubCopilot: hasFlag(args, "with-copilot") || config.clients?.githubCopilot === true
  };
}

function memoryHookFromArgs(args: ParsedArgs, current: boolean | undefined): boolean | undefined {
  if (hasFlag(args, "no-memory-hook")) {
    return false;
  }

  if (hasFlag(args, "memory-hook")) {
    return true;
  }

  return current;
}

function clientsFromArgs(
  args: ParsedArgs,
  current: GreybeardConfig["clients"]
): GreybeardConfig["clients"] {
  if (hasFlag(args, "with-copilot")) {
    return {
      ...current,
      githubCopilot: true
    };
  }

  return current;
}

function serverTogglesFromArgs(
  args: ParsedArgs,
  current: Record<string, boolean> | undefined
): Record<string, boolean> | undefined {
  const enable = flagValues(args, "enable-server");
  const disable = flagValues(args, "disable-server");
  if (enable.length === 0 && disable.length === 0) {
    return current;
  }

  const next = { ...current };
  for (const name of enable) {
    next[optionalServerName(name)] = true;
  }

  for (const name of disable) {
    next[optionalServerName(name)] = false;
  }

  return next;
}

function optionalServerName(name: string): string {
  const server = findCatalogServer(name);
  if (!server) {
    const available = optionalCatalogServers().map((candidate) => candidate.name);
    throw new Error(`Unknown MCP server: ${name}. Optional servers: ${available.join(", ") || "none"}.`);
  }

  if (server.required) {
    throw new Error(`${name} is a core Greybeard server and is always enabled.`);
  }

  return server.name;
}
