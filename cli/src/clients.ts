import { withClientConfigLock, writeClientConfigAtomic } from "./clientConfigFile.js";
import { lstat, mkdir, readFile, readdir, readlink, realpath, symlink, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { getGreybeardAppDataPath, type ServerPackageSource, type ServerUpdateMode } from "@greybeard/graph";
import { toPortablePath } from "./portablePath.js";
import { CliRuntime, runtimeCommand } from "./runtime.js";
import { HOST_MEMORY_GUIDANCE } from "./hostGuidance.js";
import {
  enabledCatalogServers,
  findCatalogServer,
  isGreybeardManagedEntry,
  SERVER_CATALOG,
  type CatalogServer
} from "./serverCatalog.js";

export const MEMORY_HOOK_REMINDER = "For Microsoft 365, Intune, or Entra tasks, call greybeard-memory recall before other work. When the admin confirms a durable correction, preference, or environment fact, call greybeard-memory remember with intent only.\n";

const GREYBEARD_BLOCK_START = "<!-- GREYBEARD SKILLS START -->";
const GREYBEARD_BLOCK_END = "<!-- GREYBEARD SKILLS END -->";

export type KnownClientName = "Claude Code" | "Claude Desktop" | "Cursor" | "Codex CLI" | "Gemini CLI" | "GitHub Copilot";

export type ClientDetectionOptions = {
  githubCopilot?: boolean;
};

export type ClientDetection = {
  name: KnownClientName;
  detected: boolean;
  binaryPath: string | null;
  userConfigPath: string;
  userConfigExists: boolean;
  userDirPath?: string;
  userDirExists?: boolean;
  detectionDetail?: string;
  warnings?: string[];
};

export type ClaudeDetection = ClientDetection & {
  name: "Claude Code";
};

export type ClientMcpConfigResult = {
  client: KnownClientName;
  path: string;
  configured: boolean;
  server?: unknown;
  error?: string;
  missingServers?: string[];
  preservedServers?: string[];
};

export type ClaudeMcpConfigResult = Omit<ClientMcpConfigResult, "client">;

export type ClaudeMemoryHookResult = {
  path: string;
  configured: boolean;
  status: "installed" | "already-configured" | "updated";
};

export type ClaudeMemoryHookInspection = {
  path: string;
  configured: boolean;
};

export type SkillWireEntry = {
  name: string;
  source: string;
  target: string;
  status: "linked" | "already-linked" | "replaced-stale-symlink" | "blocked";
  message?: string;
};

export type SkillWireResult = {
  client?: KnownClientName;
  sourceDir: string;
  targetDir: string;
  empty: boolean;
  entries: SkillWireEntry[];
  channel?: "filesystem" | "manual-zip";
  manualInstruction?: string;
};

export type SkillFallbackResult = {
  client: KnownClientName;
  path: string;
  configured: boolean;
  status: "installed" | "already-configured" | "updated" | "missing";
};

export type ServerConfigOptions = {
  serverUpdate?: ServerUpdateMode;
  serverPackageSource?: ServerPackageSource;
  serverToggles?: Record<string, boolean>;
};

export type InspectServerOptions = {
  serverToggles?: Record<string, boolean>;
};

export type ClientAmbientChannel = "memory-hook" | "context-block" | "none-manual";

export type ClientAdapter = {
  detect: (runtime: CliRuntime, options?: ClientDetectionOptions) => Promise<ClientDetection>;
  writeMcpConfig: (runtime: CliRuntime, options?: ServerConfigOptions) => Promise<ClientMcpConfigResult>;
  inspectMcpConfig: (runtime: CliRuntime, options?: InspectServerOptions) => Promise<ClientMcpConfigResult>;
  wireSkills: (runtime: CliRuntime) => Promise<SkillWireResult>;
  inspectSkills: (runtime: CliRuntime) => Promise<SkillWireResult>;
  writeFallback: ((runtime: CliRuntime) => Promise<SkillFallbackResult>) | null;
  inspectFallback: ((runtime: CliRuntime) => Promise<SkillFallbackResult>) | null;
  ambientChannel: ClientAmbientChannel;
};

type StdioServerDefinition = {
  command: string;
  args: string[];
  env: Record<string, string>;
};

export async function detectClaudeCode(runtime: CliRuntime): Promise<ClaudeDetection> {
  const configPath = claudeConfigPath(runtime.homeDir, runtime.env.CLAUDE_CONFIG_DIR);
  const [binaryPath, configSignal] = await Promise.all([
    runtime.findExecutable("claude"),
    claudeConfigDetectionSignal(configPath)
  ]);
  return {
    name: "Claude Code",
    detected: Boolean(binaryPath || configSignal),
    binaryPath,
    userConfigPath: configPath,
    userConfigExists: configSignal
  };
}

export async function detectCursor(runtime: CliRuntime): Promise<ClientDetection> {
  const appPath = cursorAppPath(runtime);
  const configPath = cursorMcpConfigPath(runtime.homeDir);
  const [binaryPath, appExists, configExists] = await Promise.all([
    runtime.findExecutable("cursor"),
    appPath ? fileExists(appPath) : Promise.resolve(false),
    fileExists(configPath)
  ]);
  return {
    name: "Cursor",
    detected: Boolean(binaryPath || appExists),
    binaryPath,
    userConfigPath: configPath,
    userConfigExists: configExists,
    ...(appExists ? { detectionDetail: `installed app at ${appPath}` } : {})
  };
}

export async function detectClaudeDesktop(runtime: CliRuntime): Promise<ClientDetection> {
  const configPath = claudeDesktopConfigPath(runtime);
  const appPath = claudeDesktopAppPath(runtime);
  const msixPackageDirs = await claudeDesktopMsixPackageDirs(runtime);
  const [appExists, configSignal] = await Promise.all([
    appPath ? fileExists(appPath) : Promise.resolve(false),
    jsonConfigDetectionSignal(configPath)
  ]);
  const msixDetected = msixPackageDirs.length > 0;
  const warnings = msixDetected
    ? [
      "Claude Desktop MSIX package detected. Greybeard uses %APPDATA%/Claude/claude_desktop_config.json because that is the config Claude Desktop reads; the MSIX redirected config may differ."
    ]
    : undefined;
  return {
    name: "Claude Desktop",
    detected: Boolean(appExists || configSignal || msixDetected),
    binaryPath: null,
    userConfigPath: configPath,
    userConfigExists: configSignal,
    ...(appPath ? { userDirPath: appPath, userDirExists: appExists } : {}),
    ...(appExists ? { detectionDetail: `installed app at ${appPath}` } : {}),
    ...(warnings ? { warnings } : {})
  };
}

export async function detectCodexCli(runtime: CliRuntime): Promise<ClientDetection> {
  const authPath = codexAuthPath(runtime.homeDir, runtime.env.CODEX_HOME);
  const configPath = codexConfigPath(runtime.homeDir, runtime.env.CODEX_HOME);
  const [binaryPath, authExists, configExists] = await Promise.all([
    runtime.findExecutable("codex"),
    fileExists(authPath),
    fileExists(configPath)
  ]);
  return {
    name: "Codex CLI",
    detected: Boolean(binaryPath || authExists),
    binaryPath,
    userConfigPath: configPath,
    userConfigExists: configExists,
    ...(authExists ? { detectionDetail: "Codex account configuration present" } : {})
  };
}

export async function detectGeminiCli(runtime: CliRuntime): Promise<ClientDetection> {
  // ~/.gemini is shared by unrelated Google tooling, so only the CLI binary is a reliable signal.
  const binaryPath = await runtime.findExecutable("gemini");
  return {
    name: "Gemini CLI",
    detected: Boolean(binaryPath),
    binaryPath,
    userConfigPath: geminiSettingsPath(runtime.homeDir),
    userConfigExists: false
  };
}

export async function detectGithubCopilot(
  runtime: CliRuntime,
  options: ClientDetectionOptions = {}
): Promise<ClientDetection> {
  // ~/.copilot is shared across Copilot surfaces and Greybeard writes files there, so it is not a detection signal.
  const binaryPath = await runtime.findExecutable("copilot");
  const forced = options.githubCopilot === true;
  return {
    name: "GitHub Copilot",
    detected: Boolean(binaryPath || forced),
    binaryPath,
    userConfigPath: copilotMcpConfigPath(runtime.homeDir),
    userConfigExists: false,
    detectionDetail: binaryPath ? "copilot on PATH" : forced ? "opted in by Greybeard config" : undefined
  };
}

export async function detectAllClients(
  runtime: CliRuntime,
  options: ClientDetectionOptions = {}
): Promise<ClientDetection[]> {
  return Promise.all(clientNames().map((client) => CLIENT_ADAPTERS[client].detect(runtime, options)));
}

export function claudeConfigPath(homeDir: string, configDir?: string): string {
  return configDir ? join(configDir, ".claude.json") : join(homeDir, ".claude.json");
}

export function claudeSettingsPath(homeDir: string, configDir?: string): string {
  return join(configDir || join(homeDir, ".claude"), "settings.json");
}

export function claudeDesktopConfigPath(runtime: Pick<CliRuntime, "env" | "homeDir" | "platform">): string {
  if (runtime.platform === "win32") {
    // The MSIX build can expose a redirected config path (anthropics/claude-code#26073).
    // If both exist, prefer %APPDATA%/Claude because that is the file Claude Desktop reads.
    const appData = runtime.env.APPDATA || join(runtime.homeDir, "AppData", "Roaming");
    return join(appData, "Claude", "claude_desktop_config.json");
  }

  return join(runtime.homeDir, "Library", "Application Support", "Claude", "claude_desktop_config.json");
}

export function claudeSkillsDir(homeDir: string, configDir?: string): string {
  return join(configDir || join(homeDir, ".claude"), "skills");
}

export function claudeFallbackPath(homeDir: string, configDir?: string): string {
  return join(configDir || join(homeDir, ".claude"), "CLAUDE.md");
}

export function cursorMcpConfigPath(homeDir: string): string {
  return join(homeDir, ".cursor", "mcp.json");
}

export function cursorSkillsDir(homeDir: string): string {
  return join(homeDir, ".cursor", "skills");
}

export function cursorFallbackPath(homeDir: string): string {
  return join(homeDir, ".cursor", "rules", "greybeard.mdc");
}

export function codexConfigPath(homeDir: string, configDir?: string): string {
  return join(configDir || join(homeDir, ".codex"), "config.toml");
}

export function codexAuthPath(homeDir: string, configDir?: string): string {
  return join(configDir || join(homeDir, ".codex"), "auth.json");
}

export function codexSkillsDir(homeDir: string): string {
  return join(homeDir, ".agents", "skills");
}

export function codexFallbackPath(homeDir: string, configDir?: string): string {
  return join(configDir || join(homeDir, ".codex"), "AGENTS.md");
}

export function geminiSettingsPath(homeDir: string): string {
  return join(homeDir, ".gemini", "settings.json");
}

export function geminiSkillsDir(homeDir: string): string {
  return join(homeDir, ".gemini", "skills");
}

export function geminiFallbackPath(homeDir: string): string {
  return join(homeDir, ".gemini", "GEMINI.md");
}

export function copilotMcpConfigPath(homeDir: string): string {
  return join(homeDir, ".copilot", "mcp-config.json");
}

export function copilotSkillsDir(homeDir: string): string {
  return join(homeDir, ".copilot", "skills");
}

export function copilotFallbackPath(homeDir: string): string {
  return join(homeDir, ".copilot", "copilot-instructions.md");
}

export function repoSkillsDir(repoRoot: string): string {
  return join(repoRoot, ".agents", "skills");
}

export async function writeClaudeMcpConfig(
  runtime: CliRuntime,
  options: ServerConfigOptions = {}
): Promise<ClaudeMcpConfigResult> {
  const result = await writeJsonMcpConfig({
    runtime,
    client: "Claude Code",
    configPath: claudeConfigPath(runtime.homeDir, runtime.env.CLAUDE_CONFIG_DIR),
    shape: "stdio",
    options
  });
  return withoutClient(result);
}

export async function inspectClaudeMcpConfig(
  runtime: CliRuntime,
  options: InspectServerOptions = {}
): Promise<ClaudeMcpConfigResult> {
  const result = await inspectJsonMcpConfig("Claude Code", claudeConfigPath(runtime.homeDir, runtime.env.CLAUDE_CONFIG_DIR), options);
  return withoutClient(result);
}

export async function writeCursorMcpConfig(
  runtime: CliRuntime,
  options: ServerConfigOptions = {}
): Promise<ClientMcpConfigResult> {
  return writeJsonMcpConfig({
    runtime,
    client: "Cursor",
    configPath: cursorMcpConfigPath(runtime.homeDir),
    shape: "plain",
    options
  });
}

export async function inspectCursorMcpConfig(
  runtime: CliRuntime,
  options: InspectServerOptions = {}
): Promise<ClientMcpConfigResult> {
  return inspectJsonMcpConfig("Cursor", cursorMcpConfigPath(runtime.homeDir), options);
}

export async function writeClaudeDesktopMcpConfig(
  runtime: CliRuntime,
  options: ServerConfigOptions = {}
): Promise<ClientMcpConfigResult> {
  return writeJsonMcpConfig({
    runtime,
    client: "Claude Desktop",
    configPath: claudeDesktopConfigPath(runtime),
    shape: "plain",
    options
  });
}

export async function inspectClaudeDesktopMcpConfig(
  runtime: CliRuntime,
  options: InspectServerOptions = {}
): Promise<ClientMcpConfigResult> {
  return inspectJsonMcpConfig("Claude Desktop", claudeDesktopConfigPath(runtime), options);
}

export async function writeGeminiMcpConfig(
  runtime: CliRuntime,
  options: ServerConfigOptions = {}
): Promise<ClientMcpConfigResult> {
  return writeJsonMcpConfig({
    runtime,
    client: "Gemini CLI",
    configPath: geminiSettingsPath(runtime.homeDir),
    shape: "plain",
    options
  });
}

export async function inspectGeminiMcpConfig(
  runtime: CliRuntime,
  options: InspectServerOptions = {}
): Promise<ClientMcpConfigResult> {
  return inspectJsonMcpConfig("Gemini CLI", geminiSettingsPath(runtime.homeDir), options);
}

export async function writeCopilotMcpConfig(
  runtime: CliRuntime,
  options: ServerConfigOptions = {}
): Promise<ClientMcpConfigResult> {
  return writeJsonMcpConfig({
    runtime,
    client: "GitHub Copilot",
    configPath: copilotMcpConfigPath(runtime.homeDir),
    shape: "copilot-local",
    options
  });
}

export async function inspectCopilotMcpConfig(
  runtime: CliRuntime,
  options: InspectServerOptions = {}
): Promise<ClientMcpConfigResult> {
  return inspectJsonMcpConfig("GitHub Copilot", copilotMcpConfigPath(runtime.homeDir), options);
}

export async function writeCodexMcpConfig(
  runtime: CliRuntime,
  options: ServerConfigOptions = {}
): Promise<ClientMcpConfigResult> {
  const configPath = codexConfigPath(runtime.homeDir, runtime.env.CODEX_HOME);
  const servers = await enabledServerDefinitions(runtime, options);
  return withClientConfigLock(configPath, async () => {
  const current = await readTextFile(configPath);
  const preserved: string[] = [];
  const replaceable = SERVER_CATALOG.filter((server) => {
    const table = extractTomlTable(current, `mcp_servers.${server.name}`);
    if (table !== null && !isGreybeardManagedEntry(server, table, runtime.repoRoot)) {
      preserved.push(server.name);
      return false;
    }

    return true;
  });
  const cleaned = replaceable
    .reduce((text, server) => removeTomlTable(text, `mcp_servers.${server.name}`), current)
    .trimEnd();
  const preservedNames = new Set(preserved);
  const block = servers
    .filter((server) => !preservedNames.has(server.name))
    .map((server) => tomlServerBlock(server.name, server.definition))
    .join("\n");
  const next = block.length === 0
    ? `${cleaned}\n`
    : cleaned.length > 0 ? `${cleaned}\n\n${block}\n` : `${block}\n`;
  await writeTextFile(configPath, next);
  return {
    client: "Codex CLI",
    path: configPath,
    configured: true,
    server: Object.fromEntries(servers.map((server) => [server.name, server.definition])),
    ...(preserved.length > 0 ? { preservedServers: preserved } : {})
  };
  });
}

export async function inspectCodexMcpConfig(
  runtime: CliRuntime,
  options: InspectServerOptions = {}
): Promise<ClientMcpConfigResult> {
  const path = codexConfigPath(runtime.homeDir, runtime.env.CODEX_HOME);
  try {
    const text = await readTextFile(path);
    const missing = enabledCatalogServers(options.serverToggles)
      .filter((server) => !hasTomlTable(text, `mcp_servers.${server.name}`))
      .map((server) => server.name);
    return {
      client: "Codex CLI",
      path,
      configured: missing.length === 0,
      ...(missing.length > 0 ? { missingServers: missing } : {})
    };
  } catch (error) {
    return {
      client: "Codex CLI",
      path,
      configured: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function writeAllClientMcpConfigs(
  runtime: CliRuntime,
  options: ServerConfigOptions = {},
  clients?: readonly ClientDetection[]
): Promise<ClientMcpConfigResult[]> {
  return Promise.all(clientNames(clients).map((client) => writeClientMcpConfig(runtime, client, options)));
}

export async function writeClientMcpConfig(
  runtime: CliRuntime,
  client: KnownClientName,
  options: ServerConfigOptions = {}
): Promise<ClientMcpConfigResult> {
  return CLIENT_ADAPTERS[client].writeMcpConfig(runtime, options);
}

function pruneClaudeMemoryHooks(root: Record<string, unknown>, runtime: CliRuntime): void {
  const hooks = isObject(root.hooks) ? root.hooks : {};
  for (const event of ["UserPromptSubmit", "PreToolUse"]) {
    if (!Array.isArray(hooks[event])) continue;
    hooks[event] = hooks[event].flatMap((group: unknown) => {
      if (!isObject(group) || !Array.isArray(group.hooks)) return [group];
      const kept = group.hooks.filter(candidate => !isGreybeardMemoryHookHandler(candidate, runtime));
      return kept.length ? [{ ...group, hooks: kept }] : [];
    });
  }
  root.hooks = hooks;
}

export async function removeClaudeMemoryHook(runtime: CliRuntime): Promise<void> {
  const path = claudeSettingsPath(runtime.homeDir, runtime.env.CLAUDE_CONFIG_DIR);
  try { await lstat(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  await withClientConfigLock(path, async () => {
    const root = await readJsonObject(path);
    pruneClaudeMemoryHooks(root, runtime);
    await writeJsonObject(path, root);
  });
}

export async function writeClaudeMemoryHook(runtime: CliRuntime): Promise<ClaudeMemoryHookResult> {
  const path = claudeSettingsPath(runtime.homeDir, runtime.env.CLAUDE_CONFIG_DIR);
  return withClientConfigLock(path, async () => {
  const root = await readJsonObject(path);
  pruneClaudeMemoryHooks(root, runtime);
  const hooks = isObject(root.hooks) ? root.hooks : {};
  const existing = Array.isArray(hooks.PreToolUse) ? hooks.PreToolUse : [];
  const invocation = runtimeCommand(runtime, ["mentor", "pre-tool", "--app-data", runtime.env.GREYBEARD_APP_DATA || getGreybeardAppDataPath(), "--profile", runtime.env.GREYBEARD_PROFILE_ID || "local", "--tenant", runtime.env.GREYBEARD_TENANT_ID || "local", "--greybeard-owned-hook=0.1"]);
  const quote = runtime.platform === "win32"
    ? (value: string) => { if (/[\r\n%!"]/u.test(value)) throw new Error("Unsupported character in Windows hook path."); return `"${value}"`; }
    : (value: string) => "'" + value.replace(/'/gu, "'\\''") + "'";
  existing.push({ matcher: "Bash", hooks: [{ type: "command", command: [invocation.command, ...invocation.args].map(quote).join(" "), timeout: 5 }] });
  hooks.PreToolUse = existing;
  root.hooks = hooks;
  await writeJsonObject(path, root);
  return { path, configured: true, status: "installed" };
  });
}

export async function inspectClaudeMemoryHook(runtime: CliRuntime): Promise<ClaudeMemoryHookInspection> {
  const path = claudeSettingsPath(runtime.homeDir, runtime.env.CLAUDE_CONFIG_DIR);
  try {
    const root = await readJsonObject(path);
    const hooks = isObject(root.hooks) ? root.hooks : {};
    const promptSubmit = Array.isArray(hooks.PreToolUse) ? hooks.PreToolUse : [];
    const configured = promptSubmit.some((group) =>
      isObject(group) && Array.isArray(group.hooks) && group.hooks.some(candidate => isGreybeardMemoryHookHandler(candidate, runtime)));
    return {
      path,
      configured
    };
  } catch {
    return {
      path,
      configured: false
    };
  }
}

export async function wireClaudeSkills(runtime: CliRuntime): Promise<SkillWireResult> {
  return wireSkillsToDir(runtime, "Claude Code", claudeSkillsDir(runtime.homeDir, runtime.env.CLAUDE_CONFIG_DIR));
}

export async function inspectClaudeSkillWiring(runtime: CliRuntime): Promise<SkillWireResult> {
  return inspectSkillsInDir(runtime, "Claude Code", claudeSkillsDir(runtime.homeDir, runtime.env.CLAUDE_CONFIG_DIR));
}

export async function wireClaudeDesktopSkills(runtime: CliRuntime): Promise<SkillWireResult> {
  return claudeDesktopManualSkills(runtime);
}

export async function inspectClaudeDesktopSkillWiring(runtime: CliRuntime): Promise<SkillWireResult> {
  return claudeDesktopManualSkills(runtime);
}

export async function wireCursorSkills(runtime: CliRuntime): Promise<SkillWireResult> {
  return wireSkillsToDir(runtime, "Cursor", cursorSkillsDir(runtime.homeDir));
}

export async function inspectCursorSkillWiring(runtime: CliRuntime): Promise<SkillWireResult> {
  return inspectSkillsInDir(runtime, "Cursor", cursorSkillsDir(runtime.homeDir));
}

export async function wireCodexSkills(runtime: CliRuntime): Promise<SkillWireResult> {
  return wireSkillsToDir(runtime, "Codex CLI", codexSkillsDir(runtime.homeDir));
}

export async function inspectCodexSkillWiring(runtime: CliRuntime): Promise<SkillWireResult> {
  return inspectSkillsInDir(runtime, "Codex CLI", codexSkillsDir(runtime.homeDir));
}

export async function wireGeminiSkills(runtime: CliRuntime): Promise<SkillWireResult> {
  return wireSkillsToDir(runtime, "Gemini CLI", geminiSkillsDir(runtime.homeDir));
}

export async function inspectGeminiSkillWiring(runtime: CliRuntime): Promise<SkillWireResult> {
  return inspectSkillsInDir(runtime, "Gemini CLI", geminiSkillsDir(runtime.homeDir));
}

export async function wireCopilotSkills(runtime: CliRuntime): Promise<SkillWireResult> {
  return wireSkillsToDir(runtime, "GitHub Copilot", copilotSkillsDir(runtime.homeDir));
}

export async function inspectCopilotSkillWiring(runtime: CliRuntime): Promise<SkillWireResult> {
  return inspectSkillsInDir(runtime, "GitHub Copilot", copilotSkillsDir(runtime.homeDir));
}

export async function wireAllClientSkills(
  runtime: CliRuntime,
  clients?: readonly ClientDetection[]
): Promise<SkillWireResult[]> {
  return Promise.all(clientNames(clients).map((client) => wireClientSkills(runtime, client)));
}

export async function wireClientSkills(runtime: CliRuntime, client: KnownClientName): Promise<SkillWireResult> {
  return CLIENT_ADAPTERS[client].wireSkills(runtime);
}

export async function writeCodexSkillFallback(runtime: CliRuntime): Promise<SkillFallbackResult> {
  return writeSkillFallbackBlock("Codex CLI", codexFallbackPath(runtime.homeDir, runtime.env.CODEX_HOME), repoSkillsDir(runtime.repoRoot));
}

export async function writeClaudeSkillFallback(runtime: CliRuntime): Promise<SkillFallbackResult> {
  return writeSkillFallbackBlock("Claude Code", claudeFallbackPath(runtime.homeDir, runtime.env.CLAUDE_CONFIG_DIR), repoSkillsDir(runtime.repoRoot));
}

export async function inspectClaudeSkillFallback(runtime: CliRuntime): Promise<SkillFallbackResult> {
  return inspectSkillFallbackBlock("Claude Code", claudeFallbackPath(runtime.homeDir, runtime.env.CLAUDE_CONFIG_DIR));
}

export async function inspectCodexSkillFallback(runtime: CliRuntime): Promise<SkillFallbackResult> {
  return inspectSkillFallbackBlock("Codex CLI", codexFallbackPath(runtime.homeDir, runtime.env.CODEX_HOME));
}

export async function writeGeminiSkillFallback(runtime: CliRuntime): Promise<SkillFallbackResult> {
  return writeSkillFallbackBlock("Gemini CLI", geminiFallbackPath(runtime.homeDir), repoSkillsDir(runtime.repoRoot));
}

export async function inspectGeminiSkillFallback(runtime: CliRuntime): Promise<SkillFallbackResult> {
  return inspectSkillFallbackBlock("Gemini CLI", geminiFallbackPath(runtime.homeDir));
}

export async function writeCursorSkillFallback(runtime: CliRuntime): Promise<SkillFallbackResult> {
  return writeSkillFallbackBlock(
    "Cursor",
    cursorFallbackPath(runtime.homeDir),
    repoSkillsDir(runtime.repoRoot),
    ensureCursorRuleHeader
  );
}

export async function inspectCursorSkillFallback(runtime: CliRuntime): Promise<SkillFallbackResult> {
  return inspectSkillFallbackBlock("Cursor", cursorFallbackPath(runtime.homeDir));
}

export async function writeCopilotSkillFallback(runtime: CliRuntime): Promise<SkillFallbackResult> {
  return writeSkillFallbackBlock("GitHub Copilot", copilotFallbackPath(runtime.homeDir), repoSkillsDir(runtime.repoRoot));
}

export async function inspectCopilotSkillFallback(runtime: CliRuntime): Promise<SkillFallbackResult> {
  return inspectSkillFallbackBlock("GitHub Copilot", copilotFallbackPath(runtime.homeDir));
}

export async function writeClientSkillFallback(
  runtime: CliRuntime,
  client: KnownClientName
): Promise<SkillFallbackResult | null> {
  return CLIENT_ADAPTERS[client].writeFallback?.(runtime) ?? null;
}

export async function writeAllClientSkillFallbacks(
  runtime: CliRuntime,
  clients?: readonly ClientDetection[]
): Promise<SkillFallbackResult[]> {
  const results = await Promise.all(clientNames(clients).map((client) => writeClientSkillFallback(runtime, client)));
  return results.filter((result): result is SkillFallbackResult => result !== null);
}

export const CLIENT_ADAPTERS: Record<KnownClientName, ClientAdapter> = {
  "Claude Code": {
    detect: detectClaudeCode,
    writeMcpConfig: async (runtime, options) => ({
      client: "Claude Code",
      ...await writeClaudeMcpConfig(runtime, options)
    }),
    inspectMcpConfig: async (runtime, options) => ({
      client: "Claude Code",
      ...await inspectClaudeMcpConfig(runtime, options)
    }),
    wireSkills: wireClaudeSkills,
    inspectSkills: inspectClaudeSkillWiring,
    writeFallback: writeClaudeSkillFallback,
    inspectFallback: inspectClaudeSkillFallback,
    ambientChannel: "memory-hook"
  },
  "Claude Desktop": {
    detect: detectClaudeDesktop,
    writeMcpConfig: writeClaudeDesktopMcpConfig,
    inspectMcpConfig: inspectClaudeDesktopMcpConfig,
    wireSkills: wireClaudeDesktopSkills,
    inspectSkills: inspectClaudeDesktopSkillWiring,
    writeFallback: null,
    inspectFallback: null,
    ambientChannel: "none-manual"
  },
  Cursor: {
    detect: detectCursor,
    writeMcpConfig: writeCursorMcpConfig,
    inspectMcpConfig: inspectCursorMcpConfig,
    wireSkills: wireCursorSkills,
    inspectSkills: inspectCursorSkillWiring,
    writeFallback: writeCursorSkillFallback,
    inspectFallback: inspectCursorSkillFallback,
    ambientChannel: "context-block"
  },
  "Codex CLI": {
    detect: detectCodexCli,
    writeMcpConfig: writeCodexMcpConfig,
    inspectMcpConfig: inspectCodexMcpConfig,
    wireSkills: wireCodexSkills,
    inspectSkills: inspectCodexSkillWiring,
    writeFallback: writeCodexSkillFallback,
    inspectFallback: inspectCodexSkillFallback,
    ambientChannel: "context-block"
  },
  "Gemini CLI": {
    detect: detectGeminiCli,
    writeMcpConfig: writeGeminiMcpConfig,
    inspectMcpConfig: inspectGeminiMcpConfig,
    wireSkills: wireGeminiSkills,
    inspectSkills: inspectGeminiSkillWiring,
    writeFallback: writeGeminiSkillFallback,
    inspectFallback: inspectGeminiSkillFallback,
    ambientChannel: "context-block"
  },
  "GitHub Copilot": {
    detect: detectGithubCopilot,
    writeMcpConfig: writeCopilotMcpConfig,
    inspectMcpConfig: inspectCopilotMcpConfig,
    wireSkills: wireCopilotSkills,
    inspectSkills: inspectCopilotSkillWiring,
    writeFallback: writeCopilotSkillFallback,
    inspectFallback: inspectCopilotSkillFallback,
    ambientChannel: "context-block"
  }
};

export function getClientAdapter(client: KnownClientName): ClientAdapter {
  return CLIENT_ADAPTERS[client];
}

function clientNames(clients?: readonly ClientDetection[]): KnownClientName[] {
  if (!clients) {
    return Object.keys(CLIENT_ADAPTERS) as KnownClientName[];
  }

  return clients
    .filter((client) => client.detected)
    .map((client) => client.name);
}

function cursorAppPath(runtime: CliRuntime): string | null {
  if (runtime.platform === "darwin") {
    return "/Applications/Cursor.app";
  }

  if (runtime.platform === "win32" && runtime.env.LOCALAPPDATA) {
    return join(runtime.env.LOCALAPPDATA, "Programs", "cursor");
  }

  return null;
}

function claudeDesktopAppPath(runtime: CliRuntime): string | null {
  if (runtime.platform === "darwin") {
    return runtime.env.GREYBEARD_CLAUDE_DESKTOP_APP || "/Applications/Claude.app";
  }

  if (runtime.platform === "win32" && runtime.env.LOCALAPPDATA) {
    return runtime.env.GREYBEARD_CLAUDE_DESKTOP_APP
      || join(runtime.env.LOCALAPPDATA, "Programs", "Claude", "Claude.exe");
  }

  return runtime.env.GREYBEARD_CLAUDE_DESKTOP_APP || null;
}

async function claudeDesktopMsixPackageDirs(runtime: CliRuntime): Promise<string[]> {
  if (runtime.platform !== "win32" || !runtime.env.LOCALAPPDATA) {
    return [];
  }

  const packagesDir = join(runtime.env.LOCALAPPDATA, "Packages");
  try {
    const entries = await readdir(packagesDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && isClaudeDesktopMsixPackage(entry.name))
      .map((entry) => join(packagesDir, entry.name));
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

function isClaudeDesktopMsixPackage(name: string): boolean {
  return /^(?:AnthropicPBC\.)?Claude_/iu.test(name)
    || (/claude/iu.test(name) && /anthropic/iu.test(name));
}

async function claudeConfigDetectionSignal(path: string): Promise<boolean> {
  if (!await fileExists(path)) {
    return false;
  }

  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!isObject(parsed)) {
      return true;
    }

    const rootKeys = Object.keys(parsed);
    const servers = isObject(parsed.mcpServers) ? parsed.mcpServers : {};
    const serverNames = Object.keys(servers);
    if (!rootKeys.includes("mcpServers") || rootKeys.some((key) => key !== "mcpServers") || serverNames.length === 0) {
      return true;
    }

    const catalogNames = new Set(SERVER_CATALOG.map((server) => server.name));
    return serverNames.some((name) => !catalogNames.has(name));
  } catch {
    return true;
  }
}

async function jsonConfigDetectionSignal(path: string): Promise<boolean> {
  if (!await fileExists(path)) {
    return false;
  }

  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!isObject(parsed)) {
      return true;
    }

    if (Object.keys(parsed).some((key) => key !== "mcpServers")) {
      return true;
    }

    const servers = isObject(parsed.mcpServers) ? parsed.mcpServers : {};
    return Object.entries(servers).some(([name, entry]) => {
      const catalogServer = findCatalogServer(name);
      return !catalogServer || isForeignJsonServerEntry(catalogServer, entry);
    });
  } catch {
    return true;
  }
}

async function writeJsonMcpConfig(params: {
  runtime: CliRuntime;
  client: KnownClientName;
  configPath: string;
  shape: "plain" | "stdio" | "copilot-local";
  options: ServerConfigOptions;
}): Promise<ClientMcpConfigResult> {
  return withClientConfigLock(params.configPath, async () => {
  const root = await readJsonObject(params.configPath);
  const mcpServers = isObject(root.mcpServers) ? root.mcpServers : {};
  const servers = await enabledServerDefinitions(params.runtime, params.options);
  const enabledNames = new Set(servers.map((server) => server.name));
  const preserved: string[] = [];
  for (const server of SERVER_CATALOG) {
    const existing = mcpServers[server.name];
    if (enabledNames.has(server.name) || existing === undefined) {
      continue;
    }

    if (isForeignJsonServerEntry(server, existing, params.runtime.repoRoot)) {
      preserved.push(server.name);
    } else {
      delete mcpServers[server.name];
    }
  }

  const written: Record<string, unknown> = {};
  for (const server of servers) {
    const catalogServer = findCatalogServer(server.name);
    const existing = mcpServers[server.name];
    if (catalogServer && existing !== undefined && isForeignJsonServerEntry(catalogServer, existing, params.runtime.repoRoot)) {
      preserved.push(server.name);
      written[server.name] = existing;
      continue;
    }

    const value = jsonServerDefinition(server.definition, params.shape);
    mcpServers[server.name] = value;
    written[server.name] = value;
  }

  root.mcpServers = mcpServers;
  await writeJsonObject(params.configPath, root);
  return {
    client: params.client,
    path: params.configPath,
    configured: true,
    server: written,
    ...(preserved.length > 0 ? { preservedServers: preserved } : {})
  };
  });
}

function isForeignJsonServerEntry(server: CatalogServer, entry: unknown, repoRoot?: string): boolean {
  return !isObject(entry) || !isGreybeardManagedEntry(server, JSON.stringify(entry), repoRoot);
}

async function inspectJsonMcpConfig(
  client: KnownClientName,
  path: string,
  options: InspectServerOptions = {}
): Promise<ClientMcpConfigResult> {
  try {
    const root = await readJsonObject(path);
    const mcpServers = isObject(root.mcpServers) ? root.mcpServers : {};
    const server: Record<string, unknown> = {};
    const missing: string[] = [];
    for (const catalogServer of enabledCatalogServers(options.serverToggles)) {
      const entry = mcpServers[catalogServer.name];
      server[catalogServer.name] = entry;
      if (!isObject(entry)) {
        missing.push(catalogServer.name);
      }
    }

    return {
      client,
      path,
      configured: missing.length === 0,
      server,
      ...(missing.length > 0 ? { missingServers: missing } : {})
    };
  } catch (error) {
    return {
      client,
      path,
      configured: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

type NamedServerDefinition = {
  name: string;
  definition: StdioServerDefinition;
};

async function enabledServerDefinitions(
  runtime: CliRuntime,
  options: ServerConfigOptions
): Promise<NamedServerDefinition[]> {
  return Promise.all(enabledCatalogServers(options.serverToggles).map(async (server) => ({
    name: server.name,
    definition: await serverDefinition(runtime, server, options)
  })));
}

async function serverDefinition(
  runtime: CliRuntime,
  server: CatalogServer,
  options: ServerConfigOptions
): Promise<StdioServerDefinition> {
  // Third-party servers have no local build in this repo, so they always run from npm.
  // Pinned mode uses the version vetted in the server catalog, bumped via repo updates.
  if (server.source.kind === "npm") {
    const tag = options.serverUpdate === "pinned" ? server.source.pinnedVersion : "latest";
    return {
      command: "npx",
      args: [
        "-y",
        `${server.source.packageName}@${tag}`
      ],
      env: {}
    };
  }

  if (options.serverPackageSource === "npm") {
    const tag = options.serverUpdate === "pinned"
      ? await packageVersion(runtime, server.source.packageDir)
      : "latest";
    return {
      command: "npx",
      args: [
        "-y",
        `${server.source.packageName}@${tag}`
      ],
      env: {}
    };
  }

  return {
    ...runtimeCommand(runtime, ["mcp", server.source.packageDir]),
    env: {
      GREYBEARD_MANAGED: "0.1",
      GREYBEARD_APP_DATA: runtime.env.GREYBEARD_APP_DATA || getGreybeardAppDataPath(),
      GREYBEARD_PROFILE_ID: runtime.env.GREYBEARD_PROFILE_ID || "local",
      GREYBEARD_TENANT_ID: runtime.env.GREYBEARD_TENANT_ID || "local",
      ...(server.source.packageDir === "graph" ? { GREYBEARD_CLIENT_ID: runtime.env.GREYBEARD_CLIENT_ID || "" } : {})
    }
  };
}

async function packageVersion(runtime: CliRuntime, packageDir: "graph" | "memory"): Promise<string> {
  const parsed = await readJsonObject(join(runtime.repoRoot, packageDir, "package.json"));
  return typeof parsed.version === "string" && parsed.version.trim().length > 0
    ? parsed.version
    : "0.1.0";
}

function jsonServerDefinition(
  server: StdioServerDefinition,
  shape: "plain" | "stdio" | "copilot-local"
): Record<string, unknown> {
  return {
    ...(shape === "stdio" ? { type: "stdio" } : {}),
    ...(shape === "copilot-local" ? { type: "local" } : {}),
    command: server.command,
    args: server.args,
    env: server.env,
    ...(shape === "copilot-local" ? { tools: ["*"] } : {})
  };
}

function tomlServerBlock(name: string, server: StdioServerDefinition): string {
  return [
    `[mcp_servers.${name}]`,
    `command = ${tomlString(server.command)}`,
    `args = ${tomlStringArray(server.args)}`,
    `env = { ${Object.entries(server.env).map(([key, value]) => `${tomlString(key)} = ${tomlString(value)}`).join(", ")} }`
  ].join("\n");
}

export function removeTomlTable(text: string, table: string): string {
  const lines = text.split(/\r?\n/u);
  const output: string[] = [];
  let skipping = false;
  const header = `[${table}]`;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === header) {
      skipping = true;
      continue;
    }

    if (skipping && /^\[[^\]]+\]\s*$/u.test(trimmed)) {
      skipping = false;
    }

    if (!skipping) {
      output.push(line);
    }
  }

  return output.join("\n");
}

export function extractTomlTable(text: string, table: string): string | null {
  const lines = text.split(/\r?\n/u);
  const collected: string[] = [];
  let inside = false;
  const header = `[${table}]`;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === header) {
      inside = true;
      collected.push(line);
      continue;
    }

    if (inside && /^\[[^\]]+\]\s*$/u.test(trimmed)) {
      break;
    }

    if (inside) {
      collected.push(line);
    }
  }

  return collected.length > 0 ? collected.join("\n") : null;
}

function hasTomlTable(text: string, table: string): boolean {
  const escaped = table.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`^\\s*\\[${escaped}\\]\\s*$`, "mu").test(text);
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlStringArray(values: string[]): string {
  return `[${values.map(tomlString).join(", ")}]`;
}

function memoryHookHandler(nodePath: string): Record<string, unknown> {
  return {
    type: "command",
    command: nodePath,
    args: [
      "-e",
      `process.stdout.write(${JSON.stringify(MEMORY_HOOK_REMINDER)});`
    ],
    timeout: 5
  };
}

function isSameHookHandler(candidate: unknown, expected: Record<string, unknown>): boolean {
  if (!isObject(candidate)) {
    return false;
  }

  return candidate.type === expected.type
    && candidate.command === expected.command
    && JSON.stringify(candidate.args) === JSON.stringify(expected.args);
}

function isGreybeardMemoryHookHandler(candidate: unknown, runtime: CliRuntime): boolean {
  if (!isObject(candidate) || candidate.type !== "command") return false;
  if (typeof candidate.command === "string" && candidate.command.includes("--greybeard-owned-hook=0.1")) {
    const invocation = runtimeCommand(runtime, ["mentor", "pre-tool"]);
    const quote = runtime.platform === "win32" ? (value: string) => `"${value}"` : (value: string) => "'" + value.replace(/'/gu, "'\\''") + "'";
    return candidate.command.startsWith([invocation.command, ...invocation.args].map(quote).join(" ") + " ");
  }
  return candidate.command === runtime.nodePath && Array.isArray(candidate.args) && candidate.args.length === 2 && candidate.args[0] === "-e"
    && typeof candidate.args[1] === "string" && candidate.args[1].startsWith("process.stdout.write(") && candidate.args[1].includes("greybeard-memory recall");
}

async function wireSkillsToDir(
  runtime: CliRuntime,
  client: KnownClientName,
  targetDir: string
): Promise<SkillWireResult> {
  const sourceDir = repoSkillsDir(runtime.repoRoot);
  const tree = await listSkillSourceDirs(sourceDir);
  await mkdir(targetDir, { recursive: true });

  const entries: SkillWireEntry[] = [];
  for (const source of tree.sources) {
    const target = join(targetDir, source.name);
    entries.push(await ensureSkillLink({
      source: source.path,
      target,
      name: source.name,
      platform: runtime.platform
    }));
  }

  entries.push(...duplicateSkillEntries(tree, targetDir));
  return {
    client,
    sourceDir,
    targetDir,
    empty: entries.length === 0,
    entries
  };
}

function claudeDesktopManualSkills(runtime: CliRuntime): SkillWireResult {
  return {
    client: "Claude Desktop",
    sourceDir: repoSkillsDir(runtime.repoRoot),
    targetDir: "Claude Desktop Settings > Capabilities > Skills",
    empty: false,
    entries: [],
    channel: "manual-zip",
    manualInstruction: "manual ZIP upload: run greybeard skills pack, then upload the ZIPs in Settings > Capabilities > Skills. Upload state is private to the Claude account and cannot be verified locally."
  };
}

async function inspectSkillsInDir(
  runtime: CliRuntime,
  client: KnownClientName,
  targetDir: string
): Promise<SkillWireResult> {
  const sourceDir = repoSkillsDir(runtime.repoRoot);
  const tree = await listSkillSourceDirs(sourceDir);
  const entries: SkillWireEntry[] = [];

  for (const source of tree.sources) {
    const target = join(targetDir, source.name);
    entries.push(await inspectSkillLink(source.name, source.path, target));
  }

  entries.push(...duplicateSkillEntries(tree, targetDir));
  return {
    client,
    sourceDir,
    targetDir,
    empty: entries.length === 0,
    entries
  };
}

function duplicateSkillEntries(tree: SkillTree, targetDir: string): SkillWireEntry[] {
  return tree.duplicates.map((duplicate) => ({
    name: `${duplicate.category}/${duplicate.name}`,
    source: duplicate.path,
    target: join(targetDir, duplicate.name),
    status: "blocked",
    message: `Duplicate skill folder name; "${duplicate.name}" already exists in "${duplicate.existingCategory}". Skill folder names must be unique across categories.`
  }));
}

async function ensureSkillLink(params: {
  source: string;
  target: string;
  name: string;
  platform: NodeJS.Platform;
}): Promise<SkillWireEntry> {
  const existing = await lstatOrNull(params.target);
  if (!existing) {
    await symlink(params.source, params.target, params.platform === "win32" ? "junction" : "dir");
    return {
      name: params.name,
      source: params.source,
      target: params.target,
      status: "linked"
    };
  }

  if (existing.isSymbolicLink()) {
    const link = await readlink(params.target);
    const resolved = resolve(dirname(params.target), link);
    if (await samePath(resolved, params.source)) {
      return {
        name: params.name,
        source: params.source,
        target: params.target,
        status: "already-linked"
      };
    }

    return { name: params.name, source: params.source, target: params.target, status: "blocked", message: "Existing symlink points elsewhere; preserved." };
  }

  return {
    name: params.name,
    source: params.source,
    target: params.target,
    status: "blocked",
    message: "Target exists and is not a symlink. Greybeard will not overwrite it."
  };
}

async function inspectSkillLink(name: string, source: string, target: string): Promise<SkillWireEntry> {
  const existing = await lstatOrNull(target);
  if (!existing) {
    return {
      name,
      source,
      target,
      status: "blocked",
      message: "Missing skill link."
    };
  }

  if (!existing.isSymbolicLink()) {
    return {
      name,
      source,
      target,
      status: "blocked",
      message: "Target exists and is not a symlink."
    };
  }

  const link = await readlink(target);
  const resolved = resolve(dirname(target), link);
  if (await samePath(resolved, source)) {
    return {
      name,
      source,
      target,
      status: "already-linked"
    };
  }

  return {
    name,
    source,
    target,
    status: "blocked",
    message: "Symlink points at a different path."
  };
}

async function writeSkillFallbackBlock(
  client: KnownClientName,
  path: string,
  skillsPath: string,
  finalize?: (text: string) => string
): Promise<SkillFallbackResult> {
  return withClientConfigLock(path, async () => {
  const current = await readTextFile(path);
  const block = greybeardFallbackBlock(skillsPath);
  let next = replaceDelimitedBlock(current, block);
  if (finalize) {
    next = finalize(next);
  }

  const hadBlock = current.includes(GREYBEARD_BLOCK_START);
  if (next !== current) {
    await writeTextFile(path, next);
  }

  return {
    client,
    path,
    configured: true,
    status: next === current ? "already-configured" : hadBlock ? "updated" : "installed"
  };
  });
}
async function inspectSkillFallbackBlock(client: KnownClientName, path: string): Promise<SkillFallbackResult> {
  const current = await readTextFile(path);
  const configured = current.includes(GREYBEARD_BLOCK_START) && current.includes(GREYBEARD_BLOCK_END);
  return {
    client,
    path,
    configured,
    status: configured ? "already-configured" : "missing"
  };
}

function greybeardFallbackBlock(skillsPath: string): string {
  return [
    GREYBEARD_BLOCK_START,
    "## Greybeard Skills",
    "",
    `Greybeard skills live at \`${skillsPath}\`, one folder per skill inside category subfolders (for example \`read/tenant-pulse\`).`,
    "When the user asks about Microsoft 365, Intune, Entra, Microsoft Graph, KQL, Conditional Access, compliance, licensing, or tenant posture, inspect the skill folders one level below that directory.",
    "Pick the skill whose `SKILL.md` description starts with `Use when` and matches the task. Read that skill's `SKILL.md` before acting. Load files under `references/` or `scripts/` only when the skill instructs you to.",
    "",
    "## Greybeard Memory",
    "",
    "Greybeard ships a local memory server, `greybeard-memory`, shared across every configured client.",
    HOST_MEMORY_GUIDANCE,
    "Never store raw tenant output, user or device lists, or GUID-heavy payloads.",
    GREYBEARD_BLOCK_END
  ].join("\n");
}

const CURSOR_RULE_HEADER = [
  "---",
  "description: Greybeard guidance for Microsoft 365, Intune, and Entra work.",
  "alwaysApply: true",
  "---"
].join("\n");

// Cursor only injects a rule into every session when its frontmatter says
// alwaysApply: true; without it the block is agent-requested, not ambient.
function ensureCursorRuleHeader(text: string): string {
  if (!text.startsWith("---\n")) {
    return `${CURSOR_RULE_HEADER}\n\n${text}`;
  }

  const close = text.indexOf("\n---", 3);
  if (close === -1) {
    return `${CURSOR_RULE_HEADER}\n\n${text}`;
  }

  const frontmatter = text.slice(0, close);
  if (/^alwaysApply:\s*true$/mu.test(frontmatter)) {
    return text;
  }

  if (/^alwaysApply:/mu.test(frontmatter)) {
    return `${frontmatter.replace(/^alwaysApply:.*$/mu, "alwaysApply: true")}${text.slice(close)}`;
  }

  return `${frontmatter}\nalwaysApply: true${text.slice(close)}`;
}

function replaceDelimitedBlock(current: string, block: string): string {
  const pattern = new RegExp(`${escapeRegex(GREYBEARD_BLOCK_START)}[\\s\\S]*?${escapeRegex(GREYBEARD_BLOCK_END)}`, "u");
  if (pattern.test(current)) {
    return `${current.replace(pattern, block).trimEnd()}\n`;
  }

  return current.trimEnd().length > 0
    ? `${current.trimEnd()}\n\n${block}\n`
    : `${block}\n`;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export interface SkillSourceDir {
  name: string;
  category: string;
  path: string;
}

export interface SkillTree {
  sources: SkillSourceDir[];
  missingManifest: SkillSourceDir[];
  duplicates: Array<SkillSourceDir & { existingCategory: string }>;
}

export async function listSkillSourceDirs(sourceDir: string): Promise<SkillTree> {
  const sources: SkillSourceDir[] = [];
  const missingManifest: SkillSourceDir[] = [];
  const duplicates: Array<SkillSourceDir & { existingCategory: string }> = [];
  const seenCategories = new Map<string, string>();

  const addSource = (name: string, category: string, path: string): void => {
    const existing = seenCategories.get(name);
    if (existing !== undefined) {
      duplicates.push({ name, category, path, existingCategory: existing || sourceDir });
      return;
    }

    seenCategories.set(name, category);
    sources.push({ name, category, path });
  };

  for (const category of await listChildDirNames(sourceDir)) {
    const categoryPath = join(sourceDir, category);
    if (await lstatOrNull(join(categoryPath, "SKILL.md"))) {
      addSource(category, "", categoryPath);
      continue;
    }

    for (const name of await listChildDirNames(categoryPath)) {
      const skillPath = join(categoryPath, name);
      if (await lstatOrNull(join(skillPath, "SKILL.md"))) {
        addSource(name, category, skillPath);
      } else {
        missingManifest.push({ name, category, path: skillPath });
      }
    }
  }

  const byName = (left: { name: string }, right: { name: string }) => left.name.localeCompare(right.name);
  return {
    sources: sources.sort(byName),
    missingManifest: missingManifest.sort(byName),
    duplicates: duplicates.sort(byName)
  };
}

export function summarizeSkillWiring(result: SkillWireResult): { ok: boolean; detail: string } {
  if (result.empty) {
    return {
      ok: false,
      detail: `no skill folders found in ${result.sourceDir}`
    };
  }

  const blocked = result.entries.filter((entry) => entry.status === "blocked");
  if (blocked.length > 0) {
    return {
      ok: false,
      detail: `${result.entries.length - blocked.length}/${result.entries.length} skills linked, ${blocked.map((entry) => entry.name).join(", ")} blocked`
    };
  }

  return {
    ok: true,
    detail: `${result.entries.length} skills linked`
  };
}

async function listChildDirNames(parent: string): Promise<string[]> {
  try {
    const entries = await readdir(parent, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

async function readJsonObject(path: string): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!isObject(parsed)) {
      throw new Error(`${path} does not contain a JSON object.`);
    }

    return parsed;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return {};
    }

    throw error;
  }
}

async function writeJsonObject(path: string, value: Record<string, unknown>): Promise<void> {
  await writeClientConfigAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function readTextFile(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return "";
    }

    throw error;
  }
}

async function writeTextFile(path: string, value: string): Promise<void> {
  await writeClientConfigAtomic(path, value);
}

async function samePath(left: string, right: string): Promise<boolean> {
  try {
    const [leftReal, rightReal] = await Promise.all([
      realpath(left),
      realpath(right)
    ]);
    return leftReal === rightReal;
  } catch {
    return resolve(left) === resolve(right);
  }
}

async function lstatOrNull(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function fileExists(path: string): Promise<boolean> {
  return Boolean(await lstatOrNull(path));
}

function withoutClient(result: ClientMcpConfigResult): ClaudeMcpConfigResult {
  const { client: _client, ...rest } = result;
  return rest;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
