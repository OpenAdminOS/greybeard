import { getGreybeardAppDataPath, readGreybeardConfig } from "@greybeard/graph";
import { flagValue, ParsedArgs } from "./args.js";
import {
  detectAllClients,
  summarizeSkillWiring,
  wireAllClientSkills,
  writeAllClientMcpConfigs,
  writeAllClientSkillFallbacks,
  writeClaudeMemoryHook
} from "./clients.js";
import { CliRuntime, writeInfoLine, writeLine, writeSection, writeStatusLine } from "./runtime.js";
import { serverOptionsFromConfig } from "./serverCatalog.js";
import { loadSkillManifests } from "./skillManifest.js";

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
    const summary = summarizeSkillWiring(result);
    writeStatusLine(runtime.stdout, summary.ok ? "OK" : "WARN", result.client ?? "Client", summary.detail);
  }

  writeSection(runtime.stdout, "Context files");
  const fallbackResults = await writeAllClientSkillFallbacks(runtime, clients);
  const claudeDetected = clients.some((client) => client.detected && client.name === "Claude Code");
  if (fallbackResults.length === 0 && !claudeDetected) {
    writeInfoLine(runtime.stdout, "Clients", "no detected clients, skipped");
  }
  for (const result of fallbackResults) {
    writeStatusLine(runtime.stdout, "OK", result.client, `${result.status} in ${result.path}`);
  }
  if (claudeDetected) {
    if (config.memoryHook === false) {
      writeInfoLine(runtime.stdout, "Claude Code", "memory hook off by setup choice");
    } else {
      const hook = await writeClaudeMemoryHook(runtime);
      writeStatusLine(runtime.stdout, "OK", "Claude Code", `memory hook ${hook.status} in ${hook.path}`);
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

  const { manifests, errors } = await loadSkillManifests(runtime.repoRoot);
  const versions = new Map(manifests.map((manifest) => [manifest.name, manifest.version]));
  const unreadable = new Set(errors.map((error) => error.name));
  const known = new Set([...versions.keys(), ...unreadable]);
  const categories = new Set(manifests.map((manifest) => manifest.category).filter((category) => category.length > 0));

  const names = new Set<string>();
  for (const line of diff.stdout.split(/\r?\n/u)) {
    const [first, second, third, fourth, fifth] = line.split("/");
    if (first !== ".agents" || second !== "skills" || !third || !fourth) {
      continue;
    }

    // Resolve the skill name against the current tree first, so paths under a
    // renamed or deleted category still report the skill, not the category.
    if (known.has(fourth)) {
      names.add(fourth);
    } else if (known.has(third)) {
      names.add(third);
    } else if (fifth) {
      names.add(fourth);
    } else if (!categories.has(third)) {
      names.add(third);
    }
  }

  return [...names].sort().map((name) => ({
    name,
    version: unreadable.has(name)
      ? "manifest unreadable"
      : versions.has(name) ? `version ${versions.get(name)}` : "removed"
  }));
}

function git(runtime: CliRuntime, args: string[]) {
  return runtime.runCommand("git", ["-C", runtime.repoRoot, ...args]);
}
