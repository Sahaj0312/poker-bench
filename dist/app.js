import {simulate,makeSeed,NAMES,VERSION} from './engine.js';
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
let knownCurrent=null;
function notify(msg){$('#notice').textContent=msg;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>$('#notice').textContent='',4500);}
async function api(path,body){
  const res=await fetch('/api/'+path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data=await res.json();if(!res.ok)throw Error(data.error||'Request failed');return data;
}
function card(c,mini=false){
  if(!c)return '<span aria-label="Undealt card" class="card empty">◇</span>';
  const rank=c[0]==='T'?'10':c[0], pip=suit[c[1]];
  const content=mini?rank+'<small>'+pip+'</small>':'<span class="rank">'+rank+'</span><span class="pip">'+pip+'</span><span class="bottompip">'+pip+'</span>';
  return '<span aria-label="'+rank+' of '+({s:'spades',h:'hearts',d:'diamonds',c:'clubs'})[c[1]]+'" class="card '+('hd'.includes(c[1])?'red':'')+'">'+content+'</span>';
}
function renderStage(e){
  const seats=e.players.map((p,i)=>{
    const badge=[i===e.button?'D':'',i===e.small?'SB':'',i===e.big?'BB':''].filter(Boolean).join('/');
    const onClock=follow && at===session.events.length-1 && session.status==='running' && session.waitingFor===p.name && session.turnStartedAt;
    const active=follow && session.status==='running'?onClock:e.seat===i;
    let status=p.last||'In hand';
    if(Number.isFinite(p.lastResponseSeconds)) status+=' · '+responseTime(p.lastResponseSeconds);
    if(onClock) status='Acting · '+Math.max(0,Math.floor((Date.now()-session.turnStartedAt)/1000))+' s';
    return `<div class="pod seat${i}${p.folded?' folded':''}${active?' acting':''}">
      <div class="seatbody">${face(p.name)}<div class="info"><div class="playername" title="${esc(p.name)}">${esc(p.name)}</div><div class="stack">${fmt(p.stack)}</div></div>
      <div class="hole">${p.cards.map(c=>card(c,true)).join('')}</div></div>
      <div class="seatstatus">${badge?'<b class="posbadge">'+badge+'</b>':''}<span>${esc(status)}</span></div></div>`;
  }).join('');
  const pot=e.type==='result'?e.pots.filter(p=>!p.refund).reduce((s,p)=>s+p.amount,0):e.pot;
  $('#stage').innerHTML=`<div class="stagebar"><span class="stageid">${icon('table')} Table 01</span><span class="stageview">${icon('eye')} Spectator view</span></div>
    <div class="felt" aria-hidden="true"><div class="feltin"></div></div>
    <div class="centerboard"><div class="pot">${icon('layers')}<small>${e.type==='result'?'Awarded':'Pot'}</small><b>${fmt(pot)}</b></div>
    <div class="boardcards">${Array.from({length:5},(_,i)=>card(e.board[i])).join('')}</div><div class="streetlabel">${esc(e.street)}</div></div>${seats}
    <button id="audit" class="stageaudit">${icon('shield')} Fairness log</button>`;
  $('#audit').onclick=auditDialog;
  $('#handmetric').textContent=pad(e.hand)+' / '+pad(session.rules.hands);
  $('#gameformat').textContent='No-limit Texas Hold’em · '+(session.rules.format==='duplicate'?'Duplicate deals':'Continuous stacks');
  $('#blinds').textContent=fmt(session.rules.sb)+' / '+fmt(session.rules.sb*2);
  $('#atTable').textContent=pad(e.players.filter(p=>p.cards.length).length);

}
function renderFeed(events){
  const feed=$('#feed'), wasAtEnd=feed.scrollHeight-feed.scrollTop-feed.clientHeight<30;
  const visible=feedType==='talk'?events.filter(e=>e.chat):events;
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
  $('#modeTag').textContent=session.mode==='demo'?'Demo session':session.status==='running'?'Live session':'Model session';
  renderStage(e);renderFeed(events);
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
  if(session.mode==='models'&&['running','paused'].includes(session.status)&&local&&knownCurrent===session.id){
    const box=document.createElement('div');box.className='noticebox';box.textContent=session.status==='paused'?'Session paused. '+session.error:'Live session · '+(session.waitingFor||'Dealer')+' is acting.';
    const add=(text,fn)=>{const b=document.createElement('button');b.textContent=text;b.onclick=fn;box.append(b);};
    if(session.status==='paused')add('Retry turn',()=>control('retry'));
    if(!follow)add('Follow live',()=>{stopPlay();follow=true;at=session.events.length-1;render();});
    add('End session',()=>{modal('End this session?','<p class="muted">The dealer will stop accepting moves. Recorded events will stay available for replay.</p><div class="formfoot"><button id="endrun" class="primary">End session</button></div>');$('#endrun').onclick=()=>{$('#dialog').close();control('stop');};});
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
  const delay=speed==='table'?(next.responseSeconds??0.4)*1000:1500/Number(speed);
  timer=setTimeout(()=>{at++;render();tick();},delay);
}
function startPlay(){if(at===session.events.length-1)at=0;playing=true;follow=false;render();tick();}
function modal(title,html){$('#dialogtitle').textContent=title;$('#dialogbody').innerHTML=html;if(!$('#dialog').open)$('#dialog').showModal();}
function stamp(s){return new Date(s.created).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});}
async function pick(s,pos=0,watch=false){
  generation++;clearTimeout(pollTimer);stopPlay();session=s;at=Math.min(pos,Math.max(0,s.events.length-1));follow=watch;page='table';location.hash='table';showPage();render();
  if(watch && ['running','paused'].includes(s.status))poll(generation);
}
async function poll(gen){
  try{
    const delta=await api('sessions/'+session.id+'?from='+session.events.length);
    if(gen!==generation)return;
    const {events,...meta}=delta;Object.assign(session,{turnStartedAt:null,waitingFor:null},meta);session.events.push(...events);
    if(follow)at=Math.max(0,session.events.length-1);
    render();
    if(!['running','paused'].includes(session.status)){await persist(session);return;}
  }catch(e){if(gen===generation)notify('Connection interrupted. Reconnecting to the local dealer.');}
  if(gen===generation)pollTimer=setTimeout(()=>poll(gen),1150);
}
async function control(action){try{await api('sessions/'+session.id+'/'+action,{});}catch(e){notify(e.message);}}
async function persist(s){library.set(s.id,s);try{await save(s);}catch{notify('Browser storage unavailable. Export the replay to keep it.');}}
function showPage(){const archive=page==='archive';$('#archivePage').hidden=!archive;$('#tablePage').hidden=archive;all('[data-go]').forEach(b=>b.classList.toggle('active',b.dataset.go===page));if(archive)renderArchive();}
async function renderArchive(){
  const entries=new Map(library);
  if(local){try{for(const s of await api('sessions'))entries.set(s.id,s);}catch{notify('Local session list unavailable');}}
  $('#archiveList').innerHTML=[...entries.values()].sort((a,b)=>b.created.localeCompare(a.created)).map(s=>'<button class="archiveitem" data-id="'+esc(s.id)+'">'+icon('replay')+'<div><span>'+esc(s.id===openingId?'Opening table':s.id==='opening-table'?'Opening table (original)':s.mode==='demo'?'Demo session':'Model session')+' · '+esc(s.rules.format==='duplicate'?'Duplicate deals':'No-limit Hold’em')+'</span><small>'+esc(stamp(s))+' · '+s.rules.hands+' hands scheduled · '+esc(s.status)+'</small></div>'+icon('chevron')+'</button>').join('');
  all('.archiveitem').forEach(b=>b.onclick=async()=>{try{let s=entries.get(b.dataset.id);if(!s.events)s=await api('sessions/'+s.id);await pick(s,0,local&&s.id===knownCurrent);}catch(e){notify(e.message);}});
}
function newDialog(draft){
  modal('New session','<form id="newform"><div class="formgrid"><label class="field wide">Players<select name="mode"><option value="demo">Demo · five simulated players</option><option value="models">Live models · configured providers</option></select></label><label class="field wide">Game format<select name="format"><option value="session">Continuous stacks</option><option value="duplicate">Duplicate deals · five seat rotations</option></select></label><label class="field">Hands<input type="number" name="hands" value="12" min="1" max="100" required></label><label class="field">Starting stack<input type="number" name="stack" value="2000" min="10" max="1000000" required></label><label class="field">Small blind<input type="number" name="sb" value="10" min="1" required></label><label class="field">Big blind<input name="bb" value="20" readonly></label></div><p id="newnote" class="formnote"></p><p id="formerror" role="alert"></p><div class="formfoot"><button class="secondary" type="button" id="connections">Players</button><button class="primary" type="submit">Start session</button></div></form>');
  const form=$('#newform');
  const note=()=>{$('#newnote').textContent=(form.mode.value==='demo'?'Demo players share one seeded policy. ':local?'Each seat uses its saved model and provider. ':'Live model play runs in the local Poker Bench app. Open http://localhost:4395 after running npm start. ')+(form.format.value==='duplicate'?'Stacks and conversation reset every hand. Each five-hand block rotates one deal through every seat.':'Chips carry over between hands. The dealer button moves each hand.');};
  if(draft?.mode)for(const name of ['mode','format','hands','stack','sb','bb'])form.elements[name].value=draft[name];
  form.mode.onchange=note;form.format.onchange=()=>{if(form.format.value==='duplicate')form.hands.value=Math.max(5,Math.ceil(Number(form.hands.value)/5)*5);note();};form.sb.oninput=()=>form.bb.value=Number(form.sb.value)*2;note();
  $('#connections').onclick=()=>{
    const draft=Object.fromEntries(new FormData(form));
    configDialog(()=>newDialog(draft));
  };
  form.onsubmit=async ev=>{ev.preventDefault();const btn=form.querySelector('[type=submit]');btn.disabled=true;$('#formerror').textContent='';
    try{const options={format:form.format.value,hands:Number(form.hands.value),stack:Number(form.stack.value),sb:Number(form.sb.value)};
      if(form.mode.value==='models'){
        if(!local)throw Error('Use the local app at http://localhost:4395 for live model play.');
        const {id}=await api('sessions',options);knownCurrent=id;
        const s=await api('sessions/'+id);await pick(s,0,true);$('#dialog').close();
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
  modal('Fairness log','<div class="protocol"><p>'+esc(s.mode==='demo'?'Demo recording. All five seats used the same simulated decision policy.':'Model recording. Each player received its own hole cards, public table state, and the same legal moves.')+'</p>'+(s.betSizing?'<h3>Raise sizes</h3><p>All seats can choose minimum, half-pot, pot, double-pot, or all-in raises when legal. TypeSafe seats play silently.</p>':'')+'<h3>Table clock</h3><p>'+esc(s.version!==VERSION?'This recording predates the table clock.':s.mode==='demo'?'Demo response times come from a reproducible simulation.':'The dealer times each successful request to a tenth of a second, including network and provider latency. Failed attempts and retry pauses are excluded. Recorded time is an observation supplied to replay verification.')+'</p><h3>Dealer protocol</h3><p>Seeded Fisher–Yates shuffle, randomized opening seats, fixed blinds, and an independent rules engine. The dealer commits to the seed before play.</p><h3>Game format</h3><p>'+esc(s.rules.format==='duplicate'?'Duplicate deals. Each block of five hands reuses one deal, rotates players, and resets stacks and chat.':'Continuous stacks. The button rotates and conversation carries between hands.')+'</p><h3>Seed commitment · SHA-256</h3><p><code>'+esc(s.commitment)+'</code></p><h3>Revealed seed</h3><p><code>'+esc(s.seed||'Available when the session ends')+'</code></p><h3>Players</h3><p>'+(s.lineup??NAMES).map(n=>esc(n)+' · '+esc(s.models?.[n]?.model||(s.mode==='demo'?'Demo policy v1':'Unspecified'))).join('<br>')+'</p><h3>Dealer version</h3><p><code>'+esc(s.version)+'</code></p>'+(s.incidents?.length?'<h3>Interrupted decisions</h3><p>'+s.incidents.map(x=>esc(x.error)).join('<br>')+'</p>':'')+'<p id="verification" role="status"></p><div class="formfoot"><button class="primary" id="verify" '+(s.status==='complete'?'':'disabled')+'>Verify replay</button></div></div>');
  $('#verify').onclick=async ev=>{ev.target.disabled=true;try{$('#verification').textContent='Verified '+await verify(s)+' events from the revealed seed and recorded moves.';}catch(e){$('#verification').textContent=e.message;}finally{ev.target.disabled=false;}};
}
function exportSession(){const url=URL.createObjectURL(new Blob([JSON.stringify(session)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='poker-bench-'+session.id+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}
paintIcons();$('#settings').onclick=configDialog;$('#new').onclick=newDialog;$('#close').onclick=()=>$('#dialog').close();$('#download').onclick=exportSession;$('#speed').onchange=tick;
$('#play').onclick=()=>{if(playing){stopPlay();render();}else startPlay();};
$('#back').onclick=()=>seek(at-1);$('#forward').onclick=()=>seek(at+1);$('#timeline').oninput=e=>seek(Number(e.target.value));
all('[data-feed]').forEach(b=>b.onclick=()=>{feedType=b.dataset.feed;render();$('#feed').scrollTop=$('#feed').scrollHeight;});
all('[data-go]').forEach(b=>b.onclick=()=>{location.hash=b.dataset.go;});window.onhashchange=()=>{page=location.hash==='#archive'?'archive':'table';showPage();};
$('#import').onclick=()=>$('#file').click();$('#file').onchange=async ev=>{try{const file=ev.target.files[0];if(!file)return;if(file.size>100e6)throw Error('Replay exceeds 100 MB.');const s=JSON.parse(await file.text());checkRecord(s);if(s.status==='complete')await verify(s);await persist(s);await pick(s);notify('Replay imported');}catch(e){notify(e.message);}finally{ev.target.value='';}};
document.addEventListener('keydown',e=>{if($('#dialog').open||page!=='table'||['INPUT','SELECT','BUTTON','TEXTAREA'].includes(document.activeElement.tagName))return;
  if(e.code==='Space'){e.preventDefault();$('#play').click();}if(e.key==='ArrowLeft')seek(at-1);if(e.key==='ArrowRight')seek(at+1);});
async function boot(){
  if(['localhost','127.0.0.1'].includes(location.hostname)){try{const data=await api('config');players=data.players;knownCurrent=data.current;local=true;}catch{}}
  try{for(const s of await list())library.set(s.id,s);}catch{}
  let demo=library.get(openingId);
  if(!demo){demo=await simulate({seed:'river-room-opening-session-v1',id:openingId,created:new Date().toISOString()});await persist(demo);}
  session=demo;at=Math.max(0,demo.events.findIndex(e=>e.street==='Flop'&&e.type==='action'));render();$('#feed').scrollTop=$('#feed').scrollHeight;
  page=location.hash==='#archive'?'archive':'table';showPage();
  if(knownCurrent){const s=await api('sessions/'+knownCurrent);if(['running','paused'].includes(s.status)&&page==='table')await pick(s,Math.max(0,s.events.length-1),true);}
}
boot().catch(e=>notify('Unable to open the table: '+e.message));
