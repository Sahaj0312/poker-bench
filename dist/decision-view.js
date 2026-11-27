import {providerInput} from './provider-input.js';
import {digest} from './engine.js';
import {observation} from './observations.js';

function element(tag,text){
  const node=document.createElement(tag);node.textContent=text;return node;
}
function details(title,value){
  const item=document.createElement('details');
  item.append(element('summary',title),element('pre',JSON.stringify(value,null,2)));
  return item;
}

export function decisionViewer(s,through,host,jump){
  host.replaceChildren();
  if(s.privateTable){host.append(element('p','Decision records open when the human session ends.'));return;}
  if(!s.decisions?.length){host.append(element('p',s.mode==='demo'?'This demo used a seeded policy. It has no model reports.':'This session has no recorded decision reports.'));return;}
  const filter=element('select',''),label=element('label','Player ');
  filter.add(new Option('All players',''));
  for(const n of s.lineup.filter(n=>s.models[n]?.kind!=='human'))filter.add(new Option(n+' · '+s.models[n].model,n));
  label.append(filter);
  const list=element('div','');
  const scope=element('select',''),scopeLabel=element('label','Show ');
  scope.add(new Option('Entire session','all'));scope.add(new Option('Through replay position','cursor'));
  for(const e of s.events.filter(e=>e.type==='deal'))scope.add(new Option('Hand '+e.hand,String(e.hand)));
  scopeLabel.append(scope);
  host.append(label,scopeLabel,list);
  function draw(){
    list.replaceChildren();
    const rows=s.decisions.filter(r=>(scope.value==='all'||(scope.value==='cursor'?r.event<=through:r.hand===Number(scope.value))) && (!filter.value||r.name===filter.value));
    if(!rows.length){list.append(element('p','No requests for this player by this replay event.'));return;}
    for(const r of rows.slice().reverse()){
      const item=element('details',''),out=r.output;
      const linked=r.appliedEvent??r.returnEvent??r.event;
      const available=scope.value!=='cursor'||linked<=through;
      const status=available?r.status:'in progress';
      const result=available && out?(r.kind==='chat'?(out.chat?'spoke':'stayed silent'):out.action+(out.action==='raise'?' to '+out.amount:'')):status;
      item.append(element('summary','Hand '+r.hand+' · '+r.name+' · '+(r.kind==='bet'?'Betting':'Chat')+' · '+result));
      // Construct detailed inputs only when a reader opens the request.
      item.ontoggle=()=>{
        if(!item.open||item.children.length>1)return;
        const utc=n=>new Date(n).toISOString();
        item.append(element('p','Dealer sent '+utc(r.dispatchedAt)+(available&&r.returnedAt?' · Dealer finished '+utc(r.returnedAt):'')+' · Input through event '+(r.event+1)));
        if(available){
          if(r.report?.summary)item.append(element('p','Reported basis · '+r.report.summary));
          if(r.report?.strategy)item.append(element('p','Private strategy note · '+r.report.strategy));
          if(r.kind==='bet'&&!r.report)item.append(element('p','No decision explanation supplied.'));
          if(out)item.append(details('Returned choice',out));
        }
        const view=observation(s,r);
        item.append(details('Messages available at dispatch ('+view.tableChat.length+')',view.tableChat),details('Exact seat input',view));
        const instructions=s.instructions?.[s.models[r.name]?.kind==='typesafe'?'choice':r.kind];
        if(instructions && s.mode==='models'){
          item.append(details('Dealer instructions',instructions),details('Provider request',providerInput(s.models[r.name],view,instructions)));
        }
        if(r.inputDigest){
          const evidence=details('Input fingerprint (SHA-256)',r.inputDigest);
          item.append(evidence);
          digest(JSON.stringify(view)).then(hash=>evidence.append(element('p',hash===r.inputDigest?'Reconstructed input matches the dispatched input.':'Input fingerprint mismatch.')));
        }
        const button=element('button','View table at this request');button.className='secondary';
        button.onclick=()=>jump(r.event);item.append(button);
      };
      list.append(item);
    }
  }
  scope.onchange=filter.onchange=draw;draw();
}
