import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as settle } from 'node:timers/promises';
import { tableConversation,transcript } from '../dist/table-room.js';

function table(t,consider,format='session'){
  t.mock.timers.enable({apis:['Date','setTimeout'],now:1000});
  const lineup=['You','A','B','C','Silent API'];
  const players=lineup.map(name=>({name,stack:100,folded:name==='B',cards:['Ah','As']}));
  const event={index:0,hand:1,type:'deal',street:'Preflop',board:[],players,pot:15,text:'Blinds posted'};
  const session={status:'running',rules:{format},lineup,humanName:'You',models:{'Silent API':{kind:'typesafe'}},events:[event]};
  const stop=new AbortController();
  t.after(()=>stop.abort());
  const room=tableConversation(session,consider,stop.signal);
  const advance=async ms=>{t.mock.timers.tick(ms);await settle();};
  return {room,session,stop,event,advance};
}

test('models can open a conversation and another seat can answer while folded',async t=>{
  const seen=new Set(), contexts=[];
  const {room,session,event,advance}=table(t,(name,ctx)=>{
    seen.add(name);
    contexts.push(ctx);
    if(name==='A' && !ctx.conversation.length)return 'Hey table';
    if(name==='B' && ctx.conversation.at(-1)?.chat==='Hey table')return 'Hey A';
    return '';
  });
  room.observe(event);
  await advance(5000);
  assert.deepEqual(session.tableChat.map(m=>m.speaker),['A']);
  await advance(13000);
  assert.deepEqual(session.tableChat.map(m=>m.speaker),['A','B']);
  assert.deepEqual([...seen].sort(),['A','B','C']);
  assert.ok(contexts.every(ctx=>ctx.players.every(p=>!('cards' in p))));
  assert.deepEqual(transcript(session,0).map(m=>m.chat),['Hey table','Hey A']);
});

test('a slow seat cannot block posts or other seats; silence and concurrent retries are safe',async t=>{
  let finish;
  const received=[];
  const {room,session,stop,advance}=table(t,(name,ctx)=>{
    received.push([name,...ctx.conversation.map(m=>m.chat)]);
    return name==='A'?new Promise(resolve=>{finish=resolve;}):'';
  });
  const first={id:'human1',text:'@A hi'};
  await Promise.all([room.send(first),room.send(first)]);
  await advance(1000);
  assert.deepEqual(received.sort(),[['A','@A hi'],['B','@A hi'],['C','@A hi']]);
  await room.send({id:'human2',text:'Another thought'});
  await advance(13000);
  assert.equal(received.filter(r=>r[0]==='A').length,1);
  assert.ok(received.some(r=>r[0]==='C' && r.includes('Another thought')));
  stop.abort();finish('Late reply');await settle();
  assert.deepEqual(session.tableChat.map(m=>m.chat),['@A hi','Another thought']);
});

test('duplicate rotations exclude previous chat and discard late replies from earlier deals',async t=>{
  let finish;
  const nextHandViews=[];
  const {room,session,event,advance}=table(t,(name,ctx)=>{
    if(name==='A' && ctx.hand===1)return new Promise(resolve=>{finish=resolve;});
    if(ctx.hand===2)nextHandViews.push(ctx.conversation);
    return '';
  },'duplicate');
  await room.send({id:'old',text:'old hand'});
  await advance(1000);
  const next={...event,hand:2,index:1};session.events.push(next);room.observe(next);
  finish('old reply');await settle();await advance(14000);
  assert.ok(nextHandViews.length>0);
  assert.ok(nextHandViews.every(lines=>!lines.length));
  assert.deepEqual(room.messages(2),[]);
  assert.equal(session.tableChat.length,1);
});

test('a silent check clears only the recovering seat’s warning',async t=>{
  const failing=new Set(['A','B']);
  const {room,session,advance}=table(t,name=>{
    if(failing.has(name)){
      if(name==='A')throw new DOMException('Request deadline','TimeoutError');
      throw new SyntaxError('private response text');
    }
    return '';
  });
  await room.send({id:'first',text:'Hi'});await advance(1000);
  assert.match(session.chatError,/A missed a chat check because the request timed out/);
  assert.match(session.chatError,/B missed a chat check because the model returned invalid JSON/);
  assert.doesNotMatch(session.chatError,/private response text/);
  failing.delete('A');
  await room.send({id:'second',text:'Hello again'});await advance(14000);
  assert.doesNotMatch(session.chatError,/A missed/);
  assert.match(session.chatError,/B missed/);
  failing.clear();
  await room.send({id:'third',text:'Good luck'});await advance(14000);
  assert.equal(session.chatError,'');
  assert.equal(session.tableChat.length,3);
});
