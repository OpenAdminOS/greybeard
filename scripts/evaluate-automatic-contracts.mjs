// 100 distinct existing prompts replayed through five adapters. No model calls.
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { processMentorEvent, hostEventOutput, AUTOMATIC_HOSTS } from '../cli/dist/automaticMentor.js';
import { MemoryService, AutomaticMentorStore } from '../memory/dist/public.js';
const root=resolve('.');
const cases=JSON.parse(await readFile('evaluations/mentor-100/cases.json','utf8'));
const results=[];
for(const item of cases) {
  const dir=await mkdtemp('/tmp/greybeard-evaluation-');const appData=join(dir,'data');
  try {
    execFileSync(process.execPath,['scripts/evaluate-memory-fixture.mjs',appData,item.fixture],{cwd:root,stdio:'pipe'});
    const service=new MemoryService({appDataPath:appData,profileId:'profile-a',tenantId:'synthetic-lab'});
    const nodes=(await service.export()).nodes;service.close();
    const hosts=[];
    for(const host of AUTOMATIC_HOSTS) {
      const input={session_id:item.id+host,sessionId:item.id+host,conversation_id:item.id+host,prompt:item.prompt,transformedPrompt:item.prompt+'\n[attachment retained]'};
      const started=performance.now();
      const result=await processMentorEvent({appData,profile:'profile-a',tenant:'synthetic-lab',host,kind:'prompt',input});
      const output=hostEventOutput(host,'prompt',input,result.context);
      const checks={bounded:Buffer.byteLength(result.context)<=2048,confirmedOnly:result.memoryIds.every(id=>nodes.some(n=>n.id===id&&n.status==='confirmed'&&!n.supersededAt)),noDecision:!JSON.stringify(output).includes('permissionDecision'),cursorCompanion:host!=='cursor'||JSON.stringify(output)==='{}',copilotPreservesPrompt:host!=='copilot'||!result.context||output.modifiedTransformedPrompt.startsWith(input.transformedPrompt+'\n\n'),pause:item.fixture!=='paused'||!result.context};
      hosts.push({host,context:result.context,bytes:Buffer.byteLength(result.context),memoryIds:result.memoryIds,ruleIds:result.ruleIds,candidateId:result.candidateId??null,elapsedMs:Math.round(performance.now()-started),checks,passed:Object.values(checks).every(Boolean)});
    }
    const store=new AutomaticMentorStore(appData,'profile-a','synthetic-lab');const events=store.summary();store.close();
    results.push({id:item.id,prompt:item.prompt,fixture:item.fixture,review:{method:'Deterministic engine and adapter contract replay; not a model conversation or independent advice-quality assessment.',passed:hosts.every(h=>h.passed),notes:item.fixture==='paused'?'No context or proposal while paused.':'Confirmed-memory isolation, context budget and non-blocking host output checked.'},hosts,eventCount:events.recent.length});
  } finally { await rm(dir,{recursive:true,force:true}); }
}
const dir='evaluations/automatic-0.1';await mkdir(dir,{recursive:true});
const sourceHashes=Object.fromEntries(await Promise.all(['cli/dist/automaticMentor.js','cli/dist/automaticHooks.js','memory/dist/automatic.js'].map(async p=>[p,createHash('sha256').update(await readFile(p)).digest('hex')])));
const report={method:'100 distinct prompts, five adapters each, synthetic local profiles. 500 deterministic prompt checks; no paid model or tenant calls.',sourceHashes,prompts:results.length,adapterChecks:results.length*5,failed:results.filter(r=>!r.review.passed).length,results};
await writeFile(join(dir,'contract-reviews.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({prompts:report.prompts,adapterChecks:report.adapterChecks,failed:report.failed}));
if(report.failed)process.exitCode=1;
