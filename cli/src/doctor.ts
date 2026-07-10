import {
  DEFAULT_TIER1_SCOPES,
  GRAPH_CLI_CLIENT_ID,
  getGreybeardAppDataPath,
  graphAuthConfig,
  readGreybeardConfig,
  TIER2_SCOPES,
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
  inspectClaudeMemoryHook,
  inspectClaudeSkillWiring,
  inspectGeminiMcpConfig,
  inspectGeminiSkillFallback,
  inspectGeminiSkillWiring,
  summarizeSkillWiring,
  type ClientDetection,
  type ClientMcpConfigResult,
  type InspectServerOptions,
  type KnownClientName,
  type SkillFallbackResult,
  type SkillWireResult
} from "./clients.js";
import { CliRuntime, writeLine, writeStatusLine } from "./runtime.js";
import { enabledCatalogServers, findCatalogServer } from "./serverCatalog.js";
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
    bootstrapCleanupFinding(config),
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

function bootstrapCleanupFinding(config: GreybeardConfig): DoctorFinding {
  if (config.bootstrapCleanupPending) {
    return {
      level: "FAIL",
      label: "Bootstrap cleanup",
      detail: "temporary permissions may remain. Run greybeard setup --writes to retry cleanup."
    };
  }
  return {
    level: "PASS",
    label: "Bootstrap cleanup",
    detail: "no pending cleanup recorded"
  };
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

  if (status.directoryRoles === null) {
    return {
      level: "WARN",
      label: "Directory roles",
      detail: `unknown. ${status.directoryRolesStatus.diagnostic ?? "Role detection was unavailable."}`
    };
  }

  if (status.directoryRoles.length === 0) {
    return {
      level: "WARN",
      label: "Directory roles",
      detail: `none detected. One of ${ROLE_GROUPS.reporting?.join(", ")} may be required for reporting endpoints.`
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
  const heldRoles = status.directoryRoles === null
    ? null
    : new Set(status.directoryRoles.map((role) => role.toLowerCase()));
  const tier2Scopes = new Set(TIER2_SCOPES.map((scope) => scope.toLowerCase()));
  const onDemand: string[] = [];
  const warnCountBefore = findings.length;

  for (const manifest of declared) {
    const requires = manifest.requires;
    if (requires === undefined) {
      continue;
    }

    const unmet: string[] = [];
    // Capabilities the product grants on demand by design are informational,
    // not warnings; a default install must be able to come out clean.
    const pending: string[] = [];

    for (const server of requires.servers ?? []) {
      if (!enabledServers.includes(server)) {
        unmet.push(`MCP server ${server} is not enabled; run greybeard setup --enable-server ${server}`);
      }
    }

    const missingScopes = (requires.scopes ?? []).filter((scope) => !grantedScopes.has(scope.toLowerCase()));
    const missingTier2 = missingScopes.filter((scope) => tier2Scopes.has(scope.toLowerCase()));
    const missingTier1 = missingScopes.filter((scope) => !tier2Scopes.has(scope.toLowerCase()));
    if (missingTier1.length > 0) {
      unmet.push(`missing scopes ${missingTier1.join(", ")}; ask the agent to call add-scope, or re-run greybeard setup`);
    }

    if (missingTier2.length > 0) {
      pending.push(`Tier 2 scopes ${missingTier2.join(", ")} granted on first use`);
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

      if (heldRoles === null) {
        unmet.push(`directory role status unknown: ${status.directoryRolesStatus.diagnostic ?? "role detection unavailable"}`);
      } else if (!roles.some((role) => heldRoles.has(role.toLowerCase()))) {
        unmet.push(`requires one of these directory roles: ${roles.join(", ")}`);
      }
    }

    if (requires.writes === true && !status.gate.writesConfigured) {
      pending.push("writes stay off until greybeard setup --writes");
    }

    if (unmet.length > 0) {
      findings.push({
        level: "WARN",
        label: `Skill: ${manifest.name}`,
        detail: [...unmet, ...pending].join("; ")
      });
    } else if (pending.length > 0) {
      onDemand.push(`${manifest.name} (${pending.join("; ")})`);
    }
  }

  const allSatisfied = findings.length === warnCountBefore && result.errors.length === 0;
  if (allSatisfied) {
    findings.push({
      level: "PASS",
      label: "Skill requirements",
      detail: onDemand.length > 0
        ? `satisfied; optional capabilities not yet enabled: ${onDemand.join(", ")}`
        : `declared requirements satisfied for all ${declared.length} skills`
    });
  } else if (onDemand.length > 0) {
    findings.push({
      level: "PASS",
      label: "Skill requirements",
      detail: `optional capabilities not yet enabled: ${onDemand.join(", ")}`
    });
  }

  return findings;
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
  const findings = [
    mcpFinding(client.name, mcp, serverOptions),
    skillFinding(client.name, skills, fallback)
  ];
  findings.push(client.name === "Claude Code"
    ? await memoryHookFinding(runtime)
    : contextBlockFinding(client.name, fallback));
  return findings;
}

async function memoryHookFinding(runtime: CliRuntime): Promise<DoctorFinding> {
  const hook = await inspectClaudeMemoryHook(runtime);
  if (hook.configured) {
    return {
      level: "PASS",
      label: "Claude Code memory hook",
      detail: `recall hook present in ${hook.path}`
    };
  }

  return {
    level: "WARN",
    label: "Claude Code memory hook",
    detail: "recall hook missing; run greybeard setup to install it"
  };
}

function contextBlockFinding(name: KnownClientName, fallback: SkillFallbackResult | null): DoctorFinding {
  if (fallback?.configured) {
    return {
      level: "PASS",
      label: `${name} context block`,
      detail: `memory and skill guidance present in ${fallback.path}`
    };
  }

  return {
    level: "WARN",
    label: `${name} context block`,
    detail: fallback
      ? `context block missing from ${fallback.path}; run greybeard update`
      : "context block missing; run greybeard update"
  };
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

  const missing = mcp.missingServers ?? [];
  const missingCore = missing.filter((serverName) => findCatalogServer(serverName)?.required !== false);
  if (missing.length > 0 && missingCore.length === 0) {
    return {
      level: "WARN",
      label: `${name} MCP`,
      detail: `optional servers not configured yet: ${missing.join(", ")}. Run greybeard update to add them, or greybeard setup --disable-server <name> to drop one.`
    };
  }

  return {
    level: "FAIL",
    label: `${name} MCP`,
    detail: mcp.error || `${missing.length > 0 ? missing.join(", ") : `one of ${expected}`} missing from ${mcp.path}`
  };
}

function skillFinding(
  name: KnownClientName,
  skills: SkillWireResult,
  fallback: SkillFallbackResult | null
): DoctorFinding {
  const summary = summarizeSkillWiring(skills);
  if (summary.ok) {
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

  const blocked = skills.entries.filter((entry) => entry.status === "blocked");
  return {
    level: "FAIL",
    label: `${name} skills`,
    detail: blocked.length > 0
      ? blocked.map((entry) => `${entry.name}: ${entry.message || "not wired"}`).join("; ")
      : summary.detail
  };
}
