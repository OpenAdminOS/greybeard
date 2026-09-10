#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "./args.js";

import { runDoctor } from "./doctor.js";
import { createRuntime, CliRuntime, writeLine } from "./runtime.js";
import { runMentor } from "./mentor.js";
import { runUninstall } from "./uninstall.js";
import { runConnect } from "./connect.js";
import { runMemory } from "./memory.js";

import { runSetup } from "./setup.js";
import { runSkills } from "./skills.js";
import { runUpdate } from "./update.js";

export async function runCli(argv: string[], runtime: CliRuntime = createRuntime()): Promise<number> {
  const args = parseArgs(argv.length ? argv : ["setup", "--ui"]);
  if (args.command === "mentor") return runMentor(args, runtime);
  if (args.command === "uninstall") return runUninstall(args, runtime);
  if (args.command === "connect") return runConnect(args, runtime);
  if (args.command === "mcp") {
    if (args.positionals[0] === "memory") {
      const { MemoryService, createGreybeardMemoryMcpServer } = await import("@greybeard/memory");
      const { getGreybeardAppDataPath } = await import("@greybeard/graph");
      const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
      const service = new MemoryService({ appDataPath: runtime.env.GREYBEARD_APP_DATA || getGreybeardAppDataPath(), profileId: runtime.env.GREYBEARD_PROFILE_ID });
      const server = createGreybeardMemoryMcpServer(service);
      server.server.onclose = () => service.close();
      await server.connect(new StdioServerTransport());
      return 0;
    }
    if (args.positionals[0] === "graph") {
      const { runGraphServer } = await import("@greybeard/graph");
      await runGraphServer();
      return 0;
    }
    writeLine(runtime.stderr, "Use greybeard mcp memory or greybeard mcp graph.");
    return 1;
  }
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
    writeLine(runtime.stderr, "Tenant writes and approvals are unavailable in Greybeard 0.1.");
    return 1;
  }

  if (args.command === "memory") {
    return runMemory(args, runtime);
  }

  if (args.command === "scopes") {
    writeLine(runtime.stdout, "Tenant connection permissions are chosen with greybeard connect. No permissions are needed for mentor-only use.");
    return 0;
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
  writeLine(runtime.stdout, "Greybeard 0.1 - An IT mentor that learns how you work.");
  writeLine(runtime.stdout, "");
  for (const command of [
    "setup [--ui] [--yes] [--client <name>] [--no-memory-hook] [--update-mode notify|automatic|manual]",
    "connect --help",
    "memory list|candidates|add|confirm|correct|export|pause|resume|forget",
    "doctor", "update", "skills pack [--out <directory>]", "uninstall"
  ]) writeLine(runtime.stdout, `  greybeard ${command}`);
  writeLine(runtime.stdout, "");
  writeLine(runtime.stdout, "Launch without arguments to open local setup. Use --app-data to select your local store.");
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

if (process.env.GREYBEARD_PACKAGED !== "1" && invokedPath && modulePath === invokedPath) {
  runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
