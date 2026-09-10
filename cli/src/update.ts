import { createHash, createPublicKey, verify } from "node:crypto";
import { mkdir, readFile, writeFile, chmod, rename, copyFile, readdir, unlink, lstat, rmdir } from "node:fs/promises";
import { constants } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { getGreybeardAppDataPath, readGreybeardConfig } from "@greybeard/graph";
import { flagValue, hasFlag, ParsedArgs } from "./args.js";
import { CliRuntime, writeLine } from "./runtime.js";

export type ReleaseManifest = {
  schema: 1;
  version: string;
  sequence: number;
  expires: string;
  platform: string;
  arch: string;
  url: string;
  sha256: string;
  bytes: number;
};

export function verifyReleaseManifest(raw: Buffer, signature: Buffer, publicKey: string, now = Date.now()): ReleaseManifest {
  const key = createPublicKey(publicKey);
  if (key.asymmetricKeyType !== "ed25519" || !verify(null, raw, key, signature)) throw new Error("Release signature verification failed.");
  const m = JSON.parse(raw.toString("utf8")) as ReleaseManifest;
  if (m.schema !== 1 || !/^0\.1(?:\.\d+)?$/u.test(m.version) || !Number.isSafeInteger(m.sequence) || m.sequence < 1
    || !Number.isFinite(Date.parse(m.expires)) || Date.parse(m.expires) <= now
    || !/^[a-f0-9]{64}$/u.test(m.sha256) || !Number.isSafeInteger(m.bytes) || m.bytes < 1 || m.bytes > 300 * 1024 * 1024
    || typeof m.platform !== "string" || typeof m.arch !== "string") throw new Error("Release manifest is invalid or expired.");
  const url = new URL(m.url);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Release download requires HTTPS without URL credentials.");
  return m;
}

async function download(url: string, maximum: number): Promise<Buffer> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("Update requests require HTTPS without URL credentials.");
  const signal = AbortSignal.timeout(120_000);
  let response: Response | undefined;
  let target = parsed;
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    if (target.protocol !== "https:" || target.username || target.password) throw new Error("Unsafe update redirect.");
    response = await fetch(target, { redirect: "manual", signal });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location || redirects === 5) throw new Error("Invalid or excessive update redirects.");
    target = new URL(location, target);
  }
  if (!response) throw new Error("Update download did not return a response.");
  if (!response.ok || !response.body) throw new Error(`Update download failed (${response.status}).`);
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > maximum) { await response.body.cancel().catch(() => undefined); throw new Error("Update response exceeds its size limit."); }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function runUpdate(args: ParsedArgs, runtime: CliRuntime): Promise<number> {
  const appData = resolve(flagValue(args, "app-data") || runtime.env.GREYBEARD_APP_DATA || getGreybeardAppDataPath());
  const directory = join(appData, "updates");
  const feed = runtime.env.GREYBEARD_UPDATE_MANIFEST_URL;
  const keyPath = runtime.env.GREYBEARD_UPDATE_PUBLIC_KEY_FILE;
  const config = await readGreybeardConfig(appData);
  writeLine(runtime.stdout, `Greybeard 0.1 updates · ${config.updateMode ?? "notify"}`);
  if (!feed || !keyPath) {
    writeLine(runtime.stdout, "Verified update delivery is not configured. The current executable remains installed.");
    writeLine(runtime.stdout, "A release operator must provision an HTTPS manifest feed and a trusted Ed25519 public key. No Git or npm commands are run.");
    return 0;
  }
  try {
    const raw = await download(feed, 16_384);
    const signature = await download(`${feed}.sig`, 256);
    const manifest = verifyReleaseManifest(raw, signature, await readFile(keyPath, "utf8"));
    if (manifest.platform !== runtime.platform || manifest.arch !== process.arch) throw new Error("Release does not match this OS and architecture.");
    let accepted = 0;
    try { accepted = Number(await readFile(join(directory, "sequence"), "utf8")); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (!Number.isSafeInteger(accepted) || accepted < 0) throw new Error("Installed build sequence is invalid.");
    if (manifest.sequence <= accepted) { writeLine(runtime.stdout, "No newer accepted release is available."); return 0; }
    writeLine(runtime.stdout, `Greybeard ${manifest.version}, build ${manifest.sequence} is available. Your current executable continues running.`);
    if (!hasFlag(args, "stage")) { writeLine(runtime.stdout, "Run greybeard update --stage to verify and stage the download."); return 0; }
    const binary = await download(manifest.url, manifest.bytes);
    if (binary.length !== manifest.bytes || createHash("sha256").update(binary).digest("hex") !== manifest.sha256) throw new Error("Release size or SHA-256 verification failed.");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const staged = join(directory, `greybeard-${manifest.sequence}${runtime.platform === "win32" ? ".exe" : ""}`);
    const temporary = `${staged}.${process.pid}.tmp`;
    await writeFile(temporary, binary, { mode: 0o700, flag: "wx" });
    await rename(temporary, staged);
    await chmod(staged, 0o700);
    await writeFile(join(directory, "pending.json"), JSON.stringify({ manifest, staged, signature: signature.toString("base64"), raw: raw.toString("base64"), executable: runtime.packaged ? runtime.nodePath : null }), { mode: 0o600 });
    writeLine(runtime.stdout, `Verified release staged at ${staged}.`);
    writeLine(runtime.stdout, runtime.packaged && runtime.platform !== "win32"
      ? "The release activates at the next launch after all current Greybeard processes exit. The previous executable is retained for recovery."
      : "Activation is deferred on this installation. Keep the current executable until a supported replacement flow is available.");
    return 0;
  } catch (error) {
    writeLine(runtime.stderr, `Update stopped: ${error instanceof Error ? error.message : String(error)} The current executable was not replaced.`);
    return 1;
  }
}

/** POSIX activation runs only at process startup, before opening SQLite or MCP. */
export async function activatePendingUpdate(runtime: CliRuntime): Promise<boolean> {
  if (!runtime.packaged || runtime.platform === "win32" || runtime.env.GREYBEARD_UPDATE_PROBE === "1") return false;
  const appData = runtime.env.GREYBEARD_APP_DATA || getGreybeardAppDataPath();
  const directory = join(appData, "updates");
  const pendingPath = join(directory, "pending.json");
  let pending: { manifest: ReleaseManifest; staged: string; raw: string; signature: string; executable: string };
  try { pending = JSON.parse(await readFile(pendingPath, "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
  if (pending.executable !== runtime.nodePath) return false;
  const keyPath = runtime.env.GREYBEARD_UPDATE_PUBLIC_KEY_FILE;
  if (!keyPath) throw new Error("Pending update cannot activate without the configured publisher key.");
  const manifest = verifyReleaseManifest(Buffer.from(pending.raw, "base64"), Buffer.from(pending.signature, "base64"), await readFile(keyPath, "utf8"));
  if (manifest.platform !== runtime.platform || manifest.arch !== process.arch) throw new Error("Pending release platform mismatch.");
  let installedSequence = 0;
  try { installedSequence = Number(await readFile(join(directory, "sequence"), "utf8")); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (!Number.isSafeInteger(installedSequence) || manifest.sequence <= installedSequence) throw new Error("Pending release would repeat or downgrade an accepted build.");
  const expectedStage = join(directory, `greybeard-${manifest.sequence}`);
  if (pending.staged !== expectedStage) throw new Error("Unexpected staged executable path.");
  const staged = await readFile(expectedStage);
  if (staged.length !== manifest.bytes || createHash("sha256").update(staged).digest("hex") !== manifest.sha256) throw new Error("Staged executable integrity check failed.");
  const lock = join(appData, "runtime-lock");
  try { await mkdir(lock, { mode: 0o700 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") return false; throw error; }
  try {
    const sessions = join(appData, "sessions");
    await writeFile(join(lock, "owner"), String(process.pid), { mode: 0o600, flag: "wx" });
    for (const filename of await readdir(sessions)) {
      if (!/^\d+\.json$/u.test(filename)) throw new Error("Unexpected runtime session record.");
      const pid = Number(filename.slice(0, -5));
      if (pid === process.pid) continue;
      try { process.kill(pid, 0); return false; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") return false; await unlink(join(sessions, filename)); }
    }
    const existing = await lstat(runtime.nodePath);
    if (!existing.isFile() || existing.isSymbolicLink() || existing.uid !== process.getuid?.()) throw new Error("Executable ownership does not permit automatic activation.");
    // The candidate must start successfully before it can replace the running version.
    const health = spawnSync(expectedStage, ["--help"], { env: { ...runtime.env, GREYBEARD_UPDATE_PROBE: "1" }, timeout: 15_000, encoding: "utf8" });
    if (health.status !== 0 || !health.stdout.includes("Greybeard")) throw new Error("Staged executable failed its startup check.");
    const candidate = `${runtime.nodePath}.${process.pid}.next`;
    const previous = `${runtime.nodePath}.previous`;
    await writeFile(candidate, staged, { mode: existing.mode & 0o777, flag: "wx" });
    const previousTemp = `${previous}.${process.pid}.tmp`;
    await copyFile(runtime.nodePath, previousTemp, constants.COPYFILE_EXCL);
    await rename(previousTemp, previous);
    await rename(candidate, runtime.nodePath);
    // Activation never rolls back user data or silently changes permission grants.
    await writeFile(join(directory, "sequence"), String(manifest.sequence), { mode: 0o600 });
    await unlink(pendingPath);
    writeLine(runtime.stderr, `Greybeard ${manifest.version} build ${manifest.sequence} activated. Previous executable retained at ${previous}.`);
    return true;
  } finally {
    await unlink(join(lock, "owner")).catch(() => undefined);
    await rmdir(lock);
  }
}

/** Long-running clients check at launch and daily; manual mode schedules nothing. */
export function scheduleUpdateChecks(runtime: CliRuntime): void {
  if (!runtime.packaged || !runtime.env.GREYBEARD_UPDATE_MANIFEST_URL || !runtime.env.GREYBEARD_UPDATE_PUBLIC_KEY_FILE || runtime.env.GREYBEARD_UPDATE_PROBE === "1") return;
  let checking = false;
  const check = async () => {
    if (checking) return;
    checking = true;
    try {
      const appData = runtime.env.GREYBEARD_APP_DATA || getGreybeardAppDataPath();
      const config = await readGreybeardConfig(appData);
      if (config.updateMode === "manual") return;
      const directory = join(appData, "updates");
      const checkedPath = join(directory, "last-check");
      try { if (Date.now() - Number(await readFile(checkedPath, "utf8")) < 86_400_000) return; } catch {}
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(checkedPath, String(Date.now()), { mode: 0o600 });
      const flags = new Map<string, string[]>();
      if (config.updateMode === "automatic") flags.set("stage", ["true"]);
      await runUpdate({ command: "update", flags, positionals: [] }, { ...runtime, stdout: runtime.stderr });
    } catch (error) {
      writeLine(runtime.stderr, `Update check deferred: ${error instanceof Error ? error.message : String(error)}`);
    } finally { checking = false; }
  };
  setTimeout(() => { void check(); }, 1000).unref();
  setInterval(() => { void check(); }, 86_400_000).unref();
}
