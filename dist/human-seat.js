import { NAMES, checkLineup, validateMove, TURN_LIMIT_SECONDS } from './engine.js';

import {lockedRunout} from './table-room.js';

export function chooseSeat(names,seat,options){
  if(!seat || !NAMES.includes(seat.slot))throw Error('Choose a seat to play.');
  if(options.format==='duplicate')throw Error('Use continuous stacks for a human seat. Duplicate rotations expose the same deal.');
  const lineup=[...names];
  lineup[NAMES.indexOf(seat.slot)]=seat.name;
  return checkLineup(lineup);
}

export class HumanSeat {
  turn=null;
  #accept=null;

  wait(view,signal,onTimeout){
    signal.throwIfAborted();
    const turn={id:crypto.randomUUID(),legal:view.legal,expiresAt:Date.now()+TURN_LIMIT_SECONDS*1000};
    this.turn=turn;
    return new Promise((resolve,reject)=>{
      const clear=()=>{
        clearTimeout(timer);
        signal.removeEventListener('abort',cancel);
        this.turn=null;
        this.#accept=null;
      };
      const cancel=()=>{clear();reject(signal.reason);};
      this.#accept=move=>{clear();resolve(move);};
      const timer=setTimeout(()=>{
        const action=view.legal.check?'check':'fold';
        onTimeout(action);
        this.#accept({action,amount:0,chat:''});
      },TURN_LIMIT_SECONDS*1000);
      signal.addEventListener('abort',cancel,{once:true});
    });
  }

  submit({turnId,move}){
    if(!this.turn || this.turn.id!==turnId)throw Error('This turn has ended.');
    this.#accept(validateMove(move,this.turn.legal));
  }
}

export function recordTimeout(session,name,action){
  session.incidents??=[];
  session.incidents.push({event:session.events.length,seat:name,error:'Turn expired. The dealer selected '+action+'.'});
}

export function activeSession(s){return s.status==='running'||s.status==='paused';}

// Only showdown cards and the owner's own cards cross the dealer boundary during play.
export function sessionView(session,from,owner,turn,wasPrivate=false){
  const {events,...metadata}=session;
  const privateTable=!!session.humanName && activeSession(session);
  const replaceHistory=wasPrivate&&!privateTable;
  const visible=events.slice(replaceHistory?0:from);
  if(!privateTable)return {...metadata,events:visible,...(replaceHistory?{replaceHistory:true}:{})};
  const name=owner?session.humanName:null;
  return {...metadata,privateTable:true,mySeat:name,turn:owner?turn:null,events:visible.map(event=>{
    const shown=new Set((event.shown||[]).map(p=>p.name));
    if(lockedRunout(event))for(const p of event.players)if(!p.folded)shown.add(p.name);
    return {...event,players:event.players.map(p=>p.name===name||shown.has(p.name)?p:{...p,cards:[],hiddenCount:p.cards.length})};
  })};
}
