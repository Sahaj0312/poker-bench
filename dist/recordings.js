import { simulate,digest,VERSION,TIMED_VERSION,LEGACY_VERSION,NAMES,defaults,checkLineup } from './engine.js';
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
  if(![VERSION,TIMED_VERSION,LEGACY_VERSION].includes(s?.version)||!Array.isArray(s.events)||s.events.length<1||s.events.length>100000||typeof s.id!=='string'||typeof s.commitment!=='string'||!['demo','models','practice'].includes(s.mode))throw Error('Unrecognized poker replay.');
  defaults(s.rules);
  if(s.version===VERSION && (s.decisions||s.instructions||s.evidenceDigest) && s.auditVersion!==1)throw Error('Missing decision evidence version.');
  const names=checkLineup(s.lineup??NAMES);
  if(s.tableChat!==undefined && (!Array.isArray(s.tableChat)||s.tableChat.some((m,i,all)=>
    !m || !names.includes(m.speaker)||typeof m.chat!=='string'||!m.chat.trim()||[...m.chat].length>180||
    !Number.isInteger(m.index)||!s.events[m.index]||m.hand!==s.events[m.index].hand||m.street!==s.events[m.index].street||
    (i>0 && m.index<all[i-1].index))))throw Error('Invalid table chat in replay.');
  if(s.decisions!==undefined && (!Array.isArray(s.decisions)||s.decisions.some(d=>!d||!names.includes(d.name)||
    !['bet','chat'].includes(d.kind)||!Number.isInteger(d.event)||!s.events[d.event]||d.hand!==s.events[d.event].hand||
    !Number.isSafeInteger(d.chatCount)||d.chatCount<0||d.chatCount>(s.tableChat||[]).length||!Number.isFinite(d.dispatchedAt))))throw Error('Invalid decision record.');
  const validCards=a=>Array.isArray(a)&&a.every(c=>typeof c==='string'&&/^[2-9TJQKA][shdc]$/.test(c));
  for(const [i,e] of s.events.entries()){
    if(s.version!==LEGACY_VERSION && e.type==='action' && !(Number.isSafeInteger(e.responseSeconds*10)&&typeof e.responseSeconds==='number'&&e.responseSeconds>=0))throw Error('Invalid response time at event '+i);
    if(e.index!==i||!Number.isInteger(e.hand)||!validCards(e.board)||e.board.length>5||!Array.isArray(e.players)||e.players.length!==5||new Set(e.players.map(p=>p.name)).size!==5||!e.players.every(p=>names.includes(p.name)&&validCards(p.cards)&&p.cards.length<=2&&Number.isSafeInteger(p.stack)&&p.stack>=0)||typeof e.text!=='string'||typeof e.street!=='string'||!e.net)throw Error('Invalid event at index '+i);
  }
}
const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
export async function verify(s){
  checkRecord(s);
  if(s.auditVersion===1 && (!s.evidenceDigest || s.evidenceDigest!==await evidenceDigest(s)))throw Error('Decision or table evidence differs from the saved digest.');
  if(s.status==='stopped' && s.auditVersion===1 && s.evidenceDigest)return s.events.length;
  if(!s.seed || s.status!=='complete')throw Error('Full verification requires a completed session and its revealed seed.');
  if(await digest(s.seed)!==s.commitment)throw Error('Seed commitment mismatch.');
  const deals=s.events.filter(e=>e.type==='deal');
  const moves=s.events.filter(e=>e.type==='action');let i=0;
  const rerun=await simulate({seed:s.seed,lineup:s.lineup??NAMES,models:s.models,options:s.rules,mode:s.mode,version:s.version,recordedTimes:moves.map(e=>e.responseSeconds),availability:h=>s.availabilityByHand?.[h]||deals[h-1]?.requestedOut||[],decide:async()=>{const e=moves[i++];return {...e?.move,source:e?.source};}});
  if(rerun.betSizing!==s.betSizing || canonical(rerun.events)!==canonical(s.events))throw Error('Event log differs from the reconstructed game.');
  return rerun.events.length;
}

export function evidenceDigest(s){
  const fields=['id','version','mode','lineup','models','rules','commitment','humanName','availabilityByHand','events','eventTimes','tableChat','presenceEvents','decisions','incidents','instructions','status'];
  return digest(canonical(Object.fromEntries(fields.filter(k=>s[k]!==undefined).map(k=>[k,s[k]]))));
}
