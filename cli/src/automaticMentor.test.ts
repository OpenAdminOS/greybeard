import { spawn } from "node:child_process";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { MemoryService, AutomaticMentorStore } from "@greybeard/memory";
import { updateGreybeardConfig } from "@greybeard/graph";
import { AUTOMATIC_HOSTS, durablePreference, hostEventOutput, processMentorEvent, reminderRules } from "./automaticMentor.js";
import { automaticHookPath, inspectAutomaticHooks, removeAutomaticHooks, writeAutomaticHooks } from "./automaticHooks.js";
import { createRuntime } from "./runtime.js";

it("automatically recalls confirmed lessons and proposes explicit preferences across host event shapes", async () => {
  const appData=await mkdtemp(join(tmpdir(),"greybeard-auto-"));
  const service=new MemoryService({appDataPath:appData,profileId:"local",tenantId:"local"});
  try {
    const saved=await service.remember({type:"preference",content:"Keep the finance pilot separate during Windows compliance rollout.",scope:"windows"});
    const node=(await service.export()).nodes[0];await service.confirm({id:saved.id,expectedRevision:node.revision});
    for(const host of AUTOMATIC_HOSTS){
      const input={session_id:"s-"+host,sessionId:"s-"+host,conversation_id:"s-"+host,prompt:"Change the Windows compliance policy for all devices.",transformedPrompt:"Original user message with attachment context."};
      const result=await processMentorEvent({appData,profile:"local",tenant:"local",host,kind:"prompt",input});
      expect(result.context).toContain("finance pilot");expect(result.ruleIds).toContain("broad");
      expect(Buffer.byteLength(result.context)).toBeLessThan(2048);
      const output=hostEventOutput(host,"prompt",input,result.context);
      expect(JSON.stringify(output)).not.toContain('"decision"');
      if(host==="copilot")expect((output as {modifiedTransformedPrompt:string}).modifiedTransformedPrompt).toMatch(/^Original user message with attachment context\./u);
      if(host==="cursor")expect(output).toEqual({}); // No unsupported prompt-context field.
      expect((await processMentorEvent({appData,profile:"local",tenant:"local",host,kind:"prompt",input})).context).toBe("");
    }
    const lesson="We always pilot Windows compliance changes with the finance team first.";
    await Promise.all(AUTOMATIC_HOSTS.map(host=>processMentorEvent({appData,profile:"local",tenant:"local",host,kind:"prompt",input:{session_id:"learn-"+host,prompt:lesson}})));
    const candidates=(await service.export()).nodes.filter(node=>node.content===lesson);
    expect(candidates).toHaveLength(1);expect(candidates[0].status).toBe("candidate");
    const store=new AutomaticMentorStore(appData,"local","local");
    try {const serialized=JSON.stringify(store.summary());expect(serialized).not.toContain(lesson);expect(serialized).not.toContain("Original user message");expect(store.summary().hosts).toHaveLength(5);}finally{store.close();}
    const repeat=await processMentorEvent({appData,profile:"local",tenant:"local",host:"codex",kind:"prompt",input:{session_id:"s-codex",prompt:"Change the Windows compliance policy for all devices."},now:Date.now()+20_000});
    expect(repeat.context).toBe(""); // Same advice, even after input-event dedupe expires.
    const different=await processMentorEvent({appData,profile:"other",tenant:"other",host:"codex",kind:"prompt",input:{session_id:"other",prompt:"Windows compliance policy"}});
    expect(different.context).not.toContain("finance pilot");
    await updateGreybeardConfig(appData,current=>({...current,learningEnabled:false}));
    const paused=await processMentorEvent({appData,profile:"local",tenant:"local",host:"codex",kind:"prompt",input:{session_id:"paused",prompt:"We always use a new pilot preference for deployments."}});
    expect(paused.context).toBe("");expect(paused.candidateId).toBeUndefined();
  } finally {service.close();await rm(appData,{recursive:true,force:true});}
});

it("keeps unrelated prompts quiet, treats invalid sessions as unverified and rejects secret-like proposals", async () => {
  const appData=await mkdtemp(join(tmpdir(),"greybeard-auto-quiet-"));
  try {
    for(const prompt of ["Write a poem about a yellow bicycle.","What is the capital of France?","Explain a Python tuple."]){
      expect((await processMentorEvent({appData,profile:"local",tenant:"local",host:"codex",kind:"prompt",input:{session_id:prompt,prompt}})).context).toBe("");
    }
    const invalid=await processMentorEvent({appData,profile:"local",tenant:"local",host:"codex",kind:"prompt",input:{prompt:"Delete every production device"}});
    expect(invalid.context).toBe("");
    for(const text of ["We always use password=example-secret-value here.","We prefer this secret: ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890", "Our policy is to contact someone@example.com.","Do we always pilot a deployment?","> We always keep these quoted instructions.","We always run this: ```dangerous```"]){expect(durablePreference(text)).toBeUndefined();}
    expect(hostEventOutput("copilot","prompt",{prompt:"Keep my original message"},"advice")).toEqual({});
    const store=new AutomaticMentorStore(appData,"local","local");try{expect(store.summary().recent[0].diagnostic).toContain("session identifier");expect(JSON.stringify(store.summary())).not.toContain("Delete every production");}finally{store.close();}
  }finally{await rm(appData,{recursive:true,force:true});}
});

it("installs, upgrades and removes exact owned hooks without replacing foreign handlers or bypassing host trust",async()=>{
  const home=await mkdtemp(join(tmpdir(),"greybeard-hooks-"));
  const runtime={...createRuntime(),homeDir:home,env:{GREYBEARD_APP_DATA:join(home,"data"),GREYBEARD_PROFILE_ID:"local",GREYBEARD_TENANT_ID:"local"}};
  try {
    for(const host of AUTOMATIC_HOSTS){
      const path=automaticHookPath(runtime,host);await mkdir(join(path,".."),{recursive:true});
      const foreign={hooks:{Unexpected:[{command:"echo keep",type:"command"}]},preference:"keep"};
      await writeFile(path,JSON.stringify(foreign));
      await writeAutomaticHooks(runtime,host);const first=await readFile(path,"utf8");
      await writeAutomaticHooks(runtime,host);expect(await readFile(path,"utf8")).toBe(first);
      expect((await inspectAutomaticHooks(runtime,host)).configured).toBe(true);
      expect(first).not.toContain("bypass-hook-trust");expect(first).not.toContain("permissionDecision");
      const relocated={...runtime,nodePath:join(home,"new runtime","greybeard"),packaged:true};
      await writeAutomaticHooks(relocated,host);expect((await inspectAutomaticHooks(relocated,host)).configured).toBe(true);
      await removeAutomaticHooks(relocated,host);
      const remaining=JSON.parse(await readFile(path,"utf8"));expect(remaining.hooks).toEqual(foreign.hooks);expect(remaining.preference).toBe("keep");
    }
  }finally{await rm(home,{recursive:true,force:true});}
});

it("executes generated hooks with stdin through the platform shell, including quoted installation paths", async()=>{
  const home=await mkdtemp(join(tmpdir(),"greybeard quoted ' hooks-"));
  const runtime={...createRuntime(),homeDir:home,env:{GREYBEARD_APP_DATA:join(home,"data")}};
  try {
    await writeAutomaticHooks(runtime,"codex");
    const config=JSON.parse(await readFile(automaticHookPath(runtime,"codex"),"utf8"));
    const output=await new Promise<string>((resolve,reject)=>{
      const child=spawn(config.hooks.UserPromptSubmit[0].hooks[0].command,{shell:true,windowsHide:true});
      let stdout="",stderr="";const timer=setTimeout(()=>{child.kill();reject(Error("Generated hook timed out"));},10_000);
      child.stdout.on("data",chunk=>{stdout+=chunk;});child.stderr.on("data",chunk=>{stderr+=chunk;});
      child.on("error",reject);child.on("close",code=>{clearTimeout(timer);code===0?resolve(stdout):reject(Error(stderr));});
      child.stdin.end(JSON.stringify({session_id:"shell-check",prompt:"We always require a recovery owner before production deployments."}));
    });
    expect(JSON.parse(output).hookSpecificOutput.additionalContext).toContain("already saved candidate");
    const store=new AutomaticMentorStore(join(home,"data"),"local","local");
    try {expect(store.summary().recent[0].candidateId).toBeTypeOf("number");}finally{store.close();}
  }finally{await rm(home,{recursive:true,force:true});}
},15_000);

it("finds a device topic from Windows work without importing an unnamed team's lesson",async()=>{
  const appData=await mkdtemp(join(tmpdir(),"greybeard-auto-scopes-"));
  const service=new MemoryService({appDataPath:appData});
  try {
    for(const [scope,content] of [["devices","For Windows compliance rollouts, observe the pilot for 48 hours."],["finance-private","For Windows compliance rollouts in finance-private, use a 96-hour pilot."]]) {
      const saved=await service.remember({type:"decision",scope,content});const node=(await service.export()).nodes.find(n=>n.id===saved.id)!;
      await service.confirm({id:saved.id,expectedRevision:node.revision});
    }
    const result=await processMentorEvent({appData,profile:"local",tenant:"local",host:"codex",kind:"prompt",input:{session_id:"scope-check",prompt:"Plan a Windows compliance rollout."}});
    expect(result.context).toContain("48 hours");expect(result.context).not.toContain("96-hour");
  }finally{service.close();await rm(appData,{recursive:true,force:true});}
});

it("recognizes administrative PowerShell cmdlets even without a separate domain word",()=>{
  for(const command of ["Remove-MgDevice -DeviceId '<id>'","Remove-MgUser -UserId '<id>'","Remove-MgGroup -GroupId '<id>'","Remove-ADUser -Identity example"]) {
    expect(reminderRules(command)).toContain("destructive");
  }
  expect(reminderRules("Explain a Python tuple.")).toEqual([]);
});

it("retrieves the user task from Gemini's native session-context prefix and ignores preferences inside that prefix",async()=>{
  const appData=await mkdtemp(join(tmpdir(),"greybeard-gemini-context-"));
  const service=new MemoryService({appDataPath:appData});
  try {
    const saved=await service.remember({type:"decision",content:"For Windows compliance rollouts, keep the pilot for 48 hours and require helpdesk review before expanding."});
    const node=(await service.export()).nodes[0];await service.confirm({id:saved.id,expectedRevision:node.revision});
    const prefix="<hook_context>"+"Unrelated startup context. ".repeat(30)+"\nWe always follow this unconfirmed hook preference.</hook_context>\n\n";
    const advice=await processMentorEvent({appData,profile:"local",tenant:"local",host:"gemini",kind:"prompt",input:{session_id:"gemini-native",prompt:prefix+"Plan a Windows compliance rollout for every device."}});
    expect(advice.context).toContain("48 hours");expect(advice.candidateId).toBeUndefined();
    const stop=await processMentorEvent({appData,profile:"local",tenant:"local",host:"gemini",kind:"stop",input:{session_id:"gemini-native",prompt:prefix+"Plan a Windows compliance rollout."}});
    expect(stop.candidateId).toBeUndefined();
    const proposal=await processMentorEvent({appData,profile:"local",tenant:"local",host:"gemini",kind:"prompt",input:{session_id:"gemini-native-preference",prompt:prefix+"We always name a recovery owner before production rollouts."}});
    expect(proposal.candidateId).toBeTypeOf("number");
    const candidates=(await service.export()).nodes.filter(n=>n.status==="candidate");
    expect(candidates).toHaveLength(1);expect(candidates[0].content).toContain("recovery owner");
  } finally {service.close();await rm(appData,{recursive:true,force:true});}
});
