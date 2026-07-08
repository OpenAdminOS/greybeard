import {
  DEFAULT_TIER1_SCOPES,
  GRAPH_CLI_CLIENT_ID,
  getGreybeardAppDataPath,
  graphAuthConfig,
  readGreybeardConfig,
  type AuthStatus,
  type CacheProtection,
  type GreybeardConfig
} from "@greybeard/graph";
import { flagValue, ParsedArgs } from "./args.js";
import {
  detectAllClients,
  inspectCodexMcpConfig,
  inspectCodexSkillFallback,
  inspectCodexSkillWiring,
  inspectCopilotMcpConfig,
  inspectCopilotSkillFallback,
  inspectCopilotSkillWiring,
  inspectCursorMcpConfig,
  inspectCursorSkillFallback,
  inspectCursorSkillWiring,
  inspectClaudeMcpConfig,
  inspectClaudeSkillWiring,
  inspectGeminiMcpConfig,
  inspectGeminiSkillFallback,
  inspectGeminiSkillWiring,
  type ClientDetection,
  type ClientMcpConfigResult,
  type InspectServerOptions,
  type KnownClientName,
  type SkillFallbackResult,
  type SkillWireResult
} from "./clients.js";
import { CliRuntime, writeLine, writeStatusLine } from "./runtime.js";
import { enabledCatalogServers } from "./serverCatalog.js";
import { loadSkillManifests, ROLE_GROUPS, type SkillManifestLoadResult } from "./skillManifest.js";

export type FindingLevel = "PASS" | "WARN" | "FAIL";

export type DoctorFinding = {
  level: FindingLevel;
  label: string;
  detail: string;
};

export async function runDoctor(args: ParsedArgs, runtime: CliRuntime): Promise<number> {
  const findings = await assembleDoctorFindings(args, runtime);
  writeLine(runtime.stdout, "Greybeard doctor");
  writeLine(runtime.stdout, "────────────────");
  for (const finding of findings) {
    writeStatusLine(runtime.stdout, finding.level, finding.label, finding.detail);
  }

  return findings.some((finding) => finding.level === "FAIL") ? 1 : 0;
}

export async function assembleDoctorFindings(args: ParsedArgs, runtime: CliRuntime): Promise<DoctorFinding[]> {
  const appDataPath = flagValue(args, "app-data") || runtime.env.GREYBEARD_APP_DATA || getGreybeardAppDataPath();
  const config = await readGreybeardConfig(appDataPath);
  const authConfig = graphAuthConfig(config);
  const activeAuth = await runtime.authFactory({
    ...authConfig,
    appDataPath,
    fetcher: runtime.fetcher
  });
  const status = await activeAuth.getStatus();
  const firstPartyAuth = await runtime.authFactory({
    tenantId: config.activeTenantId,
    clientId: GRAPH_CLI_CLIENT_ID,
    clientIdKind: "first-party",
    credentialMode: "read-only",
    writesConfigured: false,
    appDataPath,
    fetcher: runtime.fetcher
  });
  const firstPartyStatus = await firstPartyAuth.getStatus();

  const findings: DoctorFinding[] = [
    authFinding(status),
    cacheFinding(status.cacheProtection),
    entraFinding(status),
    rolesFinding(status),
    firstPartyFinding(firstPartyStatus),
    gateFinding(config),
    updateFinding(config)
  ];

  const manifests = await loadSkillManifests(runtime.repoRoot);
  const enabledServers = enabledCatalogServers(config.mcpServers ?? {}).map((server) => server.name);
  findings.push(...skillRequirementFindings(manifests, status, enabledServers));

  const clients = await detectAllClients(runtime, {
    githubCopilot: config.clients?.githubCopilot === true
  });
  const serverOptions: InspectServerOptions = {
    serverToggles: config.mcpServers ?? {}
  };
  for (const client of clients) {
    findings.push(...await clientFindings(client, runtime, serverOptions));
  }

  return findings;
}

function authFinding(status: AuthStatus): DoctorFinding {
  if (!status.signedIn) {
    return {
      level: "FAIL",
      label: "Sign-in",
      detail: status.instruction
    };
  }

  return {
    level: "PASS",
    label: "Sign-in",
    detail: `${status.account} on ${status.tenantDomain} (${status.credentialMode}, ${status.clientIdKind})`
  };
}

function cacheFinding(cacheProtection: CacheProtection): DoctorFinding {
  if (cacheProtection === "plaintext") {
    return {
      level: "FAIL",
      label: "Token cache",
      detail: "plaintext fallback in use. Configure a Linux keyring before using Greybeard on this host."
    };
  }

  return {
    level: "PASS",
    label: "Token cache",
    detail: cacheProtection
  };
}

function entraFinding(status: AuthStatus): DoctorFinding {
  if (!status.signedIn) {
    return {
      level: "WARN",
      label: "Entra P1",
      detail: "unknown until sign-in succeeds"
    };
  }

  if (status.entraP1 === true) {
    return {
      level: "PASS",
      label: "Entra P1",
      detail: "true"
    };
  }

  if (status.entraP1 === false) {
    return {
      level: "WARN",
      label: "Entra P1",
      detail: "false. P1-gated reports will degrade."
    };
  }

  return {
    level: "WARN",
    label: "Entra P1",
    detail: "unknown"
  };
}

function rolesFinding(status: AuthStatus): DoctorFinding {
  if (!status.signedIn) {
    return {
      level: "WARN",
      label: "Directory roles",
      detail: "unknown until sign-in succeeds"
    };
  }

  if (status.directoryRoles.length === 0) {
    return {
      level: "WARN",
      label: "Directory roles",
      detail: "none detected. Reports Reader, Security Reader, Global Reader, or higher may be required."
    };
  }

  return {
    level: "PASS",
    label: "Directory roles",
    detail: status.directoryRoles.join(", ")
  };
}

function firstPartyFinding(status: AuthStatus): DoctorFinding {
  if (status.signedIn) {
    const missing = DEFAULT_TIER1_SCOPES.filter((scope) => {
      return !status.grantedScopes.some((granted) => granted.toLowerCase() === scope.toLowerCase());
    });
    return {
      level: missing.length === 0 ? "PASS" : "WARN",
      label: "First-party app",
      detail: missing.length === 0
        ? "silent token acquisition succeeded"
        : `silent token succeeded, missing expected scopes: ${missing.join(", ")}`
    };
  }

  return {
    level: "FAIL",
    label: "First-party app",
    detail: "silent token acquisition failed"
  };
}

function gateFinding(config: GreybeardConfig): DoctorFinding {
  if (config.gate?.cliApprove === true) {
    return {
      level: "WARN",
      label: "CLI approval gate",
      detail: "on. Same-user shell access can imitate a terminal decision."
    };
  }

  return {
    level: "PASS",
    label: "CLI approval gate",
    detail: "off"
  };
}

function updateFinding(config: GreybeardConfig): DoctorFinding {
  return {
    level: "PASS",
    label: "Auto-update",
    detail: `skills ${config.skillUpdate ?? "weekly"}, servers ${config.serverUpdate ?? "latest"}, source ${config.serverPackageSource ?? "local"}`
  };
}

export function skillRequirementFindings(
  result: SkillManifestLoadResult,
  status: AuthStatus,
  enabledServers: string[]
): DoctorFinding[] {
  const findings: DoctorFinding[] = result.errors.map((error) => ({
    level: "WARN" as const,
    label: `Skill: ${error.name}`,
    detail: `SKILL.md manifest unreadable: ${error.message}`
  }));

  const declared = result.manifests.filter((manifest) => manifest.requires !== undefined);
  if (declared.length === 0) {
    return findings;
  }

  if (!status.signedIn) {
    findings.push({
      level: "WARN",
      label: "Skill requirements",
      detail: "unknown until sign-in succeeds"
    });
    return findings;
  }

  const grantedScopes = new Set(status.grantedScopes.map((scope) => scope.toLowerCase()));
  const heldRoles = new Set(status.directoryRoles.map((role) => role.toLowerCase()));
  const skillFindings: DoctorFinding[] = [];

  for (const manifest of declared) {
    const requires = manifest.requires ?? {};
    const unmet: string[] = [];

    for (const server of requires.servers ?? []) {
      if (!enabledServers.includes(server)) {
        unmet.push(`MCP server ${server} is not enabled; run greybeard setup --enable-server ${server}`);
      }
    }

    const missingScopes = (requires.scopes ?? []).filter((scope) => !grantedScopes.has(scope.toLowerCase()));
    if (missingScopes.length > 0) {
      unmet.push(`missing scopes ${missingScopes.join(", ")}; ask the agent to call add-scope, or re-run greybeard setup`);
    }

    if (requires.license === "entra-p1" && status.entraP1 !== true) {
      unmet.push(status.entraP1 === false
        ? "requires Entra ID P1; gated pillars will degrade"
        : "requires Entra ID P1; license status unknown");
    }

    for (const group of requires.roles ?? []) {
      const roles = ROLE_GROUPS[group];
      if (!roles) {
        unmet.push(`unknown role group ${group}`);
        continue;
      }

      if (!roles.some((role) => heldRoles.has(role.toLowerCase()))) {
        unmet.push(`requires one of these directory roles: ${roles.join(", ")}`);
      }
    }

    if (requires.writes === true && !status.gate.writesConfigured) {
      unmet.push("writes are not configured; run greybeard setup --writes");
    }

    if (unmet.length > 0) {
      skillFindings.push({
        level: "WARN",
        label: `Skill: ${manifest.name}`,
        detail: unmet.join("; ")
      });
    }
  }

  if (skillFindings.length === 0 && findings.length === 0) {
    return [{
      level: "PASS",
      label: "Skill requirements",
      detail: `declared requirements satisfied for all ${declared.length} skills`
    }];
  }

  return [...findings, ...skillFindings];
}

async function clientFindings(
  client: ClientDetection,
  runtime: CliRuntime,
  serverOptions: InspectServerOptions
): Promise<DoctorFinding[]> {
  if (!client.detected) {
    return [];
  }

  const [mcp, skills, fallback] = await Promise.all([
    inspectClientMcp(client.name, runtime, serverOptions),
    inspectClientSkills(client.name, runtime),
    inspectClientFallback(client.name, runtime)
  ]);
  return [
    mcpFinding(client.name, mcp, serverOptions),
    skillFinding(client.name, skills, fallback)
  ];
}

async function inspectClientMcp(
  name: KnownClientName,
  runtime: CliRuntime,
  options: InspectServerOptions
): Promise<ClientMcpConfigResult> {
  if (name === "Claude Code") {
    return {
      client: name,
      ...await inspectClaudeMcpConfig(runtime, options)
    };
  }

  if (name === "Cursor") {
    return inspectCursorMcpConfig(runtime, options);
  }

  if (name === "Codex CLI") {
    return inspectCodexMcpConfig(runtime, options);
  }

  if (name === "Gemini CLI") {
    return inspectGeminiMcpConfig(runtime, options);
  }

  return inspectCopilotMcpConfig(runtime, options);
}

async function inspectClientSkills(name: KnownClientName, runtime: CliRuntime): Promise<SkillWireResult> {
  if (name === "Claude Code") {
    return inspectClaudeSkillWiring(runtime);
  }

  if (name === "Cursor") {
    return inspectCursorSkillWiring(runtime);
  }

  if (name === "Codex CLI") {
    return inspectCodexSkillWiring(runtime);
  }

  if (name === "Gemini CLI") {
    return inspectGeminiSkillWiring(runtime);
  }

  return inspectCopilotSkillWiring(runtime);
}

async function inspectClientFallback(name: KnownClientName, runtime: CliRuntime): Promise<SkillFallbackResult | null> {
  if (name === "Cursor") {
    return inspectCursorSkillFallback(runtime);
  }

  if (name === "Codex CLI") {
    return inspectCodexSkillFallback(runtime);
  }

  if (name === "Gemini CLI") {
    return inspectGeminiSkillFallback(runtime);
  }

  if (name === "GitHub Copilot") {
    return inspectCopilotSkillFallback(runtime);
  }

  return null;
}

function mcpFinding(
  name: KnownClientName,
  mcp: ClientMcpConfigResult,
  serverOptions: InspectServerOptions
): DoctorFinding {
  const expected = enabledCatalogServers(serverOptions.serverToggles)
    .map((server) => server.name)
    .join(", ");
  if (mcp.configured) {
    return {
      level: "PASS",
      label: `${name} MCP`,
      detail: `${expected} present in ${mcp.path}`
    };
  }

  return {
    level: "FAIL",
    label: `${name} MCP`,
    detail: mcp.error || `one of ${expected} missing from ${mcp.path}`
  };
}

function skillFinding(
  name: KnownClientName,
  skills: SkillWireResult,
  fallback: SkillFallbackResult | null
): DoctorFinding {
  if (skills.empty) {
    return {
      level: "PASS",
      label: `${name} skills`,
      detail: `no skill folders found in ${skills.sourceDir}`
    };
  }

  const blocked = skills.entries.filter((entry) => entry.status === "blocked");
  if (blocked.length === 0) {
    return {
      level: "PASS",
      label: `${name} skills`,
      detail: `${skills.entries.length} skill links ready in ${skills.targetDir}`
    };
  }

  if (fallback?.configured) {
    return {
      level: "PASS",
      label: `${name} skills`,
      detail: `native links incomplete, fallback block present in ${fallback.path}`
    };
  }

  return {
    level: "FAIL",
    label: `${name} skills`,
    detail: blocked.map((entry) => `${entry.name}: ${entry.message || "not wired"}`).join("; ")
  };
}
