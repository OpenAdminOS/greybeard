#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "./args.js";
import { runApprove } from "./approve.js";
import { runDoctor } from "./doctor.js";
import { createRuntime, CliRuntime, writeLine } from "./runtime.js";
import { runMemory } from "./memory.js";
import { runScopes } from "./scopes.js";
import { runSetup } from "./setup.js";
import { runSkills } from "./skills.js";
import { runUpdate } from "./update.js";

export async function runCli(argv: string[], runtime: CliRuntime = createRuntime()): Promise<number> {
  const args = parseArgs(argv);
  if (args.command === "help" || args.command === "--help" || args.command === "-h") {
    printHelp(runtime);
    return 0;
  }

  if (args.command === "setup") {
    return runSetup(args, runtime);
  }

  if (args.command === "doctor") {
    return runDoctor(args, runtime);
  }

  if (args.command === "approve") {
    return runApprove(args, runtime);
  }

  if (args.command === "memory") {
    return runMemory(args, runtime);
  }

  if (args.command === "scopes") {
    return runScopes(args, runtime);
  }

  if (args.command === "update") {
    return runUpdate(args, runtime);
  }

  if (args.command === "skills") {
    return runSkills(args, runtime);
  }

  writeLine(runtime.stderr, `greybeard ${args.command} is not implemented in this milestone.`);
  return 1;
}

function printHelp(runtime: CliRuntime): void {
  writeLine(runtime.stdout, "Greybeard CLI");
  writeLine(runtime.stdout, "");
  writeLine(runtime.stdout, "Commands:");
  writeLine(runtime.stdout, "  greybeard setup [--yes] [--verbose] [--writes] [--memory-hook] [--no-memory-hook] [--with-copilot] [--tenant <tenant-id>] [--write-scope <scope>] [--skill-update weekly|login|off] [--server-update latest|pinned] [--server-source local|npm] [--enable-server <name>] [--disable-server <name>]");
  writeLine(runtime.stdout, "  greybeard update");
  writeLine(runtime.stdout, "  greybeard skills pack [--out <directory>]");
  writeLine(runtime.stdout, "  greybeard doctor");
  writeLine(runtime.stdout, "  greybeard scopes");
  writeLine(runtime.stdout, "  greybeard approve [--plan-id <plan-id>]");
  writeLine(runtime.stdout, "  greybeard memory list [--type <type>] [--limit <n>]");
  writeLine(runtime.stdout, "  greybeard memory forget --id <id>");
  writeLine(runtime.stdout, "  greybeard memory forget --older-than-days <days> --type <type>");
  writeLine(runtime.stdout, "");
  writeLine(runtime.stdout, "Environment overrides:");
  writeLine(runtime.stdout, "  GREYBEARD_APP_DATA, GREYBEARD_HOME, GREYBEARD_REPO_DIR, GREYBEARD_TENANT_ID, GREYBEARD_WRITE_SCOPES");
}

function safeRealpath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

const invokedPath = process.argv[1] ? safeRealpath(process.argv[1]) : null;
const modulePath = safeRealpath(fileURLToPath(import.meta.url));

if (invokedPath && modulePath === invokedPath) {
  runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
