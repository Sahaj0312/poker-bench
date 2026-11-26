import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { simulate,makeSeed,defaults,NAMES } from './dist/engine.js';
import { baseConfig,providerMove } from './providers.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const data=process.env.RIVER_DATA_DIR||path.join(root,'data');
await fs.mkdir(data,{recursive:true,mode:0o700});
const configFile=path.join(data,'players.json');
let saved={};try{saved=JSON.parse(await fs.readFile(configFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
const config=()=>Object.fromEntries(NAMES.map(n=>[n,{...baseConfig[n],...saved[n],key:saved[n]?.key||process.env['RIVER_'+n.toUpperCase()+'_KEY']||''}]));
const safeConfig=c=>Object.fromEntries(Object.entries(c).map(([n,{key,...rest}])=>[n,{...rest,hasKey:!!key}]));
let current=null, wake=null, abort=null, task=null;
const filename=id=>path.join(data,id+'.jsonl');
async function append(id,line){await fs.appendFile(filename(id),JSON.stringify(line)+'\n',{mode:0o600});}
async function load(id){
  if(current?.id===id)return current;
  if(!/^[0-9a-f-]{36}$/.test(id))throw Error('Unknown session');
  const lines=(await fs.readFile(filename(id),'utf8')).split('\n');
  const session=JSON.parse(lines.shift()).meta;session.events=[];session.status='interrupted';
  for(const line of lines.filter(Boolean)){
    let row;try{row=JSON.parse(line);}catch{break;}
    if(row.event)session.events.push(row.event);if(row.finish)Object.assign(session,row.finish);
  }
  return session;
}
async function run(options,players){
  const seed=makeSeed(), id=crypto.randomUUID();
  const stop=new AbortController();abort=stop;
  let ready,fail;const started=new Promise((a,b)=>{ready=a;fail=b;});
  const models=Object.fromEntries(NAMES.map(n=>[n,{kind:players[n].kind,model:players[n].model,endpoint:players[n].url}]));
  task=simulate({id,seed,options,mode:'models',models,
    onStart:async session=>{current=session;await append(id,{meta:{...session,events:[]}});ready();},
    onEvent:async event=>{await append(id,{event});},
    decide:async view=>{
      for(;;){
        stop.signal.throwIfAborted();current.status='running';current.waitingFor=view.name;delete current.error;
        try{
          const frozen=players[view.name], updated=config()[view.name];
          const seatConfig=updated.url===frozen.url?{...frozen,key:updated.key}:frozen;
          return await providerMove(seatConfig,view,stop.signal);
        }catch(e){
          stop.signal.throwIfAborted();
          current.status='paused';current.error=view.name+' — '+(e instanceof SyntaxError?'Provider returned invalid JSON.':e.message);
          current.incidents??=[];current.incidents.push({event:current.events.length,seat:view.name,error:current.error});
          await new Promise(resolve=>{wake=resolve;});wake=null;
        }
      }
    }
  }).then(async result=>{delete result.waitingFor;await append(id,{finish:{status:'complete',seed,incidents:result.incidents||[]}});})
    .catch(async e=>{
      fail(e);
      if(current?.id===id){current.status=stop.signal.aborted?'stopped':'interrupted';current.seed=seed;delete current.waitingFor;
        await append(id,{finish:{status:current.status,seed,incidents:current.incidents||[]}});}
    }).finally(()=>{task=null;abort=null;wake=null;});
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
      if(req.method==='POST' && (req.headers.origin!=='http://'+host || !req.headers['content-type']?.startsWith('application/json')))return json(res,403,{error:'Use the local River Room UI'});
      if(req.method==='GET'&&p==='/api/config')return json(res,200,{players:safeConfig(config()),current:current?.id});
      if(req.method==='POST'&&p==='/api/config'){
        const incoming=await body(req), next={}, old=config();
        for(const n of NAMES){
          const row=incoming[n];if(!row)throw Error('Missing '+n);
          const kind=n==='Astra'?'codex':row.kind;
          if(!['codex','compatible','anthropic'].includes(kind)||(n!=='Astra'&&kind==='codex'))throw Error('Unknown provider');
          const model=String(row.model||'').trim(), endpoint=kind==='codex'?'':String(row.url||'').trim();
          if(endpoint){const u=new URL(endpoint);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)throw Error('Use an HTTPS endpoint without credentials or query parameters.');}
          if(endpoint!==old[n].url && old[n].key && !row.key)throw Error('Enter a fresh key for '+n+' when changing its endpoint.');
          next[n]={kind,model,url:endpoint,key:row.key||saved[n]?.key||''};
        }
        const temp=configFile+'.'+crypto.randomUUID();await fs.writeFile(temp,JSON.stringify(next),{mode:0o600});await fs.rename(temp,configFile);saved=next;
        return json(res,200,{players:safeConfig(config())});
      }
      if(req.method==='POST'&&p==='/api/sessions'){
        const options=defaults(await body(req)), players=config();
        if(task)return json(res,409,{error:'A model session is already running.'});
        const missing=NAMES.filter(n=>!players[n].model||(n!=='Astra'&&(!players[n].key||!players[n].url)));
        if(missing.length)throw Error('Configure these seats first: '+missing.join(', '));
        return json(res,201,{id:await run(options,players)});
      }
      if(req.method==='GET'&&p==='/api/sessions'){
        const ids=(await fs.readdir(data)).filter(f=>f.endsWith('.jsonl')).map(f=>f.slice(0,-6));
        const sessions=await Promise.all(ids.map(async id=>{const {events,...meta}=await load(id);return {...meta,count:events.length};}));
        return json(res,200,sessions);
      }
      const match=p.match(/^\/api\/sessions\/([0-9a-f-]{36})(?:\/(retry|stop))?$/);
      if(match && req.method==='GET' && !match[2]){
        const {events,...meta}=await load(match[1]);return json(res,200,{...meta,events:events.slice(Math.max(0,Number(url.searchParams.get('from'))||0))});
      }
      if(match && req.method==='POST' && current?.id===match[1] && task){
        if(match[2]==='retry'&&wake)wake();
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
app.listen(port,'127.0.0.1',()=>console.log('River Room is open at http://localhost:'+port));
