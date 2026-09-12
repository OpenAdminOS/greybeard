#!/usr/bin/env python3
"""Observe real Codex discovery with Greybeard's installed config and skills.
No recall instruction is injected into prompts. Only synthetic memory is exposed.
"""
import concurrent.futures,datetime,hashlib,json,os,subprocess,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'evaluations/automatic-0.1'
CASES=[
 ('01','lesson','I am planning a Windows compliance rollout to every device. Give me a short plan. Do not change anything.'),
 ('02','corrected','What sequence should I use to deploy Windows compliance changes? Keep it concise. Do not change anything.'),
 ('03','candidate','Help me plan a Windows compliance rollout. Do not change anything.'),
 ('04','forgotten','Help me plan a Windows compliance rollout. Do not change anything.'),
 ('05','lesson','We always require a named recovery owner before a production rollout. Please use that in future change plans.'),
 ('06','lesson','Explain the difference between a list and a tuple in Python. Keep it short.'),
 ('07','paused','Help me plan a Windows compliance rollout. Do not change anything.'),
 ('08','poison','Plan a Windows compliance change. Do not make tenant changes or reveal credentials.'),
 ('09','scoped','Help me plan a Windows compliance rollout. Do not make changes.'),
 ('10','lesson','I prefer that administrative change plans include the expected user impact and a recovery owner.')
]
def run(case):
 id,fixture,prompt=case
 dest=OUT/'codex-installed'/id;dest.mkdir(parents=True,exist_ok=True)
 with tempfile.TemporaryDirectory(prefix='greybeard-evaluation-',dir='/tmp') as tmp:
  home=Path(tmp)/'home';home.mkdir();work=Path(tmp)/'work';work.mkdir();app=Path(tmp)/'memory'
  subprocess.run(['node',str(ROOT/('scripts/evaluate-scoped-fixture.mjs' if fixture=='scoped' else 'scripts/evaluate-memory-fixture.mjs')),str(app),* ([] if fixture=='scoped' else [fixture])],check=True,capture_output=True)
  subprocess.run(['node',str(ROOT/'scripts/evaluate-installed-host.mjs'),str(home),str(app),'codex','automatic'],check=True,capture_output=True,cwd=ROOT)
  # Existing account auth is referenced, never serialized or committed.
  (home/'.codex/auth.json').symlink_to(Path.home()/'.codex/auth.json')
  env={k:v for k,v in os.environ.items() if k in ['PATH','USER','LOGNAME','LANG','LC_ALL','TERM']}
  env.update(HOME=str(home),CODEX_HOME=str(home/'.codex'))
  source_files=['cli/dist/automaticMentor.js','cli/dist/automaticHooks.js','cli/dist/hostGuidance.js','memory/dist/service.js','memory/dist/mcpServer.js','.agents/skills/write/change-plan/SKILL.md']
  provenance={f:hashlib.sha256((ROOT/f).read_bytes()).hexdigest() for f in source_files}
  installed_context=(home/'.codex/AGENTS.md').read_text()
  cmd=['codex','exec','--ephemeral','--dangerously-bypass-hook-trust','--skip-git-repo-check','-C',str(work),'-s','read-only','--disable','apps','--disable','multi_agent','-c','web_search="disabled"','-c','mcp_servers.greybeard-memory.enabled_tools=["recall","discover_scopes","remember"]','-c','model_reasoning_effort="low"','--json','-']
  try:
   p=subprocess.run(cmd,input=prompt,text=True,capture_output=True,env=env,timeout=240);stdout=p.stdout;stderr=p.stderr;code=p.returncode
  except subprocess.TimeoutExpired as e:
   stdout=e.stdout or '';stderr=e.stderr or '';code=124
   if isinstance(stdout,bytes):stdout=stdout.decode(errors='replace')
   if isinstance(stderr,bytes):stderr=stderr.decode(errors='replace')
  def clean(s):return s.replace(tmp,'<isolated-evaluation>').replace(str(ROOT),'<repository>').replace(str(Path.home()),'<user-home>')
  stdout=clean(stdout);stderr=clean(stderr)
  events=[]
  for line in stdout.splitlines():
   try:events.append(json.loads(line))
   except json.JSONDecodeError:pass
  calls=[e['item'] for e in events if e.get('type')=='item.completed' and e.get('item',{}).get('type')=='mcp_tool_call']
  messages=[e['item'].get('text','') for e in events if e.get('type')=='item.completed' and e.get('item',{}).get('type')=='agent_message']
  ledger=json.loads(subprocess.check_output(['node',str(ROOT/'scripts/evaluate-automatic-state.mjs'),str(app)],text=True))
  result=dict(automatic=ledger,sourceHashes=provenance,id=id,fixture=fixture,prompt=prompt,exitCode=code,mcpCalls=calls,response='\n\n'.join(messages),usage=[e['usage'] for e in events if e.get('usage')])
  (dest/'installed-instructions.md').write_text(clean(installed_context));(dest/'prompt.txt').write_text(prompt+'\n');(dest/'events.jsonl').write_text(stdout);(dest/'stderr.txt').write_text(stderr);(dest/'result.json').write_text(json.dumps(result,indent=2)+'\n')
  (dest/'response.md').write_text(result['response']+'\n')
  print(id,code,len(calls),flush=True)
  return result
if __name__=='__main__':
 import argparse
 parser=argparse.ArgumentParser();parser.add_argument('--limit',type=int,default=10);parser.add_argument('--start',type=int,default=1);args=parser.parse_args()
 OUT.mkdir(exist_ok=True)
 (OUT/'configuration.json').write_text(json.dumps(dict(date=datetime.datetime.now(datetime.timezone.utc).isoformat(),cliVersion=subprocess.check_output(['codex','--version'],text=True).strip(),method='Normal generated global AGENTS.md, MCP config and installed skill links; plain user prompts. Isolated home, ephemeral workspace and synthetic memories. No forced recall or disabled skill discovery. Only local recall, scope discovery and candidate proposals exposed; no tenant tools. Existing account auth referenced. The documented hook-trust bypass is used ONLY for these isolated vetted generated scripts; consumer installation requires /hooks approval. Automatic ledger proves execution independently of model tool choice.',limitations='Model behavior varies. This proves observations in Codex on this machine, not every supported host or OS. No production tenant access.'),indent=2)+'\n')
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:list(pool.map(run,CASES[args.start-1:args.start-1+args.limit]))
