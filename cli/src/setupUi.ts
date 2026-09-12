import { createServer, type Server } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { APPLICATION_CAPABILITIES, getGreybeardAppDataPath, readGreybeardConfig, updateGreybeardConfig } from "@greybeard/graph";
import { companionPage } from "./companionUi.js";
import { discoveryRuntime, inspectWorkspace, readAutomaticActivity } from "./workspaceStatus.js";
import { AutomaticMentorStore, MemoryService } from "@greybeard/memory";
import { previewSetupRepair, repairSetup } from "./setupRepair.js";
import { detectAllClients } from "./clients.js";
import { flagValue, parseArgs, type ParsedArgs } from "./args.js";
import { readBoundedInput } from "./mentor.js";
import { type CliRuntime, writeLine } from "./runtime.js";

function sameSecret(actual: string, expected: string): boolean {
  const a = Buffer.from(actual); const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function startSetupUi(runtime: CliRuntime, appDataPath: string, options: { desktop?: boolean } = {}): Promise<{ server: Server; url: string }> {
  if (options.desktop) runtime = discoveryRuntime(runtime);
  let setupInProgress = false;
  let repairPreview: { id: string; plan: Awaited<ReturnType<typeof previewSetupRepair>> } | undefined;
  const session = randomBytes(32).toString("hex");
  const nonce = randomBytes(24).toString("base64");
  let origin = "";
  const server = createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Content-Security-Policy", `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; form-action 'none'; base-uri 'none'`);
    const fail = (status: number, message: string) => { response.writeHead(status, { "Content-Type": "application/json" }); response.end(JSON.stringify({ error: message })); };
    if (request.headers.host !== new URL(origin).host) return fail(403, "Invalid host.");
    const path = new URL(request.url || "/", origin).pathname;
    if (request.method === "GET" && path === "/") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); response.end(options.desktop ? companionPage(nonce) : page(nonce)); return;
    }
    if (request.method === "GET" && path === "/favicon.ico") { response.writeHead(204); response.end(); return; }
    if (request.method === "GET" && path === "/logo.png") {
      try { response.writeHead(200, { "Content-Type": "image/png" }); response.end(await readFile(join(runtime.repoRoot, "assets", "logo", "greybeard-light.png"))); }
      catch { response.end(); }
      return;
    }
    if (request.method !== "POST" || request.headers.origin !== origin || request.headers["content-type"] !== "application/json" || typeof request.headers["x-greybeard-session"] !== "string" || !sameSecret(request.headers["x-greybeard-session"], session)) return fail(403, "Open the setup link printed in your terminal.");
    let service: MemoryService | undefined;
    try {
      const body = JSON.parse(await readBoundedInput(request)) as Record<string, unknown>;
      if (!body || typeof body !== "object" || Array.isArray(body)) return fail(400, "Invalid request.");
      let result: unknown;
      if (path === "/state") {
        const config = await readGreybeardConfig(appDataPath);
        const toolStatus = await inspectWorkspace(runtime, appDataPath);
        const configuredClients = toolStatus.filter(c => c.configured).map(c => c.name);
        result = { toolStatus, setupCompleted: config.companionSetupCompleted === true, connection: config.appOnlyProfile ? { tenant: config.appOnlyProfile.tenantId, clientId: config.appOnlyProfile.clientId, certificate: config.appOnlyProfile.certificatePath, privateKey: config.appOnlyProfile.privateKeyPath, capabilities: config.appOnlyProfile.capabilities } : null, configuredClients, clients: toolStatus.filter(c => c.detected).map(c => c.name), learningEnabled: config.learningEnabled !== false, updateMode: config.updateMode ?? "notify", profileId: config.profileId ?? "local", tenantId: config.activeTenantId ?? "local", tenantConfigured: Boolean(config.appOnlyProfile), connectionSupported: true, capabilities: Object.entries(APPLICATION_CAPABILITIES).map(([id, capability]) => ({ id, label: capability.label, permission: capability.permission })) };
      } else if (path === "/mentoring") {
        const config = await readGreybeardConfig(appDataPath);
        result = {...readAutomaticActivity(appDataPath,config.profileId ?? "local",config.activeTenantId ?? "local"),paused:config.learningEnabled === false || config.memoryHook === false};
      } else if (path === "/diagnostics") {
        const { assembleDoctorFindings } = await import("./doctor.js");
        result = await assembleDoctorFindings(parseArgs(["doctor", "--app-data", appDataPath]), runtime);
      } else if (path === "/settings") {
        if (!["automatic", "notify", "manual"].includes(String(body.updateMode))) return fail(400, "Choose an update mode.");
        await updateGreybeardConfig(appDataPath, current => ({ ...current, updateMode: body.updateMode as "automatic" | "notify" | "manual" }));
        result = { saved: true };
      } else if (path === "/setup") {
        if (!Array.isArray(body.clients) || body.clients.some(name => typeof name !== "string")) return fail(400, "Select clients.");
        if (!["automatic", "notify", "manual"].includes(String(body.updateMode))) return fail(400, "Choose an update mode.");
        const { runSetup } = await import("./setup.js");
        const selected = body.clients as string[];
        if (selected.includes("Claude Desktop") && !selected.includes("Claude Code")) selected.push("Claude Code");
        const detected = await detectAllClients(runtime);
        if (selected.some(name => !detected.some(client => client.detected && client.name === name))) return fail(400, "Selected client is no longer available.");
        // No selected clients means local memory only, not implicit selection of every client.
        if (setupInProgress) return fail(409, "Setup is already running. Wait for it to finish.");
        setupInProgress = true;
        try {
          const sink = { write: () => true };
          let setupError: string | undefined;
          let code = 1;
          try {
            code = await runSetup(parseArgs(["setup", "--yes", "--app-data", appDataPath, "--update-mode", String(body.updateMode), ...(body.mentor === false ? ["--no-memory-hook"] : ["--memory-hook"]), ...(selected.length ? selected.flatMap(name => ["--client", name]) : ["--no-clients"])]), { ...runtime, stdout: sink, stderr: sink });
          } catch { setupError = "Setup could not finish. Review the tool results and check file permissions before retrying."; }
          const tools = await inspectWorkspace(runtime, appDataPath);
          const configured = code === 0 && selected.every(name => tools.some(tool => tool.name === name && tool.ready));
          if (configured) await updateGreybeardConfig(appDataPath, current => ({ ...current, companionSetupCompleted: true, ...(body.enableLearning === true ? { learningEnabled: true } : {}) }));
          result = { configured, tools, selected, ...(setupError ? { error: setupError } : {}), message: configured ? "Configuration checked. Restart your selected AI tools to load Greybeard." : "Some integrations need attention. Successful integrations have been kept; retry after fixing the listed issues." };
        } finally { setupInProgress = false; }
      } else if (path === "/repair-preview") {
        if (setupInProgress) return fail(409, "Wait for setup to finish.");
        const client = (await detectAllClients(runtime)).find(client => client.detected && client.name === body.client);
        if (!client) return fail(400, "Choose an installed tool.");
        const plan = await previewSetupRepair(runtime, client.name);
        repairPreview = { id: randomBytes(24).toString("hex"), plan };
        result = { id: repairPreview.id, client: plan.client, configPath: plan.configPath, skills: plan.skills.map(skill => ({ name: skill.name, path: skill.path, reason: skill.reason })) };
      } else if (path === "/repair") {
        if (setupInProgress) return fail(409, "Wait for setup to finish.");
        if (!repairPreview || body.id !== repairPreview.id) return fail(409, "Review this tool's repair before confirming it.");
        const preview = repairPreview.plan;
        repairPreview = undefined;
        setupInProgress = true;
        try {
          result = await repairSetup(runtime, appDataPath, preview);
          result = { ...result as object, tools: await inspectWorkspace(runtime, appDataPath) };
        } finally { setupInProgress = false; }
      } else if (path === "/setup-later") {
        if (setupInProgress) return fail(409, "Wait for setup to finish.");
        await updateGreybeardConfig(appDataPath, current => ({ ...current, companionSetupCompleted: true }));
        result = { saved: true };
      } else if (path === "/connect") {
        for (const key of ["tenant", "clientId", "certificate", "privateKey"]) if (typeof body[key] !== "string" || !(body[key] as string).trim()) return fail(400, "Tenant ID, application ID and both certificate file paths are required.");
        if (!Array.isArray(body.capabilities) || !body.capabilities.length || body.capabilities.some(key => typeof key !== "string" || !Object.hasOwn(APPLICATION_CAPABILITIES, key))) return fail(400, "Choose at least one read capability.");
        const { runConnect } = await import("./connect.js");
        let output = "";
        const sink = { write: (text: string) => { output += text; return true; } };
        const code = await runConnect(parseArgs(["connect", "--app-data", appDataPath, "--tenant", body.tenant as string, "--client-id", body.clientId as string, "--certificate", body.certificate as string, "--private-key", body.privateKey as string, ...(body.capabilities as string[]).flatMap(key => ["--capability", key])]), { ...runtime, stdout: sink, stderr: sink });
        if (code !== 0) return fail(400, output.trim());
        result = { connected: true, message: output.trim() };
      } else if (path === "/capability-preview") {
        const { getConnectionPreview } = await import("./connectionPreview.js");
        result = await getConnectionPreview(appDataPath, { verify: body.live === true, fetcher: runtime.fetcher });
      } else if (path === "/disconnect") {
        const { runConnect } = await import("./connect.js");
        await runConnect(parseArgs(["connect", "disconnect", "--app-data", appDataPath]), runtime);
        result = { connected: false };
      } else if (path === "/pause") {
        if (typeof body.paused !== "boolean") return fail(400, "Invalid pause state.");
        await updateGreybeardConfig(appDataPath, current => ({ ...current, learningEnabled: !body.paused }));
        result = { paused: body.paused };
      } else if (path === "/close") {
        result = { closed: true }; setTimeout(() => server.close(), 100);
      } else {
        // Confirmation lives only in this authenticated local UI; never exposed through MCP.
        const memoryConfig = await readGreybeardConfig(appDataPath);
        const currentTenant = memoryConfig.activeTenantId ?? "local";
        const tenantId = typeof body.memoryTenant === "string" ? body.memoryTenant : currentTenant;
        if (tenantId !== "local" && tenantId !== currentTenant) return fail(400, "Select local memory or the configured tenant.");
        service = new MemoryService({ appDataPath, profileId: memoryConfig.profileId ?? "local", tenantId });
        if (path === "/memories") result = await service.list({ limit: 50, ...(typeof body.cursor === "number" ? { cursor: body.cursor } : {}), ...(typeof body.query === "string" && body.query ? { query: body.query } : {}), ...(typeof body.scope === "string" && body.scope ? { scope: body.scope } : {}), ...(["query", "preference", "script", "fact", "scope", "decision"].includes(String(body.type)) ? { type: body.type as "fact" } : {}), ...(["candidate", "confirmed"].includes(String(body.status)) ? { status: body.status as "candidate" } : {}) });
        else if (path === "/add") {
          if (!["query", "preference", "script", "fact", "scope", "decision"].includes(String(body.type)) || typeof body.content !== "string" || !body.content.trim()) return fail(400, "Choose a type and write a memory.");
          result = await service.remember({ type: body.type as "fact", content: body.content, scope: typeof body.scope === "string" ? body.scope : "global", source: "local-ui", ...(typeof body.evidenceKind === "string" ? { evidenceKind: body.evidenceKind as "rule" } : {}), ...(typeof body.observedAt === "number" ? { observedAt: body.observedAt } : {}) });
        }
        else if (path === "/summary") {
          const nodes = (await service.export()).nodes.filter(node => node.supersededAt === null);
          result = { active: nodes.length, confirmed: nodes.filter(node => node.status === "confirmed").length, candidates: nodes.filter(node => node.status === "candidate").length };
        } else if (path === "/metrics") result = { ...(await service.adviceMetrics()), recent: await service.adviceHistory() };
        else if (path === "/clear-metrics") { await service.clearAdviceMetrics(); const activity = new AutomaticMentorStore(appDataPath,memoryConfig.profileId ?? "local",tenantId); try { activity.clear(); } finally { activity.close(); } result = { cleared: true }; }
        else if (path === "/feedback") {
          if (typeof body.recallId !== "string" || !["accepted", "ignored", "irrelevant"].includes(String(body.feedback))) return fail(400, "Select an advice event and rating.");
          result = await service.recordAdviceFeedback({ recallId: body.recallId, feedback: body.feedback as "accepted" });
        } else if (path === "/outcome") {
          if (typeof body.lesson !== "string" || typeof body.outcome !== "string") return fail(400, "Describe the lesson and outcome.");
          result = await service.proposeOutcome({ lesson: body.lesson, outcome: body.outcome, source: "local-ui", scope: typeof body.scope === "string" ? body.scope : "global", ...(typeof body.observedAt === "number" ? { observedAt: body.observedAt } : {}) });
        } else if (path === "/confirm") {
          if (!Number.isSafeInteger(body.id) || typeof body.content !== "string" || typeof body.revision !== "string") return fail(400, "Preview the candidate first.");
          const node = (await service.export()).nodes.find(n => n.id === body.id);
          if (!node || node.status !== "candidate" || node.content !== body.content || node.revision !== body.revision) return fail(409, "Candidate changed. Refresh and review again.");
          result = await service.confirm({ id: body.id as number, expectedRevision: body.revision as string, confirmationChannel: "local-ui" });
        } else if (path === "/forget") {
          if (!Number.isSafeInteger(body.id)) return fail(400, "Choose a memory.");
          if (options.desktop) {
            const node = (await service.export()).nodes.find(n => n.id === body.id);
            if (!node || node.revision !== body.revision || node.content !== body.content) return fail(409, "Memory changed. Refresh and review again before forgetting.");
          }
          result = await service.forget({ id: body.id as number });
        } else if (path === "/correct") {
          if (!Number.isSafeInteger(body.id) || typeof body.content !== "string" || !body.content.trim()) return fail(400, "Choose a memory and provide replacement text.");
          const node = (await service.export()).nodes.find(n => n.id === body.id);
          if (!node || node.status !== "confirmed" || node.supersededAt !== null) return fail(409, "Correct a current confirmed memory.");
          result = await service.remember({ type: node.type, scope: node.scope, content: body.content, supersedes: node.id, source: "local-ui", evidenceKind: node.evidenceKind, ...(node.observedAt !== null && node.observedAt !== undefined ? { observedAt: node.observedAt } : {}), ...(node.outcome ? { outcome: node.outcome } : {}) });
        } else if (path === "/export") result = await service.export();
        else return fail(404, "Unknown action.");
      }
      response.writeHead(200, { "Content-Type": "application/json" }); response.end(JSON.stringify(result));
    } catch (error) { fail(400, error instanceof Error ? error.message : "Request failed."); }
    finally { service?.close(); }
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Cannot start local setup.");
  origin = `http://127.0.0.1:${address.port}`;
  if (!options.desktop) {
    const timer = setTimeout(() => server.close(), 30 * 60_000); timer.unref();
    server.on("close", () => clearTimeout(timer));
  }
  return { server, url: `${origin}/#${session}` };
}

export async function runSetupUi(args: ParsedArgs, runtime: CliRuntime): Promise<number> {
  const { runCompanion } = await import("./companion.js");
  return runCompanion({ ...runtime, env: { ...runtime.env, GREYBEARD_APP_DATA: flagValue(args, "app-data") || runtime.env.GREYBEARD_APP_DATA || getGreybeardAppDataPath() } });
}

function page(nonce: string): string {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Greybeard 0.1</title>
<style nonce="${nonce}">:root{color-scheme:light;font:17px/1.6 Georgia,serif;color:#28342e;background:#f6f4ed}*{box-sizing:border-box}body{margin:0}main{max-width:850px;margin:auto;padding:36px 24px 70px}header{display:flex;align-items:center;gap:20px;border-bottom:1px solid #d4d8cc;padding-bottom:26px}img{width:85px;height:85px;object-fit:contain}small,button,label,select,.note{font-family:Verdana,sans-serif}small{letter-spacing:.09em;font-size:11px;text-transform:uppercase}h1{font-weight:400;font-size:clamp(34px,6vw,54px);line-height:1.1;max-width:650px}h2{font-weight:400;font-size:27px}p{max-width:670px}section{border-top:1px solid #d4d8cc;margin-top:28px;padding-top:10px}label{display:block;margin:14px 0;font-size:14px}input{margin-right:12px;accent-color:#356745}button,select{max-width:100%;font-size:14px;padding:12px 18px;border-radius:5px;border:1px solid #667463;background:#fff;color:#28342e;cursor:pointer}input[type=text]{display:block;width:100%;padding:10px;margin:6px 0;border:1px solid #667463;border-radius:5px;background:white;color:#28342e;font-size:15px}details{margin-top:18px}summary{cursor:pointer}code{overflow-wrap:anywhere}button.primary{background:#315b43;color:white;border-color:#315b43}button:disabled{opacity:.5;cursor:wait}button:focus-visible,select:focus-visible,input:focus-visible{outline:3px solid #b47d33;outline-offset:4px}.actions{display:flex;gap:12px;flex-wrap:wrap;margin:20px 0}.note{font-size:12px;color:#52604f}#status{white-space:pre-wrap;color:#315b43}article{padding:18px;background:white;border:1px solid #d4d8cc;border-radius:5px;margin:15px 0;overflow-wrap:anywhere}article p{white-space:pre-wrap}footer{margin-top:40px}.error{color:#922f20!important}</style>
<main><header><img src="/logo.png" alt="Greybeard, a wise man with a grey beard"><div><small>Greybeard · 0.1</small><div>Local setup</div></div></header>
<h1>An IT mentor that learns how you work.</h1><p>Keep the decisions and lessons you want to carry into your next task. Start with local memory. Connecting your own infrastructure is optional.</p>
<section><h2>1. Choose your AI tools</h2><div id="clients">Looking for installed clients…</div><p class="note">Greybeard supplies advisory context for supported Claude Code commands. It does not pause execution, so advice may appear afterward. Other clients can recall lessons when asked. Greybeard does not monitor your desktop.</p></section>
<section><h2>2. Make it yours</h2><label><input type="checkbox" id="mentor" checked>Offer relevant advice in Claude Code</label><label for="updates">Updates</label><select id="updates"><option value="notify">Notify me before installing</option><option value="automatic">Stage verified updates; activate on a supported next launch</option><option value="manual">Only when I ask</option></select><p class="note">Your AI client supplies the model. Recalled context can add tokens. Local memory may be sent to that model when used in a conversation. Proposed lessons need your confirmation.</p><div class="actions"><button class="primary" id="setup">Set up Greybeard</button></div></section>
<p id="status" role="status" aria-live="polite"></p>
<section><h2>Your memory</h2><p>Review each proposal before confirming it. Only confirmed preferences and lessons inform mentor advice.</p><div class="actions"><button id="refresh">Review memory</button><button id="pause">Pause learning and advice</button><button id="export">Export memory</button></div><div id="memories"><h3 id="preferences-heading">Mentor preferences</h3><p class="note">How you want to work, from advice style to specific rollout rules.</p><div id="preferences" role="region" aria-labelledby="preferences-heading"></div><p id="preferences-empty" class="note">Review memory to see your preferences.</p><h3 id="lessons-heading">Lessons and decisions</h3><p class="note">Reusable facts, decisions, and lessons from your work. Memories describe what you confirmed; they do not verify current tenant state.</p><div id="lessons" role="region" aria-labelledby="lessons-heading"></div><p id="lessons-empty" class="note">Review memory to see your lessons and decisions.</p></div><button id="more" hidden>Load more</button><p class="note">Memory belongs to this local profile. Processes running as your account can access the same files.</p></section>
<section><h2>Connect your infrastructure later</h2><p>Keep using Greybeard without a tenant connection. When you choose to connect, use an app registration owned by your company.</p><details><summary>Connect with your own app registration</summary><p class="note">Provision your certificate and grant the selected Application permissions in Entra first. Greybeard does not create registrations or grant consent. Application access can cover the tenant, and the feature selection does not narrow permissions already granted to an app. Use a dedicated app. Candidate permission mappings below still require isolated minimum-grant verification.</p><p id="tenant-status" role="status"></p><label>Tenant ID<input id="tenant" type="text" autocomplete="off" spellcheck="false"></label><label>Application (client) ID<input id="clientId" type="text" autocomplete="off" spellcheck="false"></label><label>Public certificate file path (PEM)<input id="certificate" type="text" autocomplete="off" spellcheck="false"></label><label>Private-key file path (PEM)<input id="privateKey" type="text" autocomplete="off" spellcheck="false"></label><p class="note">File paths stay local. Never paste private-key contents. Private-key ownership and file protection are checked on macOS, Linux, and Windows.</p><div id="capabilities"></div><div class="actions"><button id="connect">Check and connect</button><button id="disconnect">Disconnect tenant</button></div></details></section><footer><button id="close">Close setup</button></footer></main>
<script nonce="${nonce}">
const token=location.hash.slice(1);history.replaceState(null,'','/');let paused=false,cursor;
const status=document.getElementById('status');
async function api(path,body={}){const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','X-Greybeard-Session':token},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw Error(data.error||'Request failed');return data;}
function message(text,error=false){status.textContent=text;status.className=error?'error':'';}
function act(id,fn){document.getElementById(id).onclick=async()=>{const b=document.getElementById(id);b.disabled=true;try{await fn();}catch(e){message(e.message,true);}finally{b.disabled=false;}};}
api('/state').then(s=>{const box=document.getElementById('clients');box.replaceChildren();for(const name of s.clients){const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.value=name;input.checked=true;label.append(input,document.createTextNode(name));box.append(label);}if(!s.clients.length)box.textContent='No installed client detected. You can still set up local memory and add a client later.';document.getElementById('updates').value=s.updateMode;paused=!s.learningEnabled;pauseLabel();document.getElementById('tenant-status').textContent=s.tenantConfigured?'Tenant connection configured.':'Tenant disconnected. Mentor mode is available.';document.getElementById('connect').disabled=!s.connectionSupported;for(const cap of s.capabilities){const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.value=cap.id;label.append(input,document.createTextNode(cap.label+' - '+cap.permission));document.getElementById('capabilities').append(label);}}).catch(e=>message(e.message,true));
act('setup',async()=>{const clients=[...document.querySelectorAll('#clients input:checked')].map(x=>x.value);const r=await api('/setup',{clients,mentor:document.getElementById('mentor').checked,updateMode:document.getElementById('updates').value});message(r.configured?'Greybeard is ready. Restart your selected client, then ask it to remember an operating preference.':'Some client setup failed. Check your terminal for details.',!r.configured);});
async function memories(append=false){
  const result=await api('/memories',append?{cursor}:{});
  const preferences=document.getElementById('preferences'),lessons=document.getElementById('lessons');
  if(!append){preferences.replaceChildren();lessons.replaceChildren();}
  for(const node of result.results){
    const isPreference=node.type==='preference',kind=isPreference?'preference':'lesson';
    const article=document.createElement('article'),meta=document.createElement('small'),p=document.createElement('p'),actions=document.createElement('div');
    actions.className='actions';
    meta.textContent=(node.supersededAt!==null?'superseded':node.status)+' · '+node.type+' · '+node.scope+' · #'+node.id;
    p.textContent=node.content;article.append(meta,p);
    if(node.status==='candidate'){
      const b=document.createElement('button');b.textContent='Confirm this '+kind;
      b.onclick=async()=>{
        if(!confirm('Confirm this exact '+kind+'?\\n\\n'+node.content))return;
        b.disabled=true;
        try{await api('/confirm',{id:node.id,content:node.content,revision:node.revision});await memories();message(isPreference?'Preference confirmed.':'Lesson confirmed.');}
        catch(e){message(e.message,true);b.disabled=false;}
      };
      actions.append(b);
    }
    const forget=document.createElement('button');forget.textContent='Forget';
    forget.onclick=async()=>{
      if(!confirm('Forget this memory?'))return;
      try{await api('/forget',{id:node.id});await memories();message('Memory removed.');}catch(e){message(e.message,true);}
    };
    actions.append(forget);
    if(node.status==='confirmed'&&node.supersededAt===null){
      const correct=document.createElement('button');correct.textContent='Correct';
      correct.onclick=async()=>{
        const content=prompt('Propose replacement text. It will require separate confirmation.',node.content);if(!content)return;
        try{await api('/correct',{id:node.id,content});await memories();message('Correction saved as a candidate. The previous memory remains active until you confirm its replacement.');}catch(e){message(e.message,true);}
      };
      actions.append(correct);
    }
    article.append(actions);(isPreference?preferences:lessons).append(article);
  }
  cursor=result.nextCursor;document.getElementById('more').hidden=!cursor;
  for(const group of ['preferences','lessons']){
    const empty=document.getElementById(group+'-empty');empty.hidden=document.getElementById(group).childElementCount>0;
    empty.textContent=cursor?'None in the loaded memories. Load more to check older entries.':group==='preferences'?'No preferences yet. Ask your AI client to propose how you want to work, then confirm it here.':'No lessons or decisions yet. Ask your AI client to propose a reusable lesson from your work, then confirm it here.';
  }
}
act('refresh',()=>memories());act('more',()=>memories(true));
function pauseLabel(){document.getElementById('pause').textContent=paused?'Resume learning and advice':'Pause learning and advice';}
act('pause',async()=>{await api('/pause',{paused:!paused});paused=!paused;pauseLabel();message(paused?'Learning and mentor advice paused.':'Learning and mentor advice resumed.');});
act('export',async()=>{const data=await api('/export');const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='greybeard-memory.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
act('connect',async()=>{const data={};for(const key of ['tenant','clientId','certificate','privateKey'])data[key]=document.getElementById(key).value.trim();data.capabilities=[...document.querySelectorAll('#capabilities input:checked')].map(x=>x.value);const result=await api('/connect',data);document.getElementById('tenant-status').textContent='Tenant connected. Choose Set up Greybeard again to add it to your selected clients.';message(result.message);});
act('disconnect',async()=>{await api('/disconnect');document.getElementById('tenant-status').textContent='Tenant disconnected. Local memories remain available.';message('Tenant disconnected. Restart your clients.');});
act('close',async()=>{await api('/close');message('Setup closed. You may close this tab.');document.querySelectorAll('button').forEach(b=>b.disabled=true);});
</script></html>`;
}
