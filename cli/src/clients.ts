import { lstat, mkdir, readFile, readdir, readlink, realpath, symlink, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { ServerPackageSource, ServerUpdateMode } from "@greybeard/graph";
import { toPortablePath } from "./portablePath.js";
import { CliRuntime } from "./runtime.js";
import { enabledCatalogServers, SERVER_CATALOG, type CatalogServer } from "./serverCatalog.js";

export const MEMORY_HOOK_REMINDER = "For Microsoft 365, Intune, or Entra tasks, call greybeard-memory recall before other work.\n";

const GREYBEARD_BLOCK_START = "<!-- GREYBEARD SKILLS START -->";
const GREYBEARD_BLOCK_END = "<!-- GREYBEARD SKILLS END -->";

export type KnownClientName = "Claude Code" | "Cursor" | "Codex CLI" | "Gemini CLI" | "GitHub Copilot";

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
};

export type ClaudeMcpConfigResult = Omit<ClientMcpConfigResult, "client">;

export type ClaudeMemoryHookResult = {
  path: string;
  configured: boolean;
  status: "installed" | "already-configured";
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
};

export type SkillFallbackResult = {
  client: KnownClientName;
  path: string;
  configured: boolean;
  status: "installed" | "already-configured" | "missing";
};

export type ServerConfigOptions = {
  serverUpdate?: ServerUpdateMode;
  serverPackageSource?: ServerPackageSource;
  serverToggles?: Record<string, boolean>;
};

export type InspectServerOptions = {
  serverToggles?: Record<string, boolean>;
};

type StdioServerDefinition = {
  command: string;
  args: string[];
  env: Record<string, string>;
};

export async function detectClaudeCode(runtime: CliRuntime): Promise<ClaudeDetection> {
  const configPath = claudeConfigPath(runtime.homeDir);
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
  const [binaryPath, appExists] = await Promise.all([
    runtime.findExecutable("cursor"),
    appPath ? fileExists(appPath) : Promise.resolve(false)
  ]);
  return {
    name: "Cursor",
    detected: Boolean(binaryPath || appExists),
    binaryPath,
    userConfigPath: appPath ?? cursorMcpConfigPath(runtime.homeDir),
    userConfigExists: appExists
  };
}

export async function detectCodexCli(runtime: CliRuntime): Promise<ClientDetection> {
  const authPath = codexAuthPath(runtime.homeDir);
  const [binaryPath, authExists] = await Promise.all([
    runtime.findExecutable("codex"),
    fileExists(authPath)
  ]);
  return {
    name: "Codex CLI",
    detected: Boolean(binaryPath || authExists),
    binaryPath,
    userConfigPath: authPath,
    userConfigExists: authExists
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
  return Promise.all([
    detectClaudeCode(runtime),
    detectCursor(runtime),
    detectCodexCli(runtime),
    detectGeminiCli(runtime),
    detectGithubCopilot(runtime, options)
  ]);
}

export function claudeConfigPath(homeDir: string): string {
  return join(homeDir, ".claude.json");
}

export function claudeSettingsPath(homeDir: string): string {
  return join(homeDir, ".claude", "settings.json");
}

export function claudeSkillsDir(homeDir: string): string {
  return join(homeDir, ".claude", "skills");
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

export function codexConfigPath(homeDir: string): string {
  return join(homeDir, ".codex", "config.toml");
}

export function codexAuthPath(homeDir: string): string {
  return join(homeDir, ".codex", "auth.json");
}

export function codexSkillsDir(homeDir: string): string {
  return join(homeDir, ".agents", "skills");
}

export function codexFallbackPath(homeDir: string): string {
  return join(homeDir, ".codex", "AGENTS.md");
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
    configPath: claudeConfigPath(runtime.homeDir),
    shape: "stdio",
    options
  });
  return withoutClient(result);
}

export async function inspectClaudeMcpConfig(
  runtime: CliRuntime,
  options: InspectServerOptions = {}
): Promise<ClaudeMcpConfigResult> {
  const result = await inspectJsonMcpConfig("Claude Code", claudeConfigPath(runtime.homeDir), options);
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
  const configPath = codexConfigPath(runtime.homeDir);
  const servers = await enabledServerDefinitions(runtime, options);
  const current = await readTextFile(configPath);
  const cleaned = SERVER_CATALOG
    .reduce((text, server) => removeTomlTable(text, `mcp_servers.${server.name}`), current)
    .trimEnd();
  const block = servers
    .map((server) => tomlServerBlock(server.name, server.definition))
    .join("\n");
  const next = cleaned.length > 0 ? `${cleaned}\n\n${block}\n` : `${block}\n`;
  await writeTextFile(configPath, next);
  return {
    client: "Codex CLI",
    path: configPath,
    configured: true,
    server: Object.fromEntries(servers.map((server) => [server.name, server.definition]))
  };
}

export async function inspectCodexMcpConfig(
  runtime: CliRuntime,
  options: InspectServerOptions = {}
): Promise<ClientMcpConfigResult> {
  const path = codexConfigPath(runtime.homeDir);
  try {
    const text = await readTextFile(path);
    const configured = enabledCatalogServers(options.serverToggles)
      .every((server) => hasTomlTable(text, `mcp_servers.${server.name}`));
    return {
      client: "Codex CLI",
      path,
      configured
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
  if (client === "Claude Code") {
    return {
      client,
      ...await writeClaudeMcpConfig(runtime, options)
    };
  }

  if (client === "Cursor") {
    return writeCursorMcpConfig(runtime, options);
  }

  if (client === "Codex CLI") {
    return writeCodexMcpConfig(runtime, options);
  }

  if (client === "Gemini CLI") {
    return writeGeminiMcpConfig(runtime, options);
  }

  return writeCopilotMcpConfig(runtime, options);
}

export async function writeClaudeMemoryHook(runtime: CliRuntime): Promise<ClaudeMemoryHookResult> {
  const path = claudeSettingsPath(runtime.homeDir);
  const root = await readJsonObject(path);
  const hooks = isObject(root.hooks) ? root.hooks : {};
  const promptSubmit = Array.isArray(hooks.UserPromptSubmit) ? hooks.UserPromptSubmit : [];
  const handler = memoryHookHandler(runtime.nodePath);

  for (const group of promptSubmit) {
    if (!isObject(group) || !Array.isArray(group.hooks)) {
      continue;
    }

    if (group.hooks.some((candidate) => isSameHookHandler(candidate, handler))) {
      root.hooks = hooks;
      await writeJsonObject(path, root);
      return {
        path,
        configured: true,
        status: "already-configured"
      };
    }
  }

  promptSubmit.push({
    hooks: [
      handler
    ]
  });
  hooks.UserPromptSubmit = promptSubmit;
  root.hooks = hooks;
  await writeJsonObject(path, root);
  return {
    path,
    configured: true,
    status: "installed"
  };
}

export async function wireClaudeSkills(runtime: CliRuntime): Promise<SkillWireResult> {
  return wireSkillsToDir(runtime, "Claude Code", claudeSkillsDir(runtime.homeDir));
}

export async function inspectClaudeSkillWiring(runtime: CliRuntime): Promise<SkillWireResult> {
  return inspectSkillsInDir(runtime, "Claude Code", claudeSkillsDir(runtime.homeDir));
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
  if (client === "Claude Code") {
    return wireClaudeSkills(runtime);
  }

  if (client === "Cursor") {
    return wireCursorSkills(runtime);
  }

  if (client === "Codex CLI") {
    return wireCodexSkills(runtime);
  }

  if (client === "Gemini CLI") {
    return wireGeminiSkills(runtime);
  }

  return wireCopilotSkills(runtime);
}

export async function writeCodexSkillFallback(runtime: CliRuntime): Promise<SkillFallbackResult> {
  return writeSkillFallbackBlock("Codex CLI", codexFallbackPath(runtime.homeDir), repoSkillsDir(runtime.repoRoot));
}

export async function inspectCodexSkillFallback(runtime: CliRuntime): Promise<SkillFallbackResult> {
  return inspectSkillFallbackBlock("Codex CLI", codexFallbackPath(runtime.homeDir));
}

export async function writeGeminiSkillFallback(runtime: CliRuntime): Promise<SkillFallbackResult> {
  return writeSkillFallbackBlock("Gemini CLI", geminiFallbackPath(runtime.homeDir), repoSkillsDir(runtime.repoRoot));
}

export async function inspectGeminiSkillFallback(runtime: CliRuntime): Promise<SkillFallbackResult> {
  return inspectSkillFallbackBlock("Gemini CLI", geminiFallbackPath(runtime.homeDir));
}

export async function writeCursorSkillFallback(runtime: CliRuntime): Promise<SkillFallbackResult> {
  return writeSkillFallbackBlock("Cursor", cursorFallbackPath(runtime.homeDir), repoSkillsDir(runtime.repoRoot));
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

function clientNames(clients?: readonly ClientDetection[]): KnownClientName[] {
  if (!clients) {
    return ["Claude Code", "Cursor", "Codex CLI", "Gemini CLI", "GitHub Copilot"];
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

async function writeJsonMcpConfig(params: {
  runtime: CliRuntime;
  client: KnownClientName;
  configPath: string;
  shape: "plain" | "stdio" | "copilot-local";
  options: ServerConfigOptions;
}): Promise<ClientMcpConfigResult> {
  const root = await readJsonObject(params.configPath);
  const mcpServers = isObject(root.mcpServers) ? root.mcpServers : {};
  const servers = await enabledServerDefinitions(params.runtime, params.options);
  const enabledNames = new Set(servers.map((server) => server.name));
  for (const server of SERVER_CATALOG) {
    if (!enabledNames.has(server.name)) {
      delete mcpServers[server.name];
    }
  }

  const written: Record<string, unknown> = {};
  for (const server of servers) {
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
    server: written
  };
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
    let configured = true;
    for (const catalogServer of enabledCatalogServers(options.serverToggles)) {
      const entry = mcpServers[catalogServer.name];
      server[catalogServer.name] = entry;
      if (!isObject(entry)) {
        configured = false;
      }
    }

    return {
      client,
      path,
      configured,
      server
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
  if (server.source.kind === "npm") {
    return {
      command: "npx",
      args: [
        "-y",
        `${server.source.packageName}@latest`
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
    command: runtime.nodePath,
    args: [
      toPortablePath(join(runtime.repoRoot, server.source.packageDir, "dist", "index.js"))
    ],
    env: {}
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
    `args = ${tomlStringArray(server.args)}`
  ].join("\n");
}

function removeTomlTable(text: string, table: string): string {
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

async function wireSkillsToDir(
  runtime: CliRuntime,
  client: KnownClientName,
  targetDir: string
): Promise<SkillWireResult> {
  const sourceDir = repoSkillsDir(runtime.repoRoot);
  const sources = await listSkillSourceDirs(sourceDir);
  await mkdir(targetDir, { recursive: true });

  const entries: SkillWireEntry[] = [];
  for (const source of sources) {
    const target = join(targetDir, source.name);
    entries.push(await ensureSkillLink({
      source: source.path,
      target,
      name: source.name,
      platform: runtime.platform
    }));
  }

  return {
    client,
    sourceDir,
    targetDir,
    empty: sources.length === 0,
    entries
  };
}

async function inspectSkillsInDir(
  runtime: CliRuntime,
  client: KnownClientName,
  targetDir: string
): Promise<SkillWireResult> {
  const sourceDir = repoSkillsDir(runtime.repoRoot);
  const sources = await listSkillSourceDirs(sourceDir);
  const entries: SkillWireEntry[] = [];

  for (const source of sources) {
    const target = join(targetDir, source.name);
    entries.push(await inspectSkillLink(source.name, source.path, target));
  }

  return {
    client,
    sourceDir,
    targetDir,
    empty: sources.length === 0,
    entries
  };
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

    await unlink(params.target);
    await symlink(params.source, params.target, params.platform === "win32" ? "junction" : "dir");
    return {
      name: params.name,
      source: params.source,
      target: params.target,
      status: "replaced-stale-symlink"
    };
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
  skillsPath: string
): Promise<SkillFallbackResult> {
  const current = await readTextFile(path);
  const block = greybeardFallbackBlock(skillsPath);
  const next = replaceDelimitedBlock(current, block);
  await writeTextFile(path, next);
  return {
    client,
    path,
    configured: true,
    status: current.includes(GREYBEARD_BLOCK_START) ? "already-configured" : "installed"
  };
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
    `Greybeard skills live at \`${skillsPath}\`.`,
    "When the user asks about Microsoft 365, Intune, Entra, Microsoft Graph, KQL, Conditional Access, compliance, licensing, or tenant posture, inspect the skill folders in that directory.",
    "Pick the skill whose `SKILL.md` description starts with `Use when` and matches the task. Read that skill's `SKILL.md` before acting. Load files under `references/` or `scripts/` only when the skill instructs you to.",
    GREYBEARD_BLOCK_END
  ].join("\n");
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

async function listSkillSourceDirs(sourceDir: string): Promise<Array<{ name: string; path: string }>> {
  try {
    const entries = await readdir(sourceDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => ({
        name: entry.name,
        path: join(sourceDir, entry.name)
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
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
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
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
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value, {
    encoding: "utf8",
    mode: 0o600
  });
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
  return {
    path: result.path,
    configured: result.configured,
    server: result.server,
    error: result.error
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
