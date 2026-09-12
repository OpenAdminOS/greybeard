import json,os,subprocess,tempfile,threading,time
from pathlib import Path
from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
ROOT=Path(__file__).resolve().parents[3];OUT=Path(__file__).resolve().parent
failures=[]
for host in ['claude','copilot','gemini']:
 requests=[];phase="recall"
 class Handler(BaseHTTPRequestHandler):
  def log_message(self,*args):pass
  def do_GET(self):
   body=json.dumps({'models':[{'name':'models/gemini-2.5-flash','supportedGenerationMethods':['generateContent','countTokens']}],'data':[{'id':'gpt-4.1','object':'model'}]}).encode();self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(body)
  def do_POST(self):
   payload=json.loads(self.rfile.read(int(self.headers.get('Content-Length','0'))));serialized=json.dumps(payload)
   requests.append({'phase':phase,'hasCandidateNotice':'already saved candidate #' in serialized,'path':self.path,'hasConfirmedLesson':'keep the pilot for 48 hours and require helpdesk review before expanding' in serialized,'hasOriginalPrompt':prompt in serialized,'hasMentorContext':'Greybeard mentor context' in serialized})
   self.send_response(200)
   if host=='gemini':
    result={'candidates':[{'content':{'role':'model','parts':[{'text':'Synthetic transport acknowledgement.'}]},'finishReason':'STOP'}],'usageMetadata':{'promptTokenCount':1,'candidatesTokenCount':1,'totalTokenCount':2},'modelVersion':'gemini-2.5-flash'}
    stream='streamGenerateContent' in self.path
    self.send_header('Content-Type','text/event-stream' if stream else 'application/json');self.end_headers();self.wfile.write(('data: '+json.dumps(result)+'\n\n' if stream else json.dumps(result)).encode())
   elif host=='claude':
    self.send_header('Content-Type','text/event-stream' if payload.get('stream') else 'application/json');self.end_headers()
    message={'id':'msg_fixture','type':'message','role':'assistant','content':[{'type':'text','text':'Synthetic transport acknowledgement.'}],'model':payload.get('model','fixture'),'stop_reason':'end_turn','stop_sequence':None,'usage':{'input_tokens':1,'output_tokens':1}}
    if self.path.endswith('count_tokens'):self.wfile.write(b'{"input_tokens":1}')
    elif payload.get('stream'):
     events=[('message_start',{'type':'message_start','message':{**message,'content':[],'stop_reason':None}}),('content_block_start',{'type':'content_block_start','index':0,'content_block':{'type':'text','text':''}}),('content_block_delta',{'type':'content_block_delta','index':0,'delta':{'type':'text_delta','text':'Synthetic transport acknowledgement.'}}),('content_block_stop',{'type':'content_block_stop','index':0}),('message_delta',{'type':'message_delta','delta':{'stop_reason':'end_turn','stop_sequence':None},'usage':{'output_tokens':1}}),('message_stop',{'type':'message_stop'})]
     self.wfile.write(''.join('event: '+name+'\ndata: '+json.dumps(body)+'\n\n' for name,body in events).encode())
    else:self.wfile.write(json.dumps(message).encode())
   else:
    stream=payload.get('stream',False);self.send_header('Content-Type','text/event-stream' if stream else 'application/json');self.end_headers()
    result={'id':'fixture','object':'chat.completion.chunk' if stream else 'chat.completion','created':int(time.time()),'model':'gpt-4.1','choices':[{'index':0,('delta' if stream else 'message'):{'role':'assistant','content':'Synthetic transport acknowledgement.'},'finish_reason':'stop'}]}
    self.wfile.write(('data: '+json.dumps(result)+'\n\ndata: [DONE]\n\n' if stream else json.dumps(result)).encode())
 server=ThreadingHTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
 with tempfile.TemporaryDirectory(prefix='greybeard-evaluation-',dir='/tmp') as temp:
  home=Path(temp)/'home';home.mkdir();work=Path(temp)/'work';work.mkdir();app=Path(temp)/'memory'
  subprocess.run(['node',str(ROOT/'scripts/evaluate-memory-fixture.mjs'),str(app),'lesson'],check=True,capture_output=True)
  subprocess.run(['node',str(ROOT/'scripts/evaluate-installed-host.mjs'),str(home),str(app),host,'automatic'],check=True,capture_output=True,cwd=ROOT)
  env={k:v for k,v in os.environ.items() if k in ['PATH','USER','LOGNAME','LANG','LC_ALL','TERM']};env.update(HOME=str(home),COPILOT_HOME=str(home/'.copilot'),GEMINI_CLI_HOME=str(home),CI='true',NO_PROXY='127.0.0.1,localhost')
  endpoint='http://127.0.0.1:'+str(server.server_port);prompt='Plan a Windows compliance rollout for every device. Do not use tools or change anything.';binary=str(Path(os.environ.get('GREYBEARD_HOST_BIN_DIR','/tmp/greybeard-host-verification/node_modules/.bin'))/host)
  if host=='claude':
   import shutil
   (home/'.claude.json').write_text('{}')
   (home/'.claude/CLAUDE.md').unlink(missing_ok=True)
   shutil.rmtree(home/'.claude/skills',ignore_errors=True)
   binary=os.environ.get('GREYBEARD_CLAUDE_BINARY') or shutil.which('claude') or str(Path.home()/'.local/bin/claude')
   env.update(CLAUDE_CONFIG_DIR=str(home/'.claude'),ANTHROPIC_API_KEY='synthetic-local-endpoint',ANTHROPIC_BASE_URL=endpoint,ENABLE_CLAUDEAI_MCP_SERVERS='false',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC='1')
   cmd=[binary,'-p',prompt,'--output-format','stream-json','--verbose','--no-session-persistence','--tools','']
  elif host=='copilot':
   env.update(COPILOT_OFFLINE='true',COPILOT_PROVIDER_BASE_URL=endpoint+'/v1',COPILOT_PROVIDER_TYPE='openai',COPILOT_MODEL='gpt-4.1')
   cmd=[binary,'-p',prompt,'--output-format','json','--no-auto-update','--disable-builtin-mcps']
  else:
   settings=home/'.gemini/settings.json';config=json.loads(settings.read_text());config['security']={'auth':{'selectedType':'gemini-api-key'}};
   settings.write_text(json.dumps(config))
   env.update(GEMINI_API_KEY='synthetic-local-endpoint',GOOGLE_GEMINI_BASE_URL=endpoint,GEMINI_TELEMETRY_ENABLED='false',GEMINI_CLI_TRUST_WORKSPACE='true')
   cmd=[binary,'-p',prompt,'--model','gemini-2.5-flash','--output-format','json']
  try:
   p=subprocess.run(cmd,cwd=work,env=env,capture_output=True,text=True,timeout=90);code=p.returncode;err=p.stderr;out=p.stdout
  except subprocess.TimeoutExpired as e:
   code=124;err=str(e.stderr or '');out=str(e.stdout or '')
  ledger=json.loads(subprocess.check_output(['node',str(ROOT/'scripts/evaluate-automatic-state.mjs'),str(app)],text=True))
  phase='preference';prompt='We always require a recovery owner before a production rollout.'
  preference_cmd=cmd.copy();preference_cmd[preference_cmd.index('-p')+1]=prompt
  try:
   preference=subprocess.run(preference_cmd,cwd=work,env=env,capture_output=True,text=True,timeout=90)
   preference_code=preference.returncode
  except subprocess.TimeoutExpired: preference_code=124
  final_state=json.loads(subprocess.check_output(['node',str(ROOT/'scripts/evaluate-automatic-state.mjs'),str(app)],text=True))
  candidates=[node for node in final_state['memories'] if node['content']==prompt and node['status']=='candidate']
  checks={'recall':code==0 and any(r['phase']=='recall' and r['hasConfirmedLesson'] and r['hasOriginalPrompt'] for r in requests),'preference':preference_code==0 and len(candidates)==1 and any(r['phase']=='preference' and r['hasCandidateNotice'] and r['hasOriginalPrompt'] for r in requests)}
  if not all(checks.values()):failures.append(host)
  def clean(s):return s.replace(temp,'<isolated>').replace(str(ROOT),'<repository>').replace(str(Path.home()),'<home>')
  import hashlib
  hashes={p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in ['cli/dist/automaticMentor.js','cli/dist/automaticHooks.js','memory/dist/automatic.js']}
  result={'checks':checks,'preferenceExitCode':preference_code,'preferenceState':final_state,'sourceHashes':hashes,'version':subprocess.check_output([binary,'--version'],text=True).strip(),'host':host,'exitCode':code,'requests':requests,'automatic':ledger,'stderr':clean(err),'stdout':clean(out),'method':'Actual CLI connected to a local synthetic response server. No model reasoning evaluated, no account authentication or tenant tools. Gemini workspace trust is enabled only for the generated temporary fixture. Only request booleans are retained, not full host system prompts.'}
  (OUT/(host+'.json')).write_text(json.dumps(result,indent=2)+'\n');print(host,checks,requests,flush=True)
 server.shutdown()

if failures:raise SystemExit("Native transport checks failed: "+", ".join(failures))
