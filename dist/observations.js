// Rebuild the seat's input from immutable event and chat prefixes in the replay.
import {lockedRunout,transcript} from './table-state.js';
import {digest} from './engine.js';

const journals=new WeakMap();
export function setDecisionJournal(session,write){journals.set(session,write);}

export function publicCards(event) {
  const shown=new Map((event.shown||[]).map(p=>[p.name,p.cards]));
  if(lockedRunout(event))for(const p of event.players)if(!p.folded)shown.set(p.name,p.cards);
  return Object.fromEntries(shown);
}

export function historyEntry(e){
  const entry={index:e.index,hand:e.hand,street:e.street,type:e.type,text:e.text};
  if(e.type==='deal')Object.assign(entry,{button:e.button,smallBlindSeat:e.small,bigBlindSeat:e.big,startingStacks:e.players.map(p=>({name:p.name,stack:p.stack+p.total}))});
  if(e.type==='board')entry.board=e.board;
  if(e.type==='action'){
    const p=e.players[e.seat];
    Object.assign(entry,{speaker:e.speaker,seat:e.seat,action:e.move.action,streetBet:p.streetBet,stack:p.stack,responseSeconds:e.responseSeconds,pot:e.pot});
    if(e.source)entry.source=e.source;
  }
  if(e.chat)entry.chat=e.chat;
  if(e.type==='result')Object.assign(entry,{shown:e.shown,pots:e.pots,awards:e.awards});
  const exposed=publicCards(e);
  if(Object.keys(exposed).length)entry.exposedCards=exposed;
  return entry;
}

export function takeReceipt(s,name,kind,legal){
  const e=s.events.at(-1);
  const own=s.decisions?.findLast(d=>d.name===name && d.kind==='bet' && d.status==='returned' && d.report?.strategy && (s.rules.format!=='duplicate'||d.hand===e.hand));
  return {id:crypto.randomUUID(),name,kind,hand:e.hand,event:e.index,chatCount:s.tableChat?.length||0,
    dispatchedAt:Date.now(),status:'pending',clock:structuredClone(s.clocks||{}),presence:s.seatPresence||'present',presenceCount:s.presenceEvents?.length||0,
    ...(s.waitingFor?{acting:s.waitingFor,turnStartedAt:s.turnStartedAt}:{}),
    ...(legal?{legal:structuredClone(legal)}:{}),...(own?{strategy:own.report.strategy}:{})};
}

export function observation(s,r){
  const e=s.events[r.event], duplicate=s.rules.format==='duplicate';
  const events=s.events.slice(0,r.event+1).filter(p=>!duplicate||p.hand===e.hand);
  const seat=e.players.findIndex(p=>p.name===r.name);
  const chat=transcript({events,eventTimes:s.eventTimes,tableChat:(s.tableChat||[]).slice(0,r.chatCount)},r.event).filter(m=>!duplicate||m.hand===e.hand);
  const view={hand:e.hand,street:e.street,seat,name:r.name,cards:e.players[seat].cards,board:e.board,pot:e.pot,
    button:e.button,smallBlind:s.rules.sb,bigBlind:s.rules.sb*2,smallBlindSeat:e.small,bigBlindSeat:e.big,
    players:e.players.map(({cards,...p})=>p),exposedCards:publicCards(e),history:events.map(p=>({...historyEntry(p),publishedAt:s.eventTimes?.[p.index]})),
    ownPastHands:events.filter(p=>p.type==='deal'&&p.hand<e.hand).map(p=>({hand:p.hand,cards:p.players.find(q=>q.name===r.name).cards})).filter(p=>p.cards.length),
    tableChat:chat,tableClock:{unit:'seconds',resolution:0.1,baseSeconds:30,bankSeconds:r.clock,source:'Dealer elapsed time includes network and provider latency'},
    presenceHistory:(s.presenceEvents||[]).slice(0,r.presenceCount).filter(p=>!duplicate||p.event>=events[0].index),lineup:s.lineup.map(name=>({name,kind:s.models?.[name]?.kind,model:s.models?.[name]?.model})),humanSeat:s.humanName||null,humanPresence:r.presence,acting:r.acting||null,turnStartedAt:r.turnStartedAt||null,
    observedAt:r.dispatchedAt,privateStrategy:r.strategy||'',rules:s.rules};
  if(r.legal)view.legal=r.legal;
  if(r.kind==='chat')view.conversation=chat;
  return view;
}

export function decisionReport(raw){
  const report={};
  for(const key of ['summary','strategy'])if(typeof raw?.[key]==='string' && raw[key].trim())report[key]=Array.from(raw[key].trim()).slice(0,320).join('');
  return Object.keys(report).length?report:null;
}

export async function recordDecision(s,name,kind,legal,request,signal,id){
  const row=takeReceipt(s,name,kind,legal);
  if(id)row.id=id;
  s.decisions.push(row);
  const finish=(status)=>Object.assign(row,{status,returnedAt:Date.now(),returnEvent:s.events.at(-1).index});
  // Freeze delivery boundaries before any asynchronous work, including other seats' replies.
  const journal=journals.get(s);
  const view=observation(s,row);
  const hashed=digest(JSON.stringify(view));
  try{
    journal?.(row);
    const answer=await request(view);
    signal.throwIfAborted();
    if(kind==='chat'){
      const chat=typeof answer==='string'?answer:answer?.chat;
      if(typeof chat!=='string'||[...chat.trim()].length>180)throw Error('Invalid chat reply');
      row.output={chat:chat.trim()};
      const summary=decisionReport(answer?.report)?.summary;
      if(summary)row.report={summary};
    }else{
      row.output={action:answer.action,amount:answer.amount,chat:answer.chat,showCards:answer.showCards||null};
      row.report=decisionReport(answer.report);
    }
    finish('returned');return kind==='chat'?row.output.chat:answer;
  }catch(error){
    finish(signal.aborted?'cancelled':error.name==='TimeoutError'?'timeout':'failed');
    throw error;
  }finally{row.inputDigest=await hashed;journal?.(row);}
}
