import { generateKeyPairSync, sign, createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyReleaseManifest } from "./update.js";

describe("signed executable release metadata", () => {
  const keys = generateKeyPairSync("ed25519");
  const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
  const manifest = { schema: 1, version: "0.1", sequence: 2, expires: "2099-01-01T00:00:00Z", platform: "linux", arch: "x64", url: "https://releases.example/greybeard", bytes: 3, sha256: createHash("sha256").update("app").digest("hex") };
  const raw = Buffer.from(JSON.stringify(manifest));
  it("accepts a release signed by the configured publisher", () => {
    expect(verifyReleaseManifest(raw, sign(null, raw, keys.privateKey), publicKey).sequence).toBe(2);
  });
  it("rejects altered content and signatures from another publisher", () => {
    expect(() => verifyReleaseManifest(Buffer.from(JSON.stringify({ ...manifest, sequence: 3 })), sign(null, raw, keys.privateKey), publicKey)).toThrow("signature");
    expect(() => verifyReleaseManifest(raw, sign(null, raw, generateKeyPairSync("ed25519").privateKey), publicKey)).toThrow("signature");
  });
  it.each([{ expires: "2020-01-01" }, { bytes: 9999999999 }, { sequence: 0 }, { sha256: "no" }, { url: "http://releases.example/app" }, { url: "https://user:password@releases.example/app" }])("rejects unsafe signed metadata %j", change => {
    const data = Buffer.from(JSON.stringify({ ...manifest, ...change }));
    expect(() => verifyReleaseManifest(data, sign(null, data, keys.privateKey), publicKey)).toThrow();
  });
});

import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";
import { activatePendingUpdate } from "./update.js";
import { type CliRuntime } from "./runtime.js";

describe.skipIf(process.platform === "win32")("next-launch executable activation", () => {
  const directories: string[] = [];
  afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
  async function fixture(body = "#!/bin/sh\nprintf 'Greybeard 0.1\\n'\n") {
    const data = await mkdtemp(join(tmpdir(), "greybeard-update-")); directories.push(data);
    const directory = join(data, "updates"); await mkdir(directory); await mkdir(join(data, "sessions"));
    const executable = join(data, "greybeard"); await writeFile(executable, "previous executable", { mode: 0o700 });
    const staged = join(directory, "greybeard-2"); await writeFile(staged, body, { mode: 0o700 });
    const keys = generateKeyPairSync("ed25519");
    const keyPath = join(data, "publisher.pem"); await writeFile(keyPath, keys.publicKey.export({ type: "spki", format: "pem" }));
    const manifest = { schema: 1, version: "0.1", sequence: 2, expires: "2099-01-01", platform: process.platform, arch: process.arch, url: "https://releases.example/app", bytes: Buffer.byteLength(body), sha256: createHash("sha256").update(body).digest("hex") };
    const raw = Buffer.from(JSON.stringify(manifest));
    await writeFile(join(directory, "pending.json"), JSON.stringify({ executable, staged, raw: raw.toString("base64"), signature: sign(null, raw, keys.privateKey).toString("base64") }));
    const runtime = { packaged: true, platform: process.platform, nodePath: executable, env: { GREYBEARD_APP_DATA: data, GREYBEARD_UPDATE_PUBLIC_KEY_FILE: keyPath }, stderr: { write: () => true } } as unknown as CliRuntime;
    return { data, directory, executable, staged, runtime, body };
  }
  it("activates a verified healthy candidate and retains the previous executable", async () => {
    const f = await fixture();
    expect(await activatePendingUpdate(f.runtime)).toBe(true);
    expect(await readFile(f.executable, "utf8")).toBe(f.body);
    expect(await readFile(`${f.executable}.previous`, "utf8")).toBe("previous executable");
    expect(await readFile(join(f.directory, "sequence"), "utf8")).toBe("2");
    expect(await readdir(f.directory)).not.toContain("pending.json");
  });
  it("leaves a busy runtime and its pending update intact", async () => {
    const f = await fixture();
    await writeFile(join(f.data, "sessions", `${process.ppid}.json`), "{}");
    expect(await activatePendingUpdate(f.runtime)).toBe(false);
    expect(await readFile(f.executable, "utf8")).toBe("previous executable");
  });
  it("rejects a corrupted staged artifact and a candidate that cannot start", async () => {
    const corrupt = await fixture(); await writeFile(corrupt.staged, "corrupt");
    await expect(activatePendingUpdate(corrupt.runtime)).rejects.toThrow("integrity");
    const unhealthy = await fixture("#!/bin/sh\nexit 1\n");
    await expect(activatePendingUpdate(unhealthy.runtime)).rejects.toThrow("startup");
    expect(await readFile(unhealthy.executable, "utf8")).toBe("previous executable");
  });
  it("rejects downgrades and never activates a staged update for another binary", async () => {
    const f = await fixture(); await writeFile(join(f.directory, "sequence"), "3");
    await expect(activatePendingUpdate(f.runtime)).rejects.toThrow("downgrade");
    expect(await activatePendingUpdate({ ...f.runtime, nodePath: `${f.executable}-other` })).toBe(false);
  });
});
