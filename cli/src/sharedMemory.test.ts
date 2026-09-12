import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { MemoryService } from "@greybeard/memory";
import { SharedServerStore, startSharedServer } from "./sharedServer.js";
import { bindingKey, credentials, disconnectMemory, openMemoryBackend, operationId, pairMemory, readMemoryBinding, RemoteMemory, saveMemoryBinding, sharedUrl } from "./sharedMemory.js";
import { startSetupUi } from "./setupUi.js";
import { createRuntime } from "./runtime.js";
import { runCli } from "./index.js";
import { Readable } from "node:stream";

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "greybeard-shared-")); cleanups.push(() => rm(root, { recursive: true, force: true }));
  const serverData = join(root, "server");
  const running = await startSharedServer({ appData: serverData, publicUrl: "https://memory.example.test" }); cleanups.push(running.close);
  const admin = new SharedServerStore(serverData); cleanups.push(async () => admin.close());
  const nativeFetch = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = String(input);
    return nativeFetch(url.startsWith("https://memory.example.test") ? url.replace("https://memory.example.test", `http://127.0.0.1:${running.port}`) : input, init);
  });
  const secrets = new Map<string, string>(); let counter = 0;
  vi.spyOn(credentials, "save").mockImplementation(async (_, value) => { const ref = (++counter).toString(16).padStart(64, "0"); secrets.set(ref, value); return ref; });
  vi.spyOn(credentials, "load").mockImplementation(async (_, ref) => { const value = secrets.get(ref); if (!value) throw new Error("Missing test credential"); return value; });
  vi.spyOn(credentials, "remove").mockImplementation(async (_, ref) => { secrets.delete(ref); });
  const pair = async (name: string, review = true, profile = "local") => {
    const appData = join(root, name); const binding = await pairMemory(appData, "https://memory.example.test", admin.enroll(profile, "local", review));
    return { appData, binding, agent: new RemoteMemory(appData, binding), review: new RemoteMemory(appData, binding, true) };
  };
  const request = async (path: string, token?: string, body: unknown = {}, operation?: string, headers: Record<string,string> = {}) => {
    const response = await nativeFetch(`http://127.0.0.1:${running.port}${path}`, { method:"POST", headers: { "content-type":"application/json", "x-greybeard-protocol":"1", "x-greybeard-store":admin.serverId, ...(token ? {authorization:`Bearer ${token}`} : {}), ...(operation ? {"x-greybeard-operation":operation} : {}), ...headers }, body:JSON.stringify(body) });
    return {status:response.status, body:await response.json() as any};
  };
  return {root,admin,pair,request,running,secrets};
}

it("shares reviewed lessons across two MCP clients and automatic hooks, without reading transcript files", async () => {
  const f = await fixture(); const a = await f.pair("a"); const b = await f.pair("b");
  const proposed = await a.agent.remember({type:"preference",content:"Windows compliance pilot requires helpdesk review."});
  expect((await b.agent.recall({query:"Windows compliance pilot"})).results).toEqual([]);
  const node = (await b.review.export()).nodes.find(n=>n.id===proposed.id)!;
  await b.review.confirm({id:node.id,expectedRevision:node.revision});
  expect((await b.agent.recall({query:"Windows compliance pilot"})).results[0]?.id).toBe(node.id);
  let output = "";
  const runtime = {...createRuntime(), env:{GREYBEARD_APP_DATA:b.appData}, stdin:Readable.from([JSON.stringify({session_id:"two-hosts",prompt:"Plan a Windows compliance pilot.",transcript_path:"/does/not/exist"})]) as any, stdout:{write:(text:string)=>{output+=text;return true;}}};
  expect(await runCli(["mentor","event","--host","claude","--event","prompt"],runtime)).toBe(0);
  expect(output).toContain("helpdesk review");
  await expect(readFile(join(b.appData,"memory.db"))).rejects.toMatchObject({code:"ENOENT"});
  const bindingText = await readFile(join(b.appData,"memory-backend.json"),"utf8");
  for (const value of f.secrets.values()) expect(bindingText).not.toContain(value);
});

it("enforces single-use enrollment, roles, revocation, store identity and profile separation", async () => {
  const f = await fixture(); const code = f.admin.enroll("local","local",true);
  expect((await f.request("/pair",undefined,{code})).status).toBe(200);
  expect((await f.request("/pair",undefined,{code})).status).toBe(401);
  const a = await f.pair("a"); const other = await f.pair("other",true,"other");
  const token = await a.agent.token();
  expect((await f.request("/review",token,{method:"confirm",input:{id:1,expectedRevision:"x"}},operationId())).status).toBe(403);
  expect((await f.request("/status",token,{},undefined,{origin:"https://evil.example"})).status).toBe(403);
  expect((await f.request("/status",token,{},undefined,{"x-greybeard-store":"wrong"})).status).toBe(409);
  expect((await f.request("/status")).status).toBe(401);
  expect((await f.request("/status",token,{},undefined,{"x-greybeard-protocol":"2"})).status).toBe(400);
  await a.agent.remember({type:"preference",content:"Private production pilot rule for this profile."});
  expect((await other.review.export()).nodes).toEqual([]);
  f.admin.revoke(a.binding.deviceId);
  await expect(a.agent.status()).rejects.toThrow("revoked");
});

it("deduplicates committed mutations and rejects changed replay payloads and stale reviews", async () => {
  const f = await fixture(); const a = await f.pair("a"); const token = await a.review.token();
  const operation = operationId(); const command = {method:"remember",input:{type:"decision",content:"Pilot deployment needs a recovery owner."}};
  const first = await f.request("/review",token,command,operation);
  const second = await f.request("/review",token,command,operation);
  expect(first.status).toBe(200); expect(second.body).toEqual(first.body);
  expect((await f.request("/review",token,{...command,input:{...command.input,content:"Changed payload"}},operation)).status).toBe(409);
  expect((await a.review.export()).nodes).toHaveLength(1);
  const node = (await a.review.export()).nodes[0]!;
  expect((await f.request("/review",token,{method:"confirm",input:{id:node.id,expectedRevision:"stale"}},operationId())).status).toBe(409);
  await a.review.confirm({id:node.id,expectedRevision:node.revision});
  const confirmed = (await a.review.export()).nodes[0]!;
  expect(confirmed.status).toBe("confirmed");
  expect((await f.request("/review",token,{method:"forget",input:{id:node.id,expectedRevision:"stale"}},operationId())).status).toBe(409);
  expect((await f.request("/review",token,{method:"remember",input:{type:"decision",content:"Correction",supersedes:node.id,expectedOriginalRevision:"stale"}},operationId())).status).toBe(409);
  expect((await f.request("/review",token,{method:"forget",input:{id:node.id,expectedRevision:confirmed.revision}},operationId())).status).toBe(200);
  expect((await f.request("/review",token,command,operation)).status).toBe(409);
  expect((await a.review.export()).nodes).toHaveLength(0);
});

it("separates device sessions, pauses shared recall, and preserves local memory on disconnect", async () => {
  const f = await fixture(); const a = await f.pair("a"); const b = await f.pair("b");
  const event = {host:"claude",kind:"prompt",session:"same",turn:"same",text:"We always require a pilot before production rollouts."};
  const first = await a.agent.request("/event",event); expect(first.candidateId).toBeTruthy();
  const second = await b.agent.request("/event",event); expect(second.context).toBeTruthy();
  expect((await b.review.export()).nodes).toHaveLength(1);
  await a.review.request("/review",{method:"pause",input:{paused:true}});
  expect((await b.agent.recall({query:"production rollouts"})).recallStatus).toBe("paused");
  expect((await b.agent.request("/event",event)).paused).toBe(true);
  const local = new MemoryService({appDataPath:a.appData,profileId:"local",tenantId:"local"});
  await local.remember({type:"fact",content:"Retained local lesson."}); local.close();
  expect(await disconnectMemory(a.appData)).toEqual({revoked:true,credentialsRemoved:true});
  expect(await readMemoryBinding(a.appData)).toBeUndefined();
  const restored = await openMemoryBackend({appDataPath:a.appData,profileId:"local",tenantId:"local"});
  expect((await restored.export()).nodes[0]?.content).toBe("Retained local lesson."); restored.close();
  expect((await b.review.export()).nodes).toHaveLength(1);
});

it("keeps local mode independent, rejects invalid remote configuration and requires HTTPS", async () => {
  const root = await mkdtemp(join(tmpdir(),"greybeard-local-backend-")); cleanups.push(()=>rm(root,{recursive:true,force:true}));
  const network = vi.spyOn(globalThis,"fetch");
  const service = await openMemoryBackend({appDataPath:root,tenantId:"local",profileId:"local"});
  await service.list(); service.close(); expect(network).not.toHaveBeenCalled();
  for (const url of ["http://memory.example", "https://user:secret@memory.example", "https://memory.example/path", "https://memory.example/?token=x"]) expect(()=>sharedUrl(url)).toThrow();
  const {writeFile}=await import("node:fs/promises"); await writeFile(join(root,"memory-backend.json"),'{"mode":"remote"}');
  await expect(openMemoryBackend({appDataPath:root})).rejects.toThrow("not been substituted");
});

it("routes companion review to the shared store and rejects stale store bindings", async () => {
  const f = await fixture(); const a = await f.pair("a");
  const ui = await startSetupUi(createRuntime(),a.appData,{desktop:true}); cleanups.push(()=>new Promise<void>(resolve=>ui.server.close(()=>resolve())));
  const url = new URL(ui.url);
  const call = async (path:string,body:object={}) => {const response=await fetch(url.origin+path,{method:"POST",headers:{origin:url.origin,"content-type":"application/json","x-greybeard-session":url.hash.slice(1)},body:JSON.stringify({memoryBinding:bindingKey(a.binding),memoryTenant:"local",...body})}); return {status:response.status,body:await response.json() as any};};
  expect((await call("/add",{type:"preference",content:"Shared pilot review rule."})).status).toBe(200);
  const node=(await call("/memories")).body.results[0];
  expect((await call("/confirm",{id:node.id,content:node.content,revision:node.revision,memoryBinding:"old-store"})).status).toBe(409);
  expect((await call("/confirm",{id:node.id,content:node.content,revision:node.revision})).status).toBe(200);
  expect((await call("/memory-map")).body.nodes).toHaveLength(1);
  expect((await call("/mentoring")).status).toBe(200);
  await disconnectMemory(a.appData);
  expect((await call("/confirm",{id:node.id,content:node.content,revision:node.revision})).status).toBe(409);
});

it("bounds hooks during slow credential lookup, returns empty context offline, and omits unrelated tool fields", async () => {
  const f = await fixture(); const a = await f.pair("a");
  const {remoteEventText} = await import("./automaticMentor.js");
  const normalized = remoteEventText({tool_name:"Bash",tool_input:{command:"echo pilot",env:{PASSWORD:"never-send"},cwd:"/private/location"},transcript_path:"/private/transcript"},"tool","claude");
  expect(normalized).toBe("Bash echo pilot");
  vi.spyOn(credentials,"load").mockImplementation(async (_, _ref, signal) => new Promise((_,reject)=>{
    if (signal?.aborted) reject(new Error("cancelled"));
    else signal?.addEventListener("abort",()=>reject(new Error("cancelled")),{once:true});
  }));
  let output="";const start=Date.now();
  await runCli(["mentor","event","--host","claude","--event","prompt"],{...createRuntime(),env:{GREYBEARD_APP_DATA:a.appData},stdin:Readable.from([JSON.stringify({session_id:"slow",prompt:"Plan a pilot deployment."})]) as any,stdout:{write:(text:string)=>{output+=text;return true;}}});
  expect(output).toBe("{}\n");expect(Date.now()-start).toBeLessThan(2200);
  await expect(readFile(join(a.appData,"memory.db"))).rejects.toMatchObject({code:"ENOENT"});
});

it("exports multiple bounded pages and permits exact shared confirmation while capture is paused", async () => {
  const f=await fixture();const a=await f.pair("a");
  const service=new MemoryService({appDataPath:f.admin.appData,profileId:"local",tenantId:"local"});
  for(let i=0;i<55;i++) await service.remember({type:"decision",content:`Pilot decision number ${i} requires owner review.`});
  service.close();
  const exported=await a.review.export();expect(exported.nodes).toHaveLength(55);
  await a.review.request("/review",{method:"pause",input:{paused:true}});
  const node=exported.nodes[0]!;
  expect((await a.review.confirm({id:node.id,expectedRevision:node.revision})).status).toBe("confirmed");
  await expect(a.agent.remember({type:"decision",content:"Must not capture while paused."})).rejects.toThrow();
  expect((await a.agent.recall({query:"pilot decision"})).recallStatus).toBe("paused");
});

it("preserves committed replay results after restart and invalidates restored credentials", async () => {
  const f=await fixture();const a=await f.pair("a");const op=operationId();
  const token=await a.review.token();const cmd={method:"remember",input:{type:"fact",content:"Recorded pilot outcome."}};
  expect((await f.request("/review",token,cmd,op)).status).toBe(200);
  const reopened=new SharedServerStore(f.admin.appData);
  try {
    let executed=false;
    const result=await reopened.mutation(a.binding.deviceId,op,"remember",cmd.input,async()=>{executed=true;return {};});
    expect(executed).toBe(false);expect(result).toHaveProperty("id");
    reopened.resetCredentials();
    expect(()=>reopened.authenticate(`Bearer ${token}`)).toThrow();
    expect(reopened.devices()).toEqual(expect.arrayContaining([expect.objectContaining({id:a.binding.deviceId,revoked:1})]));
  } finally {reopened.close();}
});
