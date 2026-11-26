import { PROVIDERS, presetFor } from './connections.js';
import { NAMES } from './engine.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const option=(value,label)=>'<option value="'+esc(value)+'">'+esc(label)+'</option>';

export function editLineup({players,api,modal,onSave}){
  const panels=NAMES.map((slot,i)=>{
    const row=players[slot], preset=presetFor(row);
    return `<details class="playerconfig" data-slot="${slot}" ${i===0?'open':''}>
      <summary><span class="slotno">S${i+1}</span> <strong>${esc(row.name||slot)}</strong><small>${esc(PROVIDERS[preset].label)}</small></summary>
      <div class="seatfields">
        <label class="field">Seat name<input name="name" maxlength="24" value="${esc(row.name||slot)}" required></label>
        <label class="field">Provider<select name="preset">${Object.entries(PROVIDERS).map(([id,p])=>option(id,p.label)).join('')}</select></label>
        <label class="field protocolfield">API protocol<select name="kind">${option('compatible','Chat completions')+option('anthropic','Anthropic Messages')+option('typesafe','TypeSafe decisions')}</select></label>
        <label class="field wide endpointfield">Endpoint<input type="url" name="url" value="${esc(row.url)}"></label>
        <label class="field wide keyfield">API key<input type="password" name="key" autocomplete="new-password" placeholder="${row.hasKey?'Key available for the saved endpoint':'Enter a key'}"></label>
        <label class="clearfield"><input type="checkbox" name="clearKey"> Remove the saved key</label>
        <label class="field wide">Model ID<div class="modelrow"><input name="model" list="list-${slot}" value="${esc(row.model)}" placeholder="Enter or select a model ID"><button type="button" class="secondary loadmodels">List models</button></div></label>
        <datalist id="list-${slot}"></datalist><select class="catalog wide" aria-label="Available models" hidden></select>
        <p class="fieldnote wide" aria-live="polite"></p>
      </div></details>`;
  }).join('');
  modal('Model lineup','<form id="playerform"><p class="muted">Set a name and model for each seat. Keys stay on this computer.</p>'+panels+'<p id="formerror" role="alert"></p><div class="formfoot"><button class="primary" type="submit">Save lineup</button></div></form>');
  const form=document.querySelector('#playerform');
  const editors=[...form.querySelectorAll('details')].map(panel=>{
    const slot=panel.dataset.slot,row=players[slot],field=n=>panel.querySelector('[name="'+n+'"]');
    const preset=field('preset'),kind=field('kind'),url=field('url'),model=field('model'),key=field('key');
    const note=panel.querySelector('.fieldnote'),button=panel.querySelector('.loadmodels'),catalog=panel.querySelector('.catalog');
    const value=()=>({slot,name:field('name').value,kind:preset.value==='custom'?kind.value:PROVIDERS[preset.value].kind,url:url.value,model:model.value,key:key.value,clearKey:field('clearKey').checked});
    function update(reset){
      const p=PROVIDERS[preset.value];
      if(reset){kind.value=p.kind;url.value=p.url;model.value=p.models[0]||'';key.value='';catalog.hidden=true;}
      panel.querySelector('.protocolfield').hidden=preset.value!=='custom';
      panel.querySelector('.endpointfield').hidden=p.kind==='codex';
      panel.querySelector('.keyfield').hidden=p.kind==='codex';
      panel.querySelector('.clearfield').hidden=p.kind==='codex'||!row.hasKey;
      button.hidden=p.kind==='codex';
      panel.querySelector('datalist').innerHTML=p.models.map(m=>option(m,m)).join('');
      panel.querySelector('summary small').textContent=p.label;
      note.textContent=p.kind==='codex'?'Uses the local Codex CLI and your ChatGPT sign-in.':p.kind==='typesafe'?'Jev selects a legal move. It plays silently. All seats use the same raise sizes.':'';
    }
    preset.value=presetFor(row);kind.value=row.kind;update(false);
    preset.onchange=()=>update(true);
    field('name').oninput=e=>panel.querySelector('summary strong').textContent=e.target.value||slot;
    button.onclick=async()=>{
      button.disabled=true;note.textContent='Loading models…';catalog.hidden=true;
      const input=value();
      try{
        const result=await api('models',input);
        if(value().url!==input.url||value().kind!==input.kind)return;
        if(!result.models.length)throw Error('No models returned. Enter a model ID.');
        catalog.innerHTML=option('','Select a model')+result.models.map(m=>option(m,m)).join('');
        panel.querySelector('datalist').innerHTML=result.models.map(m=>option(m,m)).join('');
        catalog.hidden=false;note.textContent=result.models.length+' models available.';
      }catch(e){note.textContent=e.message;}finally{button.disabled=false;}
    };
    catalog.onchange=()=>{if(catalog.value)model.value=catalog.value;};
    return {slot,value};
  });
  form.onsubmit=async e=>{
    e.preventDefault();
    const save=form.querySelector('[type="submit"]');save.disabled=true;
    try{
      const rows=Object.fromEntries(editors.map(({slot,value})=>[slot,value()]));
      const result=await api('config',rows);onSave(result.players);
    }catch(error){form.querySelector('#formerror').textContent=error.message;}finally{save.disabled=false;}
  };
}
