// No more betting is possible once the only funded contender has matched all live bets.
export function lockedRunout(event){
  const live=event.players.filter(p=>!p.folded);
  if(event.type==='result'||live.length<2)return false;
  const funded=live.filter(p=>p.stack>0);
  return !funded.length || (funded.length===1 && live.every(p=>p.streetBet<=funded[0].streetBet));
}

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

export function transcript(session,through){
  const lines=[];
  for(const e of session.events){
    if(e.index>through)break;
    if(e.chat)lines.push({index:e.index,speaker:e.speaker,chat:e.chat,hand:e.hand,street:e.street,responseSeconds:e.responseSeconds});
  }
  for(const m of session.tableChat||[]){
    if(m.index>through)break;
    lines.push(m);
  }
  return lines.sort((a,b)=>a.index-b.index);
}

export function tableConversation(session,reply,save=async()=>{}){
  session.tableChat=[];
  async function say(speaker,chat,id){
    const e=session.events.at(-1);
    const message={id,index:e.index,hand:e.hand,street:e.street,speaker,chat};
    await save(message);
    session.tableChat.push(message);
  }
  return async ({text,id})=>{
    if(typeof id!=='string'||!/^[\w-]{1,64}$/.test(id))throw Error('Invalid message ID.');
    if(session.tableChat.some(m=>m.id===id))return;
    if(typeof text!=='string'||!text.trim()||[...text].length>180)throw Error('Enter a message of up to 180 characters.');
    if(session.chatBusy)throw Error('Wait for the current chat reply.');
    if(session.status!=='running' && session.status!=='paused')throw Error('This session has ended.');
    const names=session.events[0].players.map(p=>p.name).filter(n=>n!==session.humanName && session.models[n]?.kind!=='typesafe');
    const words=text.toLowerCase();
    const normalized=' '+words.replace(/[^\p{L}\p{N}_-]+/gu,' ').trim()+' ';
    const addressed=names.find(n=>normalized.includes(' '+n.toLowerCase()+' '));
    const turn=session.tableChat.filter(m=>m.speaker===session.humanName).length;
    const name=addressed||names[turn%names.length];
    session.chatBusy=name||'Dealer';
    session.chatError='';
    try{await say(session.humanName,text.trim(),id);}catch(error){session.chatBusy='';throw error;}
    if(!name){session.chatBusy='';return;}
    // A chat call sees public information only and cannot submit a poker action.
    const event=session.events.at(-1);
    const context={name,hand:event.hand,street:event.street,board:[...event.board],pot:event.pot,
      players:event.players.map(p=>({name:p.name,stack:p.stack,folded:p.folded})),
      conversation:transcript(session,event.index).slice(-18).map(({speaker,chat})=>({speaker,chat})),
      message:{speaker:session.humanName,chat:text.trim()}};
    Promise.resolve().then(()=>reply(name,context)).then(async answer=>{
      if(!['running','paused'].includes(session.status))return;
      if(typeof answer!=='string'||!answer.trim()||[...answer.trim()].length>180)throw Error('Invalid chat reply.');
      await say(name,answer.trim(),crypto.randomUUID());
    }).catch(()=>{session.chatError=name+' could not send a reply.';}).finally(()=>{session.chatBusy='';});
  };
}

export const practiceReply=(_name,context)=>'Hey '+context.message.speaker+'! Good to have you at the table.';
