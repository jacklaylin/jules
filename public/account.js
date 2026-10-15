import {mountHeader,enableAdminLink} from './design-system.js';
import {createSession} from './wishlist-session.js';
import {withActivity} from './activity.js';
// Account: manage connected shopping history (Gmail, Shop) and sign out. Linking a new account
// happens on /onboarding; everything after that lives here.
mountHeader('account');
const $=id=>document.getElementById(id);
const session=createSession({fetcher:fetch,storage:localStorage,lock:work=>navigator.locks?navigator.locks.request('jules-wishlist-refresh',work):work()});
const notice=text=>{$('notice').textContent=text;};
const running=status=>['listing','extracting','questions'].includes(status);
const day=iso=>iso?new Date(iso).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}):null;
let busy=false,poll;

function showLogin(){$('account').hidden=true;$('login').hidden=false;notice('');enableAdminLink(null);}
async function api(action,extra={}){
 const token=await session.token();if(!token){showLogin();throw Error('Log in to continue.');}
 const response=await fetch('/api/wishlist?gmail=1',{method:action?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(action?{body:JSON.stringify({action,...extra})}:{}),cache:'no-store'});
 const data=await response.json().catch(()=>({}));
 if(response.status===401){showLogin();throw Error('Log in to continue.');}
 if(!response.ok)throw Object.assign(Error(data.error||'Could not complete that. Try again.'),{status:response.status});
 void enableAdminLink(token);return data;
}
function render(data){
 $('login').hidden=true;$('account').hidden=false;
 const working=running(data.status);
 $('gmail-state').textContent=data.connected?'Connected':'Not connected';$('gmail-state').classList.toggle('off',!data.connected);
 $('gmail-summary').textContent=!data.connected?'Connect Gmail so Jules can learn from your purchase history.':
  working?(data.failed?`${data.account} · The import paused. Jules keeps retrying automatically.`:`${data.account} · Reading your shopping emails now. Checked ${data.processed.toLocaleString()} so far.`):
  `${data.account}${data.last_import_at?` · Last import ${day(data.last_import_at)}`:''}`;
 $('gmail-connect').hidden=data.connected;$('gmail-import').hidden=!data.connected||working;$('gmail-disconnect').hidden=!data.connected;
 const shop=data.connections?.shop,available=(data.connections_available??[]).includes('shop');
 $('shop-card').hidden=!available;
 if(available){
  const c=shop??{status:'not_connected'},reading=c.status==='extracting';
  $('shop-state').textContent=reading||shopWorking?'Reading':c.connected?'Connected':c.status==='reconnect'?'Reconnect needed':'Not connected';$('shop-state').classList.toggle('off',!c.connected);
  if(!shopWorking)$('shop-summary').textContent=!c.connected?(c.error??'Connect Shop to add orders from stores that use Shop checkout.'):c.status==='ready'&&c.imported_at?`Last read ${short(c.imported_at)} · ${shopResult(c)}`:'Your Shop orders.';
  // Progress shows what is actually happening: asking Shop for the list, then reading each record.
  if(shopWorking)progress('shop',reading&&c.processed+c.queued?`Reading order ${Math.min(c.processed+1,c.processed+c.queued)} of ${c.processed+c.queued}…`:'Asking Shop for your orders…');
  $('shop-connect').hidden=c.connected;$('shop-import').hidden=$('shop-reread').hidden=!c.connected||reading;$('shop-disconnect').hidden=!c.connected;
 }
 clearTimeout(poll);if(working&&!data.failed)poll=setTimeout(load,5000);
}
async function load(){try{render(await api());if(!busy)notice('');}catch(error){if(error.status===403){$('account').hidden=false;$('login').hidden=true;$('gmail-card').hidden=true;notice('Connected history isn’t available for this account yet.');}else if($('login').hidden)notice(error.message);}}
// Connected-source result: what was read, the date range shared, and what was found.
const short=iso=>{const d=new Date(iso);return d.toLocaleDateString(undefined,{month:'short',day:'numeric',...(d.getFullYear()===new Date().getFullYear()?{}:{year:'numeric'})});};
const range=c=>c.oldest?` from ${short(c.oldest)}${c.newest&&short(c.newest)!==short(c.oldest)?` to ${short(c.newest)}`:''}`:'';
const shopResult=c=>`${c.found} Shop ${c.found===1?'record':'records'}${range(c)} · ${c.purchases} clothing ${c.purchases===1?'purchase':'purchases'} found${c.purchases?` · ${c.linked} already in Gmail`:''}`;
let shopWorking=false;
function progress(name,label){$(name+'-result').hidden=true;$(name+'-progress').hidden=!label;if(label)$(name+'-progress-label').textContent=label;}
function result(name,text,error=false){progress(name,null);$(name+'-result').hidden=!text;$(name+'-result').classList.toggle('error',error);$(name+'-result-text').textContent=text??'';}
// A Shop action runs inside the card: the button names the action, progress and the result appear beside
// it, and the shared activity panel and logo show work and completion. Errors stay in the card too.
async function shopAct(button,busyLabel,activity,work,done){
 if(busy)return;busy=true;shopWorking=true;
 const buttons=[...document.querySelectorAll('#account button')],label=button.textContent;buttons.forEach(b=>{b.disabled=true;});button.textContent=busyLabel;
 result('shop',null);progress('shop','Asking Shop for your orders…');$('shop-state').textContent='Reading';$('shop-state').classList.remove('off');
 try{const data=await withActivity(activity,work,{agent:true});shopWorking=false;render(data);const c=data.connections?.shop??{};result('shop',c.error??done(c),Boolean(c.error));}
 catch(error){shopWorking=false;result('shop',error.message,true);await load();}
 finally{busy=false;shopWorking=false;button.textContent=label;buttons.forEach(b=>{b.disabled=false;});}
}
async function act(work,message){
 if(busy)return;busy=true;notice(message);
 const buttons=[...document.querySelectorAll('#account button')];buttons.forEach(b=>{b.disabled=true;});
 try{const done=await work();if(done)notice(done);}catch(error){notice(error.message);}
 finally{busy=false;buttons.forEach(b=>{b.disabled=false;});}
}
// Shop reads in browser-driven steps; lease conflicts with a running Gmail step are retried briefly.
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function shopCall(action){for(let attempt=0;;attempt++){try{return await api('connection-'+action,{source:'shop'});}catch(error){if(error.status!==409||attempt>=5)throw error;await wait(2000);}}}
// Shop reads on the server when background work is on; the page then only refreshes progress.
async function shopRead(data){while(data.connections?.shop?.status==='extracting'){render(data);data=data.background?(await wait(4000),await api()):await shopCall('step');}return data;}

$('gmail-import').onclick=()=>act(async()=>{render(await api('start'));return 'Import started. Jules will text you when it’s done.';},'Starting import…');
$('gmail-disconnect').onclick=()=>{if(!confirm('Disconnect Gmail? Jules stops reading your email. Purchases already found stay saved.'))return;act(async()=>{render(await api('disconnect'));return 'Gmail disconnected. Found purchases stay saved. You can also remove Jules in your Google account settings.';},'Disconnecting…');};
$('shop-import').onclick=()=>shopAct($('shop-import'),'Importing…','Importing your Shop orders',async()=>shopRead(await shopCall('import')),c=>c.processed?`Done. Read ${c.processed} new Shop ${c.processed===1?'record':'records'}.`:'Done. No new Shop records since your last import.');
$('shop-reread').onclick=()=>{if(!confirm('Re-read every Shop order with the latest reading? Earlier Shop results are replaced; Gmail history stays.'))return;shopAct($('shop-reread'),'Re-reading…','Re-reading your Shop orders',async()=>shopRead(await shopCall('reread')),c=>`Done. Re-read all ${c.found} Shop ${c.found===1?'record':'records'}.`);};
$('shop-disconnect').onclick=()=>act(async()=>{render(await shopCall('disconnect'));return 'Shop disconnected. Imported orders stay saved. You can also remove Jules in Shop’s settings.';},'Disconnecting…');
$('delete-history').onclick=()=>{if(!confirm('Delete everything Jules learned from your Gmail and Shop history? This also disconnects both and can’t be undone.'))return;act(async()=>{render(await api('delete-history',{confirm:true}));return 'Imported history deleted. Gmail and Shop are disconnected.';},'Deleting…');};
$('logout-button').onclick=()=>act(async()=>{const token=await session.token();if(token)await fetch('/api/wishlist',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({action:'logout'})});session.clear();location.assign('/login?next=account');},'Logging out…');
window.addEventListener('storage',event=>{if(event.key==='jules_wishlist_session'&&!event.newValue)showLogin();});
await load();
