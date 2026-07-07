import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  getGreybeardAppDataPath,
  readGreybeardConfig,
  type GreybeardConfig,
  type ServerPackageSource,
  type ServerUpdateMode
} from "@greybeard/graph";
import { flagValue, ParsedArgs } from "./args.js";
import { detectAllClients, repoSkillsDir, writeAllClientMcpConfigs } from "./clients.js";
import { CliRuntime, writeInfoLine, writeLine, writeSection, writeStatusLine } from "./runtime.js";

export async function runUpdate(args: ParsedArgs, runtime: CliRuntime): Promise<number> {
  const appDataPath = flagValue(args, "app-data") || runtime.env.GREYBEARD_APP_DATA || getGreybeardAppDataPath();
  const before = await git(runtime, ["rev-parse", "HEAD"]);
  if (before.code !== 0) {
    writeLine(runtime.stderr, `Unable to read git HEAD in ${runtime.repoRoot}: ${before.stderr || before.stdout}`);
    return 1;
  }

  const pull = await git(runtime, ["pull", "--ff-only"]);
  if (pull.code !== 0) {
    writeLine(runtime.stderr, `git pull --ff-only failed in ${runtime.repoRoot}: ${pull.stderr || pull.stdout}`);
    return 1;
  }

  const after = await git(runtime, ["rev-parse", "HEAD"]);
  if (after.code !== 0) {
    writeLine(runtime.stderr, `Unable to read updated git HEAD in ${runtime.repoRoot}: ${after.stderr || after.stdout}`);
    return 1;
  }

  writeLine(runtime.stdout, "Greybeard update");
  writeLine(runtime.stdout, "────────────────");
  writeInfoLine(runtime.stdout, "Before", before.stdout.trim());
  writeInfoLine(runtime.stdout, "After", after.stdout.trim());
  writeStatusLine(runtime.stdout, "OK", "Git", pull.stdout.trim() || "Already up to date.");

  const changed = before.stdout.trim() === after.stdout.trim()
    ? []
    : await changedSkills(runtime, before.stdout.trim(), after.stdout.trim());
  writeSection(runtime.stdout, "Changed skills");
  if (changed.length === 0) {
    writeInfoLine(runtime.stdout, "Skills", "none");
  } else {
    for (const skill of changed) {
      writeInfoLine(runtime.stdout, skill.name, skill.version);
    }
  }

  const config = await readGreybeardConfig(appDataPath);
  const clients = await detectAllClients(runtime, {
    githubCopilot: config.clients?.githubCopilot === true
  });
  writeSection(runtime.stdout, "MCP configuration");
  const mcpResults = await writeAllClientMcpConfigs(runtime, serverOptionsFromConfig(config), clients);
  if (mcpResults.length === 0) {
    writeInfoLine(runtime.stdout, "Clients", "no detected clients, skipped");
  }
  for (const result of mcpResults) {
    writeStatusLine(runtime.stdout, "OK", result.client, result.path);
  }

  return 0;
}

type ChangedSkill = {
  name: string;
  version: string;
};

async function changedSkills(runtime: CliRuntime, before: string, after: string): Promise<ChangedSkill[]> {
  const diff = await git(runtime, ["diff", "--name-only", `${before}..${after}`, "--", ".agents/skills"]);
  if (diff.code !== 0) {
    throw new Error(diff.stderr || diff.stdout || "git diff failed");
  }

  const names = new Set<string>();
  for (const line of diff.stdout.split(/\r?\n/u)) {
    const parts = line.split("/");
    if (parts[0] === ".agents" && parts[1] === "skills" && parts[2]) {
      names.add(parts[2]);
    }
  }

  const result: ChangedSkill[] = [];
  for (const name of [...names].sort()) {
    result.push({
      name,
      version: await skillVersion(runtime, name)
    });
  }

  return result;
}

async function skillVersion(runtime: CliRuntime, skillName: string): Promise<string> {
  try {
    const content = await readFile(join(repoSkillsDir(runtime.repoRoot), skillName, "SKILL.md"), "utf8");
    const frontmatterVersion = /^version:\s*(.+)$/mu.exec(content);
    if (frontmatterVersion?.[1]) {
      return `version ${frontmatterVersion[1].trim()}`;
    }

    const bodyVersion = /^Version:\s*(.+)$/mu.exec(content);
    if (bodyVersion?.[1]) {
      return `Version: ${bodyVersion[1].trim()}`;
    }

    return "version unknown";
  } catch {
    return "removed";
  }
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

function git(runtime: CliRuntime, args: string[]) {
  return runtime.runCommand("git", ["-C", runtime.repoRoot, ...args]);
}
