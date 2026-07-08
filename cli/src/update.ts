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
import {
  detectAllClients,
  listSkillSourceDirs,
  repoSkillsDir,
  wireAllClientSkills,
  writeAllClientMcpConfigs
} from "./clients.js";
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

  writeSection(runtime.stdout, "Skills");
  const skillResults = await wireAllClientSkills(runtime, clients);
  if (skillResults.length === 0) {
    writeInfoLine(runtime.stdout, "Clients", "no detected clients, skipped");
  }
  for (const result of skillResults) {
    const clientName = result.client ?? "Client";
    if (result.empty) {
      writeStatusLine(runtime.stdout, "WARN", clientName, `no skill folders found in ${result.sourceDir}`);
      continue;
    }

    const blocked = result.entries.filter((entry) => entry.status === "blocked");
    if (blocked.length > 0) {
      writeStatusLine(
        runtime.stdout,
        "WARN",
        clientName,
        `${result.entries.length - blocked.length}/${result.entries.length} skills linked, ${blocked.map((entry) => entry.name).join(", ")} blocked`
      );
    } else {
      writeStatusLine(runtime.stdout, "OK", clientName, `${result.entries.length} skills linked`);
    }
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

  const sources = await listSkillSourceDirs(repoSkillsDir(runtime.repoRoot));
  const categories = new Set(sources.map((source) => source.category).filter((category) => category.length > 0));
  const skillPaths = new Map(sources.map((source) => [source.name, source.path]));

  const names = new Set<string>();
  for (const line of diff.stdout.split(/\r?\n/u)) {
    const [first, second, third, fourth, fifth] = line.split("/");
    if (first !== ".agents" || second !== "skills" || !third || !fourth) {
      continue;
    }

    if (categories.has(third)) {
      if (fifth) {
        names.add(fourth);
      }
    } else {
      names.add(third);
    }
  }

  const result: ChangedSkill[] = [];
  for (const name of [...names].sort()) {
    result.push({
      name,
      version: await skillVersion(skillPaths.get(name))
    });
  }

  return result;
}

async function skillVersion(skillPath: string | undefined): Promise<string> {
  if (!skillPath) {
    return "removed";
  }

  try {
    const content = await readFile(join(skillPath, "SKILL.md"), "utf8");
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
  serverToggles: Record<string, boolean>;
} {
  return {
    serverUpdate: config.serverUpdate ?? "latest",
    serverPackageSource: config.serverPackageSource ?? "local",
    serverToggles: config.mcpServers ?? {}
  };
}

function git(runtime: CliRuntime, args: string[]) {
  return runtime.runCommand("git", ["-C", runtime.repoRoot, ...args]);
}
