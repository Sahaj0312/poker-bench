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

  wait(view,signal,onTimeout,seconds=TURN_LIMIT_SECONDS){
    signal.throwIfAborted();
    const turn={id:crypto.randomUUID(),legal:view.legal,expiresAt:Date.now()+seconds*1000};
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
        this.#accept({action,amount:0,chat:'',source:'timeout'});
      },seconds*1000);
      signal.addEventListener('abort',cancel,{once:true});
    });
  }

  leave(){
    if(this.turn)this.#accept({action:this.turn.legal.check?'check':'fold',amount:0,chat:'',source:'away'});
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
  const {events,decisions,seed,releasing,...metadata}=session;
  if(releasing && !activeSession(session))metadata.status='running';
  const privateTable=!!session.humanName && (activeSession(session)||session.status==='interrupted'||releasing);
  const replaceHistory=wasPrivate&&!privateTable;
  const visible=events.slice(replaceHistory?0:from);
  if(!privateTable)return {...metadata,...(seed?{seed}:{}),...(decisions?{decisions}:{}),events:visible,...(replaceHistory?{replaceHistory:true}:{})};
  const name=owner && session.seatPresence!=='left'?session.humanName:null;
  return {...metadata,privateTable:true,mySeat:name,canManage:owner,turn:name?turn:null,events:visible.map(event=>{
    const shown=new Map((event.shown||[]).map(p=>[p.name,p.cards]));
    if(lockedRunout(event))for(const p of event.players)if(!p.folded)shown.set(p.name,p.cards);
    const visible={...event};
    if(event.move){const {showCards,...move}=event.move;visible.move=move;}
    return {...visible,players:event.players.map(p=>p.name===name?p:shown.has(p.name)?{...p,cards:shown.get(p.name)}:{...p,cards:[],hiddenCount:p.hiddenCount??p.cards.length})};
  })};
}
