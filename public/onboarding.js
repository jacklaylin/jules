import {mountPublicHeader} from './design-system.js';
import {createLogo} from './brand-ui.js';
import {createSession} from './wishlist-session.js';
mountPublicHeader();
const $=id=>document.getElementById(id),session=createSession({storage:localStorage,lock:work=>navigator.locks?navigator.locks.request('jules-wishlist-refresh',work):work()});
const fragment=new URLSearchParams(location.hash.slice(1));
if(fragment.has('access_token'))session.save({access_token:fragment.get('access_token'),refresh_token:fragment.get('refresh_token'),expires_at:Number(fragment.get('expires_at'))||Date.now()/1000+(Number(fragment.get('expires_in'))||3600)});
if(location.hash)history.replaceState(null,'',location.pathname+location.search);
$('connect-logo').replaceChildren(createLogo());
const logo=createLogo();$('thinking-logo').append(logo);
let busy=false;
async function api(action){
 const token=await session.token();
 if(!token){$('login').hidden=false;throw Error('Log in with the number you text Jules from to continue.');}
 const response=await fetch('/api/wishlist?onboarding=1',{method:action?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(action?{body:JSON.stringify({action})}:{}),cache:'no-store',keepalive:Boolean(action)});
 const data=await response.json();
 if(!response.ok){if([401,403].includes(response.status))$('login').hidden=false;throw Error(data.error||'Could not continue. Please try again.');}
 return data;
}
function thinking(){ $('connect').hidden=true;$('thinking').hidden=false;$('status').textContent='';logo.classList.add('logo--thinking'); }
function completed(data){
 thinking();logo.classList.remove('logo--thinking');$('thinking-loader').hidden=true;
 $('thinking-title').textContent='Your demo is ready.';
 $('thinking-message').textContent=data.notification_status==='sent'?'Check Messages for your link. You can also open your wishlist below.':data.notification_status?'We couldn’t confirm the completion text. You can open your wishlist below.':'You can open your wishlist below.';
}
async function load(){
 $('retry').hidden=true;
 try{const data=await api();$('status').textContent='';
  if(data.gmail_available){await loadGmail();return;}
  if(data.state==='ready'){
    thinking();$('thinking-message').textContent='Taking you to your wishlist…';
    setTimeout(()=>{location.replace('/wishlist');},matchMedia('(prefers-reduced-motion: reduce)').matches?0:1800);
  }else if(data.state==='accepted')$('connect').hidden=false;
  else{$('status').textContent=data.state==='declined'?'You skipped the demo. Your wishlist is ready whenever you are.':'Reply to Jules’s style reading offer in Messages, then reload this page.';$('messages-help').hidden=false;}
 }catch(error){$('status').textContent=error.message;$('retry').hidden=false;}
}
async function act(action){
 if(busy)return;busy=true;$('connect-button').disabled=$('skip-button').disabled=true;$('retry').hidden=true;
 if(action==='connect-demo')thinking();
 try{const data=await api(action);if(action==='skip')location.assign('/wishlist');else completed(data);}
 catch(error){logo.classList.remove('logo--thinking');$('thinking').hidden=true;$('connect').hidden=false;$('status').textContent=error.message;}
 finally{busy=false;$('connect-button').disabled=$('skip-button').disabled=false;}
}
$('connect-button').onclick=()=>act('connect-demo');$('skip-button').onclick=()=>act('skip');$('retry').onclick=load;
let importBusy=false, gmailConnection=false, expandedConsent=false;
const gmailConsentVersion="gmail-receipts-5y-1000-v2";
async function gmailAPI(action,extra={}){
 const token=await session.token();if(!token){$('login').hidden=false;throw Error('Log in with the number you text Jules from to continue.');}
 const response=await fetch('/api/wishlist?gmail=1',{method:action?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(action?{body:JSON.stringify({action,...extra})}:{}),cache:'no-store'});
 const data=await response.json();if(!response.ok)throw Object.assign(Error(data.error||'Could not complete this step.'),{status:response.status});return data;
}
function renderGmail(data){
 const working=['listing','extracting','questions'].includes(data.status)&&!data.failed;
 const route=working?'thinking':data.connected||data.items.length?'reading':'connect';
 history.replaceState(null,'','/onboarding/'+route+location.search);
 document.dispatchEvent(new CustomEvent('jules:activity',{detail:{agentWorking:working,busy:working,success:data.status==='ready'}}));
 $('connect').hidden=$('thinking').hidden=true;
 gmailConnection=data.connected;expandedConsent=Boolean(data.consent_required);
 $('gmail-connect').hidden=data.connected&&(!expandedConsent||working);
 $('gmail-connect-button').textContent=data.connected?'Approve expanded import':'Connect Gmail ↗';$('gmail-history').hidden=!data.connected&&!data.items.length;
 $('gmail-history-title').textContent=working?'Purchases found so far.':'Your purchase history.';
 $('gmail-account').textContent=data.account?'Connected account: '+data.account:'';
 const running=['listing','extracting','questions'].includes(data.status);
 $('gmail-progress').textContent=data.status==='ready'?`Import complete: ${data.items.length} purchase ${data.items.length===1?'item':'items'} found in ${data.processed} matching emails.`:data.status==='listing'?'Finding matching shopping emails…':data.status==='questions'?'Selecting the most useful questions…':data.status==='extracting'?`Reviewed ${data.processed} matching emails; ${data.total} found so far.`:data.status==='paused'?'Import paused. Reconnect Gmail to continue.':data.connected?'Gmail connected. Ready to import.':'';
 $('gmail-loader').hidden=true;
 if(running&&!data.failed){
  $('gmail-history').hidden=!data.first_100;$('thinking').hidden=false;$('demo-disclosure').hidden=true;$('thinking-loader').hidden=false;
  logo.classList.add('logo--thinking');$('thinking-title').textContent='Reading your receipts.';
  $('playful').textContent=$('gmail-progress').textContent;
  $('thinking-message').textContent=data.background?'You can close this screen. We’ll text you when it’s done.':'Keep this screen open while Jules reads.';
 }else{logo.classList.remove('logo--thinking');$('thinking').hidden=true;}

 $('gmail-notice').textContent=[running?data.background?'You can close this screen. We’ll text you when it’s done.':'Keep this page open to finish the import.':'',data.limited?`The ${data.limit.toLocaleString()}-email limit was reached; this history is partial.`:'',data.warnings?`${data.warnings} ${data.warnings===1?'email has':'emails have'} unreadable, unsupported or truncated content; their readable evidence was retained.`:'',data.changed_sources?`${data.changed_sources} changed emails were held separately; prior corrections remain. Text Jules to correct an item.`:'',data.pending_events?`${data.pending_events} shopping events could not be safely linked to purchases and remain unresolved.`:'',data.failed?'The import paused. Resume to continue without losing completed work.':''].filter(Boolean).join(' ');
 $('gmail-start').hidden=running||!data.connected||expandedConsent;$('gmail-start').textContent=data.status==='ready'?'Import again':'Import five years';$('gmail-resume').hidden=!running;
 $('gmail-disconnect').hidden=!data.connected;
 const early=data.first_100,latest=data.yield;
 $('gmail-yield').textContent=early&&latest?`The first 100 emails found ${early.purchases} new purchase items. Later emails added ${Math.max(0,latest.purchases-early.purchases)} more.`:'';
 renderSources(data);
 $('gmail-items').replaceChildren();for(const item of data.items){const li=document.createElement('li');li.textContent=[item.brand,item.product,item.merchant&&'from '+item.merchant,item.size_label&&'size '+item.size_label,item.color,item.quantity&&'quantity '+item.quantity,item.recipient.value==='self'?(item.recipient.basis==='receipt_evidence'?'likely for you':'for you'):item.recipient.value==='other'?(item.recipient.basis==='receipt_evidence'?'likely a gift':'for '+(item.recipient.label||'someone else')):'recipient unknown',item.outcome.value!=='unknown'?item.outcome.value:null].filter(Boolean).join(' · ');$('gmail-items').append(li);}
}
let poll;
async function runImport(resume=false){
 if(importBusy)return;importBusy=true;$('status').textContent='';clearTimeout(poll);
 try{let data=await gmailAPI(resume?'resume':undefined);renderGmail(data);
  if(data.background){if(['listing','extracting','questions'].includes(data.status)&&!data.failed)poll=setTimeout(()=>runImport(),4000);}
  else while(['listing','extracting','questions'].includes(data.status)){data=await gmailAPI('step');renderGmail(data);}
 }catch(error){$('thinking').hidden=true;$('status').textContent=error.message;$('retry').hidden=false;}
 finally{importBusy=false;}
}
// Connected history sources (Shop today). Each has a section whose element IDs start with its name:
// <name>-orders, -title, -consent, -consent-label, -progress, -approve, -code, -approve-link, -connect,
// -import, -reread, -disconnect. Approval happens in the source's app with a short code; the page then reads
// records in steps.
const SOURCES={shop:{label:'Shop',noun:'orders',consent:'shop-orders-5y-100-v1'}},wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const sourceBusy=new Set();
function renderSources(data){
 for(const [name,source] of Object.entries(SOURCES)){
  const c=data.connections?.[name]??{status:'not_connected'},approving=c.status==='awaiting_approval',el=id=>$(name+'-'+id);
  el('orders').hidden=!(data.connections_available??[]).includes(name);el('title').textContent=c.connected?`Your ${source.label} ${source.noun}`:`Add your ${source.label} ${source.noun}`;
  el('consent-label').hidden=el('connect').hidden=c.connected||approving;
  el('approve').hidden=!approving;el('code').textContent=c.user_code??'';if(c.verification_url)el('approve-link').href=c.verification_url;
  el('import').hidden=el('reread').hidden=el('disconnect').hidden=!c.connected||c.status==='extracting';
  el('progress').textContent=[approving?`Waiting for you to approve Jules in ${source.label}…`:c.status==='extracting'?`Reading your ${source.label} ${source.noun}: ${c.processed} of ${c.processed+c.queued}.`:c.status==='ready'?`${source.label} ${source.noun} imported: ${c.found} checked.`:c.connected?`${source.label} connected.`:'',c.error??''].filter(Boolean).join(' ');
 }
}
// Lease conflicts (a Gmail step running) are retried briefly; other errors stop and are shown.
async function sourceCall(name,action,extra={}){
 for(let attempt=0;;attempt++){try{return await gmailAPI('connection-'+action,{source:name,...extra});}catch(error){if(error.status!==409||attempt>=5)throw error;await wait(2000);}}
}
async function runSource(name,data){
 if(sourceBusy.has(name))return;sourceBusy.add(name);
 try{
  while(data.connections?.[name]?.status==='awaiting_approval'){await wait((data.connections[name].interval??5)*1000);data=await sourceCall(name,'poll');renderGmail(data);}
  while(data.connections?.[name]?.status==='extracting'){data=await sourceCall(name,'step');renderGmail(data);}
 }catch(error){$('status').textContent=error.message;}
 finally{sourceBusy.delete(name);}
}
for(const [name,source] of Object.entries(SOURCES)){
 const el=id=>$(name+'-'+id);
 el('connect').onclick=async()=>{if(!el('consent').checked){$('status').textContent=`Review and confirm ${source.label} history analysis consent first.`;return;}el('connect').disabled=true;$('status').textContent='';try{const data=await sourceCall(name,'connect',{consent:source.consent});renderGmail(data);await runSource(name,data);}catch(error){$('status').textContent=error.message;}finally{el('connect').disabled=false;}};
 el('import').onclick=async()=>{try{const data=await sourceCall(name,'import');renderGmail(data);await runSource(name,data);}catch(error){$('status').textContent=error.message;}};
 // Re-reading replaces this source's earlier results with the current reading rules.
 el('reread').onclick=async()=>{if(!confirm(`Re-read every ${source.label} ${source.noun.replace(/s$/,'')} with the latest reading? Earlier ${source.label} results are replaced; Gmail history stays.`))return;try{const data=await sourceCall(name,'reread');renderGmail(data);await runSource(name,data);}catch(error){$('status').textContent=error.message;}};
 el('disconnect').onclick=async()=>{try{renderGmail(await sourceCall(name,'disconnect'));$('status').textContent=`${source.label} disconnected. Imported ${source.noun} remain saved. You can also remove Jules in ${source.label}’s settings.`;}catch(error){$('status').textContent=error.message;}};
}
async function loadGmail(){
 const data=await gmailAPI();renderGmail(data);
 for(const name of Object.keys(SOURCES))if(['awaiting_approval','extracting'].includes(data.connections?.[name]?.status))void runSource(name,data);
 if(data.connected&&data.status==='not_started'&&new URLSearchParams(location.search).get('gmail')==='connected')await gmailAPI('start');
 if(data.connected&&!data.failed)await runImport();
 if(new URLSearchParams(location.search).get('gmail')==='declined')$('status').textContent='Gmail access was declined. You can still use Jules by text.';
}
$('gmail-connect-button').onclick=async()=>{if(!$('gmail-consent').checked){$('status').textContent='Review and confirm receipt analysis consent first.';return;}$('gmail-connect-button').disabled=true;try{if(gmailConnection){await gmailAPI('start',{consent:gmailConsentVersion});await runImport();}else{const data=await gmailAPI('connect',{consent:gmailConsentVersion});location.assign(data.url);}}catch(error){$('status').textContent=error.message;$('gmail-connect-button').disabled=false;}};
$('gmail-start').onclick=async()=>{try{await gmailAPI('start');await runImport();}catch(error){$('status').textContent=error.message;}};
$('gmail-resume').onclick=()=>runImport(true);
$('gmail-disconnect').onclick=async()=>{try{renderGmail(await gmailAPI('disconnect'));$('status').textContent='Gmail disconnected. Imported history remains saved.';}catch(error){$('status').textContent=error.message;}};
$('gmail-delete').onclick=async()=>{if(!confirm('Delete imported history and its receipt-derived learning? This also disconnects Gmail and Shop. Independent shopping preferences remain.'))return;try{renderGmail(await gmailAPI('delete-history',{confirm:true}));$('status').textContent='Imported history deleted. Gmail and Shop are disconnected.';}catch(error){$('status').textContent=error.message;}};
await load();
