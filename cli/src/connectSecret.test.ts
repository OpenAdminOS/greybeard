import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { beforeEach, expect, it, vi } from "vitest";
import { readGreybeardConfig, writeGreybeardConfig } from "@greybeard/graph";
import { runConnect } from "./connect.js";
import { parseArgs } from "./args.js";
import { createRuntime } from "./runtime.js";

const mocks=vi.hoisted(()=>({create:vi.fn(),save:vi.fn(),remove:vi.fn(),preview:vi.fn()}));
vi.mock("@greybeard/graph",async original=>({ ...await original<typeof import("@greybeard/graph")>(),
  AppOnlyGraphAuthProvider: {create:mocks.create}, saveClientSecret:mocks.save, removeClientSecret:mocks.remove,
  previewCapabilities:mocks.preview, GraphService: class { async close() {} }
}));
beforeEach(()=>{
  vi.clearAllMocks();
  mocks.create.mockResolvedValue({getToken:async()=>({})});
  mocks.save.mockResolvedValue("a".repeat(64)); mocks.remove.mockResolvedValue(undefined);
  mocks.preview.mockResolvedValue({capabilities:[{selected:true,state:"ready"}]});
});

const tenant="11111111-1111-4111-8111-111111111111", client="22222222-2222-4222-8222-222222222222";
const secret="synthetic-connect-secret";
async function fixture() {
  const directory=await mkdtemp(join(tmpdir(),"greybeard-connect-secret-")); let output="";
  const sink={write:(s:string)=>{output+=s;return true;}};
  const runtime={...createRuntime(),stdout:sink,stderr:sink};
  const args=parseArgs(["connect","--app-data",directory,"--tenant",tenant,"--client-id",client,"--capability","users"]);
  return {directory,runtime,args,output:()=>output,close:()=>rm(directory,{recursive:true,force:true})};
}

it("saves only a credential reference after all checks, reloads it and deletes it on disconnect",async()=>{
  const f=await fixture();
  try {
    expect(await runConnect(f.args,f.runtime,secret)).toBe(0);
    expect((await readGreybeardConfig(f.directory)).appOnlyProfile).toEqual({tenantId:tenant,clientId:client,capabilities:["users"],authMethod:"client-secret",secretRef:"a".repeat(64)});
    expect(await readFile(join(f.directory,"config.json"),"utf8")).not.toContain(secret);
    expect(f.output()).not.toContain(secret);
    expect(await runConnect(parseArgs(["connect","disconnect","--app-data",f.directory]),f.runtime)).toBe(0);
    expect(mocks.remove).toHaveBeenCalledWith(f.directory,"a".repeat(64));
    expect((await readGreybeardConfig(f.directory)).appOnlyProfile).toBeUndefined();
  } finally {await f.close();}
});

it("keeps a previous connection and secret when read verification fails",async()=>{
  const f=await fixture();
  const previous={tenantId:tenant,clientId:client,capabilities:["users"],authMethod:"client-secret" as const,secretRef:"b".repeat(64)};
  try {
    await writeGreybeardConfig(f.directory,{appOnlyProfile:previous});
    mocks.preview.mockResolvedValue({capabilities:[{selected:true,state:"blocked"}]});
    expect(await runConnect(f.args,f.runtime,secret)).toBe(1);
    expect((await readGreybeardConfig(f.directory)).appOnlyProfile).toEqual(previous);
    expect(mocks.save).not.toHaveBeenCalled();expect(mocks.remove).not.toHaveBeenCalled();
  } finally {await f.close();}
});

it("accepts piped secret values, rotates the credential and refuses command-line values",async()=>{
  const f=await fixture();
  try {
    await writeGreybeardConfig(f.directory,{appOnlyProfile:{tenantId:tenant,clientId:client,capabilities:["users"],authMethod:"client-secret",secretRef:"b".repeat(64)}});
    f.args.flags.set("client-secret-stdin",["true"]);
    expect(await runConnect(f.args,{...f.runtime,stdin:Readable.from([secret+"\n"]) as NodeJS.ReadStream})).toBe(0);
    expect(mocks.save).toHaveBeenCalledWith(f.directory,secret);
    expect(mocks.remove).toHaveBeenCalledWith(f.directory,"b".repeat(64));
    f.args.flags.set("client-secret",[secret]);
    expect(await runConnect(f.args,f.runtime)).toBe(1);
    expect(f.output()).not.toContain(secret);
  } finally {await f.close();}
});

it("removes a newly saved secret if another connection wins before configuration is committed",async()=>{
  const f=await fixture();
  try {
    mocks.save.mockImplementationOnce(async()=>{
      await writeGreybeardConfig(f.directory,{appOnlyProfile:{tenantId:tenant,clientId:client,capabilities:["users"],authMethod:"client-secret",secretRef:"c".repeat(64)}});
      return "a".repeat(64);
    });
    expect(await runConnect(f.args,f.runtime,secret)).toBe(1);
    expect((await readGreybeardConfig(f.directory)).appOnlyProfile?.secretRef).toBe("c".repeat(64));
    expect(mocks.remove).toHaveBeenCalledWith(f.directory,"a".repeat(64));
  } finally {await f.close();}
});
