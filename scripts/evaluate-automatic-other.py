#!/usr/bin/env python3
import json,os,subprocess,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
for host in ['copilot','gemini']:
 with tempfile.TemporaryDirectory(prefix='greybeard-evaluation-',dir='/tmp') as tmp:
  home=Path(tmp)/'home';home.mkdir();work=Path(tmp)/'work';work.mkdir();app=Path(tmp)/'memory'
  subprocess.run(['node',str(ROOT/'scripts/evaluate-memory-fixture.mjs'),str(app),'lesson'],check=True,capture_output=True)
  subprocess.run(['node',str(ROOT/'scripts/evaluate-installed-host.mjs'),str(home),str(app),host,'automatic'],check=True,capture_output=True,cwd=ROOT)
  env={k:v for k,v in os.environ.items() if k in ['PATH','USER','LOGNAME','LANG','LC_ALL','TERM']};env.update(HOME=str(home),COPILOT_HOME=str(home/'.copilot'),GEMINI_CLI_HOME=str(home),CI='true')
  prompt='Plan a Windows compliance rollout for every device. Include any known pilot duration and review conditions. Do not use tools or change anything. Keep it short.'
  binary='/tmp/greybeard-host-verification/node_modules/.bin/'+host
  if host=='copilot':
   auth=subprocess.run(['gh','auth','token'],capture_output=True,text=True)
   if auth.returncode==0: env['COPILOT_GITHUB_TOKEN']=auth.stdout.strip()
   cmd=[binary,'-p',prompt,'--output-format','json','--no-auto-update','--disable-builtin-mcps']
  else: cmd=[binary,'-p',prompt,'--output-format','json']
  try:
   p=subprocess.run(cmd,cwd=work,env=env,capture_output=True,text=True,timeout=120);stdout=p.stdout;stderr=p.stderr;code=p.returncode
  except subprocess.TimeoutExpired as e:
   stdout=e.stdout or '';stderr=e.stderr or '';code=124
   if isinstance(stdout,bytes):stdout=stdout.decode(errors='replace')
   if isinstance(stderr,bytes):stderr=stderr.decode(errors='replace')
  def clean(s):
   if env.get('COPILOT_GITHUB_TOKEN'):s=s.replace(env['COPILOT_GITHUB_TOKEN'],'<redacted>')
   return s.replace(tmp,'<isolated-evaluation>').replace(str(ROOT),'<repository>').replace(str(Path.home()),'<user-home>')
  ledger=json.loads(subprocess.check_output(['node',str(ROOT/'scripts/evaluate-automatic-state.mjs'),str(app)],text=True))
  dest=ROOT/'evaluations/automatic-0.1'/host;dest.mkdir(parents=True,exist_ok=True)
  version=subprocess.check_output([binary,'--version'],text=True).strip()
  result=dict(host=host,version=version,prompt=prompt,exitCode=code,stdout=clean(stdout),stderr=clean(stderr),automatic=ledger,method='Isolated home and synthetic memory. Only generated host hooks, no MCP configuration or Greybeard host instructions. No tenant tools.')
  (dest/'result.json').write_text(json.dumps(result,indent=2)+'\n');print(host,code,clean(stdout+stderr)[:1600],flush=True)
