// No more betting is possible once the only funded contender has matched all live bets.
export function lockedRunout(event){
  const live=event.players.filter(p=>!p.folded);
  if(event.type==='result'||live.length<2)return false;
  const funded=live.filter(p=>p.stack>0);
  return !funded.length || (funded.length===1 && live.every(p=>p.streetBet<=funded[0].streetBet));
}

export function transcript(session,through){
  const lines=[];
  for(const e of session.events){
    if(e.index>through)break;
    if(e.chat)lines.push({id:"move-"+e.index,sentAt:session.eventTimes?.[e.index],index:e.index,speaker:e.speaker,chat:e.chat,hand:e.hand,street:e.street,responseSeconds:e.responseSeconds});
  }
  for(const m of session.tableChat||[]){
    if(m.index>through)break;
    lines.push(m);
  }
  return lines.sort((a,b)=>a.index-b.index);
}

