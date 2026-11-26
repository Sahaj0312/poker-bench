import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {verify} from '../dist/recordings.js';

test('local model session pauses on provider failure, retries, records, and reopens after restart',async t=>{
  const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const dir=await mkdtemp(path.join(tmpdir(),'river-room-integration-'));
  const socket=http.createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');
  const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
  const origin='http://127.0.0.1:'+port;
  await writeFile(path.join(dir,'codex'),`#!/usr/bin/env node
const fs=require('node:fs');const a=process.argv;let raw='';process.stdin.on('data',d=>raw+=d);
process.stdin.on('end',()=>{const v=JSON.parse(raw.slice(raw.indexOf('\\n')+1));fs.writeFileSync(a[a.indexOf('-o')+1],JSON.stringify({action:v.legal.check?'check':'call',amount:0,chat:'Test message'}));});
`,{mode:0o700});
  const mock=path.join(dir,'wire.mjs');
  await writeFile(mock,`const original=globalThis.fetch;
globalThis.fetch=async (url,opt)=>{if(!String(url).startsWith('https://fixture.invalid/'))return original(url,opt);
  if(Object.values(opt.headers).some(v=>String(v).includes('invalid-fixture-key')))return new Response('',{status:401});
  if(String(url).endsWith('/models'))return Response.json({data:[{id:'test-model'},{id:'second-model'}]});
  const b=JSON.parse(opt.body),v=b.state??JSON.parse(b.messages.at(-1).content);
  if(b.questions){
    if(!b.questions.move.criteria.check && !b.questions.move.criteria.call)throw Error('Missing choice options');
    return Response.json({answers:{move:{choice:v.legal.check?'check':'call'}}});
  }
  if(v.players.some(p=>p.cards)||v.deck||v.seed)throw Error('Private state leaked');
  if(!v.tableClock||v.history.some(e=>e.type==='action'&&!Number.isFinite(e.responseSeconds)))throw Error('Missing public timing');
  const text=JSON.stringify({action:v.legal.check?'check':'call',amount:0,chat:'Test message'});
  return Response.json(b.system?{content:[{type:'text',text}]}:{choices:[{message:{content:text}}]});};`);
  let server;
  const start=async()=>{server=spawn(process.execPath,['--import',mock,path.join(root,'server.mjs')],{env:{...process.env,PORT:String(port),PATH:dir+path.delimiter+process.env.PATH,RIVER_DATA_DIR:path.join(dir,'data')},stdio:['ignore','pipe','inherit']});await once(server.stdout,'data');};
  const stop=async()=>{if(server?.exitCode===null&&server.signalCode===null){const done=once(server,'exit');server.kill();await done;}};
  t.after(async()=>{await stop();await rm(dir,{recursive:true,force:true});});
  const api=async(endpoint,body)=>{const r=await fetch(origin+'/api/'+endpoint,body===undefined?{}:{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});assert.ok(r.ok,'HTTP '+r.status);return r.json();};
  const until=async(id,status)=>{for(let i=0;i<300;i++){const s=await api('sessions/'+id);if(s.status===status)return s;await new Promise(r=>setTimeout(r,20));}throw Error('Timed out waiting for '+status);};
  await start();
  const conf=(await api('config')).players;
  for(const [name,c] of Object.entries(conf)){c.model='test-model';if(name!=='Astra'){c.url='https://fixture.invalid/'+name;c.key=name==='Opus'?'invalid-fixture-key':'fixture-key';}}
  const saved=await api('config',conf);assert.ok(!JSON.stringify(saved).includes('fixture-key'));
  const {id}=await api('sessions',{hands:1,stack:300,sb:5});
  const paused=await until(id,'paused');assert.equal(paused.waitingFor,'Opus');assert.ok(!paused.seed);
  conf.Opus.key='fresh-fixture-key';await api('config',conf);await api('sessions/'+id+'/retry',{});
  const complete=await until(id,'complete');assert.equal(complete.incidents.length,1);
  assert.ok(complete.events.filter(e=>e.type==='action').every(e=>Number.isFinite(e.responseSeconds)));
  assert.equal(await verify(complete),complete.events.length);
  assert.equal(complete.betSizing,'shared-menu-v1');
  assert.ok(complete.events.filter(e=>e.speaker==='Jev').every(e=>e.chat===''));
  const raw=await readFile(path.join(dir,'data',id+'.jsonl'),'utf8');assert.ok(!raw.includes('fixture-key'));
  await stop();await start();const reopened=await api('sessions/'+id);assert.deepEqual(reopened.events,complete.events);assert.equal(reopened.status,'complete');
  // Change all five seats to API models, including the original Codex slot.
  for(const [i,slot] of Object.keys(conf).entries()){
    conf[slot]={name:'Lab '+(i+1),kind:'compatible',model:'second-model',url:'https://fixture.invalid/v1/chat/completions',key:'another-fixture-key'};
  }
  await api('config',conf);
  const catalog=await api('models',{...conf.Astra,slot:'Astra',key:''});
  assert.deepEqual(catalog.models,['second-model','test-model']);
  const second=await api('sessions',{hands:1,stack:200,sb:5});
  const changed=await until(second.id,'complete');
  assert.deepEqual(changed.lineup,Object.values(conf).map(c=>c.name));
  assert.equal(changed.models['Lab 1'].model,'second-model');
  assert.equal(await verify(changed),changed.events.length);
  conf.Astra.url='https://fixture.invalid/other/chat/completions';conf.Astra.key='';
  const updated=await api('config',conf);
  assert.equal(updated.players.Astra.hasKey,false);
});
