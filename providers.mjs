import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SYSTEM, TURN_LIMIT_SECONDS, validateMove } from './dist/engine.js';

export const baseConfig = {
  Astra:{kind:'codex',model:'gpt-6.2-astra',url:''},
  Opus:{kind:'anthropic',model:'',url:'https://api.anthropic.com/v1/messages'},
  Muse:{kind:'compatible',model:'',url:''},
  Gemini:{kind:'compatible',model:'',url:'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'},
  Jev:{kind:'compatible',model:'',url:''}
};
export function parseReply(raw) {
  if(typeof raw!=='string')throw Error('Empty provider reply');
  return JSON.parse(raw.trim().replace(/^\x60\x60\x60(?:json)?\s*/i,'').replace(/\s*\x60\x60\x60$/,''));
}
export async function fromCodex(model,view,signal) {
  const dir=await mkdtemp(path.join(tmpdir(),'river-room-seat-'));
  try {
    const out=path.join(dir,'reply.json');
    const args=['exec','--ignore-user-config','--ignore-rules','--ephemeral','--skip-git-repo-check','-s','read-only','-C',dir,'-m',model,
      '-c','forced_login_method="chatgpt"','-c','web_search="disabled"','-c','approval_policy="never"','-c','project_doc_max_bytes=0',
      ...['apps','shell_tool','browser_use','computer_use','in_app_browser','multi_agent','multi_agent_v2','hooks','memories','js_repl','image_generation','skill_search'].flatMap(x=>['--disable',x]),
      '--json','-o',out,'-'];
    const env=Object.fromEntries(['HOME','PATH','CODEX_HOME','TMPDIR','LANG','USER','LOGNAME','SYSTEMROOT','USERPROFILE'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
    await new Promise((resolve,reject)=>{
      const child=spawn('codex',args,{cwd:dir,env,stdio:['pipe','pipe','ignore'],signal});
      let line='',usedTool=false;
      child.stdout.setEncoding('utf8');
      child.stdout.on('data',chunk=>{
        const lines=(line+chunk).split('\n');line=lines.pop();
        for(const entry of lines){
          let event;try{event=JSON.parse(entry);}catch{continue;}
          if(event.type?.startsWith('item.') && event.item && !['agent_message','reasoning','plan'].includes(event.item.type)){
            usedTool=true;child.kill();
          }
        }
      });
      child.on('error',reject);
      child.once('close',code=>usedTool?reject(Error('Codex attempted a tool call. Turn discarded.')):code===0?resolve():reject(Error('Codex turn failed. Check the model ID, ChatGPT login, subscription limits, and CLI version.')));
      child.stdin.on('error',()=>{});
      child.stdin.end(SYSTEM+'\n'+JSON.stringify(view));
    });
    return parseReply(await readFile(out,'utf8'));
  }finally{await rm(dir,{recursive:true,force:true});}
}
export async function providerMove(config,view,stopSignal) {
  const signal=AbortSignal.any([stopSignal,AbortSignal.timeout(TURN_LIMIT_SECONDS*1000)]);
  if(config.kind==='codex')return validateMove(await fromCodex(config.model,view,signal),view.legal);
  const anthropic=config.kind==='anthropic';
  const messages=[{role:'user',content:JSON.stringify(view)}];
  const body=anthropic?{model:config.model,system:SYSTEM,max_tokens:1600,messages}:{model:config.model,messages:[{role:'system',content:SYSTEM},...messages]};
  const headers=anthropic?{'x-api-key':config.key,'anthropic-version':'2023-06-01'}:{Authorization:'Bearer '+config.key};
  const res=await fetch(config.url,{method:'POST',headers:{...headers,'Content-Type':'application/json'},redirect:'error',body:JSON.stringify(body),signal});
  if(!res.ok)throw Error('Provider returned HTTP '+res.status+'. Check credentials, quota, and model ID.');
  const data=await res.json();
  const raw=anthropic?data.content?.filter(x=>x.type==='text').map(x=>x.text).join(''):data.choices?.[0]?.message?.content;
  return validateMove(parseReply(raw),view.legal);
}
