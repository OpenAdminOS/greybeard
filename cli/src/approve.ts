import { type ParsedArgs } from "./args.js";
import { type CliRuntime, writeLine } from "./runtime.js";
export async function runApprove(_args: ParsedArgs, runtime: CliRuntime): Promise<number> {
  writeLine(runtime.stderr, "Tenant writes and approvals are unavailable in Greybeard 0.1; an interactive TTY cannot enable them.");
  return 1;
}
