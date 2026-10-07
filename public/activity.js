// Shared request feedback across consumer and operator pages. Never display payloads.
let active=[],timer,started=0,panel;
function show(){
 if(!panel){const css=document.createElement('link');css.rel='stylesheet';css.href='/activity.css';document.head.append(css);panel=document.createElement('div');panel.className='app-activity';panel.setAttribute('role','status');panel.setAttribute('aria-live','polite');document.body.append(panel);}
 panel.hidden=!active.length;
 if(active.length){panel.textContent=active.at(-1).label+(Date.now()-started>3000?` · ${Math.floor((Date.now()-started)/1000)}s`:'');}
}
export async function withActivity(label,fn){
 const item={label};if(!active.length){started=Date.now();timer=setInterval(show,1000);}active.push(item);show();
 try{return await fn();}finally{active=active.filter(x=>x!==item);if(!active.length)clearInterval(timer);show();}
}
export async function trackedFetch(url,options={}){
 const path=String(url);if(/(?:crop|source)=|\/api\/image/.test(path))return globalThis.fetch(url,options);
 let action;try{action=JSON.parse(options.body||'{}').action;}catch{}
 const labels={analyze:'Reading your style. Your uploads are saved; keep this page open',upload:'Saving your upload',confirm:'Saving your style and preferences',login:'Sending your sign-in link',refresh:'Renewing your session',context:'Saving your notes',tone:'Changing the tone',hide:'Updating your cards',logout:'Signing out'};
 const label=labels[action]||(path.includes('/style')?'Loading your style':path.includes('/wishlist')?'Loading your wishlist':path.includes('/costs')?'Checking costs':options.method==='POST'?'Working on your request':'Loading this page');
 return withActivity(label,()=>globalThis.fetch(url,options));
}
