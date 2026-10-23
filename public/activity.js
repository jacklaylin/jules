// Shared request feedback. Labels describe actual application actions, never guessed progress.
// Quick actions (a thumb, a remove, a save) already answer with their own motion and toast, so the panel
// only appears for a request still running after SHOW_AFTER_MS; Jules' own work (agent) shows at once.
const SHOW_AFTER_MS=1000;
let active=[],timer,panel,failed=false;
function show(success=false){
 if(!panel){
  const css=document.createElement('link');css.rel='stylesheet';css.href='/activity.css';document.head.append(css);
  panel=document.createElement('div');panel.className='app-activity';panel.setAttribute('role','status');panel.setAttribute('aria-live','polite');panel.setAttribute('popover','manual');panel.hidden=true;
  const orb=document.createElement('span');orb.className='orb';orb.setAttribute('aria-hidden','true');
  const label=document.createElement('span');label.className='activity-label';const loader=document.createElement('span');loader.className='aqua';loader.setAttribute('aria-hidden','true');panel.append(orb,label,loader);document.body.append(panel);
 }
 const shown=active.filter(item=>item.agent||Date.now()-item.started>=SHOW_AFTER_MS);
 panel.hidden=!shown.length;
 // Open modal dialogs sit in the top layer. Showing the panel as a manual popover each time it appears puts it
 // above any dialog opened earlier, so a save from inside a dialog is never dimmed by that dialog's backdrop.
 if(panel.showPopover&&!!shown.length!==panel.matches(':popover-open'))shown.length?panel.showPopover():panel.hidePopover();
 if(shown.length){const item=shown.at(-1),elapsed=Date.now()-item.started;panel.querySelector('.activity-label').textContent=item.label+(elapsed>3000?` · ${Math.floor(elapsed/1000)}s`:'');}
 document.dispatchEvent(new CustomEvent('jules:activity',{detail:{busy:!!active.length,agentWorking:active.some(item=>item.agent),success}}));
}
export async function withActivity(label,fn,{agent=false}={}){
 const item={label,agent,started:Date.now()};if(!active.length){failed=false;timer=setInterval(()=>show(),1000);}active.push(item);show();
 if(!agent)setTimeout(()=>{if(active.includes(item))show();},SHOW_AFTER_MS);
 try{return await fn();}catch(error){failed=true;throw error;}finally{active=active.filter(x=>x!==item);if(!active.length)clearInterval(timer);show(!active.length&&!failed);}
}
export async function trackedFetch(url,options={}){
 const path=String(url);if(/(?:crop|source)=|\/api\/image/.test(path))return globalThis.fetch(url,options);
 let action;try{action=JSON.parse(options.body||'{}').action;}catch{}
 // A wishlist remove or restore already happened on the page (public/wishlist-remove.js); its request runs behind it.
 if(path.includes('/wishlist')&&['remove','restore'].includes(action))return globalThis.fetch(url,options);
 const labels={analyze:'Reading your style. Your uploads are saved; keep this page open',upload:'Saving your upload',confirm:'Saving your style and preferences',login:'Sending your sign-in link',refresh:'Renewing your session',context:'Saving your notes',tone:'Changing the tone',hide:'Updating your cards',logout:'Signing out'};
 const agent=action==='analyze';
 const label=labels[action]||(agent?'Working on your shopping request':path.includes('/style')?'Loading your style':path.includes('wardrobe=1')?(options.method==='POST'?'Updating your wardrobe':'Loading your wardrobe'):path.includes('/wishlist')?'Loading your wishlist':path.includes('/costs')?'Checking costs':options.method==='POST'?'Working on your request':'Loading this page');
 return withActivity(label,async()=>{const response=await globalThis.fetch(url,options);if(!response.ok)failed=true;return response;},{agent});
}
