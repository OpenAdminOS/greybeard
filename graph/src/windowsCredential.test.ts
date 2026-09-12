import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppOnlyGraphAuthProvider } from "./appOnlyAuth.js";
import { readWindowsProtectedKey } from "./windowsCredential.js";

const windows = process.platform === "win32";
const powershell = win32.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
function ps(script: string, env: Record<string, string>) {
  return execFileSync(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from("$ErrorActionPreference='Stop';" + script, "utf16le").toString("base64")], { env: { ...process.env, ...env }, encoding: "utf8", timeout: 20_000, windowsHide: true });
}
function protect(path: string, shared = false, otherOwner = false) {
  ps(`
$me = [Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = New-Object Security.AccessControl.FileSecurity
$acl.SetAccessRuleProtection($true, $false)
$owner = $me
if ($env:GB_OTHER_OWNER -eq 'true') { $owner = New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544') }
$acl.SetOwner($owner)
foreach ($sid in @($me.Value, 'S-1-5-18', 'S-1-5-32-544')) {
  $identity = New-Object Security.Principal.SecurityIdentifier($sid)
  $rule = New-Object Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', 'Allow')
  $acl.AddAccessRule($rule)
}
if ($env:GB_SHARED -eq 'true') {
  $world = New-Object Security.Principal.SecurityIdentifier('S-1-1-0')
  $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($world, 'Read', 'Allow')))
}
[IO.File]::SetAccessControl($env:GB_TEST_PATH, $acl)
`, { GB_TEST_PATH: path, GB_SHARED: String(shared), GB_OTHER_OWNER: String(otherOwner) });
}

describe.runIf(windows)("Windows handle-bound protected credential reader", () => {
  let directory: string;
  beforeAll(async () => { directory = await mkdtemp(join(tmpdir(), "greybeard-windows-key-")); });
  afterAll(async () => { await rm(directory, { recursive: true, force: true }); });

  it("reads an owner-controlled key allowing only the owner, SYSTEM and Administrators", async () => {
    // Metacharacters stay data in an environment value, never executable code.
    const path = join(directory, "key ' $() ; [literal].pem");
    await writeFile(path, "synthetic private content\n"); protect(path);
    expect(await readWindowsProtectedKey(path)).toBe("synthetic private content\n");
  }, 30_000);
  it("rejects an Everyone read ACE without exposing file contents", async () => {
    const path = join(directory, "shared.pem");
    await writeFile(path, "fixture-secret-must-not-appear"); protect(path, true);
    const error = await readWindowsProtectedKey(path).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("shared-acl");
    expect((error as Error).message).not.toContain("fixture-secret");
  }, 30_000);
  it("rejects ownership by a different principal even when the caller can read", async () => {
    const path = join(directory, "other-owner.pem");
    await writeFile(path, "fixture"); protect(path, false, true);
    try { await expect(readWindowsProtectedKey(path)).rejects.toThrow("owner"); }
    finally { protect(path); }
  }, 30_000);
  it("rejects junction ancestors and an oversized file", async () => {
    const real = join(directory, "real"); await mkdir(real);
    const key = join(real, "private.pem"); await writeFile(key, "fixture"); protect(key);
    const junction = join(directory, "junction"); await symlink(real, junction, "junction");
    await expect(readWindowsProtectedKey(join(junction, "private.pem"))).rejects.toThrow("reparse-point");
    const oversized = join(directory, "large.pem"); await writeFile(oversized, Buffer.alloc(65537)); protect(oversized);
    await expect(readWindowsProtectedKey(oversized)).rejects.toThrow("file-type-or-size");
  }, 60_000);
  it("loads a matching certificate and protected private key through the actual application provider", async () => {
    const cert = join(directory, "certificate.pem"); const key = join(directory, "matching.pem");
    const bundled = join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "usr", "bin", "openssl.exe");
    const openssl = existsSync(bundled) ? bundled : "openssl.exe";
    execFileSync(openssl, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=Greybeard Windows fixture", "-keyout", key, "-out", cert], { stdio: "ignore", timeout: 20_000 });
    protect(key);
    const provider = await AppOnlyGraphAuthProvider.create({ tenantId: "11111111-1111-4111-8111-111111111111", clientId: "22222222-2222-4222-8222-222222222222", certificatePath: cert, privateKeyPath: key, capabilities: ["users"] });
    expect(() => provider.authorizeRead("/users")).not.toThrow();
    expect(await readWindowsProtectedKey(key)).toBe(await readFile(key, "utf8"));
  }, 60_000);
  it("rejects network paths and alternate data streams before spawning PowerShell", async () => {
    await expect(readWindowsProtectedKey("\\\\server\\share\\key.pem")).rejects.toThrow("local-drive");
    await expect(readWindowsProtectedKey("C:\\key.pem:secret")).rejects.toThrow("local-drive");
  });
});

it.skipIf(windows)("does not substitute Windows permission checks on another operating system", async () => {
  await expect(readWindowsProtectedKey("C:\\key.pem")).rejects.toThrow("only available on Windows");
});
