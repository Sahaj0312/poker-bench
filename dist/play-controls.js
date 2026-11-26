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
  panel.hidden=!turn;
  if(!turn){panel.replaceChildren();delete panel.dataset.turn;return;}
  const remaining=()=>Math.max(0,Math.ceil((turn.expiresAt-Date.now())/1000))+' s';
  // Polling must preserve focus, raise size, and unsent chat.
  if(panel.dataset.turn===turn.id){panel.querySelector('output').textContent=remaining();return;}
  panel.dataset.turn=turn.id;
  const {legal}=turn;
  panel.innerHTML='<div class="decisionhead"><h2>Your turn</h2><output></output></div><form><label class="field">Table talk <input name="chat" maxlength="180" placeholder="Optional message" autocomplete="off"></label><div class="movelist"></div><p class="moveerror" role="alert"></p></form>';
  panel.querySelector('output').textContent=remaining();
  const form=panel.querySelector('form'),moves=form.querySelector('.movelist');
  form.onsubmit=e=>e.preventDefault();
  function add(action,label){
    const button=document.createElement('button');
    button.type='button';button.className=action==='fold'?'secondary':'primary';button.textContent=label;
    button.onclick=async()=>{
      const amount=action==='raise'?Number(form.elements.amount.value):0;
      if(action==='raise' && !form.elements.amount.reportValidity())return;
      const buttons=moves.querySelectorAll('button');
      buttons.forEach(b=>b.disabled=true);
      try{await submit({turnId:turn.id,move:{action,amount,chat:form.elements.chat.value}});}
      catch(e){form.querySelector('.moveerror').textContent=e.message;buttons.forEach(b=>b.disabled=false);}
    };
    moves.append(button);
  }
  if(legal.fold)add('fold','Fold');
  if(legal.check)add('check','Check');
  if(legal.call)add('call','Call '+legal.call);
  if(legal.raise){
    const label=document.createElement('label');label.className='raiseamount';label.textContent='Raise to ';
    const {min,max,options}=legal.raise;
    const input=document.createElement(options?'select':'input');
    input.name='amount';input.setAttribute('aria-label','Total street bet');
    if(options){for(const n of options)input.add(new Option(String(n),String(n)));}
    else{input.type='number';input.step='1';input.min=min;input.max=max;input.required=true;}
    input.value=min;label.append(input);moves.append(label);add('raise','Raise');
  }
}
