import test from 'node:test';
import assert from 'node:assert/strict';
import { HumanSeat,chooseSeat } from '../dist/human-seat.js';
import { NAMES,TURN_LIMIT_SECONDS } from '../dist/engine.js';

test('a human can take one seat in a continuous game',()=>{
  assert.deepEqual(chooseSeat(NAMES,{slot:'Jev',name:'Pat'},{format:'session'}),[...NAMES.slice(0,4),'Pat']);
  assert.throws(()=>chooseSeat(NAMES,{slot:'Jev',name:'Astra'},{format:'session'}));
  assert.throws(()=>chooseSeat(NAMES,{slot:'Jev',name:'Pat'},{format:'duplicate'}));
});

test('the human clock checks or folds on timeout and cancels a stopped turn',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const seat=new HumanSeat();
  for(const [legal,action] of [[{check:true},'check'],[{fold:true,call:10},'fold']]){
    let logged;
    const decision=seat.wait({legal},new AbortController().signal,a=>{logged=a;});
    t.mock.timers.tick(TURN_LIMIT_SECONDS*1000);
    assert.equal((await decision).action,action);assert.equal(logged,action);assert.equal(seat.turn,null);
  }
  const stop=new AbortController(),decision=seat.wait({legal:{check:true}},stop.signal,()=>{});
  stop.abort();await assert.rejects(decision);assert.equal(seat.turn,null);
});
