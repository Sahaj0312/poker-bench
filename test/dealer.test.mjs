import test from 'node:test';
import assert from 'node:assert/strict';
import {best,handName,distribute,legalFor,validateMove,simulate,deckFor,viewFor,NAMES,demoPolicy,digest} from '../dist/engine.js';
import {verify} from '../dist/recordings.js';
const cards=s=>s.split(' ');
test('showdown ranks every hand class, low ace straights, kickers, and board ties',()=>{
  const examples=[
    ['High card','As Kh Qc Jd 9s'],['One pair','2s 2h Ac Kd 3s'],['Two pair','2s 2h 3c 3d As'],['Three of a kind','2s 2h 2c Ad Ks'],
    ['Straight','As 2c 3h 4d 5s'],['Flush','As 9s 7s 5s 3s'],['Full house','2s 2h 2c 3s 3h'],['Four of a kind','2s 2h 2c 2d As'],['Straight flush','As 2s 3s 4s 5s']
  ];
  let prev=0;for(const [name,hand] of examples){const score=best(cards(hand));assert.equal(handName(score),name);assert.ok(score>prev);prev=score;}
  assert.ok(best(cards('2s 3h 4c 5h 6s'))>best(cards('Ah 2c 3d 4s 5h')));
  assert.ok(best(cards('Ac Ad Kh Qs Js 5h 4d'))>best(cards('As Ah Kc Qc Ts 5h 4d')));
  assert.equal(best(cards('As Ks Qs Js Ts 3d 2d')),best(cards('As Ks Qs Js Ts 4c 6c')));
});
test('layered side pots exclude folded chips from eligibility and return uncalled bets',()=>{
  const board=cards('2s 4h 6d 8c Th');
  const players=['As Ah','Ks Kh','Qs Qh','Js Jh','3c 7c'].map((h,i)=>({cards:cards(h),total:[10,30,50,80,50][i],folded:i===4}));
  const {awards,pots}=distribute(players,board,1);
  assert.deepEqual(awards,[50,80,60,30,0]);assert.equal(pots.at(-1).refund,true);
});
test('odd chips follow the button and dead contributions merge before a pot is split',()=>{
  const board=cards('As Ks Qs Js Ts');
  const players=['2c 2d','3d 3c','4d 4c','5d 5c','6d 6c'].map((h,i)=>({cards:cards(h),total:[5,5,1,2,3][i],folded:i>1}));
  assert.deepEqual(distribute(players,board,0).awards,[8,8,0,0,0]);
  players[4].total=2;assert.deepEqual(distribute(players,board,0).awards,[7,8,0,0,0]);
});
test('short all-ins cannot reopen betting until cumulative increases reach a full raise',()=>{
  const s={players:[{stack:100,streetBet:20,actedAt:20},{stack:100,streetBet:31,actedAt:31}],bet:31,increment:20,bb:10};
  assert.deepEqual(legalFor(s,0),{fold:true,call:11});
  s.bet=40;assert.equal(legalFor(s,0).raise.min,60);
  s.players[0].stack=35;assert.deepEqual(legalFor(s,0).raise,{min:55,max:55});
  assert.throws(()=>validateMove({action:'raise',amount:54,chat:''},legalFor(s,0)));
});
test('duplicate blocks give each agent each position and hand once with fresh information',async()=>{
  const seen=[];const s=await simulate({seed:'duplicate-control',options:{hands:10,format:'duplicate'},decide:async view=>{
    if(!seen.includes(view.hand)){assert.ok(view.history.every(h=>h.hand===view.hand));seen.push(view.hand);}
    assert.ok(view.players.every(p=>!('cards' in p)));assert.equal(view.cards.length,2);
    assert.ok(!('seed' in view)&&!('deck' in view));return {action:view.legal.check?'check':'call',amount:0,chat:'hello'};
  }});
  const starts=s.events.filter(e=>e.type==='deal');assert.equal(starts.length,10);
  for(const offset of [0,5])for(let i=0;i<5;i++){
    const seats=starts.slice(offset,offset+5).map(e=>e.players[i]);
    assert.equal(new Set(seats.map(x=>x.name)).size,5);assert.equal(new Set(seats.map(x=>x.cards.join())).size,1);
    assert.ok(seats.every(p=>p.stack+p.total===2000));
  }
  assert.deepEqual(starts.slice(0,5).map(x=>x.button),Array(5).fill(starts[0].button));
  assert.equal(Object.values(s.events.at(-1).net).reduce((a,b)=>a+b,0),0);
});
test('session-wide replay reconstructs exact snapshots, detects edits, and commits before acting',async()=>{
  let committed=false, talked=false;const policy=demoPolicy('audit');
  const s=await simulate({seed:'audit',onStart:async s=>{assert.equal(s.commitment,await digest('audit'));assert.ok(!s.seed);committed=true;},
    decide:async v=>{assert.ok(committed);if(v.history.some(e=>e.chat))talked=true;return policy(v);}});
  assert.ok(talked);assert.equal(await verify(s),s.events.length);
  s.events[3].players[0].stack++;await assert.rejects(verify(s),/differs/);
});
test('randomized legal games conserve every chip and never duplicate a card',async()=>{
  for(let n=0;n<48;n++){
    const seed='stress-'+n;
    assert.equal(new Set(await deckFor(seed,n)).size,52);
    const options={hands:10,stack:10+n,sb:1+n%4};
    const s=await simulate({seed,options});
    for(const e of s.events){
      const all=[...e.board,...e.players.flatMap(p=>p.cards)];assert.equal(new Set(all).size,all.length);
      assert.equal(e.pot+e.players.reduce((a,p)=>a+p.stack,0),options.stack*5);
      assert.ok(e.players.every(p=>p.stack>=0));
    }
    assert.equal(s.events.at(-1).type,'result');
  }
});
test('wholesale all-ins run the full board without asking for empty actions',async()=>{
  let turns=0;const s=await simulate({seed:'all-in',options:{hands:1},decide:async v=>{turns++;return v.legal.raise?{action:'raise',amount:v.legal.raise.max,chat:''}:{action:'call',amount:0,chat:''};}});
  assert.equal(turns,5);assert.equal(s.events.at(-1).board.length,5);assert.equal(s.events.at(-1).shown.length,5);
});
