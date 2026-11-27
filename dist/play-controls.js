export function practiceClient(){
  const worker=new Worker(new URL('./practice-worker.js',import.meta.url),{type:'module'});
  const pending=new Map();
  function rejectAll(error){
    for(const p of pending.values())p.reject(error);
    pending.clear();
  }
  worker.onmessage=({data})=>{
    const request=pending.get(data.id);
    if(!request)return;
    pending.delete(data.id);
    if(data.error)request.reject(Error(data.error));else request.resolve(data.result);
  };
  worker.onerror=()=>rejectAll(Error('The practice dealer stopped.'));
  return {
    call(method,value){
      const id=crypto.randomUUID();
      return new Promise((resolve,reject)=>{
        pending.set(id,{resolve,reject});worker.postMessage({id,method,value});
      });
    },
    close(){worker.terminate();rejectAll(Error('Practice ended.'));}
  };
}

export function renderDecision(panel,session,atLiveEdge,submit){
  const turn=session.mySeat && atLiveEdge && session.turn;
  panel.hidden=!(session.mySeat && atLiveEdge && session.status==='running');
  if(panel.hidden){panel.replaceChildren();delete panel.dataset.turn;return;}
  if(!turn){
    delete panel.dataset.turn;
    const waiting=session.waitingFor;
    panel.innerHTML='<div class="waitdock"><span class="turnlight"></span><strong></strong></div>';
    panel.querySelector('strong').textContent=waiting && waiting!==session.mySeat?'Waiting for '+waiting:'Waiting for the dealer';
    return;
  }
  const remaining=()=>Math.max(0,Math.ceil((turn.expiresAt-Date.now())/1000))+' s';
  // Preserve the amount, keyboard focus and unsent chat between dealer updates.
  if(panel.dataset.turn===turn.id){panel.querySelector('output').textContent=remaining();return;}
  panel.dataset.turn=turn.id;
  const {legal}=turn;
  const event=session.events.at(-1), own=event.players.find(p=>p.name===session.mySeat);
  const betting=event.players.every(p=>!p.streetBet);
  panel.innerHTML='<div class="decisionhead"><h2>Your turn</h2><output></output></div><form><label class="talkfield">Table talk<input name="chat" maxlength="180" placeholder="Message with your move" autocomplete="off"></label><div class="sizing"></div><div class="movelist"></div><p class="moveerror" role="alert"></p></form>';
  if(Array.isArray(session.tableChat))panel.querySelector('.talkfield').remove();
  panel.querySelector('output').textContent=remaining();
  const form=panel.querySelector('form');
  if(session.auditVersion===1){
    const label=document.createElement('label');label.className='showchoice';label.textContent='At hand end ';
    const show=document.createElement('select');show.name='showCards';
    for(const [text,value] of [['Auto-muck',''],['Show left card','left'],['Show right card','right'],['Show both','both']])show.add(new Option(text,value));
    label.append(show);form.append(label);
  }
  const moves=form.querySelector('.movelist');
  form.onsubmit=e=>e.preventDefault();
  function add(action,label){
    const button=document.createElement('button');
    button.type='button';button.className='poker-action '+action;button.textContent=label;
    button.onclick=async()=>{
      const amount=action==='raise'?Number(form.elements.amount.value):0;
      if(action==='raise' && !form.elements.amount.reportValidity())return;
      const controls=form.querySelectorAll('button, input, select');
      controls.forEach(b=>b.disabled=true);
      try{await submit({turnId:turn.id,move:{action,amount,chat:form.elements.chat?.value||'',showCards:form.elements.showCards?.value}});}
      catch(e){form.querySelector('.moveerror').textContent=e.message;controls.forEach(b=>b.disabled=false);}
    };
    moves.append(button);return button;
  }
  if(legal.fold)add('fold','Fold');
  if(legal.check)add('check','Check');
  if(legal.call)add('call','Call '+legal.call.toLocaleString('en-US'));
  if(!legal.raise)return;
  const {min,max,options}=legal.raise;
  const sizing=form.querySelector('.sizing');
  sizing.innerHTML='<div class="betsizes" role="group" aria-label="Bet sizes"></div><div class="wager"><input type="range" aria-label="Bet size slider"><label></label></div>';
  const slider=sizing.querySelector('[type=range]'), label=sizing.querySelector('label');
  const field=document.createElement(options?'select':'input');
  field.name='amount';field.setAttribute('aria-label','Total street bet');
  if(options){for(const n of options)field.add(new Option(n.toLocaleString('en-US'),String(n)));}
  else{field.type='number';field.step='1';field.min=min;field.max=max;field.required=true;}
  const verb=betting?'Bet':'Raise to';
  label.textContent=verb+' ';label.append(field);
  const raise=add('raise',verb);
  const update=n=>{field.value=n;slider.value=options?options.indexOf(n):n;raise.textContent=(n===max?'All-in':verb)+' '+n.toLocaleString('en-US');};
  slider.min=options?0:min;slider.max=options?options.length-1:max;slider.step=1;
  slider.oninput=()=>update(options?options[Number(slider.value)]:Number(slider.value));
  field.oninput=()=>{if(field.value && field.validity.valid)update(Number(field.value));};
  const call=legal.call||0, matched=own.streetBet+call, afterCall=event.pot+call;
  const presets=[['Min',min],['½ pot',matched+Math.round(afterCall/2)],['Pot',matched+afterCall],['All-in',max]];
  if(options)for(const n of options)if(!presets.some(([,value])=>value===n))presets.splice(-1,0,[n.toLocaleString('en-US'),n]);
  const used=new Set();
  for(const [name,n] of presets){
    if(n<min||n>max||used.has(n)||(options&&!options.includes(n)))continue;
    used.add(n);
    const shortcut=document.createElement('button');shortcut.type='button';shortcut.textContent=name;
    shortcut.onclick=()=>update(n);sizing.querySelector('.betsizes').append(shortcut);
  }
  update(min);
}
