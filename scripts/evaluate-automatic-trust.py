#!/usr/bin/env python3
"""Codex trust boundary and hook-only advice. Synthetic data, no MCP or skills."""
import json,os,subprocess,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
for trust in [False,True]:
 with tempfile.TemporaryDirectory(prefix='greybeard-evaluation-',dir='/tmp') as tmp:
  home=Path(tmp)/'home';home.mkdir();work=Path(tmp)/'work';work.mkdir();app=Path(tmp)/'data'
  subprocess.run(['node',str(ROOT/'scripts/evaluate-memory-fixture.mjs'),str(app),'lesson'],capture_output=True,check=True)
  subprocess.run(['node',str(ROOT/'scripts/evaluate-installed-host.mjs'),str(home),str(app),'codex','automatic'],capture_output=True,check=True)
  # Deliberately remove MCP and instructions to isolate the contribution of hooks.
  (home/'.codex/config.toml').write_text('')
  (home/'.codex/AGENTS.md').unlink()
  import shutil
  shutil.rmtree(home/'.agents/skills',ignore_errors=True)
  shutil.rmtree(home/'.codex/skills',ignore_errors=True)
  (home/'.codex/auth.json').symlink_to(Path.home()/'.codex/auth.json')
  env={k:v for k,v in os.environ.items() if k in ['PATH','USER','LOGNAME','LANG','LC_ALL','TERM']};env.update(HOME=str(home),CODEX_HOME=str(home/'.codex'))
  prompt='Plan a Windows compliance rollout to every device. Include the known pilot duration and review condition if available. Do not use tools or change anything. Keep it short.'
  cmd=['codex','exec','--ephemeral','--skip-git-repo-check','-C',str(work),'-s','read-only','--disable','apps','--disable','multi_agent','-c','web_search="disabled"','-c','model_reasoning_effort="low"','--json',*(['--dangerously-bypass-hook-trust'] if trust else []),'-']
  p=subprocess.run(cmd,input=prompt,text=True,capture_output=True,env=env,timeout=180)
  def clean(s):return s.replace(tmp,'<isolated-evaluation>').replace(str(ROOT),'<repository>').replace(str(Path.home()),'<user-home>')
  events=[]
  for line in p.stdout.splitlines():
   try:events.append(json.loads(line))
   except json.JSONDecodeError:pass
  response='\n'.join(e['item'].get('text','') for e in events if e.get('type')=='item.completed' and e.get('item',{}).get('type')=='agent_message')
  ledger=json.loads(subprocess.check_output(['node',str(ROOT/'scripts/evaluate-automatic-state.mjs'),str(app)],text=True))
  result=dict(method='Hooks only, no MCP, installed skills or host instructions. Isolated vetted scripts use the documented automation-only trust bypass for the trusted comparison; normal installation never does.',trustedFixture=trust,prompt=prompt,exitCode=p.returncode,response=clean(response),stderr=clean(p.stderr),automatic=ledger)
  dest=ROOT/'evaluations/automatic-0.1'/('codex-hooks-only' if trust else 'codex-untrusted');dest.mkdir(parents=True,exist_ok=True)
  (dest/'result.json').write_text(json.dumps(result,indent=2)+'\n');print(trust,p.returncode,len(ledger['activity']['hosts']),flush=True)
