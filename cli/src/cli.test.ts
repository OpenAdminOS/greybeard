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
  wireClaudeSkills,
  writeClaudeMcpConfig,
  writeCodexMcpConfig,
  writeCodexSkillFallback,
  writeCopilotMcpConfig,
  writeCopilotSkillFallback,
  writeCursorMcpConfig,
  writeCursorSkillFallback,
  writeGeminiMcpConfig,
  writeGeminiSkillFallback
} from "./clients.js";
import { assembleDoctorFindings } from "./doctor.js";
import { runCli } from "./index.js";
import { CliRuntime, OutputStream } from "./runtime.js";
import { installAutoUpdateSchedule } from "./setup.js";

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

  it("prints first-party sign-in transparency and every Tier 1 scope before setup auth", async () => {
    const paths = await tempPaths();
    const runtime = createMockRuntime(paths);

    const code = await runCli(["setup", "--yes", "--app-data", paths.appData], runtime);

    expect(code).toBe(0);
    const output = runtime.stdout.toString();
    expect(output).toContain("      Browser                  login.microsoftonline.com, Microsoft's own sign-in page");
    expect(output).toContain("      Application              Microsoft Graph Command Line Tools, a first-party Microsoft application");
    expect(output).not.toContain("OK    Browser");
    expect(output).not.toContain("OK    Application");
    expect(output).toContain(GRAPH_CLI_CLIENT_ID);
    expect(output).toContain("Greybeard registers no third-party app for read-only access");
    expect(output).toContain("Greybeard never sees your password");
    expect(output).toContain("impossible unless you explicitly run greybeard setup --writes");
    for (const scope of DEFAULT_TIER1_SCOPES) {
      expect(output).toContain(`      ${scope}`);
      expect(output).not.toContain(`OK    ${scope}`);
      expect(output).toContain(scopeJustification(scope));
    }
    expect(output).toContain("OK    Signed in");
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
            oauth2PermissionScopes: [
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
      .mockResolvedValueOnce(jsonResponse({
        id: "service-principal-id"
      }, 201));
    const runtime = createMockRuntime(paths, {
      fetcher,
      authFactory: async () => ({
        async getToken(scopes) {
          requestedScopes.push(scopes);
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

    const code = await runCli(["setup", "--writes", "--app-data", paths.appData], runtime);

    expect(code).toBe(0);
    expect(requestedScopes.flat()).toContain("Application.ReadWrite.All");
    expect(requestedScopes.flat()).not.toContain("Application.ReadWrite.OwnedBy");
    expect(runtime.stdout.toString()).toContain("      note: Application.ReadWrite.All is used only to create the workspace app");
    expect(runtime.stdout.toString()).toContain("      note: Application.ReadWrite.All can be revoked from the first-party app after bootstrap");
    expect(runtime.stdout.toString()).not.toContain("WARN  Bootstrap");
  });

  it("writes Claude memory MCP config and optional recall hook during setup", async () => {
    const paths = await tempPaths();
    const runtime = createMockRuntime(paths, {
      findExecutable: async (command) => command === "claude" ? "/usr/local/bin/claude" : null
    });

    const code = await runCli(["setup", "--app-data", paths.appData, "--memory-hook"], runtime);

    expect(code).toBe(0);
    expect(runtime.stdout.toString()).toContain("Memory DB");
    expect(runtime.stdout.toString()).toContain(memoryDbPath(paths.appData));
    const claudeConfig = JSON.parse(await readFile(join(paths.home, ".claude.json"), "utf8")) as {
      mcpServers: Record<string, { args: string[] }>;
    };
    expect(claudeConfig.mcpServers["greybeard-graph"].args[0]).toContain("graph/dist/index.js");
    expect(claudeConfig.mcpServers["greybeard-memory"].args[0]).toContain("memory/dist/index.js");

    const claudeSettings = JSON.parse(await readFile(join(paths.home, ".claude", "settings.json"), "utf8")) as {
      hooks: { UserPromptSubmit: Array<{ hooks: Array<{ args: string[] }> }> };
    };
    expect(claudeSettings.hooks.UserPromptSubmit[0]?.hooks[0]?.args[1]).toContain("greybeard-memory recall");
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
    const source = join(paths.repoRoot, ".agents", "skills", "tenant-pulse");
    const staleSource = join(paths.repoRoot, "old-skill");
    const target = join(paths.home, ".claude", "skills", "tenant-pulse");
    await mkdir(source, { recursive: true });
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
    await mkdir(join(paths.repoRoot, ".agents", "skills", "tenant-pulse"), { recursive: true });
    const runtime = createMockRuntime(paths);

    const code = await runCli(["setup", "--yes", "--app-data", paths.appData], runtime);

    expect(code).toBe(0);
    expect(runtime.stdout.toString()).toContain("Gemini CLI");
    expect(runtime.stdout.toString()).toContain("not detected, skipped");
    expect(await pathExists(geminiSettingsPath(paths.home))).toBe(false);
    expect(await pathExists(geminiSkillsDir(paths.home))).toBe(false);
  });

  it("forces GitHub Copilot setup with --with-copilot", async () => {
    const skipped = await tempPaths();
    await mkdir(join(skipped.home, ".copilot"), { recursive: true });
    await mkdir(join(skipped.repoRoot, ".agents", "skills", "tenant-pulse"), { recursive: true });
    const skippedRuntime = createMockRuntime(skipped);

    const skippedCode = await runCli(["setup", "--yes", "--app-data", skipped.appData], skippedRuntime);

    expect(skippedCode).toBe(0);
    expect(skippedRuntime.stdout.toString()).toContain("GitHub Copilot");
    expect(skippedRuntime.stdout.toString()).toContain("not detected, skipped");
    expect(await pathExists(copilotMcpConfigPath(skipped.home))).toBe(false);
    expect(await pathExists(copilotSkillsDir(skipped.home))).toBe(false);

    const paths = await tempPaths();
    const source = join(paths.repoRoot, ".agents", "skills", "tenant-pulse");
    await mkdir(source, { recursive: true });
    const runtime = createMockRuntime(paths);

    const code = await runCli(["setup", "--yes", "--with-copilot", "--app-data", paths.appData], runtime);

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

  it("pulls updates, reports changed skills, and refreshes MCP configs", async () => {
    const paths = await tempPaths();
    await mkdir(join(paths.repoRoot, ".agents", "skills", "tenant-pulse"), { recursive: true });
    await writeFile(join(paths.repoRoot, ".agents", "skills", "tenant-pulse", "SKILL.md"), [
      "---",
      "name: tenant-pulse",
      "description: Use when checking tenant health.",
      "version: 0.2.0",
      "---",
      ""
    ].join("\n"), "utf8");
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
          stdout: ".agents/skills/tenant-pulse/SKILL.md\n",
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
    expect(await pathExists(copilotMcpConfigPath(paths.home))).toBe(true);
  });
});

type TempPaths = {
  root: string;
  home: string;
  appData: string;
  repoRoot: string;
};

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
    stdin,
    stdout,
    stderr,
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
    directoryRoles: [],
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
