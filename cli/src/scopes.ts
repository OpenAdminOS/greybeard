import { DEFAULT_TIER1_SCOPES, GRAPH_CLI_CLIENT_ID, scopeJustification } from "@greybeard/graph";
import { CliRuntime, writeInfoLine, writeLine, writeSection } from "./runtime.js";
import { DEFAULT_WRITE_SCOPES } from "./setup.js";

export const TIER2_SCOPES = [
  "Device.Read.All",
  "DeviceManagementConfiguration.Read.All",
  "DeviceManagementManagedDevices.Read.All",
  "DeviceManagementApps.Read.All",
  "DeviceManagementServiceConfig.Read.All",
  "Application.Read.All",
  "RoleManagement.Read.Directory",
  "IdentityRiskyUser.Read.All",
  "SecurityEvents.Read.All"
] as const;

export function runScopes(runtime: CliRuntime): number {
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

  return 0;
}
