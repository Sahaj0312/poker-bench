// Provider presets supply an endpoint. The operator can enter any model ID.
export const PROVIDERS = {
  codex: {label:'ChatGPT subscription',kind:'codex',url:'',models:['gpt-6.2-astra']},
  openai: {label:'OpenAI',kind:'compatible',url:'https://api.openai.com/v1/chat/completions',models:['gpt-6.2-astra']},
  anthropic: {label:'Anthropic',kind:'anthropic',url:'https://api.anthropic.com/v1/messages',models:[]},
  gemini: {label:'Google Gemini',kind:'compatible',url:'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',models:[]},
  openrouter: {label:'OpenRouter',kind:'compatible',url:'https://openrouter.ai/api/v1/chat/completions',models:[]},
  typesafe: {label:'TypeSafe Jev',kind:'typesafe',url:'https://api.typesafe.ai/v1/systemone',models:['jev-1.14.0','jev-latest']},
  local: {label:'Local model server',kind:'compatible',url:'http://localhost:11434/v1/chat/completions',models:[]},
  custom: {label:'Custom endpoint',kind:'compatible',url:'',models:[]}
};

export function presetFor(row) {
  if(row.kind==='codex')return 'codex';
  return Object.keys(PROVIDERS).find(id=>id!=='custom' && PROVIDERS[id].url===row.url && PROVIDERS[id].kind===row.kind)||'custom';
}

export function isLoopback(endpoint){
  try{return ['localhost','127.0.0.1','[::1]'].includes(new URL(endpoint).hostname);}
  catch{return false;}
}
