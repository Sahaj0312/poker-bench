import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { simulate,makeSeed,defaults,NAMES,SYSTEM,checkLineup,demoPolicy } from './dist/engine.js';
import { chooseSeat,HumanSeat,recordTimeout,sessionView } from './dist/human-seat.js';
import { isLoopback } from './dist/connections.js';
import { baseConfig,providerMove,providerChat,CHAT_SYSTEM } from './providers.mjs';
import { tableConversation, practiceReply, showHandEnd } from './dist/table-room.js';
import {CHOICE_SYSTEM} from './dist/provider-input.js';
import {recordDecision,setDecisionJournal} from './dist/observations.js';
import {initClocks,seatPresence,spendBank,BASE_SECONDS} from './dist/seat-clock.js';
import {evidenceDigest} from './dist/recordings.js';
const root=path.dirname(fileURLToPath(import.meta.url));
const data=process.env.RIVER_DATA_DIR||path.join(root,'data');
await fs.mkdir(data,{recursive:true,mode:0o700});
const configFile=path.join(data,'players.json');
let saved={};try{saved=JSON.parse(await fs.readFile(configFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
function envConfig(slot){
  const prefix='RIVER_'+slot.toUpperCase()+'_';
  const base={...baseConfig[slot],name:slot};
  for(const field of ['name','kind','model','url'])if(process.env[prefix+field.toUpperCase()])base[field]=process.env[prefix+field.toUpperCase()];
  return base;
}
function config(){
  return Object.fromEntries(NAMES.map(slot=>{
    const base=envConfig(slot);
    const row={...base,...saved[slot]};
    const sameEndpoint=base.url===row.url && base.kind===row.kind;
    const envKey=sameEndpoint?process.env['RIVER_'+slot.toUpperCase()+'_KEY']:'';
    return [slot,{...row,key:row.key||envKey||''}];
  }));
}
function connection(row,slot){
  const kind=row.kind;
  if(!['codex','compatible','anthropic','typesafe'].includes(kind))throw Error('Choose a supported protocol.');
  const model=String(row.model||'').trim();
  const url=kind==='codex'?'':String(row.url||'').trim();
  if(url){
    const u=new URL(url);
    if((u.protocol!=='https:' && !(u.protocol==='http:' && isLoopback(url))) || u.username||u.password||u.search||u.hash)throw Error('Use HTTPS or a local HTTP endpoint. Keep credentials out of the URL.');
  }
  return {kind,model,url,name:String(row.name??slot).trim()};
}
const safeConfig=c=>Object.fromEntries(Object.entries(c).map(([n,{key,...rest}])=>[n,{...rest,hasKey:!!key}]));
let current=null, wake=null, abort=null, task=null;
const filename=id=>path.join(data,id+'.jsonl');
async function append(id,line){await fs.appendFile(filename(id),JSON.stringify(line)+'\n',{mode:0o600});}
async function load(id){
  if(current?.id===id)return current;
  if(!/^[0-9a-f-]{36}$/.test(id))throw Error('Unknown session');
  const lines=(await fs.readFile(filename(id),'utf8')).split('\n');
  const session=JSON.parse(lines.shift()).meta;session.events=[];session.status='interrupted';
  const attempts=new Map();
  for(const line of lines.filter(Boolean)){
    let row;try{row=JSON.parse(line);}catch{break;}
    if(row.chat)(session.tableChat??=[]).push(row.chat);
    if(row.receipt)attempts.set(row.receipt.id,row.receipt);
    if(row.event){
      session.events.push(row.event);
      if(row.publishedAt)(session.eventTimes??=[])[row.event.index]=row.publishedAt;
    }
    if(row.finish)Object.assign(session,row.finish);
  }
  if(session.status==='interrupted' && attempts.size)session.decisions=[...attempts.values()];
  return session;
}
let human=null,ownerKey=null,room=null,presence=null;
const ownsSeat=req=>!!ownerKey && (req.headers.cookie||'').split(';').some(c=>c.trim()==='pokerSeat='+ownerKey);
async function run(options,players,mode,humanName){
  const seed=makeSeed(), id=crypto.randomUUID();
  const stop=new AbortController();abort=stop;
  human=humanName?new HumanSeat():null;
  ownerKey=humanName?crypto.randomUUID():null;
  const bot=mode==='practice'?demoPolicy(seed):null;
  let ready,fail;const started=new Promise((a,b)=>{ready=a;fail=b;});
  const slots=new Map(NAMES.map(slot=>[players[slot].name,slot]));
  const lineup=checkLineup([...slots.keys()]);
  const models=Object.fromEntries(NAMES.map(slot=>{
    const p=players[slot];return [p.name,{kind:p.kind,model:p.model,endpoint:p.url}];
  }));
  const seatConfig=name=>{
    const slot=slots.get(name), frozen=players[slot], updated=config()[slot];
    return updated.url===frozen.url && updated.kind===frozen.kind?{...frozen,key:updated.key}:frozen;
  };
  let writes=Promise.resolve(),writeError;
  function log(row){
    const snapshot=structuredClone(row);
    writes=writes.then(()=>append(id,snapshot)).catch(error=>{writeError=error;});
    return writes.then(()=>{if(writeError)throw writeError;});
  }
  async function finish(status){
    const s=current;
    stop.abort();await room.flush();
    delete s.turnStartedAt;delete s.waitingFor;s.status=status;
    const released=!humanName || ['complete','stopped'].includes(status);
    if(released)s.seed=seed;
    if(released)s.evidenceDigest=await evidenceDigest(s);
    const saved={status,incidents:s.incidents,clocks:s.clocks,seatPresence:s.seatPresence,presenceEvents:s.presenceEvents,eventTimes:s.eventTimes,availabilityByHand:s.availabilityByHand};
    if(released)Object.assign(saved,{seed,decisions:s.decisions,evidenceDigest:s.evidenceDigest,...(humanName?{events:s.events}:{})});
    await log({finish:saved});
    delete s.releasing;
  }
  task=simulate({id,seed,options,mode,models,lineup,availability:()=>presence?.absent()||[],
    onStart:async session=>{
      current=session;
      session.auditVersion=1;session.decisions=[];session.incidents=[];session.eventTimes=[];initClocks(session);
      session.instructions={bet:SYSTEM,chat:CHAT_SYSTEM,choice:CHOICE_SYSTEM};
      if(humanName){session.humanName=humanName;presence=seatPresence(session,stop.signal);}
      room=tableConversation(session,(name,v,signal)=>bot?practiceReply(name,v):providerChat(seatConfig(name),v,signal),stop.signal,message=>log({chat:message}));
      await log({meta:{...session,events:[]}});
      if(!humanName)setDecisionJournal(session,row=>{log({receipt:row}).catch(()=>{});});
      session.releasing=true;
    },
    onEvent:async event=>{
      current.eventTimes.push(Date.now());
      if(event.type==='deal' && options.format==='duplicate')initClocks(current);
      if(event.type==='action'){
        const receipt=current.decisions.findLast(r=>r.name===event.speaker && r.kind==='bet' && r.appliedEvent===undefined);
        if(receipt)receipt.appliedEvent=event.index;
      }
      delete current.waitingFor;
      const visible=humanName?sessionView(current,event.index,false,null).events[0]:event;
      await log({event:visible,publishedAt:current.eventTimes[event.index]});room.observe(event);
      if(event.index===0)ready();
      if(humanName)await showHandEnd(event,options,stop.signal);
    },
    decide:async (view,restartClock)=>{
      for(;;){
        stop.signal.throwIfAborted();current.status='running';current.waitingFor=view.name;delete current.error;
        const start=Date.now(),seconds=BASE_SECONDS+current.clocks[view.name];
        current.turnStartedAt=start;restartClock();
        const deadline=AbortSignal.timeout(Math.ceil(seconds*1000));
        const signal=AbortSignal.any([deadline,stop.signal]);
        try{
          let answer;
          if(view.name===humanName && current.seatPresence==='left')return {action:view.legal.check?'check':'fold',amount:0,chat:'',source:'away'};
          if(view.name===humanName)answer=await human.wait(view,stop.signal,a=>recordTimeout(current,humanName,a),seconds);
          else answer=await recordDecision(current,view.name,'bet',view.legal,async v=>{
            try{return bot?await bot(v):await providerMove(seatConfig(v.name),v,signal);}
            catch(error){signal.throwIfAborted();throw error;}
          },stop.signal);
          spendBank(current,view.name,start);return answer;
        }catch(e){
          stop.signal.throwIfAborted();
          if(deadline.aborted || e.name==='TimeoutError'){
            const action=view.legal.check?'check':'fold';
            recordTimeout(current,view.name,action);spendBank(current,view.name,start);
            return {action,amount:0,chat:'',source:'timeout'};
          }
          delete current.turnStartedAt;
          current.status='paused';current.error=view.name+' — '+(e instanceof SyntaxError?'Provider returned invalid JSON.':e.message);
          current.incidents.push({event:current.events.length,seat:view.name,error:current.error});
          await new Promise(resolve=>{wake=resolve;});wake=null;
        }finally{delete current.turnStartedAt;}
      }
    }
  }).then(()=>finish('complete'),async e=>{
    fail(e);
    if(current?.id===id)await finish(stop.signal.aborted?'stopped':'interrupted');
  }).catch(error=>{if(current?.id===id){current.status='interrupted';current.error='Could not finalize the recording.';delete current.releasing;}console.error('Recording finalization failed.',error.code||error.name);})
    .finally(()=>{task=null;abort=null;wake=null;human=null;room=null;presence=null;stop.abort();});
  await started;return id;
}
const json=(res,code,value)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
async function body(req){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>32768)throw Error('Request too large');}return JSON.parse(raw||'{}');}
const port=Number(process.env.PORT||4395);
const app=http.createServer(async(req,res)=>{
  try{
    const host=req.headers.host;
    if(!['localhost:'+port,'127.0.0.1:'+port].includes(host))return json(res,403,{error:'Local connections only'});
    const url=new URL(req.url,'http://'+host), p=url.pathname;
    if(p.startsWith('/api/')){
      if(req.method==='POST' && (req.headers.origin!=='http://'+host || !req.headers['content-type']?.startsWith('application/json')))return json(res,403,{error:'Use the local Poker Bench app'});
      if(req.method==='GET'&&p==='/api/config')return json(res,200,{players:safeConfig(config()),current:current?.id});
      if(req.method==='POST'&&p==='/api/config'){
        const incoming=await body(req), next={}, old=config();
        for(const n of NAMES){
          const row=incoming[n];if(!row)throw Error('Missing '+n);
          const c=connection(row,n);
          const same=c.url===old[n].url && c.kind===old[n].kind;
          next[n]={...c,key:c.kind==='codex'?'':String(row.key||(!row.clearKey && same?saved[n]?.key:'')||'')};
        }
        checkLineup(NAMES.map(n=>next[n].name));
        const temp=configFile+'.'+crypto.randomUUID();await fs.writeFile(temp,JSON.stringify(next),{mode:0o600});await fs.rename(temp,configFile);saved=next;
        return json(res,200,{players:safeConfig(config())});
      }
      if(req.method==='POST'&&p==='/api/models'){
        const row=await body(req);
        if(!NAMES.includes(row.slot))throw Error('Unknown seat.');
        const c=connection(row,row.slot),old=config()[row.slot];
        const key=row.key||(!row.clearKey && c.url===old.url && c.kind===old.kind?old.key:'');
        const suffix={compatible:'/chat/completions',anthropic:'/messages',typesafe:'/systemone'}[c.kind];
        if(!suffix||!c.url.endsWith(suffix))throw Error('Enter a model ID for this endpoint.');
        const target=c.url.slice(0,-suffix.length)+'/models';
        const headers={};
        if(c.kind==='anthropic'){headers['x-api-key']=key;headers['anthropic-version']='2023-06-01';}
        else if(key)headers.Authorization='Bearer '+key;
        const result=await fetch(target,{headers,signal:AbortSignal.timeout(12000),redirect:'error'});
        if(!result.ok)throw Error('Model list returned HTTP '+result.status+'. Check the key or enter a model ID.');
        const payload=await result.json();
        const rows=Array.isArray(payload)?payload:payload.data??payload.models;
        if(!Array.isArray(rows))throw Error('Enter the model ID supplied by this provider.');
        const ids=rows.map(m=>typeof m==='string'?m:m.id??m.name).filter(n=>typeof n==='string'&&n.length>0);
        return json(res,200,{models:[...new Set(ids)].sort()});
      }
      if(req.method==='POST'&&p==='/api/sessions'){
        const request=await body(req),options=defaults(request);
        const mode=request.mode??'models';
        if(!['practice','models'].includes(mode))throw Error('Unknown game mode.');
        if(mode==='practice'&&!request.human)throw Error('Choose a seat to practice.');
        if(task)return json(res,409,{error:'A local session is already running.'});
        const players=mode==='practice'?Object.fromEntries(NAMES.map(n=>[n,{name:n,kind:'demo',model:'Demo policy',url:''}])):config();
        const names=NAMES.map(slot=>players[slot].name);
        if(request.human){
          chooseSeat(names,request.human,options);
          players[request.human.slot]={name:request.human.name,kind:'human',model:'Human',url:''};
        }else checkLineup(names);
        if(mode==='models'){
          const ai=NAMES.filter(n=>players[n].kind!=='human');
          for(const slot of ai)connection(players[slot],slot);
          const missing=ai.map(n=>players[n]).filter(p=>!p.model||(p.kind!=='codex'&&(!p.url||(!p.key&&!isLoopback(p.url))))).map(p=>p.name);
          if(missing.length)throw Error('Configure these seats first: '+missing.join(', '));
        }
        const id=await run(options,players,mode,request.human?.name);
        if(ownerKey)res.setHeader('Set-Cookie','pokerSeat='+ownerKey+'; HttpOnly; SameSite=Strict; Path=/api');
        return json(res,201,{id});
      }
      if(req.method==='GET'&&p==='/api/sessions'){
        const ids=(await fs.readdir(data)).filter(f=>f.endsWith('.jsonl')).map(f=>f.slice(0,-6));
        const sessions=await Promise.all(ids.map(async id=>{const s=await load(id);return {id:s.id,mode:s.mode,status:s.status,created:s.created,rules:s.rules,count:s.events.length};}));
        return json(res,200,sessions);
      }
      const match=p.match(/^\/api\/sessions\/([0-9a-f-]{36})(?:\/(retry|stop|move|chat|presence|leave))?$/);
      if(match && req.method==='GET' && !match[2]){
        const s=await load(match[1]),from=Math.max(0,Number(url.searchParams.get('from'))||0);
        const owner=current?.id===s.id && ownsSeat(req);
        if(owner)presence?.heartbeat();
        return json(res,200,sessionView(s,from,owner,human?.turn??null,url.searchParams.has('private')));
      }
      if(match && req.method==='POST' && current?.id===match[1] && task){
        if(human && !ownsSeat(req))return json(res,403,{error:'Only the player who took this seat can act.'});
        if(match[2]==='move'&&human)human.submit(await body(req));
        else if(match[2]==='leave' && presence){presence.leave();human.leave();}
        else if(match[2]==='chat' && human && room && current.seatPresence!=='left')await room.send(await body(req));
        else if(match[2]==='presence' && presence){const {away}=await body(req);if(typeof away!=='boolean')throw Error('Choose a seat state');presence.set(away);}
        else if(match[2]==='retry'&&wake)wake();
        else if(match[2]==='stop'){abort.abort();wake?.();}
        else throw Error('Control unavailable');
        return json(res,200,{ok:true});
      }
      return json(res,404,{error:'Unknown local route'});
    }
    if(req.method!=='GET'&&req.method!=='HEAD')return json(res,405,{error:'Method not allowed'});
    const file=path.resolve(root,'dist','.'+(p==='/'?'/index.html':decodeURIComponent(p)));
    if(!file.startsWith(path.join(root,'dist')+path.sep))return json(res,403,{error:'Invalid path'});
    const bytes=await fs.readFile(file);
    res.writeHead(200,{'Content-Type':({'.js':'text/javascript','.css':'text/css','.html':'text/html','.webp':'image/webp','.svg':'image/svg+xml','.ttf':'font/ttf','.png':'image/png'})[path.extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff'});res.end(bytes);
  }catch(e){json(res,e.code==='ENOENT'?404:400,{error:e.code==='ENOENT'?'Not found':e.message});}
});
app.listen(port,'127.0.0.1',()=>console.log('Poker Bench is open at http://localhost:'+port));
