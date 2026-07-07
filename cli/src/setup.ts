import {
  buildAdminConsentUrl,
  DEFAULT_TIER1_SCOPES,
  GRAPH_CLI_CLIENT_ID,
  getGreybeardAppDataPath,
  graphAuthConfig,
  isAdminConsentError,
  readGreybeardConfig,
  scopeJustification,
  updateGreybeardConfig,
  type AuthToken,
  type FetchLike,
  type GreybeardConfig,
  type ResponseLike,
  type ServerPackageSource,
  type ServerUpdateMode,
  type SkillUpdateMode
} from "@greybeard/graph";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { initializeMemoryDatabase, memoryDbPath } from "@greybeard/memory";
import { flagValue, flagValues, hasFlag, ParsedArgs } from "./args.js";
import {
  detectAllClients,
  wireAllClientSkills,
  writeAllClientMcpConfigs,
  writeClaudeMemoryHook,
  type ClientDetectionOptions,
  type ClientDetection
} from "./clients.js";
import { toPortablePath } from "./portablePath.js";
import { CliRuntime, writeInfoLine, writeLine, writeNoteLine, writeSection, writeStatusLine } from "./runtime.js";

const GRAPH_RESOURCE_APP_ID = "00000003-0000-0000-c000-000000000000";
const BOOTSTRAP_SCOPE = "Application.ReadWrite.All";
export const DEFAULT_WRITE_SCOPES = [
  "User.ReadWrite.All",
  "Group.ReadWrite.All",
  "Policy.ReadWrite.ConditionalAccess"
] as const;

export async function runSetup(args: ParsedArgs, runtime: CliRuntime): Promise<number> {
  const appDataPath = flagValue(args, "app-data") || runtime.env.GREYBEARD_APP_DATA || getGreybeardAppDataPath();
  const config = await readGreybeardConfig(appDataPath);
  const tenantId = flagValue(args, "tenant") || runtime.env.GREYBEARD_TENANT_ID || config.activeTenantId;
  const auth = await runtime.authFactory({
    tenantId,
    clientId: GRAPH_CLI_CLIENT_ID,
    clientIdKind: "first-party",
    credentialMode: "read-only",
    writesConfigured: false,
    appDataPath,
    fetcher: runtime.fetcher
  });

  writeLine(runtime.stdout, "Greybeard setup");
  writeLine(runtime.stdout, "──────────────");

  const clients = await detectAllClients(runtime, clientDetectionOptions(args, config));
  const detectedClients = clients.filter((client) => client.detected);
  writeSection(runtime.stdout, "Clients");
  for (const client of clients) {
    writeInfoLine(
      runtime.stdout,
      client.name,
      client.detected ? clientDetectionDetail(client) : "not detected, skipped"
    );
  }

  let token: AuthToken;
  try {
    const consent = await printSignInDisclosure({
      args,
      runtime,
      scopes: [...DEFAULT_TIER1_SCOPES],
      mode: "read-only",
      clientId: GRAPH_CLI_CLIENT_ID
    });
    if (consent === "cancelled") {
      return 0;
    }

    token = await auth.getToken([...DEFAULT_TIER1_SCOPES]);
  } catch (error) {
    if (isAdminConsentError(error)) {
      printConsentHandoff({
        runtime,
        tenantId: tenantId || "organizations",
        clientId: GRAPH_CLI_CLIENT_ID,
        scopes: [...DEFAULT_TIER1_SCOPES],
        resumeCommand: "greybeard setup"
      });
      return 0;
    }

    throw error;
  }

  const updatedConfig = await updateGreybeardConfig(appDataPath, (current) => ({
    ...current,
    activeTenantId: token.tenantId,
    credentialMode: current.credentialMode === "writes" && current.workspaceAppId ? "writes" : "read-only",
    grantedReadScopes: token.grantedScopes.length > 0 ? token.grantedScopes : [...DEFAULT_TIER1_SCOPES],
    skillUpdate: skillUpdateFromArgs(args, current.skillUpdate),
    serverUpdate: serverUpdateFromArgs(args, current.serverUpdate),
    serverPackageSource: serverPackageSourceFromArgs(args, current.serverPackageSource),
    clients: clientsFromArgs(args, current.clients),
    gate: gateFromArgs(args, current.gate)
  }));
  writeStatusLine(runtime.stdout, "OK", "Signed in", token.account);
  writeStatusLine(runtime.stdout, "OK", "Tenant", `${token.tenantDomain} (${token.tenantId})`);

  writeSection(runtime.stdout, "Memory");
  initializeMemoryDatabase(appDataPath);
  writeStatusLine(runtime.stdout, "OK", "Memory DB", memoryDbPath(appDataPath));

  if (hasFlag(args, "memory-hook")) {
    if (detectedClients.some((client) => client.name === "Claude Code")) {
      const hook = await writeClaudeMemoryHook(runtime);
      writeStatusLine(runtime.stdout, "OK", "Memory hook", `${hook.status} in ${hook.path}`);
    } else {
      writeInfoLine(runtime.stdout, "Memory hook", "Claude Code not detected, skipped");
    }
  }

  writeSection(runtime.stdout, "Auto-update");
  const schedule = await installAutoUpdateSchedule(runtime, updatedConfig.skillUpdate ?? "weekly");
  writeStatusLine(runtime.stdout, schedule.configured ? "OK" : "WARN", "Schedule", schedule.detail);

  writeSection(runtime.stdout, "MCP configuration");
  const mcpResults = await writeAllClientMcpConfigs(runtime, serverOptionsFromConfig(updatedConfig), detectedClients);
  if (mcpResults.length === 0) {
    writeInfoLine(runtime.stdout, "Clients", "no detected clients, skipped");
  }
  for (const mcp of mcpResults) {
    writeStatusLine(runtime.stdout, "OK", mcp.client, mcp.path);
  }

  writeSection(runtime.stdout, "Skills");
  const skillResults = await wireAllClientSkills(runtime, detectedClients);
  if (skillResults.length === 0) {
    writeInfoLine(runtime.stdout, "Clients", "no detected clients, skipped");
  }
  for (const skills of skillResults) {
    if (skills.empty) {
      writeStatusLine(runtime.stdout, "WARN", skills.client ?? "Skills", `no skill folders found in ${skills.sourceDir}`);
    } else {
      const blocked = skills.entries.filter((entry) => entry.status === "blocked");
      writeStatusLine(
        runtime.stdout,
        blocked.length === 0 ? "OK" : "WARN",
        skills.client ?? "Skills",
        blocked.length === 0
          ? `${skills.entries.length} skill links ready in ${skills.targetDir}`
          : `${skills.entries.length - blocked.length}/${skills.entries.length} skill links ready; ${blocked.map((entry) => entry.name).join(", ")} blocked`
      );
    }
  }

  if (!hasFlag(args, "writes")) {
    const refreshResult = await refreshWorkspaceCredential({
      args,
      runtime,
      appDataPath,
      tenantId: token.tenantId,
      config: updatedConfig
    });
    if (refreshResult === "handoff" || refreshResult === "cancelled") {
      return 0;
    }
  }

  if (hasFlag(args, "writes")) {
    return setupWrites({
      args,
      runtime,
      appDataPath,
      tenantId: token.tenantId,
      readToken: token
    });
  }

  writeSection(runtime.stdout, "Done");
  writeStatusLine(runtime.stdout, "OK", "Setup", "complete");
  writeLine(runtime.stdout, "Try this now: what is my tenant MFA coverage?");
  return 0;
}

function clientDetectionDetail(client: ClientDetection): string {
  if (client.binaryPath) {
    return client.binaryPath;
  }

  if (client.detectionDetail) {
    return client.detectionDetail;
  }

  if (client.userConfigExists) {
    return client.userConfigPath;
  }

  return "detected";
}

async function refreshWorkspaceCredential(params: {
  args: ParsedArgs;
  runtime: CliRuntime;
  appDataPath: string;
  tenantId: string;
  config: Awaited<ReturnType<typeof readGreybeardConfig>>;
}): Promise<"refreshed" | "skipped" | "handoff" | "cancelled"> {
  if (params.config.credentialMode !== "writes" || !params.config.workspaceAppId) {
    return "skipped";
  }

  const scopes = unique([
    ...(params.config.grantedReadScopes ?? [...DEFAULT_TIER1_SCOPES]),
    ...(params.config.requestedWriteScopes ?? [])
  ]);
  const workspaceAuth = await params.runtime.authFactory({
    tenantId: params.tenantId,
    clientId: params.config.workspaceAppId,
    clientIdKind: "workspace",
    credentialMode: "writes",
    writesConfigured: true,
    appDataPath: params.appDataPath,
    fetcher: params.runtime.fetcher
  });

  try {
    const consent = await printSignInDisclosure({
      args: params.args,
      runtime: params.runtime,
      scopes,
      mode: "workspace",
      clientId: params.config.workspaceAppId
    });
    if (consent === "cancelled") {
      return "cancelled";
    }

    const workspaceToken = await workspaceAuth.getToken(scopes);
    writeStatusLine(params.runtime.stdout, "OK", "Workspace app", `signed in as ${workspaceToken.clientId}`);
    return "refreshed";
  } catch (error) {
    if (isAdminConsentError(error)) {
      printWorkspaceConsent(params.runtime, params.tenantId, params.config.workspaceAppId, scopes);
      return "handoff";
    }

    throw error;
  }
}

async function setupWrites(params: {
  args: ParsedArgs;
  runtime: CliRuntime;
  appDataPath: string;
  tenantId: string;
  readToken: AuthToken;
}): Promise<number> {
  const existing = graphAuthConfig(await readGreybeardConfig(params.appDataPath));
  const writeScopes = requestedWriteScopes(params.args, params.runtime.env);
  const readScopes = unique(params.readToken.grantedScopes.length > 0
    ? params.readToken.grantedScopes
    : [...DEFAULT_TIER1_SCOPES]);
  const consentScopes = unique([...readScopes, ...writeScopes]);

  if (existing.credentialMode === "writes" && existing.clientIdKind === "workspace") {
    writeLine(params.runtime.stdout, "");
    writeLine(params.runtime.stdout, `Writes already configured with workspace app ${existing.clientId}.`);
    printWorkspaceConsent(params.runtime, params.tenantId, existing.clientId, consentScopes);
    return 0;
  }

  const bootstrapAuth = await params.runtime.authFactory({
    tenantId: params.tenantId,
    clientId: GRAPH_CLI_CLIENT_ID,
    clientIdKind: "first-party",
    credentialMode: "read-only",
    writesConfigured: false,
    appDataPath: params.appDataPath,
    fetcher: params.runtime.fetcher
  });

  let bootstrapToken: AuthToken;
  try {
    const consent = await printSignInDisclosure({
      args: params.args,
      runtime: params.runtime,
      scopes: [...DEFAULT_TIER1_SCOPES, BOOTSTRAP_SCOPE],
      mode: "bootstrap",
      clientId: GRAPH_CLI_CLIENT_ID
    });
    if (consent === "cancelled") {
      return 0;
    }

    bootstrapToken = await bootstrapAuth.getToken([...DEFAULT_TIER1_SCOPES, BOOTSTRAP_SCOPE]);
  } catch (error) {
    if (isAdminConsentError(error)) {
      printConsentHandoff({
        runtime: params.runtime,
        tenantId: params.tenantId,
        clientId: GRAPH_CLI_CLIENT_ID,
        scopes: [...DEFAULT_TIER1_SCOPES, BOOTSTRAP_SCOPE],
        resumeCommand: "greybeard setup --writes"
      });
      return 0;
    }

    throw error;
  }

  const workspace = await createWorkspaceApplication({
    fetcher: params.runtime.fetcher,
    accessToken: bootstrapToken.accessToken,
    tenantDomain: params.readToken.tenantDomain,
    scopes: consentScopes
  });

  await updateGreybeardConfig(params.appDataPath, (current) => ({
    ...current,
    activeTenantId: params.tenantId,
    credentialMode: "writes",
    workspaceAppId: workspace.appId,
    grantedReadScopes: readScopes,
    requestedWriteScopes: writeScopes,
    gate: gateFromArgs(params.args, current.gate)
  }));

  writeSection(params.runtime.stdout, "Writes");
  writeStatusLine(params.runtime.stdout, "OK", "Workspace app", workspace.displayName);
  writeStatusLine(params.runtime.stdout, "OK", "Workspace app id", workspace.appId);
  writeNoteLine(params.runtime.stdout, "Application.ReadWrite.All can be revoked from the first-party app after bootstrap if not needed.");
  printWorkspaceConsent(params.runtime, params.tenantId, workspace.appId, consentScopes);
  writeLine(params.runtime.stdout, "After admin consent completes, run greybeard setup to refresh the workspace app token cache.");
  return 0;
}

type SignInDisclosureMode = "read-only" | "bootstrap" | "workspace";

async function printSignInDisclosure(params: {
  args: ParsedArgs;
  runtime: CliRuntime;
  scopes: string[];
  mode: SignInDisclosureMode;
  clientId: string;
}): Promise<"continue" | "cancelled"> {
  writeSection(params.runtime.stdout, "Sign in to Microsoft");
  writeInfoLine(params.runtime.stdout, "Browser", "login.microsoftonline.com, Microsoft's own sign-in page");

  if (params.mode === "workspace") {
    writeInfoLine(params.runtime.stdout, "Application", "Greybeard workspace app registered in this tenant");
  } else {
    writeInfoLine(params.runtime.stdout, "Application", "Microsoft Graph Command Line Tools, a first-party Microsoft application");
  }

  writeInfoLine(params.runtime.stdout, "Client ID", params.clientId);
  writeInfoLine(params.runtime.stdout, "Password", "Greybeard never sees your password");

  if (params.mode === "read-only") {
    writeInfoLine(params.runtime.stdout, "Read-only", "Greybeard registers no third-party app for read-only access");
    writeInfoLine(params.runtime.stdout, "Writes", "impossible unless you explicitly run greybeard setup --writes");
  } else if (params.mode === "bootstrap") {
    writeNoteLine(params.runtime.stdout, "Application.ReadWrite.All is used only to create the workspace app");
    writeInfoLine(params.runtime.stdout, "Writes", "tenant writes still require an approved plan");
  } else {
    writeInfoLine(params.runtime.stdout, "Writes", "tenant writes still require an approved plan");
  }

  writeSection(params.runtime.stdout, "Consent");
  for (const scope of params.scopes) {
    writeInfoLine(params.runtime.stdout, scope, scopeJustification(scope), 40);
  }

  if (hasFlag(params.args, "yes")) {
    writeStatusLine(params.runtime.stdout, "OK", "Confirmation", "skipped by --yes");
    return "continue";
  }

  const confirmation = await params.runtime.confirm("Press Enter to open your browser and sign in (Ctrl+C to cancel)");
  if (confirmation === "non-interactive") {
    writeStatusLine(params.runtime.stdout, "WARN", "Confirmation", "proceeding non-interactively because no TTY is available");
    return "continue";
  }

  if (confirmation === "cancelled") {
    writeLine(params.runtime.stdout, "Sign-in cancelled, re-run greybeard setup");
    return "cancelled";
  }

  return "continue";
}

export async function createWorkspaceApplication(params: {
  fetcher: FetchLike;
  accessToken: string;
  tenantDomain: string;
  scopes: string[];
}): Promise<{ id: string; appId: string; displayName: string }> {
  const graphSp = await getGraphServicePrincipal(params.fetcher, params.accessToken);
  const permissionIds = new Map<string, string>();
  for (const scope of graphSp.oauth2PermissionScopes) {
    if (typeof scope.value === "string" && typeof scope.id === "string") {
      permissionIds.set(scope.value.toLowerCase(), scope.id);
    }
  }

  const resourceAccess = params.scopes.map((scope) => {
    const id = permissionIds.get(scope.toLowerCase());
    if (!id) {
      throw new Error(`Microsoft Graph delegated permission not found: ${scope}`);
    }

    return {
      id,
      type: "Scope"
    };
  });

  const app = await graphJson(params.fetcher, params.accessToken, "POST", "/beta/applications", {
    displayName: `Greybeard Workspace ${params.tenantDomain}`,
    signInAudience: "AzureADMyOrg",
    requiredResourceAccess: [
      {
        resourceAppId: GRAPH_RESOURCE_APP_ID,
        resourceAccess
      }
    ]
  });

  if (!isObject(app) || typeof app.appId !== "string" || typeof app.id !== "string") {
    throw new Error("Graph did not return a workspace application id.");
  }

  await graphJson(params.fetcher, params.accessToken, "POST", "/beta/servicePrincipals", {
    appId: app.appId
  });

  return {
    id: app.id,
    appId: app.appId,
    displayName: typeof app.displayName === "string" ? app.displayName : `Greybeard Workspace ${params.tenantDomain}`
  };
}

function printWorkspaceConsent(runtime: CliRuntime, tenantId: string, clientId: string, scopes: string[]): void {
  printConsentHandoff({
    runtime,
    tenantId,
    clientId,
    scopes,
    resumeCommand: "greybeard setup"
  });
}

function printConsentHandoff(params: {
  runtime: CliRuntime;
  tenantId: string;
  clientId: string;
  scopes: string[];
  resumeCommand: string;
}): void {
  writeLine(params.runtime.stdout, "");
  writeLine(params.runtime.stdout, "Admin consent required.");
  writeLine(params.runtime.stdout, buildAdminConsentUrl({
    tenantId: params.tenantId,
    clientId: params.clientId,
    scopes: params.scopes
  }));
  writeLine(params.runtime.stdout, "");
  writeLine(params.runtime.stdout, "Scope justifications:");
  for (const scope of params.scopes) {
    writeLine(params.runtime.stdout, `- ${scope}: ${scopeJustification(scope)}`);
  }
  writeLine(params.runtime.stdout, "");
  writeLine(params.runtime.stdout, `After consent, resume with: ${params.resumeCommand}`);
}

async function getGraphServicePrincipal(fetcher: FetchLike, accessToken: string): Promise<{
  oauth2PermissionScopes: Array<{ id?: unknown; value?: unknown }>;
}> {
  const url = new URL("https://graph.microsoft.com/beta/servicePrincipals");
  url.searchParams.set("$filter", `appId eq '${GRAPH_RESOURCE_APP_ID}'`);
  url.searchParams.set("$select", "id,oauth2PermissionScopes");
  const data = await graphJson(fetcher, accessToken, "GET", url);
  if (!isObject(data) || !Array.isArray(data.value) || !isObject(data.value[0])) {
    throw new Error("Microsoft Graph service principal was not found.");
  }

  const scopes = data.value[0].oauth2PermissionScopes;
  if (!Array.isArray(scopes)) {
    throw new Error("Microsoft Graph service principal did not include delegated scopes.");
  }

  return {
    oauth2PermissionScopes: scopes
  };
}

async function graphJson(
  fetcher: FetchLike,
  accessToken: string,
  method: "GET" | "POST",
  pathOrUrl: string | URL,
  body?: unknown
): Promise<unknown> {
  const url = pathOrUrl instanceof URL ? pathOrUrl : new URL(pathOrUrl, "https://graph.microsoft.com");
  const response = await fetcher(url.toString(), {
    method,
    headers: {
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      Authorization: `Bearer ${accessToken}`
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });

  if (!response.ok) {
    throw new Error(`Graph ${method} ${url.pathname} failed with HTTP ${response.status}: ${await responseText(response)}`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

function requestedWriteScopes(args: ParsedArgs, env: NodeJS.ProcessEnv): string[] {
  const fromFlags = flagValues(args, "write-scope");
  const fromEnv = (env.GREYBEARD_WRITE_SCOPES || "")
    .split(/[,\s]+/u)
    .filter(Boolean);
  const scopes = [...fromFlags, ...fromEnv];
  return unique(scopes.length > 0 ? scopes : [...DEFAULT_WRITE_SCOPES]);
}

export type ScheduleResult = {
  configured: boolean;
  detail: string;
};

export async function installAutoUpdateSchedule(
  runtime: CliRuntime,
  mode: SkillUpdateMode
): Promise<ScheduleResult> {
  try {
    if (runtime.platform === "darwin") {
      return installLaunchdSchedule(runtime, mode);
    }

    if (runtime.platform === "win32") {
      return installWindowsSchedule(runtime, mode);
    }

    return installCronSchedule(runtime, mode);
  } catch (error) {
    return {
      configured: false,
      detail: `${mode} requested, scheduler update failed: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

function skillUpdateFromArgs(
  args: ParsedArgs,
  current: SkillUpdateMode | undefined
): SkillUpdateMode {
  const value = flagValue(args, "skill-update");
  if (value === undefined) {
    return current ?? "weekly";
  }

  if (value === "weekly" || value === "login" || value === "off") {
    return value;
  }

  throw new Error("--skill-update must be weekly, login, or off.");
}

function serverUpdateFromArgs(
  args: ParsedArgs,
  current: ServerUpdateMode | undefined
): ServerUpdateMode {
  const value = flagValue(args, "server-update");
  if (value === undefined) {
    return current ?? "latest";
  }

  if (value === "latest" || value === "pinned") {
    return value;
  }

  throw new Error("--server-update must be latest or pinned.");
}

function serverPackageSourceFromArgs(
  args: ParsedArgs,
  current: ServerPackageSource | undefined
): ServerPackageSource {
  const value = flagValue(args, "server-source");
  if (value === undefined) {
    return current ?? "local";
  }

  if (value === "local" || value === "npm") {
    return value;
  }

  throw new Error("--server-source must be local or npm.");
}

function clientDetectionOptions(args: ParsedArgs, config: GreybeardConfig): ClientDetectionOptions {
  return {
    githubCopilot: hasFlag(args, "with-copilot") || config.clients?.githubCopilot === true
  };
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

function serverOptionsFromConfig(config: GreybeardConfig): {
  serverUpdate: ServerUpdateMode;
  serverPackageSource: ServerPackageSource;
} {
  return {
    serverUpdate: config.serverUpdate ?? "latest",
    serverPackageSource: config.serverPackageSource ?? "local"
  };
}

async function installLaunchdSchedule(runtime: CliRuntime, mode: SkillUpdateMode): Promise<ScheduleResult> {
  const plistPath = join(runtime.homeDir, "Library", "LaunchAgents", "com.greybeard.update.plist");
  await mkdir(join(runtime.homeDir, "Library", "LaunchAgents"), { recursive: true });

  if (mode === "off") {
    await runtime.runCommand("launchctl", ["unload", plistPath]);
    await rm(plistPath, { force: true });
    return {
      configured: false,
      detail: "off"
    };
  }

  const args = greybeardUpdateCommand(runtime);
  await writeFile(plistPath, launchdPlist(args, mode), {
    encoding: "utf8",
    mode: 0o600
  });
  await runtime.runCommand("launchctl", ["unload", plistPath]);
  const loaded = await runtime.runCommand("launchctl", ["load", "-w", plistPath]);
  return {
    configured: loaded.code === 0,
    detail: loaded.code === 0 ? `${mode} via launchd at ${plistPath}` : `${mode} launchd plist written, load failed`
  };
}

async function installCronSchedule(runtime: CliRuntime, mode: SkillUpdateMode): Promise<ScheduleResult> {
  const existing = await runtime.runCommand("crontab", ["-l"]);
  const body = existing.code === 0 ? existing.stdout : "";
  const next = replaceCronBlock(body, mode === "off" ? "" : cronLine(runtime, mode));
  const written = await runtime.runCommand("crontab", ["-"], {
    input: next
  });
  return {
    configured: mode !== "off" && written.code === 0,
    detail: mode === "off" ? "off" : written.code === 0 ? `${mode} via cron` : `${mode} cron update failed`
  };
}

async function installWindowsSchedule(runtime: CliRuntime, mode: SkillUpdateMode): Promise<ScheduleResult> {
  if (mode === "off") {
    await runtime.runCommand("schtasks", ["/Delete", "/TN", "GreybeardUpdate", "/F"]);
    return {
      configured: false,
      detail: "off"
    };
  }

  const command = greybeardUpdateCommand(runtime).map(windowsQuote).join(" ");
  const args = mode === "weekly"
    ? ["/Create", "/TN", "GreybeardUpdate", "/TR", command, "/SC", "WEEKLY", "/D", "SUN", "/ST", "09:00", "/F"]
    : ["/Create", "/TN", "GreybeardUpdate", "/TR", command, "/SC", "ONLOGON", "/F"];
  const result = await runtime.runCommand("schtasks", args);
  return {
    configured: result.code === 0,
    detail: result.code === 0 ? `${mode} via Task Scheduler` : `${mode} Task Scheduler update failed`
  };
}

function greybeardUpdateCommand(runtime: CliRuntime): string[] {
  return [
    runtime.nodePath,
    toPortablePath(join(runtime.repoRoot, "cli", "dist", "index.js")),
    "update"
  ];
}

function launchdPlist(args: string[], mode: SkillUpdateMode): string {
  const schedule = mode === "weekly"
    ? [
        "  <key>StartCalendarInterval</key>",
        "  <dict>",
        "    <key>Weekday</key>",
        "    <integer>1</integer>",
        "    <key>Hour</key>",
        "    <integer>9</integer>",
        "    <key>Minute</key>",
        "    <integer>0</integer>",
        "  </dict>"
      ]
    : [
        "  <key>RunAtLoad</key>",
        "  <true/>"
      ];
  return [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">",
    "<plist version=\"1.0\">",
    "<dict>",
    "  <key>Label</key>",
    "  <string>com.greybeard.update</string>",
    "  <key>ProgramArguments</key>",
    "  <array>",
    ...args.map((arg) => `    <string>${xmlEscape(arg)}</string>`),
    "  </array>",
    ...schedule,
    "</dict>",
    "</plist>",
    ""
  ].join("\n");
}

function cronLine(runtime: CliRuntime, mode: SkillUpdateMode): string {
  const command = greybeardUpdateCommand(runtime).map(shellQuote).join(" ");
  return mode === "weekly"
    ? `0 9 * * 0 ${command}`
    : `@reboot ${command}`;
}

function replaceCronBlock(existing: string, line: string): string {
  const start = "# GREYBEARD UPDATE START";
  const end = "# GREYBEARD UPDATE END";
  const block = line.length > 0 ? `${start}\n${line}\n${end}` : "";
  const pattern = new RegExp(`${escapeRegex(start)}[\\s\\S]*?${escapeRegex(end)}\\n?`, "u");
  const cleaned = existing.replace(pattern, "").trimEnd();
  if (block.length === 0) {
    return cleaned.length > 0 ? `${cleaned}\n` : "";
  }

  return cleaned.length > 0 ? `${cleaned}\n\n${block}\n` : `${block}\n`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/gu, "'\\''")}'`;
}

function windowsQuote(value: string): string {
  return `"${value.replace(/"/gu, "\\\"")}"`;
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function gateFromArgs(
  args: ParsedArgs,
  current: { cliApprove?: boolean } | undefined
): { cliApprove?: boolean } | undefined {
  if (hasFlag(args, "enable-cli-approve")) {
    return {
      cliApprove: true
    };
  }

  if (hasFlag(args, "disable-cli-approve")) {
    return {
      cliApprove: false
    };
  }

  return current;
}

async function responseText(response: ResponseLike): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
