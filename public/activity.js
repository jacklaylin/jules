// Shared request feedback. Labels describe actual application actions, never guessed progress.
let active=[],timer,panel,failed=false;
function show(success=false){
 if(!panel){
  const css=document.createElement('link');css.rel='stylesheet';css.href='/activity.css';document.head.append(css);
  panel=document.createElement('div');panel.className='app-activity';panel.setAttribute('role','status');panel.setAttribute('aria-live','polite');
  const orb=document.createElement('span');orb.className='orb';orb.setAttribute('aria-hidden','true');
  const label=document.createElement('span');label.className='activity-label';const loader=document.createElement('span');loader.className='aqua';loader.setAttribute('aria-hidden','true');panel.append(orb,label,loader);document.body.append(panel);
 }
 panel.hidden=!active.length;
 if(active.length){const item=active.at(-1),elapsed=Date.now()-item.started;panel.querySelector('.activity-label').textContent=item.label+(elapsed>3000?` · ${Math.floor(elapsed/1000)}s`:'');}
 document.dispatchEvent(new CustomEvent('jules:activity',{detail:{busy:!!active.length,agentWorking:active.some(item=>item.agent),success}}));
}
export async function withActivity(label,fn,{agent=false}={}){
 const item={label,agent,started:Date.now()};if(!active.length){failed=false;timer=setInterval(()=>show(),1000);}active.push(item);show();
 try{return await fn();}catch(error){failed=true;throw error;}finally{active=active.filter(x=>x!==item);if(!active.length)clearInterval(timer);show(!active.length&&!failed);}
}
export async function trackedFetch(url,options={}){
 const path=String(url);if(/(?:crop|source)=|\/api\/image/.test(path))return globalThis.fetch(url,options);
 let action;try{action=JSON.parse(options.body||'{}').action;}catch{}
 const labels={analyze:'Reading your style. Your uploads are saved; keep this page open',upload:'Saving your upload',confirm:'Saving your style and preferences',login:'Sending your sign-in link',refresh:'Renewing your session',context:'Saving your notes',tone:'Changing the tone',hide:'Updating your cards',logout:'Signing out'};
 const agent=action==='analyze'||(path.includes('/chat-simulator')&&options.method==='POST');
 const label=labels[action]||(agent?'Working on your shopping request':path.includes('/style')?'Loading your style':path.includes('/wishlist')?'Loading your wishlist':path.includes('/costs')?'Checking costs':options.method==='POST'?'Working on your request':'Loading this page');
 return withActivity(label,async()=>{const response=await globalThis.fetch(url,options);if(!response.ok)failed=true;return response;},{agent});
}
