import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { loadClientSecret, removeClientSecret, saveClientSecret } from "./clientSecretStore.js";

const fixture = 'Greybeard-synthetic~secret#value+"quote\\end';
const native = process.platform;
const mocked = vi.hoisted(() => ({ calls: [] as Array<{file:string;args:string[];input:string}>, fail: false, value: "" }));
vi.mock("node:child_process", () => ({ execFile: (file: string, args: string[], _options: unknown, callback: (error: Error | null, output: string) => void) => ({
  stdin: { on: () => {}, end: (input: string) => {
    mocked.calls.push({file,args,input});
    if (mocked.fail) { callback(new Error("command failure contains " + input), input); return; }
    let output = "";
    if (args[0] === "-i") mocked.value = fixture;
    else if (args[0] === "find-generic-password" || args[0] === "lookup") output = mocked.value + "\n";
    else if (args[0] === "store") mocked.value = input;
    else if (file.endsWith("powershell.exe")) {
      const script = Buffer.from(args.at(-1)!, "base64").toString("utf16le");
      output = script.includes("::Protect(") ? Buffer.from("encrypted:" + input).toString("base64") : Buffer.from(input,"base64").toString().slice("encrypted:".length);
    }
    callback(null, output);
  } }
}) }));

afterEach(() => { Object.defineProperty(process,"platform",{value:native}); vi.unstubAllEnvs(); mocked.calls=[]; mocked.fail=false; mocked.value=""; });

it.each(["darwin","win32","linux"])("stores and removes a secret on %s without putting its value in process arguments", async platform => {
  Object.defineProperty(process,"platform",{value:platform}); vi.stubEnv("SystemRoot", "C:\\Windows");
  const directory = await mkdtemp(join(tmpdir(),"greybeard-secret-test-"));
  try {
    const ref = await saveClientSecret(directory,fixture);
    expect(ref).toMatch(/^[a-f0-9]{64}$/);
    expect(await loadClientSecret(directory,ref)).toBe(fixture);
    for (const call of mocked.calls) expect(JSON.stringify(call.args)).not.toContain(fixture);
    if (platform === "darwin") {
      expect(mocked.calls[0].args).toEqual(["-i"]);
      expect(mocked.calls[0].input).toContain('\\"quote\\\\end');
    }
    if (platform === "win32") expect(await readFile(join(directory,"credentials",ref),"utf8")).not.toContain(fixture);
    await removeClientSecret(directory,ref);
    if (platform === "win32") expect(await readdir(join(directory,"credentials"))).toEqual([]);
  } finally { await rm(directory,{recursive:true,force:true}); }
});

it("fails closed without leaking subprocess diagnostics or writing a plaintext fallback", async () => {
  Object.defineProperty(process,"platform",{value:"linux"}); mocked.fail=true;
  const directory=await mkdtemp(join(tmpdir(),"greybeard-secret-failure-"));
  try {
    const error=await saveClientSecret(directory,fixture).catch(e=>e);
    expect(error.message).toContain("No plaintext fallback"); expect(error.message).not.toContain(fixture);
    expect(await readdir(directory)).toEqual([]);
    await expect(loadClientSecret(directory,"../outside")).rejects.toThrow("Invalid local credential reference");
  } finally { await rm(directory,{recursive:true,force:true}); }
});
