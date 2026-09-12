import { getGreybeardAppDataPath, updateGreybeardConfig } from "@greybeard/graph";
import { MEMORY_TYPES, MemoryService, type MemoryType } from "@greybeard/memory";
import { openMemoryBackend, RemoteMemory } from "./sharedMemory.js";
import { flagValue, ParsedArgs } from "./args.js";
import { CliRuntime, writeLine } from "./runtime.js";

export async function runMemory(args: ParsedArgs, runtime: CliRuntime): Promise<number> {
  const subcommand = args.positionals[0] ?? "help";
  if (subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
    printMemoryHelp(runtime);
    return 0;
  }

  const appDataPath = flagValue(args, "app-data") || runtime.env.GREYBEARD_APP_DATA || getGreybeardAppDataPath();
  if (subcommand === "pause" || subcommand === "resume") {
    await updateGreybeardConfig(appDataPath, current => ({ ...current, learningEnabled: subcommand === "resume" }));
    writeLine(runtime.stdout, subcommand === "pause" ? "Memory capture and mentor advice paused." : "Memory capture and mentor advice resumed.");
    return 0;
  }
  const service = await openMemoryBackend({ appDataPath, profileId: flagValue(args, "profile") }, true);
  try {
    if (service instanceof RemoteMemory) writeLine(runtime.stderr, `Shared store: ${service.binding.url}, profile ${service.profileId}, environment ${service.tenant}.`);
    if (subcommand === "list" || subcommand === "candidates") {
      const type = optionalType(flagValue(args, "type"));
      const limit = optionalNumber(flagValue(args, "limit"), "limit");
      const result = await service.list({ type, limit, cursor: optionalNumber(flagValue(args, "cursor"), "cursor"), ...(subcommand === "candidates" ? { status: "candidate" as const } : {}) });
      writeJson(runtime.stdout, result);
      return 0;
    }

    if (subcommand === "export") {
      writeJson(runtime.stdout, await service.export());
      return 0;
    }
    if (subcommand === "add" || subcommand === "correct") {
      const content = flagValue(args, "content");
      if (!content) throw new Error("--content is required.");
      const supersedes = optionalNumber(flagValue(args, "id"), "id");
      if (subcommand === "correct" && !supersedes) throw new Error("--id is required for correction.");
      const original = subcommand === "correct" ? (await service.export()).nodes.find(node => node.id === supersedes) : undefined;
      if (subcommand === "correct" && !original) throw new Error("Memory to correct was not found in this profile.");
      writeJson(runtime.stdout, await service.remember({ content, type: optionalType(flagValue(args, "type")) ?? original?.type ?? "preference", source: "local-cli", scope: flagValue(args, "scope") ?? original?.scope, ...(subcommand === "correct" ? { supersedes, ...(service instanceof RemoteMemory ? {expectedOriginalRevision: original?.revision} : {}) } : {}) }));
      writeLine(runtime.stdout, "Candidate saved. Review and confirm with greybeard memory confirm --id <id>.");
      return 0;
    }
    if (subcommand === "confirm") {
      const id = optionalNumber(flagValue(args, "id"), "id");
      if (!id) throw new Error("--id is required.");
      // Preview the precise record before using the terminal confirmation channel.
      const exported = await service.export();
      const node = exported.nodes.find(candidate => candidate.id === id);
      if (!node || node.status !== "candidate") throw new Error("Candidate not found in this profile.");
      writeJson(runtime.stdout, node);
      writeLine(runtime.stdout, "Confirm only a lesson you know to be correct. Local processes sharing your account can access this store.");
      if (!runtime.stdin.isTTY) throw new Error("Confirmation requires an interactive terminal; --yes and piped input cannot confirm memories.");
      const decision = await runtime.confirm("Press Enter to confirm this exact lesson, or Ctrl+C to cancel: ");
      if (decision !== "confirmed") { writeLine(runtime.stdout, "Memory was not confirmed."); return 1; }
      writeJson(runtime.stdout, await service.confirm({ id, expectedRevision: node.revision }));
      return 0;
    }

    if (subcommand === "forget") {
      const id = optionalNumber(flagValue(args, "id"), "id");
      const olderThanDays = optionalNumber(
        flagValue(args, "older-than-days") ?? flagValue(args, "olderThanDays"),
        "olderThanDays"
      );
      const type = optionalType(flagValue(args, "type"));
      if (service instanceof RemoteMemory && !id) throw new Error("Shared memory deletion requires one exact record ID.");
      const node = service instanceof RemoteMemory ? (await service.export()).nodes.find(n => n.id === id) : undefined;
      if (service instanceof RemoteMemory && (!node || !runtime.stdin.isTTY || await runtime.confirm(`Forget this exact shared memory: ${node.content} (Enter to confirm): `) !== "confirmed")) throw new Error("Shared memory deletion needs interactive review.");
      const result = await service.forget(service instanceof RemoteMemory ? { id, expectedRevision: node?.revision } as Parameters<MemoryService["forget"]>[0] : { id, olderThanDays, type });
      writeJson(runtime.stdout, result);
      return 0;
    }

    writeLine(runtime.stderr, `greybeard memory ${subcommand} is not implemented.`);
    printMemoryHelp(runtime);
    return 1;
  } catch (error) {
    writeLine(runtime.stderr, error instanceof Error ? error.message : String(error));
    return 1;
  } finally {
    service.close();
  }
}

function printMemoryHelp(runtime: CliRuntime): void {
  writeLine(runtime.stdout, "Greybeard memory commands:");
  writeLine(runtime.stdout, "  greybeard memory candidates | export | pause | resume");
  writeLine(runtime.stdout, "  greybeard memory add --content <lesson> [--scope <scope>]");
  writeLine(runtime.stdout, "  greybeard memory confirm --id <id> (interactive terminal)");
  writeLine(runtime.stdout, "  greybeard memory correct --id <id> --content <replacement>");
  writeLine(runtime.stdout, "  greybeard memory list [--type <type>] [--limit <n>]");
  writeLine(runtime.stdout, "  greybeard memory forget --id <id>");
  writeLine(runtime.stdout, "  greybeard memory forget --older-than-days <days> --type <type>");
}

function optionalType(value: string | undefined): MemoryType | undefined {
  if (!value) {
    return undefined;
  }

  if (!MEMORY_TYPES.includes(value as MemoryType)) {
    throw new Error(`Invalid memory type: ${value}`);
  }

  return value as MemoryType;
}

function optionalNumber(value: string | undefined, name: string): number | undefined {
  if (!value) {
    return undefined;
  }

  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    throw new Error(`Invalid ${name}: ${value}`);
  }

  return numberValue;
}

function writeJson(stream: CliRuntime["stdout"], value: unknown): void {
  writeLine(stream, JSON.stringify(value, null, 2));
}
