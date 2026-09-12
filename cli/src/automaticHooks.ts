import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { withClientConfigLock, writeClientConfigAtomic } from "./clientConfigFile.js";
import { runtimeCommand, type CliRuntime } from "./runtime.js";
import type { KnownClientName } from "./clients.js";
import type { MentorHost } from "@greybeard/memory";

const OWNER = "--greybeard-hook-owner=0.1";
type RecordValue = Record<string,unknown>;
function object(value: unknown): value is RecordValue { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
export function hostForClient(client: KnownClientName): MentorHost {
  return {"Claude Code":"claude","Claude Desktop":"claude","Codex CLI":"codex",Cursor:"cursor","Gemini CLI":"gemini","GitHub Copilot":"copilot"}[client] as MentorHost;
}
export function automaticHookPath(runtime: CliRuntime, host: MentorHost): string {
  switch(host) {
    case "claude": return join(runtime.env.CLAUDE_CONFIG_DIR || join(runtime.homeDir,".claude"),"settings.json");
    case "codex": return join(runtime.env.CODEX_HOME || join(runtime.homeDir,".codex"),"hooks.json");
    case "cursor": return join(runtime.homeDir,".cursor","hooks.json");
    case "gemini": return join(runtime.env.GEMINI_CLI_HOME || runtime.homeDir,".gemini","settings.json");
    case "copilot": return join(runtime.env.COPILOT_HOME || join(runtime.homeDir,".copilot"),"hooks","greybeard.json");
  }
}
const EVENTS: Record<MentorHost, Record<string,string>> = {
  claude: {SessionStart:"start",UserPromptSubmit:"prompt",PreToolUse:"tool",Stop:"stop"},
  codex: {SessionStart:"start",UserPromptSubmit:"prompt",PreToolUse:"tool",Stop:"stop"},
  cursor: {sessionStart:"start",beforeSubmitPrompt:"prompt",beforeShellExecution:"tool",beforeMCPExecution:"tool",postToolUse:"after-tool",afterAgentResponse:"stop"},
  gemini: {SessionStart:"start",BeforeAgent:"prompt",AfterTool:"after-tool",AfterAgent:"stop"},
  copilot: {sessionStart:"start",userPromptTransformed:"prompt",postToolUse:"after-tool",agentStop:"stop"}
};
function quotePosix(value: string) { return "'" + value.replace(/'/gu,"'\\''") + "'"; }
function quotePowerShell(value: string) { return "'" + value.replace(/'/gu,"''") + "'"; }
function shellCommand(words: string[], platform: NodeJS.Platform) {
  if (words.some(word=>/[\r\n\0]/u.test(word))) throw new Error("Unsupported control character in a hook path.");
  if (platform !== "win32") return words.map(quotePosix).join(" ");
  // Windows hosts use different shells. An explicit PowerShell process makes the launch consistent.
  const script = "& " + words.map(quotePowerShell).join(" ");
  return "powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand " + Buffer.from(script,"utf16le").toString("base64");
}
function definition(runtime: CliRuntime,host: MentorHost,event: string): RecordValue {
  const call = runtimeCommand(runtime,["mentor","event","--host",host,"--event",event,"--app-data",runtime.env.GREYBEARD_APP_DATA!,"--profile",runtime.env.GREYBEARD_PROFILE_ID || "local","--tenant",runtime.env.GREYBEARD_TENANT_ID || "local",OWNER]);
  if (host === "copilot") return {type:"command",exec:call.command,args:call.args,timeoutSec:5};
  const command = shellCommand([call.command,...call.args],runtime.platform);
  if (host === "cursor") return {command,timeout:5};
  return {type:"command",command,...(host === "gemini" ? {name:`greybeard-${event}`,timeout:5000} : {timeout:5})};
}
function owned(value: unknown): boolean {
  if (!object(value)) return false;
  if (Array.isArray(value.args) && value.args.at(-1) === OWNER && value.args.includes("mentor") && value.args.includes("event")) return true;
  if (typeof value.command !== "string") return false;
  let command = value.command;
  const encoded = /^powershell\.exe -NoProfile -NonInteractive(?: -WindowStyle Hidden)? -EncodedCommand ([A-Za-z0-9+/=]+)$/u.exec(command);
  if (encoded) command = Buffer.from(encoded[1],"base64").toString("utf16le");
  return command.endsWith(quotePosix(OWNER)) && /['"]mentor['"] ['"]event['"]/u.test(command);
}
async function readRoot(path: string): Promise<RecordValue> {
  let text;
  try { text = await readFile(path,"utf8"); } catch(error) { if((error as NodeJS.ErrnoException).code === "ENOENT") return {}; throw error; }
  const root: unknown = JSON.parse(text);
  if (!object(root) || (root.hooks !== undefined && !object(root.hooks))) throw new Error("Existing hook configuration has an unsupported format; it was preserved.");
  return root;
}
function stripOwned(hooks: RecordValue): boolean {
  let changed = false;
  for(const [event,groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    hooks[event] = groups.flatMap(group=>{
      if (owned(group)) {changed=true;return [];}
      if (!object(group) || !Array.isArray(group.hooks)) return [group];
      const handlers = group.hooks.filter(handler=>!owned(handler));
      if(handlers.length===group.hooks.length)return [group];
      changed=true;return handlers.length ? [{...group,hooks:handlers}] : [];
    });
    if (!(hooks[event] as unknown[]).length && groups.length) delete hooks[event];
  }
  return changed;
}
export async function writeAutomaticHooks(runtime: CliRuntime,host: MentorHost) {
  const path = automaticHookPath(runtime,host);
  if (!runtime.env.GREYBEARD_APP_DATA) throw new Error("Automatic mentoring needs a bound local profile.");
  await withClientConfigLock(path,async()=>{
    const root = await readRoot(path);
    const hooks = object(root.hooks) ? root.hooks : {};
    stripOwned(hooks);
    for(const [event,kind] of Object.entries(EVENTS[host])) {
      if (hooks[event] !== undefined && !Array.isArray(hooks[event])) throw new Error(`Existing ${event} hooks are not a list; preserved.`);
      const handler = definition(runtime,host,kind);
      const entry = ["cursor","copilot"].includes(host) ? handler : {hooks:[handler]};
      hooks[event] = [...(hooks[event] as unknown[] || []),entry];
    }
    root.hooks = hooks;
    if (["cursor","copilot"].includes(host)) {
      if(root.version!==undefined && root.version!==1) throw new Error("Unsupported hook configuration version; preserved.");
      root.version=1;
    }
    await writeClientConfigAtomic(path,JSON.stringify(root,null,2)+"\n");
  });
  return {path,configured:true,status:"installed" as const};
}
export async function removeAutomaticHooks(runtime: CliRuntime,host: MentorHost) {
  const path = automaticHookPath(runtime,host);
  try { await readFile(path); } catch(error) { if((error as NodeJS.ErrnoException).code==="ENOENT")return; throw error; }
  await withClientConfigLock(path,async()=>{
    const root=await readRoot(path);
    if(object(root.hooks) && stripOwned(root.hooks)) await writeClientConfigAtomic(path,JSON.stringify(root,null,2)+"\n");
  });
}
export async function inspectAutomaticHooks(runtime: CliRuntime,host: MentorHost) {
  const path = automaticHookPath(runtime,host);
  const notes: string[] = [];
  let configured=false; let disabled=false;
  try {
    const root=await readRoot(path); const hooks=object(root.hooks)?root.hooks:{};
    configured=Object.entries(EVENTS[host]).every(([event,kind])=>{
      const groups=hooks[event];
      const expected=JSON.stringify(definition(runtime,host,kind));
      return Array.isArray(groups)&&groups.some(group=>JSON.stringify(group)===expected || object(group)&&Array.isArray(group.hooks)&&group.hooks.some(handler=>JSON.stringify(handler)===expected));
    });
    if(root.disableAllHooks===true || object(root.hooksConfig)&&root.hooksConfig.enabled===false) { disabled=true; notes.push("This tool's settings disable hooks. Enable them in the tool before automatic mentoring can run."); }
    if(host==="gemini" && object(root.hooksConfig) && Array.isArray(root.hooksConfig.disabled) && Object.values(EVENTS.gemini).some(kind=>{
      const def=definition(runtime,host,kind);return (root.hooksConfig as RecordValue).disabled instanceof Array && ((root.hooksConfig as RecordValue).disabled as unknown[]).some(value=>value===def.name||value===def.command);
    })) { disabled=true; notes.push("One or more Greybeard hooks are disabled in Gemini settings."); }
    if(host==="codex") {
      try { const config = await readFile(join(path,"..","config.toml"),"utf8"); const features = /(?:^|\n)\[features\]([^]*?)(?=\n\[|$)/u.exec(config)?.[1] ?? "";
        if (/^\s*hooks\s*=\s*false\s*(?:#.*)?$/mu.test(features)) { disabled=true; notes.push("Codex features.hooks is disabled. Enable hooks in Codex settings."); }
      } catch(error) { if((error as NodeJS.ErrnoException).code!=="ENOENT") notes.push("Could not inspect Codex feature settings."); }
    }
    if(host==="codex")notes.push("Open /hooks in Codex to review and trust Greybeard's hooks, then send a prompt. New or changed definitions require host approval.");
    if(host==="cursor")notes.push("Prompt-time advice appears in the running Greybeard companion. Cursor supports model context at session start and after tool results; its prompt hook cannot inject model context.");
  } catch {notes.push("Could not inspect automatic hooks. Check the configuration file's format and permissions.");}
  return {path,configured,disabled,notes,host,events:Object.keys(EVENTS[host])};
}
