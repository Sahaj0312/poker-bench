import {recordDecision} from './observations.js';
import {lockedRunout,transcript} from './table-state.js';
export {lockedRunout,transcript};

export async function showHandEnd(event,rules,signal){
  let delay=0;
  if(event.type==='result' && event.hand<rules.hands)delay=event.shown.length?6500:2600;
  else if(event.board.length<5 && lockedRunout(event))delay=1700;
  if(!delay)return;
  signal.throwIfAborted();
  await new Promise((resolve,reject)=>{
    const abort=()=>{clearTimeout(timer);reject(signal.reason);};
    const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},delay);
    signal.addEventListener('abort',abort,{once:true});
  });
}

export function tableConversation(session,consider,signal,save=async()=>{}){
  session.tableChat=[];session.decisions??=[];
  session.chatMode='group';
  const seats=session.lineup.filter(name=>name!==session.humanName && session.models[name]?.kind!=='typesafe')
    .map(name=>({name,timer:null,due:Infinity,depth:Infinity,running:false,nextAllowed:0}));
  const errors=new Map();
  const duplicate=session.rules.format==='duplicate';
  let writes=Promise.resolve();
  const pending=new Set();
  const active=()=>!signal.aborted && ['running','paused'].includes(session.status);

  // Serialize human and model posts so disk, replay and every reader see the same order.
  function post(speaker,chat,id,hand){
    const write=writes.then(async()=>{
      if(!active())throw Error('This session has ended.');
      if(session.tableChat.some(m=>m.id===id))return false;
      const e=session.events.at(-1);
      if(duplicate && hand!==undefined && hand!==e.hand)return false;
      const message={id,sentAt:Date.now(),index:e.index,hand:e.hand,street:e.street,speaker,chat};
      await save(message);
      session.tableChat.push(message);
      return true;
    });
    writes=write.catch(()=>{});
    return write;
  }

  function schedule(seat,delay,depth){
    if(!active())return;
    const due=Math.max(Date.now()+delay,seat.nextAllowed);
    seat.depth=Math.min(seat.depth,depth);
    if(due>=seat.due)return;
    seat.due=due;
    clearTimeout(seat.timer);
    if(!seat.running)seat.timer=setTimeout(()=>think(seat),Math.max(0,due-Date.now()));
  }

  function notifySeats(except,delay,depth=0){
    for(const seat of seats)if(seat.name!==except)schedule(seat,delay+Math.random()*400,depth);
  }

  function think(seat){
    const task=check(seat);pending.add(task);task.finally(()=>pending.delete(task));
  }

  async function check(seat){
    const depth=seat.depth;
    seat.depth=Infinity;seat.due=Infinity;
    if(!active())return;
    const player=session.events.at(-1).players.find(p=>p.name===seat.name);
    if(player && !player.stack && !player.total && (player.last==='Out'||session.events.at(-1).type==='result'))return;
    if(session.status==='paused'){schedule(seat,35000,0);return;}
    seat.running=true;
    // Each seat has its own clock. Coalesce messages received while it is thinking.
    seat.nextAllowed=Date.now()+12000;
    const event=session.events.at(-1);
    let failure='the model request failed';
    try{
      const messageId=crypto.randomUUID();
      const answer=await recordDecision(session,seat.name,'chat',null,view=>consider(seat.name,view,signal),signal,messageId);
      if(typeof answer!=='string'||[...answer.trim()].length>180){
        failure='the model returned an invalid chat message';throw Error(failure);
      }
      failure='the dealer could not save the message';
      if(answer.trim() && active() && await post(seat.name,answer.trim(),messageId,event.hand)){
        // Limit immediate follow-ups. All messages remain visible on the next independent check.
        if(depth<2)notifySeats(seat.name,600,depth+1);
      }
      errors.delete(seat.name);
    }catch(error){
      if(active()){
        if(error?.name==='TimeoutError')failure='the request timed out';
        else if(error instanceof SyntaxError)failure='the model returned invalid JSON';
        const status=/^Provider returned HTTP (\d{3})\./.exec(error?.message);
        if(status)failure='the provider returned HTTP '+status[1];
        errors.set(seat.name,seat.name+' missed a chat check because '+failure+'.');
      }
    }finally{
      session.chatError=errors.size?[...errors.values()].join(' ')+' The dealer will check again.':'';
      seat.running=false;
      const queued=seat.due-Date.now(), nextDepth=seat.depth;
      seat.due=Infinity;seat.depth=Infinity;
      if(Number.isFinite(queued))schedule(seat,queued,nextDepth);
      else schedule(seat,35000+Math.random()*25000,0);
    }
  }

  signal.addEventListener('abort',()=>{for(const seat of seats)clearTimeout(seat.timer);},{once:true});
  return {
    async send({text,id}){
      if(!session.humanName)throw Error('Only a seated player can send chat.');
      if(typeof id!=='string'||!/^[\w-]{1,64}$/.test(id))throw Error('Invalid message ID.');
      if(typeof text!=='string'||!text.trim()||[...text].length>180)throw Error('Enter a message of up to 180 characters.');
      if(await post(session.humanName,text.trim(),id))notifySeats(null,100);
    },
    observe(event){
      if(event.type==='deal')notifySeats(null,1200+Math.random()*2600);
      else if(event.chat)notifySeats(event.speaker,350);
      else if(['board','result','action'].includes(event.type))notifySeats(event.speaker,1000);
    },
    messages(hand){
      return session.tableChat.filter(m=>!duplicate || m.hand===hand);
    },
    flush:async()=>{await Promise.allSettled([...pending]);await writes;}
  };
}

export function practiceReply(name,{conversation,street}){
  const last=conversation.at(-1);
  if(last?.speaker===name || Math.random()>.28)return '';
  const options=last?['I hear you, '+last.speaker+'.','Now I’m curious.','Poker face is staying on.']:
    ['Good luck, everyone.','Anyone else here to see a flop?',street==='River'?'Interesting river.':'How’s the table doing?'];
  const fresh=options.filter(line=>!conversation.some(m=>m.speaker===name && m.chat===line));
  return fresh[Math.floor(Math.random()*fresh.length)]||'';
}
