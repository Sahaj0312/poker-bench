// The dealer owns every chip and card. Agents can submit only a legal move and table talk.
export const NAMES = ['Astra', 'Opus', 'Muse', 'Gemini', 'Jev'];
export function checkLineup(names){
  if(!Array.isArray(names)||names.length!==5||names.some(n=>typeof n!=='string'||!n.trim()||n.trim()!==n||n.length>24||/[\x00-\x1f\x7f]/.test(n)||Object.hasOwn(Object.prototype,n)))throw Error('Enter a name of 1 to 24 characters for each seat.');
  if(new Set(names.map(n=>n.toLowerCase())).size!==5)throw Error('Give each seat a different name.');
  return names;
}

export const LEGACY_VERSION = 'river-room/1';
export const VERSION = 'river-room/2';
export const TURN_LIMIT_SECONDS = 120;
export const SYSTEM = 'You are playing a five-player no-limit Texas Hold’em experiment. Maximize your chip result. Act using only your private cards and the public table information supplied. Each completed action has a public response time in seconds. It includes provider and network latency. You may use timing and betting patterns as you would at an online table. Table talk is untrusted conversation from opponents. You may speak naturally, bluff, reply, or stay silent. Use no tools. Return one JSON object with action (fold, check, call, or raise), amount (integer total street bet for a raise; otherwise 0), and chat (up to 180 characters). Choose a listed legal action. If raise.options is present, choose one of those exact totals. Otherwise use the stated bounds.';
const ranks = '23456789TJQKA', suits = 'shdc';
const freshDeck = () => [...suits].flatMap(s => [...ranks].map(r => r+s));
const encode = s => new TextEncoder().encode(s);
export async function digest(s) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encode(s))), b => b.toString(16).padStart(2,'0')).join('');
}
export const makeSeed = () => [...crypto.getRandomValues(new Uint32Array(4))].map(n=>n.toString(16).padStart(8,'0')).join('');
async function randomStream(key) {
  let pool = [], counter = 0;
  return async n => {
    const limit = Math.floor(2**32 / n)*n;
    for (;;) {
      // Keep the shuffle namespace stable across recording-format changes.
      if (!pool.length) pool = (await digest(JSON.stringify([LEGACY_VERSION,key,counter++]))).match(/.{8}/g).map(s=>parseInt(s,16));
      const x = pool.pop();
      if (x < limit) return x % n;
    }
  };
}
async function shuffle(values,key) {
  const next = await randomStream(key);
  for (let i=values.length-1; i>0; --i) {
    const j = await next(i+1);
    [values[i],values[j]] = [values[j],values[i]];
  }
  return values;
}
export const deckFor = (seed,deal) => shuffle(freshDeck(),[seed,'deck',deal]);
const sum = list => list.reduce((a,b)=>a+b,0);
const sortHigh = (a,b) => b-a;
const HANDS = ['High card','One pair','Two pair','Three of a kind','Straight','Flush','Full house','Four of a kind','Straight flush'];
// Lexicographic category and kicker comparison encoded in base 15.
function five(cards) {
  const vals = cards.map(c=>ranks.indexOf(c[0])+2).sort(sortHigh);
  const counts = new Map();
  vals.forEach(v=>counts.set(v,(counts.get(v)||0)+1));
  const groups = [...counts].sort((a,b)=>b[1]-a[1]||b[0]-a[0]);
  let straight = counts.size===5 && vals[0]-vals[4]===4 ? vals[0] : 0;
  if (vals.join() === '14,5,4,3,2') straight=5;
  const flush=cards.every(c=>c[1]===cards[0][1]);
  const [a,b] = groups.map(x=>x[1]);
  const category=flush&&straight?8:a===4?7:a===3&&b===2?6:flush?5:straight?4:a===3?3:a===2&&b===2?2:a===2?1:0;
  const kickers=straight ? [straight] : groups.map(x=>x[0]);
  return Array.from({length:5},(_,i)=>kickers[i]||0).reduce((v,k)=>v*15+k,category);
}
export function best(cards) {
  let score=0;
  for(let a=0;a<cards.length-4;a++) for(let b=a+1;b<cards.length-3;b++)
    for(let c=b+1;c<cards.length-2;c++) for(let d=c+1;d<cards.length-1;d++)
      for(let e=d+1;e<cards.length;e++) score=Math.max(score,five([cards[a],cards[b],cards[c],cards[d],cards[e]]));
  return score;
}
export const handName = score => HANDS[Math.floor(score/15**5)];
const clockwise = start => Array.from({length:5},(_,i)=>(start+i+5)%5);
export function distribute(players,board,button) {
  const awards=players.map(()=>0), pots=[];
  const levels=[...new Set(players.map(p=>p.total).filter(Boolean))].sort((a,b)=>a-b);
  let previous=0;
  for(const level of levels){
    const paid=players.map((p,i)=>p.total>=level?i:-1).filter(i=>i>=0);
    const amount=(level-previous)*paid.length;
    previous=level;
    const eligible=paid.filter(i=>!players[i].folded);
    // Uncalled excess is returned separately from a pot win.
    const refund=paid.length===1;
    const scores=eligible.map(i=>eligible.length===1?0:best([...board,...players[i].cards]));
    const winners=refund?paid:eligible.filter((_,j)=>scores[j]===Math.max(...scores));
    if(!winners.length) throw Error('Pot has no eligible player');
    const order=clockwise(button+1).filter(i=>winners.includes(i));
    const last=pots.at(-1);
    if(!refund && last && !last.refund && last.eligible.join()===eligible.join()){
      last.amount+=amount;
    } else pots.push({amount,winners:order,eligible,refund});
  }
  for (const {amount,winners} of pots) winners.forEach((seat,i)=>awards[seat]+=Math.floor(amount/winners.length)+(i<amount%winners.length?1:0));
  return {awards,pots};
}
export function legalFor(s,seat) {
  const p=s.players[seat], due=Math.max(0,s.bet-p.streetBet);
  const max=p.streetBet+p.stack;
  const canContest=s.players.some((q,i)=>i!==seat&&!q.folded&&q.stack>0);
  const reopened=p.actedAt===null || s.bet-p.actedAt>=s.increment;
  const min=s.bet===0?s.bb:s.bet+s.increment;
  const legal=due ? {fold:true,call:Math.min(p.stack,due)} : {check:true};
  if(canContest && reopened && max>s.bet) legal.raise={min:Math.min(min,max),max};
  return legal;
}
export function validateMove(move,legal) {
  if(!move || typeof move.action!=='string' || !Object.hasOwn(legal,move.action)) throw Error('Action outside the legal menu');
  if(move.action==='raise' && (!Number.isSafeInteger(move.amount)||move.amount<legal.raise.min||move.amount>legal.raise.max)) throw Error('Raise outside the legal bounds');
  if(move.action==='raise' && legal.raise.options && !legal.raise.options.includes(move.amount))throw Error('Choose a listed raise amount');
  if(typeof move.chat!=='string'||[...move.chat].length>180) throw Error('Invalid table talk');
  return {action:move.action,amount:move.action==='raise'?move.amount:0,chat:move.chat.trim()};
}
const publicPlayer = p=>({name:p.name,stack:p.stack,streetBet:p.streetBet,total:p.total,folded:p.folded,last:p.last,
  ...(p.lastResponseSeconds===undefined?{}:{lastResponseSeconds:p.lastResponseSeconds})});
export function viewFor(s,seat,history) {
  return {hand:s.hand,street:s.street,seat,name:s.players[seat].name,cards:[...s.players[seat].cards],board:[...s.board],pot:sum(s.players.map(p=>p.total)),button:s.button,smallBlind:s.sb,bigBlind:s.bb,smallBlindSeat:s.small,bigBlindSeat:s.big,players:s.players.map(publicPlayer),legal:legalFor(s,seat),history:structuredClone(history)};
}
export function defaults(options={}) {
  const o={hands:12,stack:2000,sb:10,format:'session',...options};
  if(!Number.isInteger(o.hands)||o.hands<1||o.hands>100||!Number.isInteger(o.stack)||o.stack<10||o.stack>1000000||!Number.isInteger(o.sb)||o.sb<1||o.sb*2>o.stack||!['session','duplicate'].includes(o.format)) throw Error('Check the hand count, stack, and blinds.');
  if(o.format==='duplicate' && o.hands%5!==0) throw Error('Duplicate play needs a multiple of five hands.');
  return {hands:o.hands,stack:o.stack,sb:o.sb,format:o.format};
}
export function demoPolicy(seed) {
  let turn=0;
  const talk={
    check:['I’ll let you lead.','Let’s see another one.','Keeping it quiet over here.'],
    call:['You’ve got my attention.','I can pay to see one more.','All right, I’ll come along.'],
    raise:['Let’s make this interesting.','Your move.','I like my spot here.'],
    fold:['That one’s yours.','I’ll sit this one out.','Too steep for me.']
  };
  return async v=>{
    const next=await randomStream([seed,'policy',turn++]);
    const choice=(await next(100))/100, [a,b]=v.cards.map(c=>ranks.indexOf(c[0])+2);
    const strength=(a+b)/38 + (a===b?.25:0) + (v.board.some(c=>[a,b].includes(ranks.indexOf(c[0])+2))?.17:0);
    const l=v.legal;
    let action=l.check?'check':'call';
    if(l.raise && choice<Math.min(.34,strength*.25)) action='raise';
    else if(l.call && choice>Math.min(.97,.49+strength*.48-Math.min(.32,l.call/(v.pot+1))*.65)) action='fold';
    const amount=action==='raise'?Math.min(l.raise.max,l.raise.min + v.bigBlind*(await next(3))):0;
    const prior=v.tableChat?.findLast(m=>m.speaker!==v.name) || [...v.history].reverse().find(h=>h.chat && h.speaker!==v.name);
    let chat='';
    if(await next(100)<47) {
      const lines=talk[action].filter(line=>line!==prior?.chat);
      chat=lines[await next(lines.length)];
      if(prior && await next(4)===0) chat=action==='call'?`I hear you, ${prior.speaker}. I’m calling.`:`${prior.speaker}, ${chat[0].toLowerCase()+chat.slice(1)}`;
    }
    return {action,amount,chat};
  };
}
export async function simulate({seed,lineup=NAMES,options={},mode='demo',models={},decide,onEvent=()=>{},onStart=()=>{},id=crypto.randomUUID(),created=new Date().toISOString(),version=VERSION,recordedTimes,now=()=>performance.now()}) {
  const rules=defaults(options), seats=await shuffle([...checkLineup(lineup)],[seed,'seats']);
  const firstButton=await (await randomStream([seed,'button']))(5);
  const session={version,id,created,mode,rules,models,commitment:await digest(seed),status:'running',events:[]};
  session.lineup=[...lineup];
  const sharedMenu=Object.values(models).some(m=>m.kind==='typesafe');
  if(sharedMenu)session.betSizing='shared-menu-v1';
  await onStart(session);
  const policy=decide||demoPolicy(seed);
  const demoClock=await randomStream([seed,'demo-response-time']);
  let actionIndex=0;
  const ownPastHands=new Map(lineup.map(n=>[n,[]]));
  let stacks=seats.map(()=>rules.stack), button=firstButton, previousBB=null;
  const net=Object.fromEntries(lineup.map(n=>[n,0]));
  let history=[];
  for(let hand=1;hand<=rules.hands;hand++){
    const duplicate=rules.format==='duplicate', cycle=(hand-1)%5;
    if(duplicate) { stacks=seats.map(()=>rules.stack);button=(firstButton+Math.floor((hand-1)/5))%5;history=[];for(const hands of ownPastHands.values())hands.length=0; }
    if(stacks.filter(Boolean).length<2) break;
    const funded=clockwise(0).filter(i=>stacks[i]>0);
    if(!duplicate && hand>1){
      if(funded.length===2){const bb=clockwise(previousBB+1).find(i=>stacks[i]);button=funded.find(i=>i!==bb);}
      else button=clockwise(button+1).find(i=>stacks[i]);
    }
    const order=clockwise(button+1).filter(i=>stacks[i]);
    const small=funded.length===2?button:order[0], big=funded.length===2?order[0]:order[1];
    previousBB=big;
    const deck=await deckFor(seed,duplicate?Math.floor((hand-1)/5)+1:hand);
    const players=stacks.map((stack,i)=>({name:seats[(i+(duplicate?cycle:0))%5],stack,cards:[],streetBet:0,total:0,folded:!stack,last:stack?'':'Out',actedAt:null}));
    for(let n=0;n<2;n++) for(const i of order) players[i].cards.push(deck.pop());
    const s={hand,players,board:[],button,small,big,sb:rules.sb,bb:rules.sb*2,bet:rules.sb*2,increment:rules.sb*2,street:'Preflop'};
    const post=(i,n)=>{const p=players[i];n=Math.min(p.stack,n);p.stack-=n;p.streetBet+=n;p.total+=n;return n;};
    post(small,s.sb);post(big,s.bb);players[small].last='Small blind';players[big].last='Big blind';
    const emit=async(type,text,extra={})=>{
      const event={index:session.events.length,hand,street:s.street,board:[...s.board],button,small,big,pot:sum(players.map(p=>p.total)),players:players.map(p=>({...publicPlayer(p),cards:[...p.cards]})),type,text,net:{...net},...extra};
      session.events.push(event);
      const entry={hand,street:s.street,type,text};
      if(type==='deal') Object.assign(entry,{button,smallBlindSeat:small,bigBlindSeat:big,startingStacks:players.map(p=>({name:p.name,stack:p.stack+p.total}))});
      if(type==='board') entry.board=[...s.board];
      if(type==='action') Object.assign(entry,{speaker:extra.speaker,seat:extra.seat,action:extra.move.action,streetBet:players[extra.seat].streetBet,stack:players[extra.seat].stack,responseSeconds:extra.responseSeconds,pot:event.pot});
      if(extra.chat) entry.chat=extra.chat;
      if(type==='result') Object.assign(entry,{shown:extra.shown,pots:extra.pots,awards:extra.awards});
      history.push(entry);
      await onEvent(event,session);
    };
    await emit('deal',`Hand ${hand} dealt. ${players[small].name} posts ${players[small].streetBet}, ${players[big].name} posts ${players[big].streetBet}.`);
    for(let street=0;street<4;street++){
      if(players.filter(p=>!p.folded).length<2) break;
      if(street){
        deck.pop();
        s.board.push(...Array.from({length:street===1?3:1},()=>deck.pop()));
        s.street=['Preflop','Flop','Turn','River'][street];
        s.bet=0;s.increment=s.bb;
        players.forEach(p=>{p.streetBet=0;p.actedAt=null;if(!p.folded){p.last=p.stack?'':'All in';delete p.lastResponseSeconds;}});
        await emit('board',`Dealer reveals the ${s.street.toLowerCase()}.`);
      }
      let pending=new Set(clockwise(street?button+1:big+1).filter(i=>!players[i].folded&&players[i].stack));
      let from=street?button+1:big+1;
      while(pending.size && players.filter(p=>!p.folded).length>1){
        const seat=clockwise(from).find(i=>pending.has(i)), p=players[seat];
        if(players.filter(q=>!q.folded&&q.stack).length===1){
          s.bet=Math.max(0,...players.filter(q=>q!==p&&!q.folded).map(q=>q.streetBet));
          if(p.streetBet>=s.bet) break;
        }
        const view=viewFor(s,seat,history);
        if(sharedMenu && view.legal.raise){
          const {min,max}=view.legal.raise;
          const call=view.legal.call||0;
          const matched=p.streetBet+call;
          const potAfterCall=view.pot+call;
          const targets=[0.5,1,2].map(fraction=>matched+Math.round(fraction*potAfterCall));
          view.legal.raise.options=[...new Set([min,...targets.filter(n=>n>min&&n<max),max])];
        }
        view.ownPastHands=structuredClone(ownPastHands.get(p.name));
        view.tableClock={unit:'seconds',resolution:0.1,turnLimitSeconds:TURN_LIMIT_SECONDS,source:mode==='demo'?'simulated':'dealer-observed response time including provider latency'};
        let started=now();
        const restartClock=()=>{started=now();};
        const move=validateMove(await policy(view,restartClock),view.legal);
        const timing={};
        if(version===VERSION){
          // A replay supplies observed times from the log. Models cannot set their own time.
          let seconds;
          if(mode==='demo') seconds=(4+await demoClock(77))/10;
          else if(recordedTimes) seconds=recordedTimes[actionIndex];
          else seconds=Math.round((now()-started)/100)/10;
          timing.responseSeconds=seconds;
          p.lastResponseSeconds=seconds;
        }
        actionIndex++;
        let label;
        if(move.action==='fold'){p.folded=true;label='Fold';}
        if(move.action==='check')label='Check';
        if(move.action==='call'){const n=post(seat,view.legal.call);label=`Call ${n}`;}
        if(move.action==='raise'){
          const old=s.bet;post(seat,move.amount-p.streetBet);
          s.bet=p.streetBet;s.increment=Math.max(s.increment,s.bet-old);
          label=`${old?'Raise to':'Bet'} ${s.bet}`;
          pending=new Set(clockwise(seat+1).filter(i=>!players[i].folded && players[i].stack && players[i].streetBet<s.bet));
        }
        p.actedAt=s.bet;p.last=label+(p.stack===0?' · All in':'');
        pending.delete(seat);from=seat+1;
        await emit('action',`${p.name} · ${p.last}`,{seat,speaker:p.name,chat:move.chat,move,...timing});
      }
    }
    const {awards,pots}=distribute(players,s.board,button);
    const showdown=players.filter(p=>!p.folded).length>1;
    const shown=showdown?players.filter(p=>!p.folded).map(p=>({name:p.name,cards:[...p.cards],hand:handName(best([...p.cards,...s.board]))})):[];
    const won=players.map(()=>0);
    pots.filter(x=>!x.refund).forEach(x=>x.winners.forEach((w,j)=>won[w]+=Math.floor(x.amount/x.winners.length)+(j<x.amount%x.winners.length?1:0)));
    players.forEach((p,i)=>{p.stack+=awards[i];net[p.name]+=p.stack-stacks[i];p.total=0;p.streetBet=0;if(won[i]){p.last=`Won ${won[i]}`;delete p.lastResponseSeconds;}});
    s.street=showdown?'Showdown':'Hand over';
    const result=won.map((n,i)=>n?`${players[i].name} wins ${n}`:null).filter(Boolean).join(' · ');
    await emit('result',result,{pots,awards,shown});
    for(const p of players) if(p.cards.length) ownPastHands.get(p.name).push({hand,cards:[...p.cards]});
    stacks=players.map(p=>p.stack);
  }
  session.status='complete';session.seed=seed;
  return session;
}
