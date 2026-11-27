// Every seat receives the same base time and the same initial session bank.
export const BASE_SECONDS=30, BANK_SECONDS=90;
export function initClocks(s){s.clocks=Object.fromEntries(s.lineup.map(n=>[n,BANK_SECONDS]));}
export function spendBank(s,name,start){
  const used=Math.max(0,(Date.now()-start)/1000-BASE_SECONDS);
  s.clocks[name]=Math.max(0,Math.floor((s.clocks[name]-used)*10)/10);
}
export function seatPresence(s,signal){
  let lastSeen=Date.now(),intent=false;
  s.seatPresence='present';s.presenceEvents=[];
  function update(value){
    if(value===s.seatPresence)return;
    s.seatPresence=value;
    s.presenceEvents.push({at:Date.now(),event:s.events.at(-1)?.index??0,state:value,name:s.humanName});
  }
  const timer=setInterval(()=>{if(s.seatPresence!=='left' && !intent && Date.now()-lastSeen>30000)update('disconnected');},5000);
  signal.addEventListener('abort',()=>clearInterval(timer),{once:true});
  return {
    heartbeat(){lastSeen=Date.now();if(!intent && s.seatPresence!=='left')update('present');},
    leave(){intent=true;update('left');},
    set(away){if(s.seatPresence==='left')throw Error('Seat has left the table');intent=away;lastSeen=Date.now();update(away?'sitting out':'present');},
    absent(){return s.seatPresence==='present'?[]:[s.humanName];}
  };
}
