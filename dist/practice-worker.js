import { simulate, demoPolicy, makeSeed, NAMES, defaults } from './engine.js';
import { chooseSeat, HumanSeat, recordTimeout, sessionView } from './human-seat.js';

import { tableConversation, practiceReply, showHandEnd } from './table-room.js';
let session, stop, room;
const seat=new HumanSeat();

async function start(input){
  const rules=defaults(input);
  const lineup=chooseSeat(NAMES,input.human,rules);
  const name=input.human.name, seed=makeSeed(), bot=demoPolicy(seed);
  stop=new AbortController();
  const models=Object.fromEntries(lineup.map(n=>[n,n===name?{kind:'human',model:'Human'}:{kind:'demo',model:'Demo policy'}]));
  let ready,fail;
  const started=new Promise((ok,no)=>{ready=ok;fail=no;});
  simulate({seed,mode:'practice',lineup,models,options:rules,
    onStart:s=>{session=s;session.humanName=name;room=tableConversation(s,practiceReply,stop.signal);},
    onEvent:async event=>{room.observe(event);ready(session.id);await showHandEnd(event,rules,stop.signal);},
    decide:async view=>{
      stop.signal.throwIfAborted();
      session.waitingFor=view.name;session.turnStartedAt=Date.now();
      try{
        if(view.name===name)return await seat.wait(view,stop.signal,a=>recordTimeout(session,name,a));
        return await bot({...view,tableChat:room.messages(view.hand)});
      }finally{delete session.turnStartedAt;delete session.waitingFor;}
    }
  }).catch(error=>{
    if(session){session.status=stop.signal.aborted?'stopped':'interrupted';session.seed=seed;}
    fail(error);
  }).finally(()=>stop.abort());
  return {id:await started};
}

self.onmessage=async({data:{id,method,value}})=>{
  try{
    let result;
    if(method==='start')result=await start(value);
    else if(method==='read')result=sessionView(session,value.from,true,seat.turn,value.wasPrivate);
    else if(method==='chat')await room.send(value);
    else if(method==='move')seat.submit(value);
    else if(method==='stop')stop.abort();
    else throw Error('Unknown practice control.');
    self.postMessage({id,result});
  }catch(error){self.postMessage({id,error:error.message});}
};
