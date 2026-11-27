import {simulate,makeSeed,NAMES,VERSION,best} from './engine.js';
import {practiceClient,renderDecision} from './play-controls.js';
import {transcript,lockedRunout} from './table-room.js';
import {chipPile} from './chips.js';
import {symbol} from './seats.js';
import {editLineup} from './lineup.js';
import {icon,paintIcons} from './icons.js';
import {save,list,verify,checkRecord} from './recordings.js';
const $=s=>document.querySelector(s), all=s=>[...document.querySelectorAll(s)];
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const fmt=n=>Number(n||0).toLocaleString('en-US'), pad=n=>String(n).padStart(2,'0');
const face=name=>symbol((session?.lineup??NAMES).indexOf(name));
const responseTime=seconds=>seconds===0?'under 0.1 s':seconds.toFixed(1)+' s';
const timingLabel=e=>Number.isFinite(e.responseSeconds)?responseTime(e.responseSeconds):'';
const openingId='opening-table-v2';
const suit={s:'♠',h:'♥',d:'♦',c:'♣'};
let session,at=0,playing=false,timer,pollTimer,follow=true,feedType='talk',local=false,players={},page='table',generation=0,library=new Map(),noticeTimer;
let knownCurrent=null,practice=null,practiceId=null,revealUntil=0;
async function readSession(id,from=0,wasPrivate=false){
  if(id===practiceId && practice)return practice.call('read',{from,wasPrivate});
  return api('sessions/'+id+'?from='+from+(wasPrivate?'&private=1':''));
}
function sessionLabel(s){
  if(s.mode==='practice')return 'Practice session';
  if(s.mode==='demo')return 'Demo session';
  return s.status==='running'?'Live session':'Model session';
}
function notify(msg){$('#notice').textContent=msg;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>$('#notice').textContent='',4500);}
async function api(path,body){
  const res=await fetch('/api/'+path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data=await res.json();if(!res.ok)throw Error(data.error||'Request failed');return data;
}
function card(c,mini=false){
  if(!c && mini)return '<span class="card back" aria-label="Hidden card">◇</span>';
  if(!c)return '<span aria-label="Undealt card" class="card empty">◇</span>';
  const rank=c[0]==='T'?'10':c[0], pip=suit[c[1]];
  const content=mini?rank+'<small>'+pip+'</small>':'<span class="rank">'+rank+'</span><span class="pip">'+pip+'</span><span class="bottompip">'+pip+'</span>';
  return '<span aria-label="'+rank+' of '+({s:'spades',h:'hearts',d:'diamonds',c:'clubs'})[c[1]]+'" class="card '+('hd'.includes(c[1])?'red':'')+'">'+content+'</span>';
}
function rankedHand(shown,board){
  if(board.length!==5 || shown.cards.length!==2)return shown.hand;
  const score=best([...shown.cards,...board]);
  const rank=i=>'23456789TJQKA'[Math.floor(score/15**(4-i))%15-2];
  const ranks=Array.from({length:5},(_,i)=>rank(i)).filter(Boolean).join(' · ');
  return shown.hand+' ('+ranks+')';
}
function handRecap(e){
  const hands=e.shown.map(p=>`<li><strong>${esc(p.name)}</strong><span class="recapcards">${p.cards.map(c=>card(c,true)).join('')}</span><span>${esc(rankedHand(p,e.board))}</span></li>`).join('');
  const pots=e.pots.map((p,i)=>`<li>${p.refund?'Uncalled bet returned':i?'Side pot':'Main pot'} · ${fmt(p.amount)} · ${p.winners.map(w=>esc(e.players[w].name)).join(', ')}</li>`).join('');
  const past=session.events.slice(0,at+1).filter(row=>row.type==='result');
  const menu=past.map(row=>`<option value="${row.index}" ${row.index===e.index?'selected':''}>Hand ${row.hand} · ${row.shown.length?'Showdown':'Won by folds'}</option>`).join('');
  modal('Hand '+e.hand+' · '+(hands?'Showdown':'Won by folds'),`<div class="recap"><label>Hand result <select id="resultHand">${menu}</select></label><h3>${esc(e.text)}</h3><div class="recapboard">${e.board.map(c=>card(c)).join('')}</div>${hands?`<ul>${hands}</ul>`:'<p>Every other player folded.</p>'}<ul>${pots}</ul></div>`);
  $('#resultHand').onchange=ev=>handRecap(session.events[Number(ev.target.value)]);
}
function renderStage(e){
  const ready=session.status==='ready';
  const owner=session.mySeat || (!session.privateTable && session.humanName);
  const ownIndex=e.players.findIndex(p=>p.name===owner);
  const seats=e.players.map((p,i)=>{
    const position=ownIndex<0?i:(i-ownIndex+8)%5;
    const own=p.name===owner;
    const onClock=follow && at===session.events.length-1 && session.status==='running' && session.waitingFor===p.name && session.turnStartedAt;
    const active=follow && session.status==='running'?onClock:e.seat===i;
    const winner=e.type==='result' && e.pots.some(pot=>!pot.refund && pot.winners.includes(i));
    const index=session.lineup?.indexOf(p.name)??i;
    const badge=[i===e.button?'D':'',i===e.small?'SB':'',i===e.big?'BB':''].filter(Boolean).join('/');
    let status=p.last || (ready?'':'In hand');
    if((p.last==='Small blind'||p.last==='Big blind') && p.streetBet)status+=' '+fmt(p.streetBet);
    if(Number.isFinite(p.lastResponseSeconds))status+=' · '+responseTime(p.lastResponseSeconds);
    if(onClock)status=(own?'Your turn':'Thinking')+' · '+Math.max(0,Math.floor((Date.now()-session.turnStartedAt)/1000))+' s';
    const revealed=e.shown?.find(q=>q.name===p.name);
    if(revealed)status=rankedHand(revealed,e.board);
    const cards=p.hiddenCount?Array(p.hiddenCount).fill(null):p.cards;
    return `<div class="pod seat${position}${own?' hero':''}${p.folded?' folded':''}${active?' acting':''}${winner?' winner':''}${revealed?' revealed':''}">
      <img class="avatar" src="assets/player-${index<0?i:index}.webp" alt="">
      <div class="hole">${cards.map(c=>card(c,true)).join('')}</div>
      <div class="seatplate"><div class="playername" title="${esc(p.name)}">${esc(p.name)}</div><div class="stack">${fmt(p.stack)}</div>
      ${badge?'<b class="position-tag">'+badge+'</b>':''}</div>
      ${status?'<div class="seatstatus">'+esc(status)+'</div>':''}
      ${chipPile(p.stack,session.rules.stack)}</div>`;
  }).join('');
  const pot=e.type==='result'?e.pots.filter(p=>!p.refund).reduce((s,p)=>s+p.amount,0):e.pot;
  $('#stage').innerHTML=`<div class="stagebar"><span class="stageid">${icon('spade')} Table 01</span><span class="stageview">${icon(owner?'people':'eye')} ${session.mySeat?'Player view':session.privateTable?'Public view':'Spectator view'}</span></div>
    <div class="felt" aria-hidden="true"></div>
    <div class="centerboard">${e.type==='result'?`<div class="winnertext">${esc(e.text)}</div>`:'<div class="feltmark" aria-hidden="true">Poker Bench</div>'}
    ${ready?'<div class="streetlabel">Waiting for the deal</div>':`<div class="pot">${e.type==='result'?'':chipPile(e.pot,session.rules.stack)}<small>${e.type==='result'?'Awarded':'Total pot'}</small><b>${fmt(pot)}</b></div>
    <div class="boardcards">${Array.from({length:5},(_,i)=>card(e.board[i])).join('')}</div><div class="streetlabel">${e.type==='result'&&!e.shown.length?'Won by folds':!ready && lockedRunout(e)?'All-in runout':esc(e.street)}</div>`}</div>${seats}
    ${ready?'':`<button id="audit" class="stageaudit">${icon('shield')} Fairness log</button>`}`;
  if(!ready)$('#audit').onclick=auditDialog;
  const result=ready?null:session.events.slice(0,at+1).findLast(x=>x.type==='result');
  const last=$('#lastHand');last.hidden=!result;
  if(result){last.textContent='Hand '+result.hand+' · '+result.text+' · View result';last.onclick=()=>handRecap(result);}
  $('#handmetric').textContent=(ready?'0':e.hand)+' / '+session.rules.hands;
  $('#gameformat').textContent=session.rules.format==='duplicate'?'Duplicate deals':'Continuous stacks';
  $('#blinds').textContent=fmt(session.rules.sb)+' / '+fmt(session.rules.sb*2);
  $('#atTable').textContent=ready?'5':String(e.players.filter(p=>p.cards.length||p.hiddenCount).length);
  $('.feedtabs').hidden=ready;
  $('#roomSeats').hidden=!ready;
  if(ready)$('#roomSeats').innerHTML='<h3>Lineup</h3>'+e.players.map((p,i)=>`<div><img src="assets/player-${i}.webp" alt=""><span><strong>${esc(p.name)}</strong><small>${esc(session.models[p.name])}</small></span></div>`).join('');
}
function renderFeed(events){
  const feed=$('#feed'), wasAtEnd=feed.scrollHeight-feed.scrollTop-feed.clientHeight<30;
  const visible=feedType==='talk'?transcript(session,at):events;
  $('#chatcount').textContent=visible.length+(feedType==='talk'?' messages':' events');
  let previous='',html='';
  for(const e of visible.slice(-65)){
    const marker='Hand '+pad(e.hand)+' · '+e.street;
    if(marker!==previous){html+='<div class="feedsep">'+esc(marker)+'</div>';previous=marker;}
    const duration=timingLabel(e);
    if(feedType==='talk'){
      html+='<div class="message">'+face(e.speaker)+'<div><div class="messagehead"><strong>'+esc(e.speaker)+'</strong><small>'+(duration?duration+' · ':'')+'#'+pad(e.index+1)+'</small></div><div class="bubble">'+esc(e.chat)+'</div></div></div>';
    }else{
      const shown=e.shown?.map(p=>esc(p.name)+' · '+esc(p.hand)).join(' / ');
      const pots=e.pots?.map((p,i)=>(p.refund?'Refund':i?'Side pot':'Main pot')+' '+fmt(p.amount)+' — '+p.winners.map(w=>esc(e.players[w].name)).join(', ')).join('<br>');
      html+='<div class="actionline"><small>EVENT '+pad(e.index+1)+(duration?' · '+duration:'')+'</small>'+esc(e.text)+(shown?'<br>'+shown:'')+(pots?'<br>'+pots:'')+'</div>';
    }
  }
  feed.innerHTML=html||'<p class="emptymsg">Waiting for the first table comment.</p>';
  if(wasAtEnd||!playing)feed.scrollTop=feed.scrollHeight;
  all('[data-feed]').forEach(b=>b.classList.toggle('selected',b.dataset.feed===feedType));
}
function render(){
  if(!session?.events.length)return;
  const e=session.events[at], events=session.events.slice(0,at+1), total=session.events.length;
  $('#seatEntry').hidden=true;
  $('.ledger').hidden=false;$('#replayPanel').hidden=false;
  if($('#replayPanel').dataset.session!==session.id){
    $('#replayPanel').open=!(session.mySeat && session.status==='running');
    $('#replayPanel').dataset.session=session.id;
  }
  $('#modeTag').textContent=sessionLabel(session);
  $('#download').disabled=!!session.privateTable;
  renderDecision($('#decision'),session,follow && at===total-1,async payload=>{
    const id=session.id;
    if(id===practiceId && practice)await practice.call('move',payload);
    else await api('sessions/'+id+'/move',payload);
    if(session.id===id){if(session.turn?.id===payload.turnId)session.turn=null;render();}
  });
  renderStage(e);renderFeed(events);
  const composer=$('#tableChat');
  composer.hidden=!(session.mySeat && Array.isArray(session.tableChat) && ['running','paused'].includes(session.status) && follow && at===total-1);
  composer.querySelector('button').disabled=composer.dataset.sending==='yes';
  $('#chatstatus').textContent=session.chatError||'';
  const timed=session.version===VERSION;
  $('#feedclock').textContent=timed?(session.mode==='demo'?'Simulated move times':'Observed move times'):'Move times unavailable in this replay';
  const tablePace=$('#speed option[value="table"]');tablePace.disabled=!timed;
  if(!timed && $('#speed').value==='table')$('#speed').value='1';
  $('#eventcount').textContent='EVENT '+pad(at+1)+' / '+pad(total);
  const range=$('#timeline');range.max=total-1;range.value=at;range.style.setProperty('--progress',((at/(total-1)||0)*100)+'%');
  const hands=session.events.filter(x=>x.type==='deal');
  $('#ticks').innerHTML=hands.map(x=>'<b class="tick" style="left:'+100*x.index/Math.max(1,total-1)+'%"></b>').join('');
  $('#moment').innerHTML='<select id="handsel" aria-label="Jump to hand">'+hands.map(x=>'<option value="'+x.index+'" '+(e.hand===x.hand?'selected':'')+'>Hand '+pad(x.hand)+'</option>').join('')+'</select><span> / '+esc(e.street)+'</span>';
  $('#handsel').onchange=ev=>seek(Number(ev.target.value));
  $('#back').disabled=at===0;$('#forward').disabled=at===total-1;
  $('#play').innerHTML=icon(playing?'pause':'play');$('#play').setAttribute('aria-label',playing?'Pause replay':'Play replay');
  const delta=p=>session.rules.format==='duplicate'?(e.net[p.name]||0)+(e.type==='result'?0:p.stack-session.rules.stack):p.stack-session.rules.stack;
  $('#standingCaption').textContent=session.rules.format==='duplicate'?'Cumulative net chips':'Hand '+pad(e.hand)+' · Stack size';
  const order=[...e.players].sort((a,b)=>session.rules.format==='duplicate'?delta(b)-delta(a):b.stack-a.stack);
  const maxStack=Math.max(1,...order.map(p=>p.stack));
  $('#standings').innerHTML='<table><thead><tr><th>Rank</th><th>Player</th><th>Model</th><th>Last action</th><th class="num">Stack</th><th class="num">Net chips</th></tr></thead><tbody>'+order.map((p,i)=>{
    const d=delta(p),model=session.models?.[p.name]?.model||'Demo policy';
    return `<tr><td>${pad(i+1)}</td><td><span class="who">${face(p.name)}<strong>${esc(p.name)}</strong></span></td><td>${esc(model)}</td><td>${esc(p.last||'In hand')}</td><td class="num"><span class="stackbar"><b style="width:${100*p.stack/maxStack}%"></b></span>${fmt(p.stack)}</td><td class="num ${d>0?'gain':''}">${d>0?'+':''}${fmt(d)}</td></tr>`;
  }).join('')+'</tbody></table>';
  $('#runstatus').innerHTML='';
  if(at===total-1 && session.status==='complete'){
    const results=events.filter(x=>x.type==='result');
    const top=Math.max(...Object.values(e.net));
    const leaders=(session.lineup??NAMES).filter(n=>e.net[n]===top);
    const wonPot=x=>x.pots.filter(p=>!p.refund).reduce((t,p)=>t+p.amount,0);
    const biggest=results.reduce((a,b)=>wonPot(a)>=wonPot(b)?a:b);
    $('#runstatus').innerHTML='<div class="noticebox summary"><strong>Session complete</strong> · '+results.length+' hands · '+leaders.map(esc).join(' and ')+(leaders.length===1?' leads':' share first place')+' with '+(top>0?'+':'')+fmt(top)+' net chips. <button id="bigpot">Largest pot · '+fmt(wonPot(biggest))+' in hand '+biggest.hand+'</button></div>';
    $('#bigpot').onclick=()=>seek(biggest.index);
  }
  if(['running','paused'].includes(session.status)&&(knownCurrent===session.id||practiceId===session.id)){
    const box=document.createElement('div');box.className='noticebox';box.textContent=session.status==='paused'?'Session paused. '+session.error:session.mySeat && follow?'':sessionLabel(session)+' · '+(session.waitingFor||'Dealer')+' is acting.';
    const add=(text,fn)=>{const b=document.createElement('button');b.textContent=text;b.onclick=fn;box.append(b);};
    if(session.status==='paused' && (!session.privateTable || session.mySeat))add('Retry turn',()=>control('retry'));
    if(!follow)add('Follow live',()=>{stopPlay();follow=true;at=session.events.length-1;render();});
    if(!session.privateTable||session.mySeat)add('End session',()=>{modal('End this session?','<p class="muted">The dealer will stop accepting moves. Recorded events will stay available for replay.</p><div class="formfoot"><button id="endrun" class="primary">End session</button></div>');$('#endrun').onclick=()=>{$('#dialog').close();control('stop');};});
    $('#runstatus').append(box);
  }
}
function stopPlay(){playing=false;clearTimeout(timer);}
function seek(pos){stopPlay();follow=false;at=Math.min(Math.max(0,pos),session.events.length-1);render();}
function tick(){
  clearTimeout(timer);
  if(!playing)return;
  const next=session.events[at+1];
  if(!next){stopPlay();render();return;}
  const speed=$('#speed').value;
  const resultDelay=session.events[at].type==='result'?4500:0;
  const delay=resultDelay/(Number(speed)||1) || (speed==='table'?(next.responseSeconds??0.4)*1000:1500/Number(speed));
  timer=setTimeout(()=>{at++;render();tick();},delay);
}
function startPlay(){if(at===session.events.length-1)at=0;playing=true;follow=false;render();tick();}
function modal(title,html){$('#dialogtitle').textContent=title;$('#dialogbody').innerHTML=html;if(!$('#dialog').open)$('#dialog').showModal();}
function stamp(s){return new Date(s.created).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});}
async function pick(s,pos=0,watch=false){
  generation++;revealUntil=0;clearTimeout(pollTimer);stopPlay();session=s;at=Math.min(pos,Math.max(0,s.events.length-1));follow=watch;page='table';location.hash='table';showPage();render();
  if(watch && ['running','paused'].includes(s.status))poll(generation);
}
async function poll(gen){
  try{
    const delta=await readSession(session.id,session.events.length,session.privateTable);
    if(gen!==generation)return;
    const {events,replaceHistory,...meta}=delta;
    for(const key of ['turnStartedAt','waitingFor','privateTable','mySeat','turn'])delete session[key];
    Object.assign(session,meta);
    if(replaceHistory)session.events=events;else session.events.push(...events);
    if(follow){
      const result=events.findLast(e=>e.type==='result');
      if(!replaceHistory && result && session.status==='running'){
        at=result.index;revealUntil=Date.now()+(result.shown.length?5100:2200);
      }
      if(session.turn || session.status!=='running' || Date.now()>=revealUntil)at=Math.max(0,session.events.length-1);
    }
    render();
    if(!['running','paused'].includes(session.status)){await persist(session);
      if(session.id===practiceId){practice.close();practice=null;practiceId=null;}
      return;}
  }catch(e){if(gen===generation)notify('Connection interrupted. Reconnecting to the local dealer.');}
  if(gen===generation)pollTimer=setTimeout(()=>poll(gen),1150);
}
async function control(action){try{if(session.id===practiceId && practice)await practice.call(action);else await api('sessions/'+session.id+'/'+action,{});}catch(e){notify(e.message);}}
async function persist(s){library.set(s.id,s);try{await save(s);}catch{notify('Browser storage unavailable. Export the replay to keep it.');}}
function showPage(){const archive=page==='archive';$('#archivePage').hidden=!archive;$('#tablePage').hidden=archive;all('[data-go]').forEach(b=>b.classList.toggle('active',b.dataset.go===page));if(archive)renderArchive();}
async function renderArchive(){
  const entries=new Map(library);
  if(practiceId && session?.id===practiceId)entries.set(practiceId,session);
  if(local){try{for(const s of await api('sessions'))entries.set(s.id,s);}catch{notify('Local session list unavailable');}}
  $('#archiveList').innerHTML=[...entries.values()].sort((a,b)=>b.created.localeCompare(a.created)).map(s=>'<button class="archiveitem" data-id="'+esc(s.id)+'">'+icon('replay')+'<div><span>'+esc(s.id===openingId?'Opening table':s.id==='opening-table'?'Opening table (original)':sessionLabel(s))+' · '+esc(s.rules.format==='duplicate'?'Duplicate deals':'No-limit Hold’em')+'</span><small>'+esc(stamp(s))+' · '+s.rules.hands+' hands scheduled · '+esc(s.status)+'</small></div>'+icon('chevron')+'</button>').join('');
  all('.archiveitem').forEach(b=>b.onclick=async()=>{try{let s=entries.get(b.dataset.id);if(practiceId && s.id!==practiceId)throw Error('End the practice session before opening another recording.');if(!s.events||s.id===practiceId)s=await readSession(s.id);const watch=s.id===knownCurrent||s.id===practiceId;await pick(s,watch?Math.max(s.events.length-1,0):0,watch);}catch(e){notify(e.message);}});
}
async function startLocal(options){
  const {id}=await api('sessions',options);knownCurrent=id;
  const s=await readSession(id);await pick(s,Math.max(0,s.events.length-1),true);
}
function showOpenSeat(){
  const human={name:'You',slot:NAMES.at(-1)};
  const rules={hands:12,stack:2000,sb:10,format:'session'};
  const lineup=NAMES.map(slot=>slot===human.slot?human.name:players[slot].name);
  const models=Object.fromEntries(NAMES.map((slot,i)=>[lineup[i],slot===human.slot?'Your seat':players[slot].model]));
  session={status:'ready',mySeat:human.name,privateTable:true,rules,lineup,models,events:[]};
  renderStage({players:lineup.map(name=>({name,cards:[],stack:rules.stack})),board:[],type:'waiting',pot:0});
  $('#modeTag').textContent='Open table';$('#feedclock').textContent='120 seconds per turn';
  $('#tableChat').hidden=true;$('#feed').replaceChildren();$('#chatcount').textContent='5 players';$('#decision').hidden=true;
  $('#runstatus').replaceChildren();$('.ledger').hidden=true;$('#replayPanel').hidden=true;
  const entry=$('#seatEntry');entry.hidden=false;
  entry.innerHTML='<div><strong>Your seat is ready</strong><span>2,000 chips · 12 hands</span></div><button class="primary dealin">Deal me in</button>';
  const button=entry.querySelector('button');
  button.onclick=async()=>{button.disabled=true;try{await startLocal({...rules,human,mode:'models'});}catch(e){notify(e.message);button.disabled=false;}};
}
function newDialog(draft){
  if(practiceId){notify('End the current practice session before starting another.');return;}
  modal('New session','<form id="newform"><div class="formgrid"><label class="field wide">Your role<select name="role"><option value="watch">Spectate</option><option value="play">Play a seat</option></select></label><label class="field humanfield" hidden>Your name<input name="humanName" value="You" maxlength="24"></label><label class="field humanfield" hidden>Replace seat<select name="slot"></select></label><label class="field wide">Opponents<select name="mode"><option value="demo">Demo players · no keys required</option><option value="models">Live models · configured providers</option></select></label><label class="field wide">Game format<select name="format"><option value="session">Continuous stacks</option><option value="duplicate">Duplicate deals · five seat rotations</option></select></label><label class="field">Hands<input type="number" name="hands" value="12" min="1" max="100" required></label><label class="field">Starting stack<input type="number" name="stack" value="2000" min="10" max="1000000" required></label><label class="field">Small blind<input type="number" name="sb" value="10" min="1" required></label><label class="field">Big blind<input name="bb" value="20" readonly></label></div><p id="newnote" class="formnote"></p><p id="formerror" role="alert"></p><div class="formfoot"><button class="secondary" type="button" id="connections">Players</button><button class="primary" type="submit">Start session</button></div></form>');
  const form=$('#newform');
  const note=()=>{
    const joined=form.elements.role.value==='play';
    form.querySelectorAll('.humanfield').forEach(el=>el.hidden=!joined);
    form.elements.humanName.required=joined;
    const slot=form.elements.slot.value||NAMES.at(-1);
    form.elements.slot.innerHTML=NAMES.map(n=>'<option value="'+n+'">'+esc(form.mode.value==='models'?(players[n]?.name||n):n)+'</option>').join('');
    form.elements.slot.value=slot;
    if(joined)form.format.value='session';
    form.format.querySelector('[value=duplicate]').disabled=joined;
    $('#newnote').textContent=joined?'Play against four opponents. You have 120 seconds per turn. On timeout the dealer checks or folds. '+(!local?'Keep this tab open during practice.':''): (form.mode.value==='demo'?'Demo players share one seeded policy. ':local?'Each seat uses its saved model and provider. ':'Live model play runs in the local Poker Bench app. Open http://localhost:4395 after running npm start. ')+(form.format.value==='duplicate'?'Stacks and conversation reset every hand. Each five-hand block rotates one deal through every seat.':'Chips carry over between hands. The dealer button moves each hand.');};
  if(draft?.mode)for(const name of ['mode','format','hands','stack','sb','bb','role','humanName'])if(draft[name]!=null)form.elements[name].value=draft[name];
  form.elements.role.onchange=note;form.mode.onchange=note;form.format.onchange=()=>{if(form.format.value==='duplicate')form.hands.value=Math.max(5,Math.ceil(Number(form.hands.value)/5)*5);note();};form.sb.oninput=()=>form.bb.value=Number(form.sb.value)*2;note();if(draft?.slot)form.elements.slot.value=draft.slot;
  $('#connections').onclick=()=>{
    const draft=Object.fromEntries(new FormData(form));
    configDialog(()=>newDialog(draft));
  };
  form.onsubmit=async ev=>{ev.preventDefault();const btn=form.querySelector('[type=submit]');btn.disabled=true;$('#formerror').textContent='';
    try{const options={format:form.format.value,hands:Number(form.hands.value),stack:Number(form.stack.value),sb:Number(form.sb.value)};
      const joined=form.elements.role.value==='play';
      if(joined)options.human={slot:form.elements.slot.value,name:form.elements.humanName.value.trim()};
      if(joined && form.mode.value==='demo')options.mode='practice';
      if(joined && !local && options.mode==='practice'){
        practice=practiceClient();
        try{
          const {id}=await practice.call('start',options);practiceId=id;
          const s=await readSession(id);await pick(s,Math.max(0,s.events.length-1),true);$('#dialog').close();
        }catch(error){practice.close();practice=null;practiceId=null;throw error;}
      }else if(form.mode.value==='models'||joined){
        if(!local)throw Error('Use the local app at http://localhost:4395 for live model play.');
        await startLocal(options);$('#dialog').close();
      }else{const s=await simulate({seed:makeSeed(),options});await persist(s);await pick(s);$('#dialog').close();startPlay();}
    }catch(e){$('#formerror').textContent=e.message;}finally{btn.disabled=false;}};
}
function configDialog(afterSave){
  if(!local){
    modal('Model lineup','<div class="protocol"><p>Run Poker Bench on your computer to configure API keys and model IDs.</p><pre>git clone https://github.com/Sahaj0312/poker-bench.git\ncd poker-bench\nnpm start</pre><a href="http://localhost:4395">Open the local table</a></div>');
    return;
  }
  editLineup({players,api,modal,onSave:updated=>{players=updated;$('#dialog').close();notify('Model lineup saved');if(typeof afterSave==='function')afterSave();}});
}
function auditDialog(){
  const s=session;
  modal('Fairness log','<div class="protocol"><p>'+esc(s.humanName?'Human participant: '+s.humanName+'. The dealer shows public cards and the participant’s own hand during play.':s.mode==='demo'?'Demo recording. All five seats used the same simulated decision policy.':'Model recording. Each player received its own hole cards, public table state, and the same legal moves.')+'</p>'+(s.chatMode==='group'?'<h3>Group chat</h3><p>Every chat-capable seat can open a conversation, answer any player, or stay silent. Off-turn decisions use the public table and shared chat. Each seat has its own clock, with at least 12 seconds between chat checks.</p>':'')+(s.betSizing?'<h3>Raise sizes</h3><p>All seats can choose minimum, half-pot, pot, double-pot, or all-in raises when legal. TypeSafe seats play silently.</p>':'')+'<h3>Table clock</h3><p>'+esc(s.version!==VERSION?'This recording predates the table clock.':s.mode==='demo'?'Demo response times come from a reproducible simulation.':'The dealer times each successful request to a tenth of a second, including network and provider latency. Failed attempts and retry pauses are excluded. Recorded time is an observation supplied to replay verification.')+'</p><h3>Dealer protocol</h3><p>Seeded Fisher–Yates shuffle, randomized opening seats, fixed blinds, and an independent rules engine. The dealer commits to the seed before play.</p><h3>Game format</h3><p>'+esc(s.rules.format==='duplicate'?'Duplicate deals. Each block of five hands reuses one deal, rotates players, and resets stacks and chat.':'Continuous stacks. The button rotates and conversation carries between hands.')+'</p><h3>Seed commitment · SHA-256</h3><p><code>'+esc(s.commitment)+'</code></p><h3>Revealed seed</h3><p><code>'+esc(s.seed||'Available when the session ends')+'</code></p><h3>Players</h3><p>'+(s.lineup??NAMES).map(n=>esc(n)+' · '+esc(s.models?.[n]?.model||(s.mode==='demo'?'Demo policy v1':'Unspecified'))).join('<br>')+'</p><h3>Dealer version</h3><p><code>'+esc(s.version)+'</code></p>'+(s.incidents?.length?'<h3>Interrupted decisions</h3><p>'+s.incidents.map(x=>esc(x.error)).join('<br>')+'</p>':'')+'<p id="verification" role="status"></p><div class="formfoot"><button class="primary" id="verify" '+(s.status==='complete'?'':'disabled')+'>Verify replay</button></div></div>');
  $('#verify').onclick=async ev=>{ev.target.disabled=true;try{$('#verification').textContent='Verified '+await verify(s)+' events from the revealed seed and recorded moves.';}catch(e){$('#verification').textContent=e.message;}finally{ev.target.disabled=false;}};
}
function exportSession(){if(session.privateTable)return;const url=URL.createObjectURL(new Blob([JSON.stringify(session)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='poker-bench-'+session.id+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}
function themeControl(){
  const light=document.documentElement.dataset.theme==='light',button=$('#theme');
  button.innerHTML=icon(light?'moon':'sun');button.title=light?'Use dark theme':'Use light theme';
  button.setAttribute('aria-label',button.title);
  document.querySelector('meta[name="theme-color"]').content=light?'#f7f8f8':'#0e1318';
}
$('#theme').onclick=()=>{
  const choice=document.documentElement.dataset.theme==='light'?'dark':'light';
  document.documentElement.dataset.theme=choice;
  try{localStorage.setItem('poker-theme',choice);}catch{}
  themeControl();
};
themeControl();paintIcons();$('#settings').onclick=configDialog;$('#new').onclick=newDialog;$('#close').onclick=()=>$('#dialog').close();$('#download').onclick=exportSession;$('#speed').onchange=tick;
$('#play').onclick=()=>{if(playing){stopPlay();render();}else startPlay();};
$('#tableChat').onsubmit=async ev=>{
  ev.preventDefault();
  const form=ev.currentTarget,input=form.elements.message,button=form.querySelector('button');
  if(button.disabled||!input.value.trim())return;
  const id=session.id, original=input.value, payload={id:crypto.randomUUID(),text:original.trim()};
  form.dataset.sending='yes';button.disabled=true;
  try{
    if(id===practiceId && practice)await practice.call('chat',payload);
    else await api('sessions/'+id+'/chat',payload);
    if(session.id===id){
      if(input.value===original)input.value='';
      feedType='talk';const latest=await readSession(id,session.events.length);
      if(session.id===id){session.tableChat=latest.tableChat;session.chatError=latest.chatError;render();}
    }
  }catch(error){notify(error.message);}
  finally{delete form.dataset.sending;if(session.id===id)button.disabled=false;}
};
$('#back').onclick=()=>seek(at-1);$('#forward').onclick=()=>seek(at+1);$('#timeline').oninput=e=>seek(Number(e.target.value));
all('[data-feed]').forEach(b=>b.onclick=()=>{feedType=b.dataset.feed;render();$('#feed').scrollTop=$('#feed').scrollHeight;});
all('[data-go]').forEach(b=>b.onclick=()=>{location.hash=b.dataset.go;});window.onhashchange=()=>{page=location.hash==='#archive'?'archive':'table';showPage();};
$('#import').onclick=()=>$('#file').click();$('#file').onchange=async ev=>{try{if(practiceId)throw Error('End practice before importing a replay.');const file=ev.target.files[0];if(!file)return;if(file.size>100e6)throw Error('Replay exceeds 100 MB.');const s=JSON.parse(await file.text());checkRecord(s);if(s.status==='complete')await verify(s);await persist(s);await pick(s);notify('Replay imported');}catch(e){notify(e.message);}finally{ev.target.value='';}};
document.addEventListener('keydown',e=>{if($('#dialog').open||!session?.events?.length||page!=='table'||['INPUT','SELECT','BUTTON','TEXTAREA'].includes(document.activeElement.tagName))return;
  if(e.code==='Space'){e.preventDefault();$('#play').click();}if(e.key==='ArrowLeft')seek(at-1);if(e.key==='ArrowRight')seek(at+1);});
async function boot(){
  if(['localhost','127.0.0.1'].includes(location.hostname)){try{const data=await api('config');players=data.players;knownCurrent=data.current;local=true;}catch{}}
  try{for(const s of await list())library.set(s.id,s);}catch{}
  let demo=library.get(openingId);
  if(!demo){demo=await simulate({seed:'river-room-opening-session-v1',id:openingId,created:new Date().toISOString()});await persist(demo);}
  session=demo;at=Math.max(0,demo.events.findIndex(e=>e.street==='Flop'&&e.type==='action'));render();$('#feed').scrollTop=$('#feed').scrollHeight;
  page=location.hash==='#archive'?'archive':'table';showPage();
  if(knownCurrent){const s=await api('sessions/'+knownCurrent);if(['running','paused'].includes(s.status)&&page==='table'){await pick(s,Math.max(0,s.events.length-1),true);return;}}
  if(local && location.hash==='#play')showOpenSeat();
}
window.addEventListener('beforeunload',e=>{if(practiceId){e.preventDefault();e.returnValue='';}});
boot().catch(e=>notify('Unable to open the table: '+e.message));
