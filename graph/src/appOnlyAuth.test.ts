import { execFileSync } from "node:child_process";
import { generateKeyPairSync, X509Certificate } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppOnlyGraphAuthProvider, validateAppOnlyProfile } from "./appOnlyAuth.js";
import type { AppOnlyProfile } from "./writeGateTypes.js";

const mocked = vi.hoisted(() => ({ acquire: vi.fn() }));
vi.mock("@azure/msal-node", () => ({
  ConfidentialClientApplication: class { acquireTokenByClientCredential = mocked.acquire; }
}));

// All certificates and keys are generated for this suite in a temporary local
// directory. MSAL is mocked: no credential or request reaches Microsoft.
const base: AppOnlyProfile = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  clientId: "22222222-2222-4222-8222-222222222222",
  certificatePath: "unused",
  privateKeyPath: "unused",
  capabilities: ["users"]
};

it.each(["__proto__", "constructor", "toString"])("rejects inherited capability name %s", capability => {
  expect(() => validateAppOnlyProfile({ ...base, capabilities: [capability] })).toThrow("known capability");
});

describe.runIf(process.platform !== "win32")("protected local certificate provider", () => {
  let directory: string;
  let profile: AppOnlyProfile;
  let expiresAt: number;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "greybeard-app-auth-"));
    profile = { ...base, certificatePath: join(directory, "certificate.pem"), privateKeyPath: join(directory, "private-key.pem") };
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=Greybeard local fixture",
      "-keyout", profile.privateKeyPath, "-out", profile.certificatePath], { stdio: "ignore" });
    await chmod(profile.privateKeyPath, 0o600);
    expiresAt = Date.parse(new X509Certificate(await readFile(profile.certificatePath)).validTo);
  });
  beforeEach(async () => {
    mocked.acquire.mockReset();
    await writeFile(join(directory, "config.json"), JSON.stringify({ appOnlyProfile: profile }), { mode: 0o600 });
  });
  afterEach(() => vi.useRealTimers());
  afterAll(async () => rm(directory, { recursive: true, force: true }));

  it("accepts a matching private certificate and requests only the application default resource", async () => {
    mocked.acquire.mockResolvedValue({ accessToken: fakeToken(profile) });
    const provider = await AppOnlyGraphAuthProvider.create(profile, directory);
    const token = await provider.getToken(["ignored-delegated-scope"]);
    expect(mocked.acquire).toHaveBeenCalledWith({ scopes: ["https://graph.microsoft.com/.default"] });
    expect(token).toMatchObject({ tenantId: profile.tenantId, clientId: profile.clientId, credentialMode: "read-only", writesConfigured: false });
  });

  it("limits the compliance capability to policy reads and verified navigations", async () => {
    const provider = await AppOnlyGraphAuthProvider.create({ ...profile, capabilities: ["compliance"] });
    const policy = "11111111-2222-3333-4444-555555555555";
    expect(() => provider.authorizeRead("/deviceManagement/deviceCompliancePolicies")).not.toThrow();
    expect(() => provider.authorizeRead(`/deviceManagement/deviceCompliancePolicies/${policy}/assignments`)).not.toThrow();
    expect(() => provider.authorizeRead(`/deviceManagement/deviceCompliancePolicies/${policy}/scheduledActionsForRule`)).not.toThrow();
    expect(() => provider.authorizeRead("/deviceManagement/managedDevices")).toThrow("outside");
    expect(() => provider.authorizeRead(`/deviceManagement/deviceCompliancePolicies/${policy}/assign`)).toThrow("outside");
    expect(() => provider.authorizeRead("/applications")).toThrow("outside");
  });

  it("discards an acquired token when the connection is removed during acquisition", async () => {
    let release!: (result: { accessToken: string }) => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    mocked.acquire.mockImplementation(() => { entered(); return new Promise(resolve => { release = resolve; }); });
    const provider = await AppOnlyGraphAuthProvider.create(profile, directory);
    const pending = provider.getToken([]);
    const rejection = expect(pending).rejects.toThrow("changed during authentication");
    await started;
    await writeFile(join(directory, "config.json"), "{}");
    release({ accessToken: fakeToken(profile) });
    await rejection;
  });

  it("rejects a private key with group-readable permissions", async () => {
    const keyPath = join(directory, "shared-key.pem");
    await writeFile(keyPath, await readFile(profile.privateKeyPath), { mode: 0o640 });
    await expect(AppOnlyGraphAuthProvider.create({ ...profile, privateKeyPath: keyPath })).rejects.toThrow("accessible only to this user");
    expect(mocked.acquire).not.toHaveBeenCalled();
  });

  it("rejects private-key symlinks before loading credentials", async () => {
    const linkPath = join(directory, "key-link.pem");
    await symlink(profile.privateKeyPath, linkPath);
    await expect(AppOnlyGraphAuthProvider.create({ ...profile, privateKeyPath: linkPath })).rejects.toThrow();
    expect(mocked.acquire).not.toHaveBeenCalled();
  });

  it("rejects a valid private key belonging to a different certificate", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const keyPath = join(directory, "other-key.pem");
    await writeFile(keyPath, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
    await expect(AppOnlyGraphAuthProvider.create({ ...profile, privateKeyPath: keyPath })).rejects.toThrow("does not match");
    expect(mocked.acquire).not.toHaveBeenCalled();
  });

  it("rejects a certificate that is expired when the provider is created", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(expiresAt + 1);
    await expect(AppOnlyGraphAuthProvider.create(profile)).rejects.toThrow("has expired");
    expect(mocked.acquire).not.toHaveBeenCalled();
  });

  it("stops acquisition when an existing provider's certificate expires", async () => {
    const provider = await AppOnlyGraphAuthProvider.create(profile, directory);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(expiresAt);
    await expect(provider.getToken([])).rejects.toThrow("Certificate has expired");
    expect(mocked.acquire).not.toHaveBeenCalled();
  });
});

function fakeToken(profile: AppOnlyProfile): string {
  const payload = { tid: profile.tenantId, appid: profile.clientId, aud: "00000003-0000-0000-c000-000000000000", roles: ["User.Read.All"], exp: Math.floor(Date.now() / 1000) + 3600 };
  return `fixture.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.fixture`;
}
