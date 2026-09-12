#!/usr/bin/env python3
"""Real Claude Code sessions using installed CLAUDE.md and skill discovery."""
import json,os,subprocess,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'evaluations/next-build/claude-installed'
CASES=[('01','lesson','I am planning to change an Intune compliance policy for all Windows devices. Help me plan it. Do not make tenant changes.'),('02','candidate','Why is my Greybeard lesson still a candidate after I said yes in chat? Does it affect the Intune policy?'),('03','lesson','Explain the difference between a list and a tuple in Python.')]
for id,fixture,prompt in CASES:
 dest=OUT/id;dest.mkdir(parents=True,exist_ok=True)
 with tempfile.TemporaryDirectory(prefix='greybeard-evaluation-',dir='/tmp') as tmp:
  home=Path(tmp)/'home';home.mkdir();work=Path(tmp)/'work';work.mkdir();app=Path(tmp)/'memory'
  subprocess.run(['node',str(ROOT/'scripts/evaluate-memory-fixture.mjs'),str(app),fixture],check=True,capture_output=True)
  subprocess.run(['node',str(ROOT/'scripts/evaluate-installed-host.mjs'),str(home),str(app),'claude'],check=True,capture_output=True,cwd=ROOT)
  (home/'.claude/.credentials.json').symlink_to(Path.home()/'.claude/.credentials.json')
  env={k:v for k,v in os.environ.items() if k in ['PATH','USER','LOGNAME','LANG','LC_ALL','TERM']};env.update(HOME=str(home),CLAUDE_CONFIG_DIR=str(home/'.claude'),ENABLE_CLAUDEAI_MCP_SERVERS='false')
  inspection=subprocess.run(['claude','mcp','list'],cwd=work,env=env,text=True,capture_output=True,timeout=40)
  # Normal user config and CLAUDE.md discovery remain enabled. Only reads allowed.
  cmd=['claude','-p',prompt,'--output-format','stream-json','--verbose','--no-session-persistence','--tools','Read,Glob,Grep,Skill','--allowedTools','Read,Glob,Grep,Skill,mcp__greybeard-memory__recall,mcp__greybeard-memory__discover_scopes','--disallowedTools','mcp__greybeard-memory__remember,mcp__greybeard-memory__forget,mcp__greybeard-memory__propose_outcome','--max-budget-usd','2']
  try:
   p=subprocess.run(cmd,cwd=work,env=env,text=True,capture_output=True,timeout=240);stdout=p.stdout;stderr=p.stderr;code=p.returncode
  except subprocess.TimeoutExpired as e:
   stdout=e.stdout or '';stderr=e.stderr or '';code=124
   if isinstance(stdout,bytes):stdout=stdout.decode(errors='replace')
   if isinstance(stderr,bytes):stderr=stderr.decode(errors='replace')
  def clean(s):return s.replace(tmp,'<isolated-evaluation>').replace(str(ROOT),'<repository>').replace(str(Path.home()),'<user-home>')
  stdout=clean(stdout);stderr=clean(stderr);events=[]
  for line in stdout.splitlines():
   try:events.append(json.loads(line))
   except json.JSONDecodeError:pass
  content=[part for e in events if e.get('type')=='assistant' for part in e.get('message',{}).get('content',[])]
  calls=[p for p in content if p.get('type')=='tool_use'];response='\n\n'.join(p.get('text','') for p in content if p.get('type')=='text')
  result=dict(id=id,fixture=fixture,prompt=prompt,exitCode=code,toolCalls=calls,response=response,resultEvents=[e for e in events if e.get('type')=='result'])
  (dest/'mcp-inspection.txt').write_text(clean(inspection.stdout+inspection.stderr));(dest/'events.jsonl').write_text(stdout);(dest/'stderr.txt').write_text(stderr);(dest/'prompt.txt').write_text(prompt+'\n');(dest/'response.md').write_text(response+'\n');(dest/'result.json').write_text(json.dumps(result,indent=2)+'\n');print(id,code,len(calls),flush=True)
  if 'OAuth session expired' in response: break
