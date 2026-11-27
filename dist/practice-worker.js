import { simulate, demoPolicy, makeSeed, NAMES, defaults } from './engine.js';
import { chooseSeat, HumanSeat, recordTimeout, sessionView } from './human-seat.js';

import { tableConversation, practiceReply, showHandEnd } from './table-room.js';
import {recordDecision} from './observations.js';
import {BASE_SECONDS,initClocks,seatPresence,spendBank} from './seat-clock.js';
import {evidenceDigest} from './recordings.js';
let session, stop, room, presence;
const seat=new HumanSeat();

async function start(input){
  const rules=defaults(input);
  const lineup=chooseSeat(NAMES,input.human,rules);
  const name=input.human.name, seed=makeSeed(), bot=demoPolicy(seed);
  stop=new AbortController();
  const models=Object.fromEntries(lineup.map(n=>[n,n===name?{kind:'human',model:'Human'}:{kind:'demo',model:'Demo policy'}]));
  let ready,fail;
  const started=new Promise((ok,no)=>{ready=ok;fail=no;});
  simulate({seed,mode:'practice',lineup,models,options:rules,availability:()=>presence.absent(),
    onStart:s=>{
      session=s;s.humanName=name;s.releasing=true;s.auditVersion=1;s.decisions=[];s.eventTimes=[];
      initClocks(s);presence=seatPresence(s,stop.signal);
      room=tableConversation(s,practiceReply,stop.signal);
    },
    onEvent:async event=>{session.eventTimes.push(Date.now());room.observe(event);ready(session.id);await showHandEnd(event,rules,stop.signal);},
    decide:async view=>{
      stop.signal.throwIfAborted();
      session.waitingFor=view.name;session.turnStartedAt=Date.now();
      const start=Date.now();
      try{
        if(view.name===name && session.seatPresence==='left')return {action:view.legal.check?'check':'fold',amount:0,chat:'',source:'away'};
        if(view.name===name)return await seat.wait(view,stop.signal,a=>recordTimeout(session,name,a),BASE_SECONDS+session.clocks[name]);
        return await recordDecision(session,view.name,'bet',view.legal,bot,stop.signal);
      }finally{spendBank(session,view.name,start);delete session.turnStartedAt;delete session.waitingFor;}
    }
  }).catch(error=>{
    if(session){session.status=stop.signal.aborted?'stopped':'interrupted';session.seed=seed;}
    fail(error);
  }).finally(async()=>{
    stop.abort();if(session){await room.flush();session.evidenceDigest=await evidenceDigest(session);delete session.releasing;}
  });
  return {id:await started};
}

self.onmessage=async({data:{id,method,value}})=>{
  try{
    let result;
    if(method==='start')result=await start(value);
    else if(method==='read'){presence.heartbeat();result=sessionView(session,value.from,true,seat.turn,value.wasPrivate);}
    else if(method==='presence')presence.set(value.away);
    else if(method==='leave'){presence.leave();seat.leave();}
    else if(method==='chat' && session.seatPresence!=='left')await room.send(value);
    else if(method==='move')seat.submit(value);
    else if(method==='stop')stop.abort();
    else throw Error('Unknown practice control.');
    self.postMessage({id,result});
  }catch(error){self.postMessage({id,error:error.message});}
};
