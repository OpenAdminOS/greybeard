import { resolve } from "node:path";
import { APPLICATION_CAPABILITIES, AppOnlyGraphAuthProvider, GraphService, expectedApplicationRoles, getGreybeardAppDataPath, readGreybeardConfig, updateGreybeardConfig, type AppOnlyProfile } from "@greybeard/graph";
import { flagValue, flagValues, type ParsedArgs } from "./args.js";
import { writeLine, type CliRuntime } from "./runtime.js";

export async function runConnect(args: ParsedArgs, runtime: CliRuntime): Promise<number> {
  const appDataPath = flagValue(args, "app-data") || runtime.env.GREYBEARD_APP_DATA || getGreybeardAppDataPath();
  try {
    if (args.positionals[0] === "disconnect") {
      await updateGreybeardConfig(appDataPath, (current) => ({ ...current, appOnlyProfile: undefined, activeTenantId: undefined }));
      writeLine(runtime.stdout, "Tenant disconnected. Restart AI clients to remove their tenant tool connection. Your customer-owned certificate files and local memories are retained.");
      return 0;
    }
    if (args.positionals[0] === "status") {
      const profile = (await readGreybeardConfig(appDataPath)).appOnlyProfile;
      writeLine(runtime.stdout, JSON.stringify(profile ? { configured: true, tenantId: profile.tenantId, clientId: profile.clientId, capabilities: profile.capabilities, verifiedNow: false } : { configured: false, mentorAvailable: true }, null, 2));
      return 0;
    }
    if (args.positionals[0] === "capabilities" || !flagValue(args, "tenant")) {
      writeLine(runtime.stdout, "Optional customer-owned app registration. No user sign-in and no permissions selected by default.");
      writeLine(runtime.stdout, "greybeard connect --tenant <id> --client-id <id> --certificate <public.pem> --private-key <private.pem> --capability <name>");
      writeLine(runtime.stdout, "Provision the certificate and selected Application permissions in Entra, grant admin consent, and protect the private key locally. Greybeard never creates registrations or grants consent.");
      for (const [name, capability] of Object.entries(APPLICATION_CAPABILITIES)) writeLine(runtime.stdout, `${name}: ${capability.permission} - ${capability.label}`);
      writeLine(runtime.stdout, "These are candidate permission mappings; isolated minimum-grant verification remains pending. Successful probes do not certify least privilege. Private-key file protection is currently checked on POSIX; Windows tenant connection is unavailable until its protected provider is verified.");
      return 0;
    }
    const profile: AppOnlyProfile = {
      tenantId: (flagValue(args, "tenant") ?? "").toLowerCase(), clientId: (flagValue(args, "client-id") ?? "").toLowerCase(),
      certificatePath: resolve(runtime.cwd, flagValue(args, "certificate") ?? ""),
      privateKeyPath: resolve(runtime.cwd, flagValue(args, "private-key") ?? ""), capabilities: flagValues(args, "capability")
    };
    if (!flagValue(args, "certificate") || !flagValue(args, "private-key")) throw new Error("Both the public certificate and private-key file paths are required. No credential is copied into configuration.");
    const roles = expectedApplicationRoles(profile);
    writeLine(runtime.stdout, `Checking customer application credentials and exact selected roles: ${roles.join(", ")}.`);
    const auth = await AppOnlyGraphAuthProvider.create(profile);
    await auth.getToken([]);
    const service = new GraphService({ auth, fetcher: runtime.fetcher, appDataPath });
    try {
      for (const key of profile.capabilities) {
        const capability = APPLICATION_CAPABILITIES[key as keyof typeof APPLICATION_CAPABILITIES];
        const result = await service.graph({ apiVersion: "beta", path: capability.path, query: { "$select": capability.select, "$top": 1 }, fetchAll: false });
        if (!result.data || typeof result.data !== "object" || !Array.isArray((result.data as Record<string, unknown>).value)) throw new Error(`Unexpected response shape for ${key}. Connection remains inactive.`);
        writeLine(runtime.stdout, `${key}: selected read probe succeeded.`);
      }
    } finally { await service.close(); }
    await updateGreybeardConfig(appDataPath, (current) => ({ ...current, appOnlyProfile: profile, activeTenantId: profile.tenantId }));
    writeLine(runtime.stdout, "Customer application connected for selected reads. These probes do not certify minimum grants. Run greybeard setup to add the tenant MCP entry, then reconnect your AI client. Production writes are disabled.");
    return 0;
  } catch (error) {
    // MSAL error strings can contain request details. Keep the external response local and concise.
    writeLine(runtime.stderr, error instanceof Error ? error.message : "Tenant connection failed.");
    return 1;
  }
}
