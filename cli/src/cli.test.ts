import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, readlink, stat, writeFile, symlink } from "node:fs/promises";
import { PassThrough } from "node:stream";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { inflateRawSync } from "node:zlib";
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
  claudeFallbackPath,
  codexConfigPath,
  codexFallbackPath,
  claudeDesktopConfigPath,
  copilotFallbackPath,
  copilotMcpConfigPath,
  copilotSkillsDir,
  cursorFallbackPath,
  cursorMcpConfigPath,
  cursorSkillsDir,
  detectCodexCli,
  detectClaudeCode,
  detectClaudeDesktop,
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
  writeClaudeSkillFallback,
  writeClaudeDesktopMcpConfig,
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
import { packSkills } from "./skills.js";

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
    expect(result.stdout).toContain("Greybeard 0.1");
    expect(result.stdout).toContain("greybeard setup");
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
      manifests: [manifest("ask-my-tenant", { servers: ["greybeard-memory"], scopes: ["User.Read.All"] })],
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
    }, status, ["greybeard-memory"]);

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
    } as AuthStatus, ["greybeard-memory"]);
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

    await expect(runCli(["setup", "--yes", "--enable-server", "intune", "--app-data", paths.appData], runtime)).rejects.toThrow("Unknown MCP server: intune");
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
    expect(written.mcpServers["greybeard-memory"].args[0]).toContain("cli/dist/index.js");

    const pinnedPaths = await tempPaths();
    const pinnedRuntime = createMockRuntime(pinnedPaths);
    await writeClaudeMcpConfig(pinnedRuntime, { serverUpdate: "pinned", serverPackageSource: "npm", serverToggles: { intuneautomation: true } });
    const pinned = JSON.parse(await readFile(join(pinnedPaths.home, ".claude.json"), "utf8")) as {
      mcpServers: Record<string, { args: string[] }>;
    };
    expect(pinned.mcpServers.intuneautomation.args[1]).toMatch(/^@ugurkocde\/intuneautomation-mcp@\d+\.\d+\.\d+$/);
    expect(pinned.mcpServers.intuneautomation.args[1]).not.toContain("@latest");
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
    expect(runtime.stderr.toString()).toContain("unavailable in Greybeard 0.1");
    expect(fetcher).not.toHaveBeenCalled();
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

  it("packs each skill as a Claude Desktop ZIP with the skill folder at its root", async () => {
    const paths = await tempPaths();
    const skillDir = await createSkillFixture(paths.repoRoot, "read", "tenant-pulse");
    await mkdir(join(skillDir, "agents"), { recursive: true });
    await writeFile(join(skillDir, "agents", "openai.yaml"), "name: tenant-pulse\n", "utf8");
    await writeFile(join(skillDir, "test.md"), "test question\n", "utf8");
    const outputDir = join(paths.root, "packed");

    const packed = await packSkills(createMockRuntime(paths), outputDir);

    expect(packed).toEqual([{
      name: "tenant-pulse",
      path: join(outputDir, "tenant-pulse.zip")
    }]);
    const entries = readZipEntries(await readFile(packed[0].path));
    expect([...entries.keys()]).toEqual([
      "tenant-pulse/",
      "tenant-pulse/agents/",
      "tenant-pulse/agents/openai.yaml",
      "tenant-pulse/SKILL.md",
      "tenant-pulse/test.md"
    ]);
    expect(entries.get("tenant-pulse/SKILL.md")?.toString("utf8")).toContain("name: tenant-pulse");
    expect(entries.get("tenant-pulse/test.md")?.toString("utf8")).toBe("test question\n");
  });

  it("prints Claude Desktop upload instructions and blocks duplicate skill names", async () => {
    const paths = await tempPaths();
    await createSkillFixture(paths.repoRoot, "read", "tenant-pulse");
    const outputDir = join(paths.root, "packed");
    const runtime = createMockRuntime(paths);

    const code = await runCli(["skills", "pack", "--out", outputDir], runtime);

    expect(code).toBe(0);
    expect(runtime.stdout.toString()).toContain("Settings > Capabilities > Skills");
    expect(runtime.stdout.toString()).toContain(join(outputDir, "tenant-pulse.zip"));

    await createSkillFixture(paths.repoRoot, "write", "tenant-pulse");
    const duplicateRuntime = createMockRuntime(paths);
    const duplicateCode = await runCli(["skills", "pack", "--out", outputDir], duplicateRuntime);
    expect(duplicateCode).toBe(1);
    expect(duplicateRuntime.stderr.toString()).toContain("duplicate folder names");
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

  it("keeps Claude Desktop and Claude Code detection signals separate", async () => {
    const paths = await tempPaths();
    const runtime = createMockRuntime(paths, {
      platform: "darwin",
      env: {
        GREYBEARD_CLAUDE_DESKTOP_APP: join(paths.root, "not-installed", "Claude.app")
      }
    });
    const desktopConfig = claudeDesktopConfigPath(runtime);
    await mkdir(resolve(desktopConfig, ".."), { recursive: true });
    await writeFile(desktopConfig, JSON.stringify({
      mcpServers: {
        userServer: {
          command: "user-command"
        }
      }
    }), "utf8");

    expect((await detectClaudeDesktop(runtime)).detected).toBe(true);
    expect((await detectClaudeCode(runtime)).detected).toBe(true);
    expect((await detectClaudeCode(runtime)).binaryPath).toBeNull();

    await writeFile(desktopConfig, JSON.stringify({
      mcpServers: {
        "greybeard-graph": {
          command: process.execPath,
          args: [join(paths.repoRoot, "cli", "dist", "index.js"), "mcp", "graph"],
          env: { GREYBEARD_MANAGED: "0.1" }
        },
        "greybeard-memory": {
          command: process.execPath,
          args: [join(paths.repoRoot, "cli", "dist", "index.js"), "mcp", "memory"],
          env: { GREYBEARD_MANAGED: "0.1" }
        }
      }
    }), "utf8");
    expect((await detectClaudeDesktop(runtime)).detected).toBe(false);

    await writeFile(join(paths.home, ".claude.json"), JSON.stringify({
      theme: "dark"
    }), "utf8");
    expect((await detectClaudeCode(runtime)).detected).toBe(true);
    expect((await detectClaudeDesktop(runtime)).detected).toBe(false);
  });

  it("detects Claude Desktop Windows installs and warns about MSIX config redirection", async () => {
    const paths = await tempPaths();
    const localAppData = join(paths.root, "local-app-data");
    const appData = join(paths.root, "roaming-app-data");
    const msixDir = join(localAppData, "Packages", "AnthropicPBC.Claude_test");
    await mkdir(msixDir, { recursive: true });
    const runtime = createMockRuntime(paths, {
      platform: "win32",
      env: {
        APPDATA: appData,
        LOCALAPPDATA: localAppData
      }
    });

    const detection = await detectClaudeDesktop(runtime);

    expect(detection.detected).toBe(true);
    expect(detection.userConfigPath).toBe(join(appData, "Claude", "claude_desktop_config.json"));
    expect(detection.warnings?.[0]).toContain("MSIX package detected");
    expect(detection.warnings?.[0]).toContain("%APPDATA%/Claude/claude_desktop_config.json");

    await writeGreybeardConfig(paths.appData, {
      activeTenantId: "tenant-id"
    });
    const findings = await assembleDoctorFindings(parseArgs(["doctor", "--app-data", paths.appData]), runtime);
    expect(findings).toContainEqual(expect.objectContaining({
      level: "WARN",
      label: "Claude Desktop config path",
      detail: expect.stringContaining("MSIX package detected")
    }));
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
    expect(cursor.userConfigPath).toBe(cursorMcpConfigPath(paths.home));
    expect(cursor.detectionDetail).toContain(join(paths.home, "Programs", "cursor"));
    await writeCursorMcpConfig(runtime);
    expect(await runCli(["uninstall", "--client", "Cursor"], runtime)).toBe(0);
    const config = JSON.parse(await readFile(cursorMcpConfigPath(paths.home), "utf8"));
    expect(config.mcpServers["greybeard-memory"]).toBeUndefined();
  });

  it("skips Gemini setup writes when only the shared Gemini directory exists", async () => {
    const paths = await tempPaths();
    await mkdir(join(paths.home, ".gemini"), { recursive: true });
    await writeFile(join(paths.home, ".gemini", "oauth_creds.json"), "{}\n", "utf8");
    await createSkillFixture(paths.repoRoot, "read", "tenant-pulse");
    const runtime = createMockRuntime(paths);

    const code = await runCli(["setup", "--yes", "--app-data", paths.appData], runtime);

    expect(code).toBe(0);
    expect(runtime.stdout.toString()).toContain("No selected installed client detected");
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
    expect(skippedRuntime.stdout.toString()).toContain("No selected installed client detected");
    expect(await pathExists(copilotMcpConfigPath(skipped.home))).toBe(false);
    expect(await pathExists(copilotSkillsDir(skipped.home))).toBe(false);

    const paths = await tempPaths();
    const source = await createSkillFixture(paths.repoRoot, "read", "tenant-pulse");
    const runtime = createMockRuntime(paths);

    const code = await runCli(["setup", "--yes", "--with-copilot", "--verbose", "--app-data", paths.appData], runtime);

    expect(code).toBe(0);
    expect(runtime.stdout.toString()).toContain("GitHub Copilot");
    expect((await readGreybeardConfig(paths.appData)).clients?.githubCopilot).toBe(true);

    const copilot = JSON.parse(await readFile(copilotMcpConfigPath(paths.home), "utf8")) as {
      mcpServers: Record<string, { type?: string; command: string; args?: string[]; tools?: string[] }>;
    };
    expect(copilot.mcpServers["greybeard-memory"].type).toBe("local");
    expect(copilot.mcpServers["greybeard-memory"].tools).toEqual(["*"]);
    expect(copilot.mcpServers["greybeard-memory"].args?.[0]).toContain("cli/dist/index.js");

    const target = join(copilotSkillsDir(paths.home), "tenant-pulse");
    expect(resolve(join(target, ".."), await readlink(target))).toBe(source);
  });

  it("configures Claude Desktop with plain entries, preserves foreign servers, and prints manual steps", async () => {
    const paths = await tempPaths();
    await createSkillFixture(paths.repoRoot, "read", "tenant-pulse");
    const runtime = createMockRuntime(paths, {
      platform: "darwin"
    });
    const configPath = claudeDesktopConfigPath(runtime);
    await mkdir(resolve(configPath, ".."), { recursive: true });
    await writeFile(configPath, JSON.stringify({
      mcpServers: {
        userServer: {
          command: "user-command",
          args: ["--keep"]
        }
      }
    }), "utf8");

    const code = await runCli(["setup", "--yes", "--app-data", paths.appData], runtime);

    expect(code).toBe(0);
    const config = JSON.parse(await readFile(configPath, "utf8")) as {
      mcpServers: Record<string, { type?: string; command: string; args: string[]; env: Record<string, string> }>;
    };
    expect(config.mcpServers.userServer.command).toBe("user-command");
    expect(config.mcpServers["greybeard-memory"].type).toBeUndefined();
    expect(config.mcpServers["greybeard-memory"].args[0]).toContain("cli/dist/index.js");
    expect(config.mcpServers["greybeard-memory"].env).toMatchObject({ GREYBEARD_APP_DATA: paths.appData });
    expect(runtime.stdout.toString()).toContain("Claude Desktop");
    expect(runtime.stdout.toString()).toContain("greybeard skills pack");
    expect(runtime.stdout.toString()).toContain("fully quit and restart Claude Desktop");
    expect(await pathExists(join(paths.home, ".claude", "skills"))).toBe(true);
    if (process.platform !== "win32") {
      expect((await stat(configPath)).mode & 0o777).toBe(0o600);
    }
  });

  it("uses the Claude Desktop adapter writer without adding a type field", async () => {
    const paths = await tempPaths();
    const runtime = createMockRuntime(paths, {
      platform: "win32",
      env: {
        APPDATA: join(paths.root, "roaming")
      }
    });

    await writeClaudeDesktopMcpConfig(runtime);

    const config = JSON.parse(await readFile(claudeDesktopConfigPath(runtime), "utf8")) as {
      mcpServers: Record<string, { type?: string; args: string[] }>;
    };
    expect(config.mcpServers["greybeard-memory"].type).toBeUndefined();
    expect(config.mcpServers["greybeard-memory"].args[0]).not.toContain("\\");
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
    expect(cursor.mcpServers["greybeard-memory"].args?.[0]).toContain("cli/dist/index.js");
    expect(Object.keys(cursor.mcpServers).filter((name) => name === "greybeard-memory")).toHaveLength(1);

    const codex = await readFile(codexConfigPath(paths.home), "utf8");
    expect(codex).toContain("model = \"gpt-5\"");
    expect(codex).toContain("[mcp_servers.other]");
    expect(countOccurrences(codex, "[mcp_servers.greybeard-graph]")).toBe(0);
    expect(countOccurrences(codex, "[mcp_servers.greybeard-memory]")).toBe(1);

    const gemini = JSON.parse(await readFile(geminiSettingsPath(paths.home), "utf8")) as {
      theme: string;
      mcpServers: Record<string, { command: string; args?: string[] }>;
    };
    expect(gemini.theme).toBe("dark");
    expect(gemini.mcpServers.other.command).toBe("other");
    expect(gemini.mcpServers["greybeard-memory"].args?.[0]).toContain("cli/dist/index.js");
    expect(Object.keys(gemini.mcpServers).filter((name) => name === "greybeard-memory")).toHaveLength(1);

    const copilot = JSON.parse(await readFile(copilotMcpConfigPath(paths.home), "utf8")) as {
      setting: string;
      mcpServers: Record<string, { type?: string; command: string; args?: string[]; tools?: string[] }>;
    };
    expect(copilot.setting).toBe("kept");
    expect(copilot.mcpServers.other.command).toBe("other");
    expect(copilot.mcpServers["greybeard-memory"].type).toBe("local");
    expect(copilot.mcpServers["greybeard-memory"].tools).toEqual(["*"]);
    expect(copilot.mcpServers["greybeard-memory"].args?.[0]).toContain("cli/dist/index.js");
    expect(Object.keys(copilot.mcpServers).filter((name) => name === "greybeard-memory")).toHaveLength(1);
  });

  it("writes skill fallback blocks idempotently for context-file fallbacks", async () => {
    const paths = await tempPaths();
    const runtime = createMockRuntime(paths);

    await mkdir(join(paths.home, ".cursor", "rules"), { recursive: true });
    await mkdir(join(paths.home, ".codex"), { recursive: true });
    await mkdir(join(paths.home, ".gemini"), { recursive: true });
    await mkdir(join(paths.home, ".copilot"), { recursive: true });
    await mkdir(join(paths.home, ".claude"), { recursive: true });
    await writeFile(claudeFallbackPath(paths.home), "Existing Claude notes\n", "utf8");
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
    await writeClaudeSkillFallback(runtime);
    const again = await writeClaudeSkillFallback(runtime);
    expect(again.status).toBe("already-configured");
    const claude = await readFile(claudeFallbackPath(paths.home), "utf8");
    expect(claude).toContain("Existing Claude notes");
    expect(countOccurrences(claude, "<!-- GREYBEARD SKILLS START -->")).toBe(1);
    expect(claude).toContain("Never perform this human confirmation");

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

  it("installs MCP and context in custom host configuration directories", async () => {
    const paths = await tempPaths();
    const runtime = createMockRuntime(paths);
    runtime.env.CLAUDE_CONFIG_DIR = join(paths.home, "claude-work");
    runtime.env.CODEX_HOME = join(paths.home, "codex-work");
    await writeClaudeMcpConfig(runtime);
    await writeClaudeSkillFallback(runtime);
    await writeCodexMcpConfig(runtime);
    await writeCodexSkillFallback(runtime);
    const claude = JSON.parse(await readFile(join(runtime.env.CLAUDE_CONFIG_DIR, ".claude.json"), "utf8"));
    expect(claude.mcpServers["greybeard-memory"]).toBeDefined();
    expect(await readFile(join(runtime.env.CLAUDE_CONFIG_DIR, "CLAUDE.md"), "utf8")).toContain("Greybeard Memory");
    expect(await readFile(join(runtime.env.CODEX_HOME, "config.toml"), "utf8")).toContain("[mcp_servers.greybeard-memory]");
    expect(await readFile(join(runtime.env.CODEX_HOME, "AGENTS.md"), "utf8")).toContain("Greybeard Memory");
    expect(await pathExists(join(paths.home, ".claude.json"))).toBe(false);
    expect(await pathExists(join(paths.home, ".codex", "AGENTS.md"))).toBe(false);
  });

  it("uninstalls Codex MCP configuration without touching account authentication", async () => {
    const paths = await tempPaths();
    const runtime = createMockRuntime(paths);
    await mkdir(join(paths.home, ".codex"), { recursive: true });
    const auth = JSON.stringify({ fixture: "not-a-real-credential" });
    await writeFile(codexAuthPath(paths.home), auth);
    await writeCodexMcpConfig(runtime);
    const detected = await detectCodexCli(runtime);
    expect(detected.userConfigPath).toBe(codexConfigPath(paths.home));
    expect(detected.detected).toBe(true);
    expect(await runCli(["uninstall", "--client", "Codex CLI"], runtime)).toBe(0);
    expect(await readFile(codexConfigPath(paths.home), "utf8")).not.toContain("mcp_servers.greybeard-memory");
    expect(await readFile(codexAuthPath(paths.home), "utf8")).toBe(auth);
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

function readZipEntries(zip: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  let offset = 0;
  while (zip.readUInt32LE(offset) === 0x04034b50) {
    const method = zip.readUInt16LE(offset + 8);
    const compressedSize = zip.readUInt32LE(offset + 18);
    const nameLength = zip.readUInt16LE(offset + 26);
    const extraLength = zip.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = zip.subarray(nameStart, nameStart + nameLength).toString("utf8");
    const compressed = zip.subarray(dataStart, dataStart + compressedSize);
    entries.set(name, method === 8 ? inflateRawSync(compressed) : Buffer.from(compressed));
    offset = dataStart + compressedSize;
  }
  return entries;
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
  await mkdir(appData, { recursive: true, mode: 0o700 });
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
    const child = spawn(process.execPath, [scriptPath, "help"], {
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
