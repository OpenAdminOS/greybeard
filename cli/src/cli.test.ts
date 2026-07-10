import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, readlink, writeFile, symlink } from "node:fs/promises";
import { PassThrough } from "node:stream";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_TIER1_SCOPES,
  GRAPH_CLI_CLIENT_ID,
  readGreybeardConfig,
  scopeJustification,
  writeGreybeardConfig,
  type AuthStatus,
  type AuthToken,
  type FetchLike,
  type ResponseLike
} from "@greybeard/graph";
import { MemoryService, memoryDbPath } from "@greybeard/memory";
import { parseArgs } from "./args.js";
import { runApprove } from "./approve.js";
import {
  codexAuthPath,
  codexConfigPath,
  codexFallbackPath,
  copilotFallbackPath,
  copilotMcpConfigPath,
  copilotSkillsDir,
  cursorFallbackPath,
  cursorMcpConfigPath,
  cursorSkillsDir,
  detectCodexCli,
  detectClaudeCode,
  detectGithubCopilot,
  detectCursor,
  detectGeminiCli,
  geminiFallbackPath,
  geminiSettingsPath,
  geminiSkillsDir,
  listSkillSourceDirs,
  repoSkillsDir,
  wireClaudeSkills,
  writeClaudeMcpConfig,
  writeClaudeMemoryHook,
  writeCodexMcpConfig,
  writeCodexSkillFallback,
  writeCopilotMcpConfig,
  writeCopilotSkillFallback,
  writeCursorMcpConfig,
  writeCursorSkillFallback,
  writeGeminiMcpConfig,
  writeGeminiSkillFallback
} from "./clients.js";
import { assembleDoctorFindings, skillRequirementFindings } from "./doctor.js";
import { runCli } from "./index.js";
import { CliRuntime, OutputStream } from "./runtime.js";
import { ensureWorkspaceApplication, installAutoUpdateSchedule } from "./setup.js";

describe("greybeard CLI", () => {
  it("runs help when the built CLI is invoked through a symlink", async () => {
    const builtCli = resolve("dist", "index.js");
    if (!await pathExists(builtCli)) {
      return;
    }

    const paths = await tempPaths();
    const symlinkPath = join(paths.root, "greybeard");
    try {
      await symlink(builtCli, symlinkPath, "file");
    } catch (error) {
      if (isNodeError(error) && (error.code === "EPERM" || error.code === "EACCES")) {
        return;
      }

      throw error;
    }

    const result = await runNode(symlinkPath);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Greybeard CLI");
    expect(result.stdout).toContain("greybeard setup");
  });

  it("prints an admin consent handoff when setup cannot complete Tier 1 consent", async () => {
    const paths = await tempPaths();
    const runtime = createMockRuntime(paths, {
      authFactory: async () => ({
        async getToken() {
          throw new Error("AADSTS65001 admin consent required");
        },
        async getStatus() {
          return unsignedStatus();
        },
        async addScopes() {
          throw new Error("unused");
        }
      })
    });

    const code = await runCli(["setup", "--app-data", paths.appData, "--tenant", "tenant-id"], runtime);

    expect(code).toBe(0);
    expect(runtime.stdout.toString()).toContain("Admin consent required.");
    expect(runtime.stdout.toString()).toContain("https://login.microsoftonline.com/tenant-id/v2.0/adminconsent");
    expect(runtime.stdout.toString()).toContain("User.Read.All: Read users for identity and account hygiene reports.");
    expect(runtime.stdout.toString()).toContain("After consent, resume with: greybeard setup");
  });

  it("prints first-party sign-in transparency before setup auth and every Tier 1 scope via greybeard scopes", async () => {
    const paths = await tempPaths();
    const runtime = createMockRuntime(paths);

    const code = await runCli(["setup", "--yes", "--app-data", paths.appData], runtime);

    expect(code).toBe(0);
    const output = runtime.stdout.toString();
    expect(output).toContain("Sign in to Microsoft");
    expect(output).toContain("Microsoft's own sign-in page (login.microsoftonline.com) with");
    expect(output).toContain("the first-party Microsoft Graph Command Line Tools app");
    expect(output).toContain(`(app ID ${GRAPH_CLI_CLIENT_ID})`);
    expect(output).toContain("Greybeard never sees your password, registers no app of its own,");
    expect(output).toContain("and cannot write to your tenant.");
    expect(output).toContain(`Requests ${DEFAULT_TIER1_SCOPES.length} read-only scopes`);
    expect(output).toContain("Run greybeard scopes for the full list and reasons.");
    expect(output).toContain("OK    Signed in");

    const scopesRuntime = createMockRuntime(paths);
    expect(await runCli(["scopes"], scopesRuntime)).toBe(0);
    const scopesOutput = scopesRuntime.stdout.toString();
    expect(scopesOutput).toContain(GRAPH_CLI_CLIENT_ID);
    expect(scopesOutput).toContain("greybeard setup --writes");
    for (const scope of DEFAULT_TIER1_SCOPES) {
      expect(scopesOutput).toContain(scope);
      expect(scopesOutput).toContain(scopeJustification(scope));
    }
  });

  it("pauses for confirmation before setup token acquisition in interactive mode", async () => {
    const paths = await tempPaths();
    const events: string[] = [];
    const runtime = createMockRuntime(paths, {
      confirm: async (prompt) => {
        events.push(`confirm:${prompt}`);
        return "confirmed";
      },
      authFactory: async () => ({
        async getToken() {
          events.push("getToken");
          return signedInToken();
        },
        async getStatus() {
          return signedInStatus();
        },
        async addScopes(input) {
          return {
            granted: true,
            alreadyGranted: [],
            requestedScopes: input.scopes,
            grantedScopes: input.scopes
          };
        }
      })
    });

    const code = await runCli(["setup", "--app-data", paths.appData], runtime);

    expect(code).toBe(0);
    expect(events[0]).toContain("Press Enter to open your browser");
    expect(events[1]).toBe("getToken");
  });

  it("skips the sign-in pause with --yes and proceeds non-interactively without a TTY", async () => {
    const yesPaths = await tempPaths();
    const yesConfirm = vi.fn<CliRuntime["confirm"]>(async () => "confirmed");
    const yesRuntime = createMockRuntime(yesPaths, {
      confirm: yesConfirm
    });

    const yesCode = await runCli(["setup", "--yes", "--app-data", yesPaths.appData], yesRuntime);

    expect(yesCode).toBe(0);
    expect(yesConfirm).not.toHaveBeenCalled();
    expect(yesRuntime.stdout.toString()).toContain("skipped by --yes");

    const nonInteractivePaths = await tempPaths();
    const nonInteractiveConfirm = vi.fn<CliRuntime["confirm"]>(async () => "non-interactive");
    const nonInteractiveRuntime = createMockRuntime(nonInteractivePaths, {
      confirm: nonInteractiveConfirm
    });

    const nonInteractiveCode = await runCli(["setup", "--app-data", nonInteractivePaths.appData], nonInteractiveRuntime);

    expect(nonInteractiveCode).toBe(0);
    expect(nonInteractiveConfirm).toHaveBeenCalled();
    expect(nonInteractiveRuntime.stdout.toString()).toContain("proceeding non-interactively");
  });

  it("aborts setup cleanly when sign-in confirmation is cancelled", async () => {
    const paths = await tempPaths();
    const getToken = vi.fn(async () => signedInToken());
    const runtime = createMockRuntime(paths, {
      confirm: async () => "cancelled",
      authFactory: async () => ({
        getToken,
        async getStatus() {
          return signedInStatus();
        },
        async addScopes(input) {
          return {
            granted: true,
            alreadyGranted: [],
            requestedScopes: input.scopes,
            grantedScopes: input.scopes
          };
        }
      })
    });

    const code = await runCli(["setup", "--app-data", paths.appData], runtime);

    expect(code).toBe(0);
    expect(runtime.stdout.toString()).toContain("Sign-in cancelled, re-run greybeard setup");
    expect(getToken).not.toHaveBeenCalled();
  });

  it("assembles doctor findings for auth, plaintext cache, Claude MCP, skills, and gate state", async () => {
    const paths = await tempPaths();
    await writeGreybeardConfig(paths.appData, {
      activeTenantId: "tenant-id",
      credentialMode: "read-only",
      gate: {
        cliApprove: true
      }
    });
    const runtime = createMockRuntime(paths, {
      findExecutable: async (command) => command === "claude" ? "/usr/local/bin/claude" : null,
      authFactory: async () => ({
        async getToken() {
          return signedInToken({
            cacheProtection: "plaintext"
          });
        },
        async getStatus() {
          return signedInStatus({
            cacheProtection: "plaintext",
            entraP1: null,
            directoryRoles: []
          });
        },
        async addScopes(input) {
          return {
            granted: true,
            alreadyGranted: [],
            requestedScopes: input.scopes,
            grantedScopes: input.scopes
          };
        }
      })
    });
    await writeClaudeMcpConfig(runtime);
    await createSkillFixture(paths.repoRoot, "read", "tenant-pulse");
    await wireClaudeSkills(runtime);

    const findings = await assembleDoctorFindings(parseArgs(["doctor", "--app-data", paths.appData]), runtime);

    expect(findings).toContainEqual(expect.objectContaining({
      level: "PASS",
      label: "Sign-in"
    }));
    expect(findings).toContainEqual(expect.objectContaining({
      level: "FAIL",
      label: "Token cache"
    }));
    expect(findings).toContainEqual(expect.objectContaining({
      level: "PASS",
      label: "First-party app"
    }));
    expect(findings).toContainEqual(expect.objectContaining({
      level: "PASS",
      label: "Claude Code MCP"
    }));
    expect(findings).toContainEqual(expect.objectContaining({
      level: "PASS",
      label: "Claude Code skills"
    }));
    expect(findings).not.toContainEqual(expect.objectContaining({
      label: "Cursor MCP"
    }));
    expect(findings).not.toContainEqual(expect.objectContaining({
      label: "Gemini CLI MCP"
    }));
    expect(findings).not.toContainEqual(expect.objectContaining({
      label: "GitHub Copilot MCP"
    }));
    expect(findings).toContainEqual(expect.objectContaining({
      level: "WARN",
      label: "CLI approval gate"
    }));
    expect(findings).toContainEqual(expect.objectContaining({
      level: "WARN",
      label: "Claude Code memory hook"
    }));
  });

  it("reports context block findings for non-Claude clients in doctor", async () => {
    const paths = await tempPaths();
    const runtime = createMockRuntime(paths, {
      findExecutable: async (command) => command === "codex" ? "/usr/local/bin/codex" : null
    });

    const missing = await assembleDoctorFindings(parseArgs(["doctor", "--app-data", paths.appData]), runtime);
    expect(missing).toContainEqual(expect.objectContaining({
      level: "WARN",
      label: "Codex CLI context block"
    }));

    await writeCodexSkillFallback(runtime);
    const present = await assembleDoctorFindings(parseArgs(["doctor", "--app-data", paths.appData]), runtime);
    expect(present).toContainEqual(expect.objectContaining({
      level: "PASS",
      label: "Codex CLI context block"
    }));
  });

  it("reports skill requirements against granted scopes, servers, writes, and roles", () => {
    const manifest = (name: string, requires: Record<string, unknown>) => ({
      name,
      category: "read",
      dir: `/repo/.agents/skills/read/${name}`,
      description: `Use when testing ${name}.`,
      version: "0.2.0",
      requires
    });
    const status = signedInStatus({
      grantedScopes: ["User.Read.All", "Group.Read.All"],
      directoryRoles: ["Global Reader"],
      entraP1: true
    });

    const satisfied = skillRequirementFindings({
      manifests: [manifest("ask-my-tenant", { servers: ["greybeard-graph"], scopes: ["User.Read.All"] })],
      errors: []
    }, status, ["greybeard-graph", "greybeard-memory"]);
    expect(satisfied).toEqual([expect.objectContaining({
      level: "PASS",
      label: "Skill requirements"
    })]);

    const unmet = skillRequirementFindings({
      manifests: [
        manifest("tenant-pulse", { scopes: ["Reports.Read.All"], roles: ["reporting"] }),
        manifest("change-plan", { writes: true }),
        manifest("intune-compliance", { scopes: ["DeviceManagementManagedDevices.Read.All"] }),
        manifest("intune-assignments", { servers: ["intuneautomation"] })
      ],
      errors: [{ name: "broken-skill", message: "Unknown requires key: gpus" }]
    }, status, ["greybeard-graph"]);

    expect(unmet).toContainEqual(expect.objectContaining({
      level: "WARN",
      label: "Skill: broken-skill",
      detail: expect.stringContaining("Unknown requires key")
    }));
    expect(unmet).toContainEqual(expect.objectContaining({
      level: "WARN",
      label: "Skill: tenant-pulse",
      detail: expect.stringContaining("missing scopes Reports.Read.All; ask the agent to call add-scope")
    }));
    expect(unmet).toContainEqual(expect.objectContaining({
      level: "WARN",
      label: "Skill: intune-assignments",
      detail: expect.stringContaining("greybeard setup --enable-server intuneautomation")
    }));
    expect(unmet).not.toContainEqual(expect.objectContaining({
      label: "Skill: change-plan"
    }));
    expect(unmet).not.toContainEqual(expect.objectContaining({
      label: "Skill: intune-compliance"
    }));
    expect(unmet).toContainEqual(expect.objectContaining({
      level: "PASS",
      label: "Skill requirements",
      detail: expect.stringContaining("optional capabilities not yet enabled: change-plan (writes stay off until greybeard setup --writes), intune-compliance (Tier 2 scopes DeviceManagementManagedDevices.Read.All granted on first use)")
    }));
    expect(unmet).not.toContainEqual(expect.objectContaining({
      detail: expect.stringContaining("directory roles")
    }));

    const signedOut = skillRequirementFindings({
      manifests: [manifest("tenant-pulse", { scopes: ["Reports.Read.All"] })],
      errors: []
    }, {
      signedIn: false,
      instruction: "run greybeard setup",
      account: null,
      tenantId: null,
      tenantDomain: null,
      activeTenantAlias: "organizations",
      cacheProtection: "keyring"
    } as AuthStatus, ["greybeard-graph"]);
    expect(signedOut).toEqual([expect.objectContaining({
      level: "WARN",
      label: "Skill requirements",
      detail: "unknown until sign-in succeeds"
    })]);
  });

  it("rejects unknown --enable-server names before any sign-in happens", async () => {
    const paths = await tempPaths();
    const getToken = vi.fn();
    const runtime = createMockRuntime(paths, {
      authFactory: async () => ({
        getToken,
        async getStatus() {
          return signedInStatus();
        },
        async addScopes() {
          throw new Error("not used");
        }
      })
    });

    const code = await runCli(["setup", "--yes", "--enable-server", "intune", "--app-data", paths.appData], runtime);

    expect(code).toBe(1);
    expect(runtime.stderr.toString()).toContain("Unknown MCP server: intune");
    expect(getToken).not.toHaveBeenCalled();

    const coreCode = await runCli(["setup", "--yes", "--disable-server", "greybeard-graph", "--app-data", paths.appData], runtime);
    expect(coreCode).toBe(1);
    expect(runtime.stderr.toString()).toContain("core Greybeard server");
    expect(getToken).not.toHaveBeenCalled();
  });

  it("preserves user-defined MCP entries and honors pinned versions for npm servers", async () => {
    const paths = await tempPaths();
    const runtime = createMockRuntime(paths);
    const configPath = join(paths.home, ".claude.json");
    const userEntry = {
      command: "docker",
      args: ["run", "--rm", "my-intune-image"],
      env: { INTUNE_TENANT: "contoso" }
    };
    await writeFile(configPath, JSON.stringify({ mcpServers: { intuneautomation: userEntry } }), "utf8");

    const result = await writeClaudeMcpConfig(runtime);
    expect(result.preservedServers).toEqual(["intuneautomation"]);
    const written = JSON.parse(await readFile(configPath, "utf8")) as {
      mcpServers: Record<string, { command: string; args: string[] }>;
    };
    expect(written.mcpServers.intuneautomation).toEqual(userEntry);
    expect(written.mcpServers["greybeard-graph"].args[0]).toContain("graph/dist/index.js");

    const pinnedPaths = await tempPaths();
    const pinnedRuntime = createMockRuntime(pinnedPaths);
    await writeClaudeMcpConfig(pinnedRuntime, { serverUpdate: "pinned", serverPackageSource: "npm" });
    const pinned = JSON.parse(await readFile(join(pinnedPaths.home, ".claude.json"), "utf8")) as {
      mcpServers: Record<string, { args: string[] }>;
    };
    expect(pinned.mcpServers.intuneautomation.args[1]).toMatch(/^@ugurkocde\/intuneautomation-mcp@\d+\.\d+\.\d+$/);
    expect(pinned.mcpServers.intuneautomation.args[1]).not.toContain("@latest");
  });

  it("reports missing optional servers as WARN, not FAIL, in doctor", async () => {
    const paths = await tempPaths();
    const runtime = createMockRuntime(paths, {
      findExecutable: async (command) => command === "claude" ? "/usr/local/bin/claude" : null
    });
    await createSkillFixture(paths.repoRoot, "read", "tenant-pulse");
    await wireClaudeSkills(runtime);
    // Pre-catalog install shape: only the two core servers are configured.
    await writeFile(join(paths.home, ".claude.json"), JSON.stringify({
      mcpServers: {
        "greybeard-graph": { command: "node", args: ["graph/dist/index.js"], env: {} },
        "greybeard-memory": { command: "node", args: ["memory/dist/index.js"], env: {} }
      }
    }), "utf8");

    const findings = await assembleDoctorFindings(parseArgs(["doctor", "--app-data", paths.appData]), runtime);

    expect(findings).toContainEqual(expect.objectContaining({
      level: "WARN",
      label: "Claude Code MCP",
      detail: expect.stringContaining("optional servers not configured yet: intuneautomation")
    }));
    expect(findings).not.toContainEqual(expect.objectContaining({
      level: "FAIL",
      label: "Claude Code MCP"
    }));
  });

  it("refuses greybeard approve without an interactive TTY", async () => {
    const paths = await tempPaths();
    const fetcher = vi.fn<FetchLike>();
    const runtime = createMockRuntime(paths, {
      stdinIsTTY: false,
      fetcher
    });

    const code = await runApprove(parseArgs(["approve", "--app-data", paths.appData]), runtime);

    expect(code).toBe(1);
    expect(runtime.stderr.toString()).toContain("requires an interactive TTY");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("posts an approval decision to the pending plan loopback endpoint", async () => {
    const paths = await tempPaths();
    await writeGreybeardConfig(paths.appData, {
      gate: {
        cliApprove: true
      }
    });
    await mkdir(join(paths.appData, "pending"), { recursive: true });
    await writeFile(join(paths.appData, "pending", "gbp_1234abcd.json"), JSON.stringify({
      planId: "gbp_1234abcd",
      loopbackPort: 34567,
      approvalDeadline: "2026-07-04T13:10:00Z",
      rendered: "Plan gbp_1234abcd\nDELETE v1.0 /groups/1"
    }), "utf8");

    const fetcher = vi.fn<FetchLike>().mockResolvedValue(jsonResponse({
      ok: true
    }));
    const runtime = createMockRuntime(paths, {
      stdinIsTTY: true,
      fetcher
    });

    const code = await runApprove(parseArgs([
      "approve",
      "--app-data",
      paths.appData,
      "--decision",
      "approved",
      "--reason",
      "looks correct"
    ]), runtime);

    expect(code).toBe(0);
    expect(runtime.stdout.toString()).toContain("Plan gbp_1234abcd");
    expect(fetcher).toHaveBeenCalledWith(
      "http://127.0.0.1:34567/cli/plan/gbp_1234abcd/decision",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          decision: "approved",
          reason: "looks correct"
        })
      })
    );
  });

  it("uses Application.ReadWrite.All for setup --writes bootstrap", async () => {
    const paths = await tempPaths();
    const requestedScopes: string[][] = [];
    const fetcher = vi.fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse({
        value: [
          {
            id: "graph-service-principal-id",
            publishedPermissionScopes: [
              ...[
                "User.Read.All",
                "Group.Read.All",
                "Policy.Read.All",
                "Organization.Read.All",
                "AuditLog.Read.All",
                "Reports.Read.All",
                "User.ReadWrite.All",
                "Group.ReadWrite.All",
                "Policy.ReadWrite.ConditionalAccess"
              ].map((value, index) => ({
                value,
                id: `scope-${index}`
              }))
            ]
          }
        ]
      }))
      .mockResolvedValueOnce(jsonResponse({
        id: "application-object-id",
        appId: "workspace-client-id",
        displayName: "Greybeard Workspace contoso.com"
      }, 201))
      .mockResolvedValueOnce(jsonResponse({ value: [] }))
      .mockResolvedValueOnce(jsonResponse({
        id: "service-principal-id"
      }, 201))
      .mockResolvedValueOnce(jsonResponse({
        value: [{
          id: "graph-service-principal-id",
          publishedPermissionScopes: []
        }]
      }))
      .mockResolvedValueOnce(jsonResponse({ value: [{ id: "graph-cli-service-principal-id" }] }))
      .mockResolvedValueOnce(jsonResponse({
        value: [{
          id: "bootstrap-grant-id",
          scope: "User.Read.All Application.ReadWrite.All DelegatedPermissionGrant.ReadWrite.All"
        }]
      }))
      .mockResolvedValueOnce(jsonResponse(null, 204));
    const runtime = createMockRuntime(paths, {
      fetcher,
      authFactory: async () => ({
        async getToken(scopes) {
          requestedScopes.push(scopes);
          return signedInToken({
            grantedScopes: [...DEFAULT_TIER1_SCOPES, "Directory.Read.All"]
          });
        },
        async getStatus() {
          return signedInStatus();
        },
        async addScopes(input) {
          return {
            granted: true,
            alreadyGranted: [],
            requestedScopes: input.scopes,
            grantedScopes: input.scopes
          };
        }
      })
    });

    const code = await runCli(["setup", "--writes", "--app-data", paths.appData], runtime);

    expect(code).toBe(0);
    expect(requestedScopes.flat()).toContain("Application.ReadWrite.All");
    expect(requestedScopes.flat()).not.toContain("Application.ReadWrite.OwnedBy");
    expect(runtime.stdout.toString()).toContain("      note: Application.ReadWrite.All and DelegatedPermissionGrant.ReadWrite.All are temporary bootstrap scopes");
    expect(runtime.stdout.toString()).toContain("OK    Bootstrap scopes");
    expect(runtime.stdout.toString()).not.toContain("WARN  Bootstrap");
    expect(runtime.stdout.toString()).toContain("redirect_uri=http%3A%2F%2Flocalhost");

    const applicationCall = fetcher.mock.calls.find(([url, init]) => {
      return new URL(url).pathname === "/v1.0/applications" && init.method === "POST";
    });
    const applicationBody = JSON.parse(String(applicationCall?.[1].body)) as {
      isFallbackPublicClient: boolean;
      publicClient: { redirectUris: string[] };
      requiredResourceAccess: Array<{ resourceAccess: Array<{ id: string }> }>;
    };
    expect(applicationBody).toMatchObject({
      isFallbackPublicClient: true,
      publicClient: { redirectUris: ["http://localhost"] }
    });
    expect(JSON.stringify(applicationBody)).not.toContain("Directory.Read.All");
    expect((await readGreybeardConfig(paths.appData)).grantedReadScopes).toEqual([...DEFAULT_TIER1_SCOPES]);
    expect((await readGreybeardConfig(paths.appData)).bootstrapCleanupPending).toBe(false);
  });

  it("accepts the legacy delegated-scope property and repairs an existing workspace app idempotently", async () => {
    const fetcher = vi.fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse({ error: { message: "unknown property publishedPermissionScopes" } }, 400))
      .mockResolvedValueOnce(jsonResponse({
        value: [{
          id: "graph-sp-id",
          oauth2PermissionScopes: [{ id: "scope-id", value: "Group.ReadWrite.All" }]
        }]
      }))
      .mockResolvedValueOnce(jsonResponse({
        value: [{ id: "app-object-id", appId: "workspace-id", displayName: "Old name" }]
      }))
      .mockResolvedValueOnce(jsonResponse(null, 204))
      .mockResolvedValueOnce(jsonResponse({ value: [{ id: "workspace-sp-id", appId: "workspace-id" }] }));

    const workspace = await ensureWorkspaceApplication({
      fetcher,
      accessToken: "token",
      tenantDomain: "contoso.com",
      scopes: ["Group.ReadWrite.All"],
      existingAppId: "workspace-id"
    });

    expect(workspace.appId).toBe("workspace-id");
    expect(fetcher.mock.calls[0]?.[0]).toContain("publishedPermissionScopes");
    expect(fetcher.mock.calls[1]?.[0]).toContain("oauth2PermissionScopes");
    const patchCall = fetcher.mock.calls.find(([_url, init]) => init.method === "PATCH");
    expect(patchCall?.[0]).toContain("/v1.0/applications/app-object-id");
    expect(JSON.parse(String(patchCall?.[1].body))).toMatchObject({
      isFallbackPublicClient: true,
      publicClient: { redirectUris: ["http://localhost"] }
    });
    expect(fetcher.mock.calls.filter(([_url, init]) => init.method === "POST")).toHaveLength(0);
  });

  it("rolls back a newly created application when service-principal creation fails", async () => {
    const fetcher = vi.fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse({
        value: [{
          id: "graph-sp-id",
          publishedPermissionScopes: [{ id: "scope-id", value: "Group.ReadWrite.All" }]
        }]
      }))
      .mockResolvedValueOnce(jsonResponse({
        id: "app-object-id",
        appId: "workspace-id",
        displayName: "Greybeard Workspace contoso.com"
      }, 201))
      .mockResolvedValueOnce(jsonResponse({ value: [] }))
      .mockResolvedValueOnce(jsonResponse({ error: { message: "creation failed" } }, 500))
      .mockResolvedValueOnce(jsonResponse(null, 204));

    await expect(ensureWorkspaceApplication({
      fetcher,
      accessToken: "token",
      tenantDomain: "contoso.com",
      scopes: ["Group.ReadWrite.All"]
    })).rejects.toThrow("servicePrincipals");

    expect(fetcher).toHaveBeenCalledWith(
      "https://graph.microsoft.com/v1.0/applications/app-object-id",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("writes Claude memory MCP config and installs the recall hook by default during setup", async () => {
    const paths = await tempPaths();
    const runtime = createMockRuntime(paths, {
      findExecutable: async (command) => command === "claude" ? "/usr/local/bin/claude" : null
    });

    const code = await runCli(["setup", "--app-data", paths.appData, "--verbose"], runtime);

    expect(code).toBe(0);
    expect(runtime.stdout.toString()).toContain("OK    Memory");
    expect(runtime.stdout.toString()).toContain(memoryDbPath(paths.appData));
    const claudeConfig = JSON.parse(await readFile(join(paths.home, ".claude.json"), "utf8")) as {
      mcpServers: Record<string, { args: string[] }>;
    };
    expect(claudeConfig.mcpServers["greybeard-graph"].args[0]).toContain("graph/dist/index.js");
    expect(claudeConfig.mcpServers["greybeard-memory"].args[0]).toContain("memory/dist/index.js");
    expect(claudeConfig.mcpServers["intuneautomation"].args).toEqual(["-y", "@ugurkocde/intuneautomation-mcp@latest"]);

    const claudeSettings = JSON.parse(await readFile(join(paths.home, ".claude", "settings.json"), "utf8")) as {
      hooks: { UserPromptSubmit: Array<{ hooks: Array<{ args: string[] }> }> };
    };
    expect(claudeSettings.hooks.UserPromptSubmit[0]?.hooks[0]?.args[1]).toContain("greybeard-memory recall");
    expect(claudeSettings.hooks.UserPromptSubmit[0]?.hooks[0]?.args[1]).toContain("greybeard-memory remember");
  });

  it("skips the recall hook with --no-memory-hook and keeps it off across reruns and update", async () => {
    const paths = await tempPaths();
    const claudeOnly = async (command: string) => command === "claude" ? "/usr/local/bin/claude" : null;

    const optOutRuntime = createMockRuntime(paths, { findExecutable: claudeOnly });
    expect(await runCli(["setup", "--yes", "--app-data", paths.appData, "--no-memory-hook"], optOutRuntime)).toBe(0);
    expect(optOutRuntime.stdout.toString()).toContain("off; re-run greybeard setup --memory-hook");
    expect(await pathExists(join(paths.home, ".claude", "settings.json"))).toBe(false);
    expect((await readGreybeardConfig(paths.appData)).memoryHook).toBe(false);

    const rerunRuntime = createMockRuntime(paths, { findExecutable: claudeOnly });
    expect(await runCli(["setup", "--yes", "--app-data", paths.appData], rerunRuntime)).toBe(0);
    expect(await pathExists(join(paths.home, ".claude", "settings.json"))).toBe(false);

    const updateRuntime = createMockRuntime(paths, {
      findExecutable: claudeOnly,
      runCommand: mockUpdateGit([])
    });
    expect(await runCli(["update", "--app-data", paths.appData], updateRuntime)).toBe(0);
    expect(updateRuntime.stdout.toString()).toContain("memory hook off by setup choice");
    expect(await pathExists(join(paths.home, ".claude", "settings.json"))).toBe(false);

    const reenableRuntime = createMockRuntime(paths, { findExecutable: claudeOnly });
    expect(await runCli(["setup", "--yes", "--app-data", paths.appData, "--memory-hook"], reenableRuntime)).toBe(0);
    expect((await readGreybeardConfig(paths.appData)).memoryHook).toBe(true);
    expect(await pathExists(join(paths.home, ".claude", "settings.json"))).toBe(true);
  });

  it("replaces the old recall hook text instead of stacking a duplicate", async () => {
    const paths = await tempPaths();
    const runtime = createMockRuntime(paths);
    const oldReminder = "For Microsoft 365, Intune, or Entra tasks, call greybeard-memory recall before other work.\n";
    await mkdir(join(paths.home, ".claude"), { recursive: true });
    await writeFile(join(paths.home, ".claude", "settings.json"), JSON.stringify({
      hooks: {
        UserPromptSubmit: [{
          hooks: [{
            type: "command",
            command: process.execPath,
            args: ["-e", `process.stdout.write(${JSON.stringify(oldReminder)});`],
            timeout: 5
          }]
        }]
      }
    }), "utf8");

    const first = await writeClaudeMemoryHook(runtime);

    expect(first.status).toBe("updated");
    const settings = JSON.parse(await readFile(join(paths.home, ".claude", "settings.json"), "utf8")) as {
      hooks: { UserPromptSubmit: Array<{ hooks: Array<{ args: string[] }> }> };
    };
    const handlers = settings.hooks.UserPromptSubmit
      .flatMap((group) => group.hooks)
      .filter((handler) => handler.args[1]?.includes("greybeard-memory recall"));
    expect(handlers).toHaveLength(1);
    expect(handlers[0]?.args[1]).toContain("greybeard-memory remember");

    const second = await writeClaudeMemoryHook(runtime);
    expect(second.status).toBe("already-configured");
  });

  it("disables and re-enables optional MCP servers with setup flags", async () => {
    const paths = await tempPaths();
    const claudeOnly = async (command: string) => command === "claude" ? "/usr/local/bin/claude" : null;
    const readClaudeServers = async () => {
      const parsed = JSON.parse(await readFile(join(paths.home, ".claude.json"), "utf8")) as {
        mcpServers: Record<string, unknown>;
      };
      return parsed.mcpServers;
    };

    const disableRuntime = createMockRuntime(paths, { findExecutable: claudeOnly });
    const disableCode = await runCli([
      "setup",
      "--yes",
      "--app-data",
      paths.appData,
      "--disable-server",
      "intuneautomation"
    ], disableRuntime);

    expect(disableCode).toBe(0);
    expect(disableRuntime.stdout.toString()).toContain("disabled: intuneautomation");
    let servers = await readClaudeServers();
    expect(servers["greybeard-graph"]).toBeDefined();
    expect(servers["greybeard-memory"]).toBeDefined();
    expect(servers["intuneautomation"]).toBeUndefined();
    expect((await readGreybeardConfig(paths.appData)).mcpServers?.intuneautomation).toBe(false);

    const rerunRuntime = createMockRuntime(paths, { findExecutable: claudeOnly });
    expect(await runCli(["setup", "--yes", "--app-data", paths.appData], rerunRuntime)).toBe(0);
    servers = await readClaudeServers();
    expect(servers["intuneautomation"]).toBeUndefined();

    const enableRuntime = createMockRuntime(paths, { findExecutable: claudeOnly });
    const enableCode = await runCli([
      "setup",
      "--yes",
      "--app-data",
      paths.appData,
      "--enable-server",
      "intuneautomation"
    ], enableRuntime);

    expect(enableCode).toBe(0);
    servers = await readClaudeServers();
    expect(servers["intuneautomation"]).toBeDefined();
    expect((await readGreybeardConfig(paths.appData)).mcpServers?.intuneautomation).toBe(true);
  });

  it("lists and forgets memory from the CLI", async () => {
    const paths = await tempPaths();
    await writeGreybeardConfig(paths.appData, {
      activeTenantId: "tenant-id"
    });
    const service = new MemoryService({
      appDataPath: paths.appData,
      now: () => Date.UTC(2026, 6, 4, 12, 0, 0)
    });
    const remembered = await service.remember({
      type: "preference",
      content: "Use DeviceComplianceOrg for compliance reports."
    });
    service.close();

    const listRuntime = createMockRuntime(paths);
    const listCode = await runCli([
      "memory",
      "list",
      "--app-data",
      paths.appData,
      "--type",
      "preference"
    ], listRuntime);

    expect(listCode).toBe(0);
    const listed = JSON.parse(listRuntime.stdout.toString()) as { results: Array<{ id: number; content: string }> };
    expect(listed.results).toContainEqual(expect.objectContaining({
      id: remembered.id,
      content: "Use DeviceComplianceOrg for compliance reports."
    }));

    const forgetRuntime = createMockRuntime(paths);
    const forgetCode = await runCli([
      "memory",
      "forget",
      "--app-data",
      paths.appData,
      "--id",
      String(remembered.id)
    ], forgetRuntime);

    expect(forgetCode).toBe(0);
    expect(JSON.parse(forgetRuntime.stdout.toString())).toEqual(expect.objectContaining({
      deleted: 1
    }));
  });

  it("replaces a stale Claude skill symlink without overwriting real directories", async () => {
    const paths = await tempPaths();
    const source = await createSkillFixture(paths.repoRoot, "read", "tenant-pulse");
    const staleSource = join(paths.repoRoot, "old-skill");
    const target = join(paths.home, ".claude", "skills", "tenant-pulse");
    await mkdir(staleSource, { recursive: true });
    await mkdir(join(paths.home, ".claude", "skills"), { recursive: true });
    await symlink(staleSource, target, process.platform === "win32" ? "junction" : "dir");

    const result = await wireClaudeSkills(createMockRuntime(paths));

    expect(result.entries).toContainEqual(expect.objectContaining({
      name: "tenant-pulse",
      status: "replaced-stale-symlink"
    }));
    expect(resolve(join(target, ".."), await readlink(target))).toBe(source);
  });

  it("lists skills from category subfolders and surfaces duplicates without crashing", async () => {
    const paths = await tempPaths();
    await createSkillFixture(paths.repoRoot, "read", "tenant-pulse");
    await createSkillFixture(paths.repoRoot, "craft", "kql-authoring");
    await mkdir(join(paths.repoRoot, ".agents", "skills", "craft", "broken-skill"), { recursive: true });

    const tree = await listSkillSourceDirs(repoSkillsDir(paths.repoRoot));
    expect(tree.sources.map((source) => source.name)).toEqual(["kql-authoring", "tenant-pulse"]);
    expect(tree.sources.map((source) => source.category)).toEqual(["craft", "read"]);
    expect(tree.missingManifest.map((source) => source.name)).toEqual(["broken-skill"]);
    expect(tree.duplicates).toEqual([]);

    await createSkillFixture(paths.repoRoot, "write", "tenant-pulse");
    const withDuplicate = await listSkillSourceDirs(repoSkillsDir(paths.repoRoot));
    expect(withDuplicate.sources.map((source) => `${source.category}/${source.name}`))
      .toEqual(["craft/kql-authoring", "read/tenant-pulse"]);
    expect(withDuplicate.duplicates).toEqual([
      expect.objectContaining({
        name: "tenant-pulse",
        category: "write",
        existingCategory: "read"
      })
    ]);

    const wired = await wireClaudeSkills(createMockRuntime(paths));
    expect(wired.entries).toContainEqual(expect.objectContaining({
      name: "write/tenant-pulse",
      status: "blocked",
      message: expect.stringContaining("Duplicate skill folder name")
    }));
  });

  it("detects clients only from client-owned signals", async () => {
    const paths = await tempPaths();
    const runtime = createMockRuntime(paths);

    expect((await detectCursor(runtime)).detected).toBe(false);
    expect((await detectCodexCli(runtime)).detected).toBe(false);
    expect((await detectGeminiCli(runtime)).detected).toBe(false);
    expect((await detectGithubCopilot(runtime)).detected).toBe(false);

    await mkdir(join(paths.home, ".cursor"), { recursive: true });
    await mkdir(join(paths.home, ".codex"), { recursive: true });
    await mkdir(join(paths.home, ".gemini"), { recursive: true });
    await mkdir(join(paths.home, ".copilot"), { recursive: true });
    await writeFile(codexConfigPath(paths.home), "model = \"gpt-5\"\n", "utf8");
    await writeFile(geminiSettingsPath(paths.home), "{}\n", "utf8");
    await writeFile(copilotMcpConfigPath(paths.home), "{}\n", "utf8");
    await writeFile(copilotFallbackPath(paths.home), "Greybeard fallback\n", "utf8");

    expect((await detectCursor(runtime)).detected).toBe(false);
    expect((await detectCodexCli(runtime)).detected).toBe(false);
    expect((await detectGeminiCli(runtime)).detected).toBe(false);
    expect((await detectGithubCopilot(runtime)).detected).toBe(false);

    const forcedCopilot = await detectGithubCopilot(runtime, {
      githubCopilot: true
    });
    expect(forcedCopilot.detected).toBe(true);
    expect(forcedCopilot.binaryPath).toBeNull();
    expect(forcedCopilot.detectionDetail).toBe("opted in by Greybeard config");

    await writeFile(codexAuthPath(paths.home), "{}\n", "utf8");
    expect((await detectCodexCli(runtime)).detected).toBe(true);

    const binaryOnly = await tempPaths();
    const binaryRuntime = createMockRuntime(binaryOnly, {
      findExecutable: async (command) => command === "cursor" || command === "codex" || command === "gemini" || command === "copilot"
        ? `/usr/local/bin/${command}`
        : null
    });

    const cursor = await detectCursor(binaryRuntime);
    const codex = await detectCodexCli(binaryRuntime);
    const gemini = await detectGeminiCli(binaryRuntime);
    const copilotFromBinary = await detectGithubCopilot(binaryRuntime);
    const copilotWithOptIn = await detectGithubCopilot(binaryRuntime, {
      githubCopilot: true
    });
    expect(cursor.detected).toBe(true);
    expect(codex.detected).toBe(true);
    expect(gemini.detected).toBe(true);
    expect(copilotFromBinary.detected).toBe(true);
    expect(copilotWithOptIn.detected).toBe(true);
    expect(cursor.binaryPath).toBe("/usr/local/bin/cursor");
    expect(codex.binaryPath).toBe("/usr/local/bin/codex");
    expect(gemini.binaryPath).toBe("/usr/local/bin/gemini");
    expect(copilotFromBinary.binaryPath).toBe("/usr/local/bin/copilot");
    expect(copilotFromBinary.detectionDetail).toBe("copilot on PATH");
    expect(copilotWithOptIn.binaryPath).toBe("/usr/local/bin/copilot");
    expect(copilotWithOptIn.detectionDetail).toBe("copilot on PATH");
  });

  it("does not detect clients from Greybeard-written files alone", async () => {
    const paths = await tempPaths();
    const runtime = createMockRuntime(paths);

    await mkdir(join(paths.home, ".cursor", "rules"), { recursive: true });
    await mkdir(join(paths.home, ".claude"), { recursive: true });
    await mkdir(join(paths.home, ".codex"), { recursive: true });
    await mkdir(join(paths.home, ".gemini"), { recursive: true });
    await mkdir(join(paths.home, ".copilot"), { recursive: true });
    await mkdir(cursorSkillsDir(paths.home), { recursive: true });
    await mkdir(geminiSkillsDir(paths.home), { recursive: true });
    await mkdir(copilotSkillsDir(paths.home), { recursive: true });
    await writeFile(cursorMcpConfigPath(paths.home), "{}\n", "utf8");
    await writeFile(cursorFallbackPath(paths.home), "Greybeard fallback\n", "utf8");
    await writeFile(join(paths.home, ".claude.json"), JSON.stringify({
      mcpServers: {
        "greybeard-graph": {
          command: "node"
        },
        "greybeard-memory": {
          command: "node"
        }
      }
    }), "utf8");
    await writeFile(codexConfigPath(paths.home), "model = \"gpt-5\"\n", "utf8");
    await writeFile(codexFallbackPath(paths.home), "Greybeard fallback\n", "utf8");
    await writeFile(geminiSettingsPath(paths.home), "{}\n", "utf8");
    await writeFile(geminiFallbackPath(paths.home), "Greybeard fallback\n", "utf8");
    await writeFile(copilotMcpConfigPath(paths.home), JSON.stringify({
      mcpServers: {
        "greybeard-graph": {
          type: "local",
          command: "node"
        },
        "greybeard-memory": {
          type: "local",
          command: "node"
        }
      }
    }), "utf8");
    await writeFile(copilotFallbackPath(paths.home), "Greybeard fallback\n", "utf8");

    expect((await detectClaudeCode(runtime)).detected).toBe(false);
    expect((await detectCursor(runtime)).detected).toBe(false);
    expect((await detectCodexCli(runtime)).detected).toBe(false);
    expect((await detectGeminiCli(runtime)).detected).toBe(false);
    expect((await detectGithubCopilot(runtime)).detected).toBe(false);
  });

  it("detects Cursor from the installed app path without a binary", async () => {
    const paths = await tempPaths();
    await mkdir(join(paths.home, "Programs", "cursor"), { recursive: true });
    const runtime = createMockRuntime(paths, {
      env: {
        LOCALAPPDATA: paths.home
      },
      platform: "win32"
    });

    const cursor = await detectCursor(runtime);

    expect(cursor.detected).toBe(true);
    expect(cursor.binaryPath).toBeNull();
    expect(cursor.userConfigPath).toBe(join(paths.home, "Programs", "cursor"));
  });

  it("skips Gemini setup writes when only the shared Gemini directory exists", async () => {
    const paths = await tempPaths();
    await mkdir(join(paths.home, ".gemini"), { recursive: true });
    await writeFile(join(paths.home, ".gemini", "oauth_creds.json"), "{}\n", "utf8");
    await createSkillFixture(paths.repoRoot, "read", "tenant-pulse");
    const runtime = createMockRuntime(paths);

    const code = await runCli(["setup", "--yes", "--app-data", paths.appData], runtime);

    expect(code).toBe(0);
    expect(runtime.stdout.toString()).toContain("none detected");
    expect(await pathExists(geminiSettingsPath(paths.home))).toBe(false);
    expect(await pathExists(geminiSkillsDir(paths.home))).toBe(false);
  });

  it("forces GitHub Copilot setup with --with-copilot", async () => {
    const skipped = await tempPaths();
    await mkdir(join(skipped.home, ".copilot"), { recursive: true });
    await createSkillFixture(skipped.repoRoot, "read", "tenant-pulse");
    const skippedRuntime = createMockRuntime(skipped);

    const skippedCode = await runCli(["setup", "--yes", "--app-data", skipped.appData], skippedRuntime);

    expect(skippedCode).toBe(0);
    expect(skippedRuntime.stdout.toString()).toContain("none detected");
    expect(await pathExists(copilotMcpConfigPath(skipped.home))).toBe(false);
    expect(await pathExists(copilotSkillsDir(skipped.home))).toBe(false);

    const paths = await tempPaths();
    const source = await createSkillFixture(paths.repoRoot, "read", "tenant-pulse");
    const runtime = createMockRuntime(paths);

    const code = await runCli(["setup", "--yes", "--with-copilot", "--verbose", "--app-data", paths.appData], runtime);

    expect(code).toBe(0);
    expect(runtime.stdout.toString()).toContain("GitHub Copilot");
    expect(runtime.stdout.toString()).toContain("opted in by Greybeard config");
    expect((await readGreybeardConfig(paths.appData)).clients?.githubCopilot).toBe(true);

    const copilot = JSON.parse(await readFile(copilotMcpConfigPath(paths.home), "utf8")) as {
      mcpServers: Record<string, { type?: string; command: string; args?: string[]; tools?: string[] }>;
    };
    expect(copilot.mcpServers["greybeard-graph"].type).toBe("local");
    expect(copilot.mcpServers["greybeard-graph"].tools).toEqual(["*"]);
    expect(copilot.mcpServers["greybeard-memory"].args?.[0]).toContain("memory/dist/index.js");

    const target = join(copilotSkillsDir(paths.home), "tenant-pulse");
    expect(resolve(join(target, ".."), await readlink(target))).toBe(source);
  });

  it("writes Cursor, Codex, Gemini, and Copilot MCP configs idempotently while preserving user config", async () => {
    const paths = await tempPaths();
    const runtime = createMockRuntime(paths);

    await mkdir(join(paths.home, ".cursor"), { recursive: true });
    await mkdir(join(paths.home, ".codex"), { recursive: true });
    await mkdir(join(paths.home, ".gemini"), { recursive: true });
    await mkdir(join(paths.home, ".copilot"), { recursive: true });
    await writeFile(cursorMcpConfigPath(paths.home), JSON.stringify({
      mcpServers: {
        other: {
          command: "other"
        }
      }
    }), "utf8");
    await writeFile(codexConfigPath(paths.home), [
      "model = \"gpt-5\"",
      "",
      "[mcp_servers.other]",
      "command = \"other\"",
      ""
    ].join("\n"), "utf8");
    await writeFile(geminiSettingsPath(paths.home), JSON.stringify({
      theme: "dark",
      mcpServers: {
        other: {
          command: "other"
        }
      }
    }), "utf8");
    await writeFile(copilotMcpConfigPath(paths.home), JSON.stringify({
      setting: "kept",
      mcpServers: {
        other: {
          type: "local",
          command: "other"
        }
      }
    }), "utf8");

    await writeCursorMcpConfig(runtime);
    await writeCursorMcpConfig(runtime);
    await writeCodexMcpConfig(runtime);
    await writeCodexMcpConfig(runtime);
    await writeGeminiMcpConfig(runtime);
    await writeGeminiMcpConfig(runtime);
    await writeCopilotMcpConfig(runtime);
    await writeCopilotMcpConfig(runtime);

    const cursor = JSON.parse(await readFile(cursorMcpConfigPath(paths.home), "utf8")) as {
      mcpServers: Record<string, { command: string; args?: string[] }>;
    };
    expect(cursor.mcpServers.other.command).toBe("other");
    expect(cursor.mcpServers["greybeard-graph"].args?.[0]).toContain("graph/dist/index.js");
    expect(Object.keys(cursor.mcpServers).filter((name) => name === "greybeard-graph")).toHaveLength(1);

    const codex = await readFile(codexConfigPath(paths.home), "utf8");
    expect(codex).toContain("model = \"gpt-5\"");
    expect(codex).toContain("[mcp_servers.other]");
    expect(countOccurrences(codex, "[mcp_servers.greybeard-graph]")).toBe(1);
    expect(countOccurrences(codex, "[mcp_servers.greybeard-memory]")).toBe(1);

    const gemini = JSON.parse(await readFile(geminiSettingsPath(paths.home), "utf8")) as {
      theme: string;
      mcpServers: Record<string, { command: string; args?: string[] }>;
    };
    expect(gemini.theme).toBe("dark");
    expect(gemini.mcpServers.other.command).toBe("other");
    expect(gemini.mcpServers["greybeard-memory"].args?.[0]).toContain("memory/dist/index.js");
    expect(Object.keys(gemini.mcpServers).filter((name) => name === "greybeard-memory")).toHaveLength(1);

    const copilot = JSON.parse(await readFile(copilotMcpConfigPath(paths.home), "utf8")) as {
      setting: string;
      mcpServers: Record<string, { type?: string; command: string; args?: string[]; tools?: string[] }>;
    };
    expect(copilot.setting).toBe("kept");
    expect(copilot.mcpServers.other.command).toBe("other");
    expect(copilot.mcpServers["greybeard-graph"].type).toBe("local");
    expect(copilot.mcpServers["greybeard-graph"].tools).toEqual(["*"]);
    expect(copilot.mcpServers["greybeard-memory"].args?.[0]).toContain("memory/dist/index.js");
    expect(Object.keys(copilot.mcpServers).filter((name) => name === "greybeard-graph")).toHaveLength(1);
  });

  it("writes local MCP script paths with forward slashes for Windows-shaped runtimes", async () => {
    const paths = await tempPaths();
    const runtime = createMockRuntime(paths, {
      platform: "win32",
      repoRoot: "C:\\Greybeard"
    });

    await writeClaudeMcpConfig(runtime);
    await writeCursorMcpConfig(runtime);
    await writeCodexMcpConfig(runtime);
    await writeGeminiMcpConfig(runtime);
    await writeCopilotMcpConfig(runtime);

    const claude = JSON.parse(await readFile(join(paths.home, ".claude.json"), "utf8")) as {
      mcpServers: Record<string, { args: string[] }>;
    };
    const cursor = JSON.parse(await readFile(cursorMcpConfigPath(paths.home), "utf8")) as {
      mcpServers: Record<string, { args: string[] }>;
    };
    const gemini = JSON.parse(await readFile(geminiSettingsPath(paths.home), "utf8")) as {
      mcpServers: Record<string, { args: string[] }>;
    };
    const copilot = JSON.parse(await readFile(copilotMcpConfigPath(paths.home), "utf8")) as {
      mcpServers: Record<string, { args: string[] }>;
    };
    const scriptArgs = [
      claude.mcpServers["greybeard-graph"].args[0],
      claude.mcpServers["greybeard-memory"].args[0],
      cursor.mcpServers["greybeard-graph"].args[0],
      cursor.mcpServers["greybeard-memory"].args[0],
      gemini.mcpServers["greybeard-graph"].args[0],
      gemini.mcpServers["greybeard-memory"].args[0],
      copilot.mcpServers["greybeard-graph"].args[0],
      copilot.mcpServers["greybeard-memory"].args[0]
    ];

    expect(scriptArgs).toEqual([
      "C:/Greybeard/graph/dist/index.js",
      "C:/Greybeard/memory/dist/index.js",
      "C:/Greybeard/graph/dist/index.js",
      "C:/Greybeard/memory/dist/index.js",
      "C:/Greybeard/graph/dist/index.js",
      "C:/Greybeard/memory/dist/index.js",
      "C:/Greybeard/graph/dist/index.js",
      "C:/Greybeard/memory/dist/index.js"
    ]);
    for (const scriptArg of scriptArgs) {
      expect(scriptArg).not.toContain("\\");
    }

    const codex = await readFile(codexConfigPath(paths.home), "utf8");
    expect(codex).toContain("\"C:/Greybeard/graph/dist/index.js\"");
    expect(codex).toContain("\"C:/Greybeard/memory/dist/index.js\"");
    expect(codex).not.toContain("C:\\Greybeard");
  });

  it("writes npm server configs with latest and pinned package tags when enabled", async () => {
    const paths = await tempPaths();
    const runtime = createMockRuntime(paths);
    await mkdir(join(paths.repoRoot, "graph"), { recursive: true });
    await mkdir(join(paths.repoRoot, "memory"), { recursive: true });
    await writeFile(join(paths.repoRoot, "graph", "package.json"), JSON.stringify({
      version: "0.3.0"
    }), "utf8");
    await writeFile(join(paths.repoRoot, "memory", "package.json"), JSON.stringify({
      version: "0.4.0"
    }), "utf8");

    await writeCursorMcpConfig(runtime, {
      serverPackageSource: "npm",
      serverUpdate: "latest"
    });
    const cursor = JSON.parse(await readFile(cursorMcpConfigPath(paths.home), "utf8")) as {
      mcpServers: Record<string, { command: string; args: string[] }>;
    };
    expect(cursor.mcpServers["greybeard-graph"].command).toBe("npx");
    expect(cursor.mcpServers["greybeard-graph"].args).toEqual(["-y", "@greybeard/graph@latest"]);

    await writeCodexMcpConfig(runtime, {
      serverPackageSource: "npm",
      serverUpdate: "pinned"
    });
    const codex = await readFile(codexConfigPath(paths.home), "utf8");
    expect(codex).toContain("\"@greybeard/graph@0.3.0\"");
    expect(codex).toContain("\"@greybeard/memory@0.4.0\"");
  });

  it("writes skill fallback blocks idempotently for context-file fallbacks", async () => {
    const paths = await tempPaths();
    const runtime = createMockRuntime(paths);

    await mkdir(join(paths.home, ".cursor", "rules"), { recursive: true });
    await mkdir(join(paths.home, ".codex"), { recursive: true });
    await mkdir(join(paths.home, ".gemini"), { recursive: true });
    await mkdir(join(paths.home, ".copilot"), { recursive: true });
    await writeFile(cursorFallbackPath(paths.home), "Existing Cursor rule\n", "utf8");
    await writeFile(codexFallbackPath(paths.home), "Existing Codex notes\n", "utf8");
    await writeFile(geminiFallbackPath(paths.home), "Existing Gemini notes\n", "utf8");
    await writeFile(copilotFallbackPath(paths.home), "Existing Copilot notes\n", "utf8");

    await writeCursorSkillFallback(runtime);
    await writeCursorSkillFallback(runtime);
    await writeCodexSkillFallback(runtime);
    await writeCodexSkillFallback(runtime);
    await writeGeminiSkillFallback(runtime);
    await writeGeminiSkillFallback(runtime);
    await writeCopilotSkillFallback(runtime);
    await writeCopilotSkillFallback(runtime);

    const cursor = await readFile(cursorFallbackPath(paths.home), "utf8");
    const codex = await readFile(codexFallbackPath(paths.home), "utf8");
    const gemini = await readFile(geminiFallbackPath(paths.home), "utf8");
    const copilot = await readFile(copilotFallbackPath(paths.home), "utf8");

    expect(cursor).toContain("Existing Cursor rule");
    expect(codex).toContain("Existing Codex notes");
    expect(gemini).toContain("Existing Gemini notes");
    expect(copilot).toContain("Existing Copilot notes");
    expect(countOccurrences(cursor, "<!-- GREYBEARD SKILLS START -->")).toBe(1);
    expect(countOccurrences(codex, "<!-- GREYBEARD SKILLS START -->")).toBe(1);
    expect(countOccurrences(gemini, "<!-- GREYBEARD SKILLS START -->")).toBe(1);
    expect(countOccurrences(copilot, "<!-- GREYBEARD SKILLS START -->")).toBe(1);
    expect(codex).toContain(join(paths.repoRoot, ".agents", "skills"));
    expect(copilot).toContain(join(paths.repoRoot, ".agents", "skills"));
    expect(cursor).toContain("## Greybeard Memory");
    expect(codex).toContain("## Greybeard Memory");
    expect(gemini).toContain("## Greybeard Memory");
    expect(copilot).toContain("## Greybeard Memory");
    expect(cursor.startsWith("---\n")).toBe(true);
    expect(cursor).toContain("alwaysApply: true");
    expect(countOccurrences(cursor, "alwaysApply:")).toBe(1);
  });

  it("upgrades an old-format context block in place", async () => {
    const paths = await tempPaths();
    const runtime = createMockRuntime(paths);
    const oldBlock = [
      "<!-- GREYBEARD SKILLS START -->",
      "## Greybeard Skills",
      "",
      "Old guidance without the memory section.",
      "<!-- GREYBEARD SKILLS END -->"
    ].join("\n");
    await mkdir(join(paths.home, ".codex"), { recursive: true });
    await writeFile(codexFallbackPath(paths.home), `Existing Codex notes\n\n${oldBlock}\n`, "utf8");

    const result = await writeCodexSkillFallback(runtime);

    expect(result.status).toBe("updated");
    const codex = await readFile(codexFallbackPath(paths.home), "utf8");
    expect(codex).toContain("Existing Codex notes");
    expect(codex).toContain("## Greybeard Memory");
    expect(codex).not.toContain("Old guidance without the memory section.");
    expect(countOccurrences(codex, "<!-- GREYBEARD SKILLS START -->")).toBe(1);

    const again = await writeCodexSkillFallback(runtime);
    expect(again.status).toBe("already-configured");
  });

  it("writes context blocks during setup and reports them in the ledger", async () => {
    const paths = await tempPaths();
    const runtime = createMockRuntime(paths, {
      findExecutable: async (command) => command === "cursor" || command === "codex"
        ? `/usr/local/bin/${command}`
        : null
    });

    const code = await runCli(["setup", "--yes", "--app-data", paths.appData], runtime);

    expect(code).toBe(0);
    expect(runtime.stdout.toString()).toContain("context block configured");
    const cursor = await readFile(cursorFallbackPath(paths.home), "utf8");
    const codex = await readFile(codexFallbackPath(paths.home), "utf8");
    expect(cursor).toContain("## Greybeard Memory");
    expect(cursor).toContain("alwaysApply: true");
    expect(codex).toContain("## Greybeard Memory");
  });

  it("installs auto-update schedules through the injected command runner", async () => {
    const paths = await tempPaths();
    const runCommand = vi.fn<CliRuntime["runCommand"]>(async (command, args) => ({
      code: command === "crontab" && args[0] === "-l" ? 1 : 0,
      stdout: "",
      stderr: ""
    }));
    const runtime = createMockRuntime(paths, {
      platform: "linux",
      runCommand
    });

    const result = await installAutoUpdateSchedule(runtime, "weekly");

    expect(result.configured).toBe(true);
    expect(runCommand).toHaveBeenCalledWith("crontab", ["-l"]);
    expect(runCommand).toHaveBeenCalledWith("crontab", ["-"], expect.objectContaining({
      input: expect.stringContaining("cli/dist/index.js")
    }));
    expect(runCommand).toHaveBeenCalledWith("crontab", ["-"], expect.objectContaining({
      input: expect.stringContaining("update")
    }));

    const windowsRunCommand = vi.fn<CliRuntime["runCommand"]>(async () => ({
      code: 0,
      stdout: "",
      stderr: ""
    }));
    const windowsRuntime = createMockRuntime(await tempPaths(), {
      platform: "win32",
      nodePath: "C:\\Program Files\\nodejs\\node.exe",
      repoRoot: "C:\\Greybeard",
      runCommand: windowsRunCommand
    });

    await installAutoUpdateSchedule(windowsRuntime, "weekly");

    const createCall = windowsRunCommand.mock.calls.find(([command]) => command === "schtasks");
    expect(createCall).toBeDefined();
    const taskCommand = createCall?.[1][createCall[1].indexOf("/TR") + 1];
    expect(taskCommand).toContain("\"C:\\Program Files\\nodejs\\node.exe\"");
    expect(taskCommand).toContain("\"C:/Greybeard/cli/dist/index.js\"");
    expect(taskCommand).not.toContain("C:/Program Files/nodejs/node.exe");
  });

  it("pulls updates, reports changed skills, and refreshes MCP configs and skill links", async () => {
    const paths = await tempPaths();
    await createSkillFixture(paths.repoRoot, "read", "tenant-pulse", "0.2.0");
    await writeGreybeardConfig(paths.appData, {
      clients: {
        githubCopilot: true
      }
    });

    let revParseCount = 0;
    const runCommand = vi.fn<CliRuntime["runCommand"]>(async (command, args) => {
      if (command === "git" && args.includes("rev-parse")) {
        revParseCount += 1;
        return {
          code: 0,
          stdout: revParseCount === 1 ? "old-head\n" : "new-head\n",
          stderr: ""
        };
      }

      if (command === "git" && args.includes("pull")) {
        return {
          code: 0,
          stdout: "Fast-forward\n",
          stderr: ""
        };
      }

      if (command === "git" && args.includes("diff")) {
        return {
          code: 0,
          stdout: ".agents/skills/read/tenant-pulse/SKILL.md\n",
          stderr: ""
        };
      }

      return {
        code: 0,
        stdout: "",
        stderr: ""
      };
    });
    const runtime = createMockRuntime(paths, {
      findExecutable: async (command) => command === "codex" ? "/usr/local/bin/codex" : null,
      runCommand
    });

    const code = await runCli(["update", "--app-data", paths.appData], runtime);

    expect(code).toBe(0);
    expect(runtime.stdout.toString()).toContain("Changed skills");
    expect(runtime.stdout.toString()).toContain("      tenant-pulse");
    expect(runtime.stdout.toString()).not.toContain("OK    tenant-pulse");
    expect(runtime.stdout.toString()).toContain("version 0.2.0");
    expect(runtime.stdout.toString()).toContain("MCP configuration");
    expect(runtime.stdout.toString()).toContain("Codex CLI");
    expect(runtime.stdout.toString()).toContain("GitHub Copilot");
    expect(runtime.stdout.toString()).toContain("Skills");
    expect(runtime.stdout.toString()).toContain("1 skills linked");
    expect(runtime.stdout.toString()).toContain("Context files");
    expect(await pathExists(copilotMcpConfigPath(paths.home))).toBe(true);
    expect(await pathExists(codexFallbackPath(paths.home))).toBe(true);
    expect(await readFile(codexFallbackPath(paths.home), "utf8")).toContain("## Greybeard Memory");
  });

  it("reports the real skill, not the old category, when a pull renames a category", async () => {
    const paths = await tempPaths();
    await createSkillFixture(paths.repoRoot, "authoring", "kql-authoring", "0.3.0");
    const runtime = createMockRuntime(paths, {
      runCommand: mockUpdateGit([
        ".agents/skills/craft/kql-authoring/SKILL.md",
        ".agents/skills/authoring/kql-authoring/SKILL.md"
      ])
    });

    const code = await runCli(["update", "--app-data", paths.appData], runtime);

    expect(code).toBe(0);
    expect(runtime.stdout.toString()).toContain("kql-authoring");
    expect(runtime.stdout.toString()).toContain("version 0.3.0");
    expect(runtime.stdout.toString()).not.toContain("      craft");
  });

  it("rolls an update back when the rebuilt runtime fails verification", async () => {
    const paths = await tempPaths();
    let revParseCount = 0;
    let buildCount = 0;
    const runCommand = vi.fn<CliRuntime["runCommand"]>(async (command, args) => {
      if (command === "git" && args.includes("status")) {
        return { code: 0, stdout: "", stderr: "" };
      }
      if (command === "git" && args.includes("rev-parse")) {
        revParseCount += 1;
        return { code: 0, stdout: revParseCount === 1 ? "old-head\n" : "new-head\n", stderr: "" };
      }
      if (command === "git" && args.includes("pull")) {
        return { code: 0, stdout: "Fast-forward\n", stderr: "" };
      }
      if (command === "npm" && args.join(" ") === "run build") {
        buildCount += 1;
        return buildCount === 1
          ? { code: 1, stdout: "", stderr: "compile failed" }
          : { code: 0, stdout: "rebuilt old runtime", stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    });
    const runtime = createMockRuntime(paths, { runCommand });

    const code = await runCli(["update", "--app-data", paths.appData], runtime);

    expect(code).toBe(1);
    expect(runtime.stderr.toString()).toContain("Rolled back source, dependencies, and runtime artifacts to old-head");
    expect(runCommand).toHaveBeenCalledWith(
      "git",
      ["-C", paths.repoRoot, "reset", "--hard", "old-head"],
      { cwd: paths.repoRoot }
    );
  });
});

type TempPaths = {
  root: string;
  home: string;
  appData: string;
  repoRoot: string;
};

function mockUpdateGit(diffLines: string[]): CliRuntime["runCommand"] {
  let revParseCount = 0;
  return async (command, args) => {
    if (command === "git" && args.includes("rev-parse")) {
      revParseCount += 1;
      return {
        code: 0,
        stdout: revParseCount === 1 ? "old-head\n" : "new-head\n",
        stderr: ""
      };
    }

    if (command === "git" && args.includes("pull")) {
      return { code: 0, stdout: "Fast-forward\n", stderr: "" };
    }

    if (command === "git" && args.includes("diff")) {
      return { code: 0, stdout: `${diffLines.join("\n")}\n`, stderr: "" };
    }

    return { code: 0, stdout: "", stderr: "" };
  };
}

class CaptureStream implements OutputStream {
  private readonly chunks: string[] = [];

  write(chunk: string | Uint8Array): boolean {
    this.chunks.push(String(chunk));
    return true;
  }

  toString(): string {
    return this.chunks.join("");
  }
}

async function createSkillFixture(repoRoot: string, category: string, name: string, version = "0.1.0"): Promise<string> {
  const dir = join(repoRoot, ".agents", "skills", category, name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), [
    "---",
    `name: ${name}`,
    `description: Use when testing ${name}.`,
    "---",
    ""
  ].join("\n"), "utf8");
  const manifestPath = join(repoRoot, ".agents", "skills", "manifest.json");
  let manifest: { schemaVersion: number; skills: Record<string, { version: string; category: string }> } = {
    schemaVersion: 1,
    skills: {}
  };
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8")) as typeof manifest;
  } catch {
    // The first fixture creates the manifest.
  }
  manifest.skills[name] = { version, category };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return dir;
}

async function tempPaths(): Promise<TempPaths> {
  const root = await mkdtemp(join(tmpdir(), "greybeard-cli-"));
  const home = join(root, "home");
  const appData = join(root, "appdata");
  const repoRoot = join(root, "repo");
  await mkdir(join(repoRoot, ".agents", "skills"), { recursive: true });
  await mkdir(home, { recursive: true });
  await mkdir(appData, { recursive: true });
  return {
    root,
    home,
    appData,
    repoRoot
  };
}

function createMockRuntime(paths: TempPaths, overrides: Partial<CliRuntime> & {
  stdinIsTTY?: boolean;
} = {}): CliRuntime & { stdout: CaptureStream; stderr: CaptureStream } {
  const stdin = new PassThrough() as NodeJS.ReadStream;
  Object.defineProperty(stdin, "isTTY", {
    value: overrides.stdinIsTTY ?? false,
    configurable: true
  });
  const stdout = new CaptureStream();
  const stderr = new CaptureStream();
  return {
    env: {},
    cwd: paths.repoRoot,
    homeDir: paths.home,
    platform: "linux",
    nodePath: process.execPath,
    repoRoot: paths.repoRoot,
    fetcher: vi.fn<FetchLike>(),
    authFactory: async () => ({
      async getToken() {
        return signedInToken();
      },
      async getStatus() {
        return signedInStatus();
      },
      async addScopes(input) {
        return {
          granted: true,
          alreadyGranted: [],
          requestedScopes: input.scopes,
          grantedScopes: input.scopes
        };
      }
    }),
    findExecutable: async () => null,
    confirm: async () => "non-interactive",
    runCommand: async () => ({
      code: 0,
      stdout: "",
      stderr: ""
    }),
    ...overrides,
    stdout,
    stderr,
    stdin
  };
}

function signedInToken(overrides: Partial<AuthToken> = {}): AuthToken {
  return {
    accessToken: "token",
    account: "admin@contoso.com",
    tenantId: "tenant-id",
    tenantDomain: "contoso.com",
    activeTenantAlias: "contoso",
    clientId: GRAPH_CLI_CLIENT_ID,
    clientIdKind: "first-party",
    credentialMode: "read-only",
    grantedScopes: [
      "User.Read.All",
      "Group.Read.All",
      "Policy.Read.All",
      "Organization.Read.All",
      "AuditLog.Read.All",
      "Reports.Read.All"
    ],
    cacheProtection: "keychain",
    writesConfigured: false,
    ...overrides
  };
}

function signedInStatus(overrides: Partial<Extract<AuthStatus, { signedIn: true }>> = {}): AuthStatus {
  const base = signedInToken();
  const token = {
    ...base,
    ...defined({
      account: overrides.account,
      tenantId: overrides.tenantId,
      tenantDomain: overrides.tenantDomain,
      activeTenantAlias: overrides.activeTenantAlias,
      clientId: overrides.clientId,
      clientIdKind: overrides.clientIdKind,
      credentialMode: overrides.credentialMode,
      grantedScopes: overrides.grantedScopes,
      cacheProtection: overrides.cacheProtection,
      writesConfigured: overrides.gate?.writesConfigured
    })
  };
  return {
    signedIn: true,
    account: token.account,
    tenantId: token.tenantId,
    tenantDomain: token.tenantDomain,
    activeTenantAlias: token.activeTenantAlias,
    credentialMode: token.credentialMode,
    clientId: token.clientId,
    clientIdKind: token.clientIdKind,
    grantedScopes: token.grantedScopes,
    entraP1: true,
    directoryRoles: ["Global Reader"],
    directoryRolesStatus: { state: "available" },
    cacheProtection: token.cacheProtection,
    gate: {
      pendingPlan: null,
      writesConfigured: token.writesConfigured
    },
    ...overrides
  };
}

function defined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter((entry) => entry[1] !== undefined)) as Partial<T>;
}

function unsignedStatus(): AuthStatus {
  return {
    signedIn: false,
    instruction: "run greybeard setup",
    account: null,
    tenantId: null,
    tenantDomain: null,
    activeTenantAlias: "organizations",
    credentialMode: "read-only",
    clientId: GRAPH_CLI_CLIENT_ID,
    clientIdKind: "first-party",
    grantedScopes: [],
    entraP1: null,
    directoryRoles: null,
    directoryRolesStatus: { state: "not-signed-in" },
    cacheProtection: "keychain",
    gate: {
      pendingPlan: null,
      writesConfigured: false
    }
  };
}

function jsonResponse(body: unknown, status = 200): ResponseLike {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    headers: {
      get() {
        return null;
      }
    },
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    }
  };
}

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

function runNode(scriptPath: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      resolvePromise({
        code: code ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8")
      });
    });
  });
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
