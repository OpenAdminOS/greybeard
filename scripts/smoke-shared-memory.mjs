// Real TLS, native OS credential storage, two isolated clients, and packaged headless server.
// Run on Linux inside an isolated unlocked Secret Service session. No personal data is used.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createServer as httpsServer } from 'node:https';
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { SharedServerStore } from '../cli/dist/sharedServer.js';
import { pairMemory, RemoteMemory, disconnectMemory } from '../cli/dist/sharedMemory.js';

if (process.argv[2] === 'client') {
  let input=''; for await (const part of process.stdin) input+=part;
  const {appData,url,code,action}=JSON.parse(input);
  const binding=await pairMemory(appData,url,code);
  try {
    const agent=new RemoteMemory(appData,binding); const review=new RemoteMemory(appData,binding,true);
    if(action==='propose') {
      const record=await agent.remember({type:'preference',content:'Windows compliance pilot requires helpdesk review.'});
      const node=(await review.export()).nodes.find(n=>n.id===record.id);
      assert.equal(node.status,'candidate');
      assert.equal((await agent.recall({query:'Windows compliance pilot'})).results.length,0);
      await review.confirm({id:node.id,expectedRevision:node.revision});
      process.stdout.write('proposed-and-reviewed\n');
    } else {
      assert.equal((await agent.recall({query:'Windows compliance pilot'})).results.length,1);
      const child=spawn(process.execPath,[resolve('cli/dist/index.js'),'mentor','event','--host','claude','--event','prompt'],{env:{...process.env,GREYBEARD_APP_DATA:appData},stdio:['pipe','pipe','pipe']});
      let output='',errors='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>errors+=b);
      const start=Date.now();child.stdin.end(JSON.stringify({session_id:'native-second-client',prompt:'Plan a Windows compliance pilot.',transcript_path:'/nonexistent/transcript'}));
      const [status]=await once(child,'exit');assert.equal(status,0,errors);assert.match(output,/helpdesk review/);assert(Date.now()-start<2000,'Hook completed within the host budget including process launch.');
      process.stdout.write('second-client-recall-and-hook\n');
    }
  } finally {assert.equal((await disconnectMemory(appData)).revoked,true);}
} else {
  const root=await mkdtemp(join(tmpdir(),'greybeard-shared-native-'));let child;let proxy;let admin;
  try {
    const data=join(root,'server');await mkdir(data,{mode:0o700});
    const cert=join(root,'cert.pem'),key=join(root,'key.pem');
    execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1,DNS:localhost'],{stdio:'ignore'});
    const reserve=createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');const backendPort=reserve.address().port;await new Promise(r=>reserve.close(r));
    proxy=httpsServer({cert:await readFile(cert),key:await readFile(key)},(req,res)=>{
      const upstream=httpRequest({hostname:'127.0.0.1',port:backendPort,path:req.url,method:req.method,headers:{...req.headers,host:`127.0.0.1:${backendPort}`}},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});
      upstream.on('error',()=>{res.writeHead(503);res.end('{}');});req.pipe(upstream);res.on('close',()=>upstream.destroy());
    });proxy.listen(0,'127.0.0.1');await once(proxy,'listening');const url=`https://127.0.0.1:${proxy.address().port}`;
    admin=new SharedServerStore(data);
    const binary=join(root,'greybeard');await copyFile(resolve('dist/executable/greybeard-linux-x64'),binary);
    const env={...process.env,GREYBEARD_APP_DATA:data,PATH:'',DISPLAY:'',WAYLAND_DISPLAY:'',GREYBEARD_UPDATE_MODE:'manual'};
    child=spawn(binary,['server','start','--port',String(backendPort),'--public-url',url,'--app-data',data],{cwd:root,env,stdio:['ignore','pipe','pipe']});
    let stderr='';child.stderr.on('data',b=>stderr+=b);
    await new Promise((done,reject)=>{const timer=setTimeout(()=>reject(Error('Server startup timed out: '+stderr)),15000);child.stderr.on('data',()=>{if(stderr.includes('listening on loopback')){clearTimeout(timer);done();}});child.once('exit',()=>{clearTimeout(timer);reject(Error('Server exited: '+stderr));});});
    for(const [name,action] of [['workstation','propose'],['laptop','recall']]) {
      const processClient=spawn(process.execPath,[resolve('scripts/smoke-shared-memory.mjs'),'client'],{env:{...process.env,NODE_EXTRA_CA_CERTS:cert},stdio:['pipe','pipe','pipe']});
      let output='',errors='';processClient.stdout.on('data',b=>output+=b);processClient.stderr.on('data',b=>errors+=b);
      processClient.stdin.end(JSON.stringify({appData:join(root,name),url,code:admin.enroll('local','local',true),action}));
      const [status]=await once(processClient,'exit');assert.equal(status,0,errors);assert.match(output,action==='propose'?/proposed-and-reviewed/:/second-client-recall-and-hook/);
    }
    assert.equal(admin.devices().filter(d=>!d.revoked).length,0);
    console.log('PASS: packaged headless server outside checkout with empty PATH/display, trusted TLS, native protected credentials, two isolated client processes, candidate review, later MCP/hook recall, and device revocation. Physical multi-machine and native host conversations remain separate release checks.');
  } finally {
    admin?.close();if(child&&child.exitCode===null){child.kill('SIGTERM');await once(child,'exit');}if(proxy)await new Promise(r=>proxy.close(r));await rm(root,{recursive:true,force:true});
  }
}
