import { APPLICATION_CAPABILITIES, getGreybeardAppDataPath } from "@greybeard/graph";
import { flagValue, type ParsedArgs } from "./args.js";
import { getConnectionPreview } from "./connectionPreview.js";
import { type CliRuntime, writeLine } from "./runtime.js";

export async function runScopes(args: ParsedArgs, runtime: CliRuntime): Promise<number> {
  const appDataPath = flagValue(args, "app-data") || runtime.env.GREYBEARD_APP_DATA || getGreybeardAppDataPath();
  writeLine(runtime.stdout, "Optional application permissions on your own app registration. Mentor-only mode requires none.");
  for (const [key, capability] of Object.entries(APPLICATION_CAPABILITIES)) writeLine(runtime.stdout, `${key}: ${capability.permission} - ${capability.label}`);
  writeLine(runtime.stdout, "These are candidate mappings, not isolated minimum-grant certifications. Greybeard never grants consent or narrows pre-existing grants. Production writes are disabled.");
  writeLine(runtime.stdout, JSON.stringify(await getConnectionPreview(appDataPath), null, 2));
  writeLine(runtime.stdout, "Use greybeard connect status --verify for explicit live read probes. Configuration alone does not establish readiness.");
  return 0;
}
