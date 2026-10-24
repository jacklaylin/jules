// Jules+ fake-door page (PLUS-TEST.md): counts the visit and the Get Jules+ tap, then says plainly that Jules+
// isn't open and nothing was charged. A signed-in tester is counted as themselves; a signed-out browser once,
// from its own storage. Counting is best effort and never blocks the page.
import {mountPublicHeader} from './design-system.js';
import {createSession} from './wishlist-session.js';
mountPublicHeader();

const DAY_MS=24*60*60*1000;
const store=(()=>{try{return window.localStorage;}catch{return null;}})();
const seen=key=>{try{return store?.getItem(key);}catch{return null;}};
const mark=(key,value)=>{try{store?.setItem(key,value);}catch{}};
async function send(event){
 let token=null;
 try{token=store?await createSession({storage:store}).token():null;}catch{}
 const response=await fetch('/api/plus',{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify({event}),cache:'no-store'});
 return response.ok?response.json():{};
}

const viewed=Number(seen('jules_plus_viewed'))||0;
if(Date.now()-viewed>DAY_MS){mark('jules_plus_viewed',String(Date.now()));send('view').catch(()=>{});}

const button=document.getElementById('plus-get'),done=document.getElementById('plus-done');
function showDone(signedIn){button.hidden=true;done.hidden=false;document.getElementById('plus-done-known').hidden=!signedIn;done.focus();}
if(seen('jules_plus_interest'))showDone(seen('jules_plus_interest')==='signed_in');
button.addEventListener('click',async()=>{
 button.disabled=true;
 const result=await send('interest').catch(()=>({}));
 mark('jules_plus_interest',result.signed_in?'signed_in':'yes');
 showDone(Boolean(result.signed_in));
});
