import { chmod } from "node:fs/promises";
import { resolve } from "node:path";
import { getGreybeardAppDataPath } from "@greybeard/graph";
import { flagValue, type ParsedArgs } from "./args.js";
import { type CliRuntime, writeLine } from "./runtime.js";
import { readMemoryBinding, RemoteMemory, disconnectMemory } from "./sharedMemory.js";
import { SharedServerStore, startSharedServer } from "./sharedServer.js";

export async function runSharedCommands(args: ParsedArgs, runtime: CliRuntime): Promise<number> {
  const appData = flagValue(args, "app-data") || runtime.env.GREYBEARD_APP_DATA || getGreybeardAppDataPath();
  const command = args.positionals[0];
  if (args.command === "shared-memory") {
    if (command === "disconnect") { const result = await disconnectMemory(appData); writeLine(runtime.stdout, `Local memory selected. Restart AI clients. ${result.revoked ? "Device revoked on server." : "Server revocation is pending; revoke the device on the server."} ${result.credentialsRemoved ? "" : "OS credential cleanup needs attention."}`); return 0; }
    if (command === "status") { const binding = await readMemoryBinding(appData); writeLine(runtime.stdout, JSON.stringify(binding ? { mode: "remote", url: binding.url, ...(await new RemoteMemory(appData, binding).status()) } : { mode: "local" })); return 0; }
    writeLine(runtime.stdout, "Use shared-memory status or disconnect. Pair in App preferences > Advanced > Shared memory."); return 0;
  }
  if (command === "start") {
    const publicUrl = flagValue(args, "public-url"); if (!publicUrl) throw new Error("Specify --public-url https://your-private-server. Configure HTTPS forwarding to the loopback listener.");
    const port = Number(flagValue(args, "port") ?? "47831"); if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Choose a port from 1 to 65535.");
    const running = await startSharedServer({ appData, publicUrl, port });
    writeLine(runtime.stderr, `Shared memory listening on loopback port ${running.port}. HTTPS is provided by your private reverse proxy.`);
    await new Promise<void>(resolve => {
      let closing = false;
      const stop = () => { if (closing) return; closing = true; void running.close().then(resolve); };
      process.once("SIGINT", stop); process.once("SIGTERM", stop);
      running.server.once("close", () => { process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); });
    });
    return 0;
  }
  if (!["enroll", "devices", "revoke", "backup", "reset-credentials"].includes(command ?? "")) {
    writeLine(runtime.stdout, "Advanced server commands:\n  server start --public-url <https-origin> [--port 47831] --app-data <directory>\n  server enroll [--profile local] [--tenant local] [--review] --app-data <directory>\n  server devices --app-data <directory>\n  server revoke --device <id> --app-data <directory>\n  server backup --out <new-file> --app-data <directory>\n  server reset-credentials --app-data <directory> (after restoring a backup, before starting)"); return 0;
  }
  if (["enroll", "reset-credentials"].includes(command!) && !runtime.stdin.isTTY) throw new Error("Enrollment and credential reset require an interactive server-owner terminal.");
  const store = new SharedServerStore(appData);
  try {
    if (command === "enroll") {
      const review = args.flags.has("review");
      if (review && await runtime.confirm("Allow this device's companion and interactive CLI to confirm, correct, delete, and pause shared memories? Press Enter to authorize: ") !== "confirmed") return 1;
      const code = store.enroll(flagValue(args, "profile") || "local", flagValue(args, "tenant") || "local", review);
      writeLine(runtime.stdout, `Single-use pairing code (expires in 10 minutes):\n${code}\nPaste it into Advanced > Shared memory on one device. ${review ? "Includes human-review authority." : "Memory tools and hooks only."}`);
    } else if (command === "devices") writeLine(runtime.stdout, JSON.stringify(store.devices(), null, 2));
    else if (command === "revoke") { const device = flagValue(args, "device"); if (!device) throw new Error("Specify --device from server devices."); store.revoke(device); writeLine(runtime.stdout, "Device revoked."); }
    else if (command === "backup") { const out = flagValue(args, "out"); if (!out) throw new Error("Specify --out for a new backup file."); const { open } = await import("node:fs/promises"); const file = await open(resolve(out), "wx", 0o600); await file.close(); await store.db.backup(resolve(out)); await chmod(resolve(out), 0o600); writeLine(runtime.stdout, "Memory and server metadata backed up. After restoring, reset credentials before restarting the server and pair devices again."); }
    else { if (await runtime.confirm("With the server stopped, invalidate every device and enrollment code in this restored store? Press Enter to confirm: ") !== "confirmed") return 1; store.resetCredentials(); writeLine(runtime.stdout, "All devices revoked and store identity rotated. Restart the server and pair devices again."); }
    return 0;
  } finally { store.close(); }
}
