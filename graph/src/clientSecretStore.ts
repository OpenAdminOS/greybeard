import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve, win32 } from "node:path";

const SERVICE = "greybeard-app-secret";
const failure = () => new Error("The OS credential store is unavailable or locked. Unlock your keychain or credential service and try again. No plaintext fallback is used.");

// Credential input goes through stdin, never command arguments or diagnostics.
function command(file: string, args: string[], input = ""): Promise<string> {
  return new Promise((done, reject) => {
    const child = execFile(file, args, { windowsHide: true, timeout: 20_000, maxBuffer: 64 * 1024 }, (error, stdout) => {
      if (error) reject(failure()); else done(stdout);
    });
    child.stdin?.on("error", () => { /* Process completion supplies a sanitized failure. */ });
    child.stdin?.end(input);
  });
}

export function validateClientSecret(secret: string): void {
  if (!secret || Buffer.byteLength(secret) > 4096 || /[\s\u0000-\u001f\u007f]/u.test(secret)) {
    throw new Error("Enter the client secret value, not its secret ID. It must not contain whitespace and must be no larger than 4 KiB.");
  }
}

function validateRef(ref: string): void {
  if (!/^[a-f0-9]{64}$/.test(ref)) throw new Error("Invalid local credential reference. Reconnect your application.");
}

function powershell(): string {
  const root = process.env.SystemRoot;
  if (!root || !/^[a-z]:[\\/]/i.test(root)) throw failure();
  return win32.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

async function dpapi(value: string, encrypt: boolean): Promise<string> {
  const script = `$ErrorActionPreference='Stop'; try { Add-Type -AssemblyName System.Security; $data=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $result=[System.Security.Cryptography.ProtectedData]::${encrypt ? "Protect" : "Unprotect"}($data,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($result)) } catch { exit 1 }`;
  const result = await command(powershell(), ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], value);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(result)) throw failure();
  return result;
}

export async function saveClientSecret(appDataPath: string, secret: string): Promise<string> {
  validateClientSecret(secret);
  const ref = createHash("sha256").update(resolve(appDataPath)).update(randomBytes(32)).digest("hex");
  try {
    if (process.platform === "darwin") {
      // security's interactive command parser supports double-quoted strings.
      const quoted = '"' + secret.replaceAll("\\", "\\\\").replaceAll('"', '\\"') + '"';
      await command("/usr/bin/security", ["-i"], `add-generic-password -a ${ref} -s ${SERVICE} -w ${quoted}\n`);
    } else if (process.platform === "win32") {
      const encrypted = await dpapi(Buffer.from(secret).toString("base64"), true);
      const directory = join(appDataPath, "credentials");
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(join(directory, ref), encrypted, { flag: "wx", mode: 0o600 });
    } else if (process.platform === "linux") {
      await command("secret-tool", ["store", "--label=Greybeard application credential", "service", SERVICE, "account", ref], secret);
    } else throw failure();
    // Detect store failures, including interactive security command failures.
    if (await loadClientSecret(appDataPath, ref) !== secret) throw failure();
    return ref;
  } catch {
    await removeClientSecret(appDataPath, ref).catch(() => {});
    throw failure();
  }
}

export async function loadClientSecret(appDataPath: string, ref: string): Promise<string> {
  validateRef(ref);
  try {
    let secret: string;
    if (process.platform === "darwin") secret = (await command("/usr/bin/security", ["find-generic-password", "-a", ref, "-s", SERVICE, "-w"])).replace(/\r?\n$/u, "");
    else if (process.platform === "linux") secret = (await command("secret-tool", ["lookup", "service", SERVICE, "account", ref])).replace(/\r?\n$/u, "");
    else if (process.platform === "win32") {
      const encoded = await readFile(join(appDataPath, "credentials", ref), "utf8");
      if (encoded.length > 32 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw failure();
      secret = Buffer.from(await dpapi(encoded, false), "base64").toString("utf8");
    } else throw failure();
    validateClientSecret(secret);
    return secret;
  } catch { throw failure(); }
}

export async function removeClientSecret(appDataPath: string, ref: string): Promise<void> {
  validateRef(ref);
  if (process.platform === "darwin") await command("/usr/bin/security", ["delete-generic-password", "-a", ref, "-s", SERVICE]);
  else if (process.platform === "linux") await command("secret-tool", ["clear", "service", SERVICE, "account", ref]);
  else if (process.platform === "win32") await rm(join(appDataPath, "credentials", ref), { force: true });
  else throw failure();
}
