import test from 'node:test';
import assert from 'node:assert/strict';
import {simulate,NAMES,distribute,digest} from '../dist/engine.js';
import {recordDecision,observation} from '../dist/observations.js';
import {sessionView} from '../dist/human-seat.js';
import {initClocks,spendBank,seatPresence} from '../dist/seat-clock.js';
import {verify} from '../dist/recordings.js';

const call=view=>({action:view.legal.check?'check':'call',amount:0,chat:''});

test('one seat can leave and return on its natural big blind',async()=>{
  let name;
  const s=await simulate({seed:'move-blinds',options:{hands:8,stack:10000},availability:h=>h===2?[name]:[],
    decide:call,onEvent:e=>{if(e.hand===1 && e.type==='deal')name=e.players[e.big].name;}});
  const deals=s.events.filter(e=>e.type==='deal');
  assert.equal(deals[1].small,null);
  assert.deepEqual(deals[1].players.find(p=>p.name===name).cards,[]);
  const back=deals.slice(2).find(e=>e.players.some(p=>p.name===name && p.cards.length));
  assert.equal(back.players[back.big].name,name);
  assert.equal(await verify(s),s.events.length);
});

test('muck, one-card voluntary show and mandatory winner reveals respect public boundaries',async()=>{
  const s=await simulate({seed:'voluntary',options:{hands:1},decide:v=>({...call(v),showCards:'left'})});
  const end=s.events.at(-1);
  for(const [i,p] of end.players.entries()){
    const shown=end.shown.find(h=>h.name===p.name);
    assert.equal(shown.cards.length,end.pots.some(p=>p.winners.includes(i))?2:1);
  }
  const publicView=sessionView({...s,status:'running',humanName:'Pat',decisions:[{private:'test'}]},0,false,null);
  assert.ok(!publicView.seed && !publicView.decisions);
  assert.ok(publicView.events.filter(e=>e.move).every(e=>!e.move.showCards));
  assert.deepEqual(publicView.events.at(-1).players.map(p=>p.cards),end.shown.map(p=>p.cards));
  const interrupted=sessionView({...s,status:'interrupted',humanName:'Pat'},0,true,null);
  assert.ok(interrupted.privateTable && !interrupted.seed);
  assert.equal(await verify(s),s.events.length);
});

test('a chat posted while a request runs is absent from its reconstructed input',async()=>{
  const s=await simulate({seed:'message-cutoff',options:{hands:1},decide:call});
  s.events=s.events.slice(0,1);s.decisions=[];s.tableChat=[];
  const name=s.events[0].players[0].name;let delivered,finish;
  const request=recordDecision(s,name,'bet',{check:true},v=>{
    delivered=structuredClone(v);
    return new Promise(ok=>{finish=ok;});
  },new AbortController().signal);
  s.tableChat.push({id:'later',speaker:s.events[0].players[1].name,hand:1,street:'Preflop',index:0,chat:'I have aces'});
  finish({action:'check',amount:0,chat:'',report:{summary:'Free card.',strategy:'Keep the pot small.',reasoning:'ignored'}});
  await request;
  const first=s.decisions[0];
  assert.deepEqual(observation(s,first),delivered);
  assert.equal(await digest(JSON.stringify(delivered)),first.inputDigest);
  assert.equal(first.report.reasoning,undefined);
  await recordDecision(s,name,'chat',null,v=>{
    assert.equal(v.privateStrategy,first.report.strategy);
    assert.deepEqual(v.conversation.map(m=>m.id),['later']);return '';
  },new AbortController().signal);
  await recordDecision(s,s.events[0].players[1].name,'chat',null,v=>{
    assert.equal(v.privateStrategy,'');return '';
  },new AbortController().signal);
});

test('a disconnected seat can reconnect and an explicitly vacated seat stays empty',t=>{
  t.mock.timers.enable({apis:['Date','setInterval'],now:1000});
  const s={lineup:NAMES,events:[],humanName:NAMES[0]},stop=new AbortController();
  const presence=seatPresence(s,stop.signal);initClocks(s);
  t.mock.timers.tick(35000);assert.equal(s.seatPresence,'disconnected');
  spendBank(s,NAMES[0],1000);assert.equal(s.clocks[NAMES[0]],85);
  presence.heartbeat();assert.equal(s.seatPresence,'present');
  presence.set(true);presence.heartbeat();assert.deepEqual(presence.absent(),[NAMES[0]]);
  presence.leave();presence.heartbeat();assert.equal(s.seatPresence,'left');stop.abort();
});

test('rake excludes uncalled chips and uses one cap for all side pots',()=>{
  const board=['2s','4h','6d','8c','Th'];
  const players=[['As','Ah'],['Ks','Kh'],['Qs','Qh']].map((cards,i)=>({total:[100,400,500][i],cards}));
  const {pots,awards}=distribute(players,board,1,{rakePercent:5,rakeCap:20});
  assert.deepEqual(pots.map(p=>p.rake||0),[15,5,0]);
  assert.equal(awards.reduce((a,b)=>a+b,0),980);
  assert.equal(pots.at(-1).amount,100);
});
