import { getGreybeardAppDataPath } from "@greybeard/graph";
import { MEMORY_TYPES, MemoryService, type MemoryType } from "@greybeard/memory";
import { flagValue, ParsedArgs } from "./args.js";
import { CliRuntime, writeLine } from "./runtime.js";

export async function runMemory(args: ParsedArgs, runtime: CliRuntime): Promise<number> {
  const subcommand = args.positionals[0] ?? "help";
  if (subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
    printMemoryHelp(runtime);
    return 0;
  }

  const appDataPath = flagValue(args, "app-data") || runtime.env.GREYBEARD_APP_DATA || getGreybeardAppDataPath();
  const service = new MemoryService({ appDataPath });
  try {
    if (subcommand === "list") {
      const type = optionalType(flagValue(args, "type"));
      const limit = optionalNumber(flagValue(args, "limit"), "limit");
      const result = await service.list({ type, limit });
      writeJson(runtime.stdout, result);
      return 0;
    }

    if (subcommand === "forget") {
      const id = optionalNumber(flagValue(args, "id"), "id");
      const olderThanDays = optionalNumber(
        flagValue(args, "older-than-days") ?? flagValue(args, "olderThanDays"),
        "olderThanDays"
      );
      const type = optionalType(flagValue(args, "type"));
      const result = await service.forget({ id, olderThanDays, type });
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
