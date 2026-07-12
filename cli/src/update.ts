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
  const status = await git(runtime, ["status", "--porcelain", "--untracked-files=no"]);
  if (status.code !== 0) {
    writeLine(runtime.stderr, `Unable to verify the Greybeard working tree: ${status.stderr || status.stdout}`);
    return 1;
  }
  if (status.stdout.trim()) {
    writeLine(runtime.stderr, "Greybeard update requires a clean tracked working tree. Commit or stash local changes and retry.");
    return 1;
  }

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
    const rollback = await rollbackUpdate(runtime, before.stdout.trim());
    writeLine(runtime.stderr, `Unable to read updated git HEAD in ${runtime.repoRoot}: ${after.stderr || after.stdout}`);
    writeLine(runtime.stderr, rollback.ok
      ? `Rolled back source, dependencies, and runtime artifacts to ${before.stdout.trim()}.`
      : `Rollback to ${before.stdout.trim()} was incomplete: ${rollback.detail}`);
    return 1;
  }

  const beforeRevision = before.stdout.trim();
  const afterRevision = after.stdout.trim();
  const verification = [
    { label: "Dependencies", command: "npm", args: ["ci"] },
    { label: "Build", command: "npm", args: ["run", "build"] },
    { label: "Tests", command: "npm", args: ["test"] }
  ];
  for (const step of verification) {
    const result = await runtime.runCommand(step.command, step.args, { cwd: runtime.repoRoot });
    if (result.code !== 0) {
      const rollback = await rollbackUpdate(runtime, beforeRevision);
      writeLine(runtime.stderr, `${step.label} failed after update: ${result.stderr || result.stdout}`);
      writeLine(runtime.stderr, rollback.ok
        ? `Rolled back source, dependencies, and runtime artifacts to ${beforeRevision}.`
        : `Rollback to ${beforeRevision} was incomplete: ${rollback.detail}`);
      return 1;
    }
  }

  writeLine(runtime.stdout, "Greybeard update");
  writeLine(runtime.stdout, "────────────────");
  writeInfoLine(runtime.stdout, "Before", beforeRevision);
  writeInfoLine(runtime.stdout, "After", afterRevision);
  writeStatusLine(runtime.stdout, "OK", "Git", pull.stdout.trim() || "Already up to date.");
  for (const step of verification) {
    writeStatusLine(runtime.stdout, "OK", step.label, "complete");
  }

  const changed = beforeRevision === afterRevision
    ? []
    : await changedSkills(runtime, beforeRevision, afterRevision);
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
    const restart = result.client === "Claude Desktop" ? "; full app restart required" : "";
    writeStatusLine(runtime.stdout, "OK", result.client, `${result.path}${restart}`);
  }

  writeSection(runtime.stdout, "Skills");
  const skillResults = await wireAllClientSkills(runtime, clients);
  if (skillResults.length === 0) {
    writeInfoLine(runtime.stdout, "Clients", "no detected clients, skipped");
  }
  for (const result of skillResults) {
    if (result.channel === "manual-zip") {
      writeInfoLine(runtime.stdout, result.client ?? "Client", result.manualInstruction ?? "manual ZIP upload required");
      continue;
    }

    const summary = summarizeSkillWiring(result);
    writeStatusLine(runtime.stdout, summary.ok ? "OK" : "WARN", result.client ?? "Client", summary.detail);
  }

  writeSection(runtime.stdout, "Context files");
  const fallbackResults = await writeAllClientSkillFallbacks(runtime, clients);
  const claudeDetected = clients.some((client) => client.detected && client.name === "Claude Code");
  const claudeDesktopDetected = clients.some((client) => client.detected && client.name === "Claude Desktop");
  if (fallbackResults.length === 0 && !claudeDetected && !claudeDesktopDetected) {
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
  if (claudeDesktopDetected) {
    writeInfoLine(runtime.stdout, "Claude Desktop", "no global instruction file; manual ZIP upload is the skills channel");
  }

  if (claudeDesktopDetected && changed.length > 0) {
    const changedUploads = changed.filter((skill) => skill.version !== "removed");
    const removedUploads = changed.filter((skill) => skill.version === "removed");
    writeSection(runtime.stdout, "Claude Desktop skill uploads");
    if (changedUploads.length > 0) {
      writeInfoLine(runtime.stdout, "Action", "run greybeard skills pack, then re-upload the changed ZIPs in Settings > Capabilities > Skills");
      writeInfoLine(runtime.stdout, "Changed ZIPs", changedUploads.map((skill) => `${skill.name}.zip`).join(", "));
    }
    if (removedUploads.length > 0) {
      writeInfoLine(runtime.stdout, "Remove uploads", removedUploads.map((skill) => skill.name).join(", "));
    }
  }

  writeSection(runtime.stdout, "Activation");
  writeStatusLine(runtime.stdout, "OK", "Runtime", "rebuilt and verified before MCP configuration activation");
  writeInfoLine(runtime.stdout, "MCP clients", "reload or reconnect clients to launch the updated server runtime");
  if (claudeDesktopDetected) {
    writeInfoLine(runtime.stdout, "Claude Desktop", "fully quit and restart the app to load the updated MCP config");
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
  let manifestChanged = false;
  for (const line of diff.stdout.split(/\r?\n/u)) {
    const [first, second, third, fourth, fifth] = line.split("/");
    if (first === ".agents" && second === "skills" && third === "manifest.json") {
      manifestChanged = true;
      continue;
    }
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
  if (manifestChanged) {
    for (const name of await changedManifestSkills(runtime, before, after)) {
      names.add(name);
    }
  }

  return [...names].sort().map((name) => ({
    name,
    version: unreadable.has(name)
      ? "manifest unreadable"
      : versions.has(name) ? `version ${versions.get(name)}` : "removed"
  }));
}

async function changedManifestSkills(runtime: CliRuntime, before: string, after: string): Promise<string[]> {
  const [oldResult, newResult] = await Promise.all([
    git(runtime, ["show", `${before}:.agents/skills/manifest.json`]),
    git(runtime, ["show", `${after}:.agents/skills/manifest.json`])
  ]);
  const oldSkills = manifestSkills(oldResult.code === 0 ? oldResult.stdout : "{}");
  const newSkills = manifestSkills(newResult.code === 0 ? newResult.stdout : "{}");
  return [...new Set([...Object.keys(oldSkills), ...Object.keys(newSkills)])]
    .filter((name) => JSON.stringify(oldSkills[name]) !== JSON.stringify(newSkills[name]));
}

function manifestSkills(content: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(content);
    if (!isObject(parsed) || !isObject(parsed.skills)) {
      return {};
    }
    return parsed.skills;
  } catch {
    return {};
  }
}

async function rollbackUpdate(runtime: CliRuntime, revision: string): Promise<{ ok: boolean; detail: string }> {
  const commands = [
    ["git", ["-C", runtime.repoRoot, "reset", "--hard", revision]],
    ["npm", ["ci"]],
    ["npm", ["run", "build"]]
  ] as const;
  for (const [command, args] of commands) {
    const result = await runtime.runCommand(command, [...args], { cwd: runtime.repoRoot });
    if (result.code !== 0) {
      return {
        ok: false,
        detail: `${command} ${args.join(" ")} failed: ${result.stderr || result.stdout}`
      };
    }
  }
  return { ok: true, detail: "complete" };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function git(runtime: CliRuntime, args: string[]) {
  return runtime.runCommand("git", ["-C", runtime.repoRoot, ...args]);
}
