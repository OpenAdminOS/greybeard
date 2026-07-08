import {
  DEFAULT_TIER1_SCOPES,
  DEFAULT_WRITE_SCOPES,
  GRAPH_CLI_CLIENT_ID,
  getGreybeardAppDataPath,
  readGreybeardConfig,
  scopeJustification,
  TIER2_SCOPES
} from "@greybeard/graph";
import { flagValue, ParsedArgs } from "./args.js";
import { CliRuntime, writeInfoLine, writeLine, writeSection } from "./runtime.js";

export async function runScopes(args: ParsedArgs, runtime: CliRuntime): Promise<number> {
  const appDataPath = flagValue(args, "app-data") || runtime.env.GREYBEARD_APP_DATA || getGreybeardAppDataPath();
  const config = await readGreybeardConfig(appDataPath);

  writeLine(runtime.stdout, "Delegated Microsoft Graph scopes Greybeard can request");
  writeLine(runtime.stdout, "");
  writeLine(runtime.stdout, "Read-only sign-in uses the first-party Microsoft Graph Command Line Tools");
  writeLine(runtime.stdout, `app, client ID ${GRAPH_CLI_CLIENT_ID}. Greybeard registers no`);
  writeLine(runtime.stdout, "app of its own unless you explicitly run greybeard setup --writes.");

  writeSection(runtime.stdout, "Tier 1, requested at first sign-in");
  for (const scope of DEFAULT_TIER1_SCOPES) {
    writeInfoLine(runtime.stdout, scope, scopeJustification(scope), 40);
  }

  writeSection(runtime.stdout, "Tier 2, requested only when a skill needs it");
  for (const scope of TIER2_SCOPES) {
    writeInfoLine(runtime.stdout, scope, scopeJustification(scope), 40);
  }

  writeSection(runtime.stdout, "Write scopes, only with greybeard setup --writes");
  writeLine(runtime.stdout, "Writes use a tenant-owned workspace app and always require an approved plan.");
  for (const scope of DEFAULT_WRITE_SCOPES) {
    writeInfoLine(runtime.stdout, scope, scopeJustification(scope), 40);
  }

  const defaultWriteScopes = new Set<string>(DEFAULT_WRITE_SCOPES);
  const customWriteScopes = (config.requestedWriteScopes ?? []).filter((scope) => !defaultWriteScopes.has(scope));
  if (customWriteScopes.length > 0) {
    writeSection(runtime.stdout, "Custom write scopes configured on this install");
    for (const scope of customWriteScopes) {
      writeInfoLine(runtime.stdout, scope, scopeJustification(scope), 40);
    }
  }

  return 0;
}
