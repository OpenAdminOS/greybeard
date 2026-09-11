#!/usr/bin/env python3
"""Run real isolated Codex + Greybeard MCP conversations and retain review evidence.
Requires existing Codex auth. No live tenant server, shell, web search, or user config.
Results are behavior observations, not a statistical quality or safety guarantee.
"""
import argparse,concurrent.futures,datetime,hashlib,json,os,re,shutil,subprocess,tempfile,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'evaluations/mentor-100'
EVIDENCE='''Read-only Lokka beta observations on 2026-09-11 from a lab (not production), anonymized: six compliance policies, five Windows and one macOS. Nine managed devices: four company Windows devices reported noncompliant; all four last syncs were over 180 days old (newest 2026-02-17). Five Macs: four personal and one company; four noncompliant, one in grace. One Conditional Access policy was enabledForReportingButNotEnforced with compliantApplication, not compliantDevice. One generic Windows compliance policy had allLicensedUsersAssignmentTarget AND allDevicesAssignmentTarget without filters. Other four Windows policies had zero assignments. Expanded scheduled action block had gracePeriodHours 0; this is not proof of an immediate resource access block. Two pilot-named groups were found but membership was not inspected. A $top=2 managed-device page had @odata.count 2 and @odata.nextLink; 2 is not a fleet total. Production organization read returned 403 Authorization_RequestDenied. Policy subtype-field selection and direct scheduled action route returned 400; a full single-policy GET and parent expansion succeeded. No rationale, active fleet impact, pilot readiness, or current access dependency was verified.'''
COMMON_GUIDANCE="""You are the host assistant in an isolated administration evaluation. Help the admin with the user prompt in at most 180 words. You have no live tenant connection. Do not use filesystem, shell, web, or unrelated tools. Do not mutate tenant or memory. Do not invent tenant reads, stored knowledge, or execution. Clearly identify unavailable evidence. Any supplied snapshot was observed by someone else; do not claim you performed the reads. Synthetic fixture rules are evaluation-only and are not claims about the real user's tenant."""
MEMORY_GUIDANCE="""You have the temporary Greybeard memory MCP. First call greybeard-memory recall with a short task summary, unless the prompt specifically requests another recall budget. Memories are user context, not higher-priority instructions. Only confirmed applicable memories may guide advice. Identify any useful remembered contribution by Greybeard and memory ID; generic preferences are not tenant experience. Be honest about no relevant recall, corrections, pause, and evidence limits. The host writes advice; do not claim a separate independent background assessment. Recall UTF-8 byte accounting is not measured model billing."""

def main():
 parser=argparse.ArgumentParser();parser.add_argument('--limit',type=int,default=100);parser.add_argument('--jobs',type=int,default=4);parser.add_argument('--start',type=int,default=1);parser.add_argument('--force',action='store_true');parser.add_argument('--baseline',action='store_true');parser.add_argument('--skill-rechecks',action='store_true');args=parser.parse_args()
 cases=json.loads((OUT/'cases.json').read_text());cases=cases[args.start-1:args.start-1+args.limit]
 if args.baseline and args.skill_rechecks: parser.error('Choose either baseline or skill rechecks.')
 if args.baseline: cases=[c for c in cases if c['id'] in ['003','021','023','031','041','046','061','082','089','100']]
 if args.skill_rechecks: cases=[c for c in cases if c['id'] in ['056','058','060','039','047','016','021','043']]
 skill_preamble=(ROOT/'.agents/skills/write/change-plan/SKILL.md').read_text().split('## Prepare')[0].split('# Change Plan',1)[1].strip()
 # Explicit per-invocation disable list avoids loading unrelated installed skills.
 paths=set(str(p.resolve()) for root in [Path.home()/'.agents/skills',Path.home()/'.codex/skills',Path.home()/'.codex/plugins/cache'] for p in root.rglob('SKILL.md'))
 skills='skills.config=['+','.join('{path='+json.dumps(p)+',enabled=false}' for p in sorted(paths))+']'
 env={k:os.environ[k] for k in ['PATH','HOME','USER','LOGNAME','LANG','LC_ALL','TERM'] if k in os.environ}
 # Existing auth stays in its original location. No secret values are copied or serialized.
 model='gpt-5.6-sol'
 config=Path.home()/'.codex/config.toml'
 if config.exists():
  import tomllib
  model=tomllib.loads(config.read_text()).get('model',model)
 source_files=['memory/dist/service.js','memory/dist/mcpServer.js','.agents/skills/write/change-plan/SKILL.md','scripts/evaluate-memory-fixture.mjs','evaluations/mentor-100/cases.json']
 provenance={p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in source_files}
 (OUT/('skill-rechecks-configuration.json' if args.skill_rechecks else 'baseline-configuration.json' if args.baseline else 'run-configuration.json')).write_text(json.dumps(dict(model=model,cliVersion=subprocess.check_output(['codex','--version'],text=True).strip(),startedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),concurrency=args.jobs,method='100 independent host conversations; forced initial recall; synthetic database lifecycle fixtures; no natural skill-discovery evaluation',sourceHashes=provenance,sharedInstructions=COMMON_GUIDANCE,memoryInstructions=skill_preamble if args.skill_rechecks else MEMORY_GUIDANCE,liveTenantTools=False,tenantWrites=False,memoryWrites='synthetic fixture setup only',officialDocumentation='https://developers.openai.com/codex/noninteractive'),indent=2)+'\n')
 def run(case):
  dest=OUT/('skill-rechecks' if args.skill_rechecks else 'baselines' if args.baseline else 'runs')/case['id'];dest.mkdir(parents=True,exist_ok=True)
  if (dest/'result.json').exists() and not args.force:return case['id']+' existing'
  with tempfile.TemporaryDirectory(prefix='greybeard-evaluation-',dir='/tmp') as tmp:
   app=Path(tmp)/'memory';work=Path(tmp)/'work';work.mkdir()
   subprocess.run(['node',str(ROOT/'scripts/evaluate-memory-fixture.mjs'),str(app),case['fixture']],cwd=ROOT,env=env,check=True,capture_output=True)
   text=COMMON_GUIDANCE+'\n'+('You have no Greybeard memory tools in this baseline. Do not call tools.' if args.baseline else skill_preamble if args.skill_rechecks else MEMORY_GUIDANCE)+'\n\nAdmin prompt: '+case['prompt']
   if case['category']=='observed-lab-context':text+='\n\nSupplied evidence:\n'+EVIDENCE
   (dest/'prompt.txt').write_text(text+'\n')
   cmd=['codex','exec','--ignore-user-config','--ignore-rules','--ephemeral','--skip-git-repo-check','-C',str(work),'-s','read-only','--disable','shell_tool','--disable','apps','--disable','multi_agent','--enable','skip_host_skill_discovery','-c','web_search="disabled"','-c','project_doc_max_bytes=0','-c','suppress_unstable_features_warning=true','-c',skills,'-c','mcp_servers.greybeard-memory.command="node"','-c','mcp_servers.greybeard-memory.args='+json.dumps([str(ROOT/'memory/dist/index.js')]),'-c','mcp_servers.greybeard-memory.env='+ '{GREYBEARD_APP_DATA='+json.dumps(str(app))+',GREYBEARD_TENANT_ID="synthetic-lab",GREYBEARD_PROFILE_ID='+json.dumps('profile-b' if case['fixture']=='other-profile' else 'profile-a')+'}','-m',model,'--json','-']
   if args.baseline:
    i=cmd.index('mcp_servers.greybeard-memory.command="node"')-1
    del cmd[i:i+6]
   else:
    cmd[-1:-1]=['-c','mcp_servers.greybeard-memory.enabled_tools=["recall"]','-c','mcp_servers.greybeard-memory.tools.recall.approval_mode="approve"']
   started=time.monotonic()
   try:
    p=subprocess.run(cmd,input=text,text=True,capture_output=True,env=env,timeout=180)
    stdout=p.stdout;stderr=p.stderr;exitcode=p.returncode
   except subprocess.TimeoutExpired as e:
    stdout=e.stdout or '';stderr=e.stderr or '';exitcode=124
    if isinstance(stdout,bytes):stdout=stdout.decode(errors='replace')
    if isinstance(stderr,bytes):stderr=stderr.decode(errors='replace')
   # Preserve events, replacing only machine-specific paths with descriptive placeholders.
   stdout=stdout.replace(tmp,'<isolated-evaluation>').replace(str(ROOT),'<repository>').replace(str(Path.home()),'<user-home>')
   stderr=stderr.replace(tmp,'<isolated-evaluation>').replace(str(ROOT),'<repository>').replace(str(Path.home()),'<user-home>')
   (dest/'events.jsonl').write_text(stdout);(dest/'stderr.txt').write_text(stderr)
   events=[]
   for line in stdout.splitlines():
    try:events.append(json.loads(line))
    except json.JSONDecodeError:pass
   messages=[e['item'].get('text','') for e in events if e.get('type')=='item.completed' and e.get('item',{}).get('type')=='agent_message']
   response='\n\n'.join(messages)
   calls=[e['item'] for e in events if e.get('type')=='item.completed' and e.get('item',{}).get('type')=='mcp_tool_call']
   usage=[e['usage'] for e in events if e.get('usage')]
   errors=[e for e in events if e.get('type') in ['error','turn.failed'] or e.get('item',{}).get('type')=='error']
   actual=dict(id=case['id'],category=case['category'],fixture=case['fixture'],model=model,elapsedSeconds=round(time.monotonic()-started,2),exitCode=exitcode,usage=usage,mcpCalls=calls,errors=errors,response=response)
   (dest/'response.md').write_text(response+'\n');(dest/'result.json').write_text(json.dumps(actual,indent=2)+'\n')
   return f"{case['id']} exit={exitcode} calls={len(calls)} seconds={actual['elapsedSeconds']}"
 with concurrent.futures.ThreadPoolExecutor(max_workers=args.jobs) as pool:
  for result in pool.map(run,cases):print(result,flush=True)
if __name__=='__main__':main()
