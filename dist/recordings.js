import { simulate,digest,VERSION,LEGACY_VERSION,NAMES,defaults } from './engine.js';
let storeReady;
function openStore(){return storeReady??=new Promise((resolve,reject)=>{
  const request=indexedDB.open('river-room-recordings',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('sessions',{keyPath:'id'});
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
});}
async function dbOp(mode,action){
  const db=await openStore();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('sessions',mode), req=action(tx.objectStore('sessions'));
    tx.oncomplete=()=>resolve(req.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });
}
export const save=s=>dbOp('readwrite',store=>store.put(s));
export const list=()=>dbOp('readonly',store=>store.getAll());
export function checkRecord(s){
  if(![VERSION,LEGACY_VERSION].includes(s?.version)||!Array.isArray(s.events)||s.events.length<1||s.events.length>100000||typeof s.id!=='string'||typeof s.commitment!=='string'||!['demo','models'].includes(s.mode))throw Error('Unrecognized River Room replay.');
  defaults(s.rules);
  const validCards=a=>Array.isArray(a)&&a.every(c=>typeof c==='string'&&/^[2-9TJQKA][shdc]$/.test(c));
  for(const [i,e] of s.events.entries()){
    if(s.version===VERSION && e.type==='action' && !(Number.isSafeInteger(e.responseSeconds*10)&&typeof e.responseSeconds==='number'&&e.responseSeconds>=0))throw Error('Invalid response time at event '+i);
    if(e.index!==i||!Number.isInteger(e.hand)||!validCards(e.board)||e.board.length>5||!Array.isArray(e.players)||e.players.length!==5||new Set(e.players.map(p=>p.name)).size!==5||!e.players.every(p=>NAMES.includes(p.name)&&validCards(p.cards)&&p.cards.length<=2&&Number.isSafeInteger(p.stack)&&p.stack>=0)||typeof e.text!=='string'||typeof e.street!=='string'||!e.net)throw Error('Invalid event at index '+i);
  }
}
const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
export async function verify(s){
  checkRecord(s);
  if(!s.seed || s.status!=='complete')throw Error('Full verification requires a completed session and its revealed seed.');
  if(await digest(s.seed)!==s.commitment)throw Error('Seed commitment mismatch.');
  const moves=s.events.filter(e=>e.type==='action');let i=0;
  const rerun=await simulate({seed:s.seed,options:s.rules,mode:s.mode,version:s.version,recordedTimes:moves.map(e=>e.responseSeconds),decide:async()=>moves[i++]?.move});
  if(canonical(rerun.events)!==canonical(s.events))throw Error('Event log differs from the reconstructed game.');
  return rerun.events.length;
}
