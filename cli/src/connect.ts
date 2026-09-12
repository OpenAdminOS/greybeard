import { getConnectionPreview } from "./connectionPreview.js";
import { resolve } from "node:path";
import { readGreybeardConfig, saveClientSecret, removeClientSecret, validateClientSecret, APPLICATION_CAPABILITIES, AppOnlyGraphAuthProvider, GraphService, previewCapabilities, expectedApplicationRoles, getGreybeardAppDataPath, updateGreybeardConfig, type AppOnlyProfile } from "@greybeard/graph";
import { flagValue, flagValues, type ParsedArgs } from "./args.js";
import { writeLine, type CliRuntime } from "./runtime.js";

export async function runConnect(args: ParsedArgs, runtime: CliRuntime, suppliedSecret?: string): Promise<number> {
  const appDataPath = flagValue(args, "app-data") || runtime.env.GREYBEARD_APP_DATA || getGreybeardAppDataPath();
  let savedSecretRef: string | undefined;
  let committed = false;
  try {
    if (args.positionals[0] === "disconnect") {
      let previous: AppOnlyProfile | undefined;
      await updateGreybeardConfig(appDataPath, (current) => {
        previous = current.appOnlyProfile;
        return { ...current, appOnlyProfile: undefined, activeTenantId: undefined };
      });
      if (previous?.authMethod === "client-secret") await removeClientSecret(appDataPath, previous.secretRef).catch(() => {
        writeLine(runtime.stdout, "Connection removed, but its saved credential could not be deleted from the OS credential store. Remove the Greybeard application credential there when it is unlocked.");
      });
      writeLine(runtime.stdout, "Tenant disconnected. Restart AI clients to remove their tenant tool connection. Your customer-owned certificate files and local memories are retained.");
      return 0;
    }
    if (args.positionals[0] === "status") {
      writeLine(runtime.stdout, JSON.stringify(await getConnectionPreview(appDataPath, { verify: args.flags.has("verify"), fetcher: runtime.fetcher }), null, 2));
      return 0;
    }
    if (args.positionals[0] === "capabilities" || !flagValue(args, "tenant")) {
      writeLine(runtime.stdout, "Optional customer-owned app registration. No user sign-in and no permissions selected by default.");
      writeLine(runtime.stdout, "greybeard connect --tenant <id> --client-id <id> --certificate <public.pem> --private-key <private.pem> --capability <name>");
      writeLine(runtime.stdout, "Alternatively use --client-secret-stdin instead of the certificate flags, or enter the secret value in the companion. Secrets are saved in the OS credential store; no plaintext fallback.");
      writeLine(runtime.stdout, "Provision the certificate and selected Application permissions in Entra, grant admin consent, and protect the private key locally. Greybeard never creates registrations or grants consent.");
      for (const [name, capability] of Object.entries(APPLICATION_CAPABILITIES)) writeLine(runtime.stdout, `${name}: ${capability.permission} - ${capability.label}`);
      writeLine(runtime.stdout, "These are candidate permission mappings; isolated minimum-grant verification remains pending. Successful probes do not certify least privilege. Private-key ownership and permissions are checked on POSIX and Windows. Windows also permits SYSTEM and local Administrators as the OS recovery boundary.");
      return 0;
    }
    if (args.flags.has("client-secret")) throw new Error("Use the companion's masked field or --client-secret-stdin. Do not put a secret in command arguments.");
    const useSecret = suppliedSecret !== undefined || args.flags.has("client-secret-stdin");
    if (useSecret && (flagValue(args, "certificate") || flagValue(args, "private-key"))) throw new Error("Choose either a client secret or certificate credentials.");
    if (args.flags.has("client-secret-stdin") && suppliedSecret === undefined) {
      const { readBoundedInput } = await import("./mentor.js");
      suppliedSecret = (await readBoundedInput(runtime.stdin, 4096, 60_000)).replace(/\r?\n$/u, "");
    }
    if (useSecret) validateClientSecret(suppliedSecret ?? "");
    const profile: AppOnlyProfile = {
      tenantId: (flagValue(args, "tenant") ?? "").toLowerCase(), clientId: (flagValue(args, "client-id") ?? "").toLowerCase(),
      capabilities: flagValues(args, "capability"),
      ...(useSecret ? { authMethod: "client-secret" as const, secretRef: "0".repeat(64) } : {
        certificatePath: resolve(runtime.cwd, flagValue(args, "certificate") ?? ""),
        privateKeyPath: resolve(runtime.cwd, flagValue(args, "private-key") ?? "") })
    };
    if (!useSecret && (!flagValue(args, "certificate") || !flagValue(args, "private-key"))) throw new Error("Both the public certificate and private-key file paths are required. No credential is copied into configuration.");
    const previous = (await readGreybeardConfig(appDataPath)).appOnlyProfile;
    const roles = expectedApplicationRoles(profile);
    writeLine(runtime.stdout, `Checking customer application credentials and exact selected roles: ${roles.join(", ")}.`);
    const auth = await AppOnlyGraphAuthProvider.create(profile, undefined, suppliedSecret);
    await auth.getToken([]);
    const service = new GraphService({ auth, fetcher: runtime.fetcher, appDataPath });
    try {
      const preview = await previewCapabilities(profile, service);
      writeLine(runtime.stdout, JSON.stringify(preview, null, 2));
      if (preview.capabilities.some((item) => item.selected && item.state !== "ready")) throw new Error("One or more selected read probes failed. The new connection was not saved; any previous connection is unchanged. See the endpoint diagnostics above.");
    } finally { await service.close(); }
    if (profile.authMethod === "client-secret") {
      savedSecretRef = await saveClientSecret(appDataPath, suppliedSecret!);
      profile.secretRef = savedSecretRef;
    }
    await updateGreybeardConfig(appDataPath, (current) => {
      if (JSON.stringify(current.appOnlyProfile) !== JSON.stringify(previous)) throw new Error("The connection changed while checking credentials. Try connecting again.");
      return { ...current, appOnlyProfile: profile, activeTenantId: profile.tenantId };
    });
    committed = true;
    if (previous?.authMethod === "client-secret") await removeClientSecret(appDataPath, previous.secretRef).catch(() => {
      writeLine(runtime.stdout, "Connected. The previous credential could not be deleted; remove the old Greybeard application credential from the OS credential store.");
    });
    writeLine(runtime.stdout, "Customer application connected for selected reads. These probes do not certify minimum grants. Run greybeard setup to add the tenant MCP entry, then reconnect your AI client. Production writes are disabled.");
    return 0;
  } catch (error) {
    // MSAL error strings can contain request details. Keep the external response local and concise.
    const diagnostic = error instanceof Error ? error.message : "Tenant connection failed.";
    writeLine(runtime.stderr, suppliedSecret ? diagnostic.replaceAll(suppliedSecret, "[redacted]") : diagnostic);
    return 1;
  } finally {
    suppliedSecret = undefined;
    if (savedSecretRef && !committed) await removeClientSecret(appDataPath, savedSecretRef).catch(() => {});
  }
}
