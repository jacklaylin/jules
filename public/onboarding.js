import {mountPublicHeader} from './design-system.js';
import {createLogo} from './brand-ui.js';
import {createSession} from './wishlist-session.js';
mountPublicHeader();
// Onboarding: connect accounts, show progress, finish. Results and questions arrive by text.
// Views: signing-in, expired, signed-out, unavailable, connect, reading, done.
const $=id=>document.getElementById(id),session=createSession({storage:localStorage,lock:work=>navigator.locks?navigator.locks.request('jules-wishlist-refresh',work):work()});
const params=new URLSearchParams(location.search),fragment=new URLSearchParams(location.hash.slice(1)),signinToken=fragment.get('signin');
if(fragment.has('access_token'))session.save({access_token:fragment.get('access_token'),refresh_token:fragment.get('refresh_token'),expires_at:Number(fragment.get('expires_at'))||Date.now()/1000+(Number(fragment.get('expires_in'))||3600)});
if(location.hash)history.replaceState(null,'',location.pathname+location.search);
const GMAIL_CONSENT='gmail-receipts-5y-1000-v3';
// Connected history sources (Shop today; more later). The page's consent covers every account connected.
const SOURCES={shop:{label:'Shop',noun:'orders',consent:'shop-orders-5y-100-v2'}};
const VIEWS=['signing-in','expired','signed-out','unavailable','connect','reading','done'];
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const running=status=>['listing','extracting','questions'].includes(status);
const working=c=>['awaiting_approval','extracting'].includes(c?.status);
const logos=new Map();
for(const el of document.querySelectorAll('[data-logo]')){const logo=createLogo();if(el.dataset.logo==='thinking')logo.classList.add('logo--thinking');if(el.dataset.logo==='done')logo.classList.add('logo--done');el.append(logo);logos.set(el,logo);}
let data=null,textURL='',consentOpen=false,poll=null,busy=false,shopWaiting=false;
// "Continue" without the remaining account; kept for this tab so a reload stays on the reading screen.
const store=(key,value)=>{try{if(value===undefined)return sessionStorage.getItem(key);sessionStorage.setItem(key,value);}catch{return null;}};
let continued=store('jules-onboarding-continued')==='1';

function show(view){for(const id of VIEWS)$(id).hidden=id!==view;document.body.dataset.view=view;}
function say(message,retry=false){$('status').textContent=message??'';$('retry').hidden=!retry;}

async function signInFromLink(token){
 show('signing-in');
 const response=await fetch('/api/wishlist?phone_login=1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'link',token}),cache:'no-store'});
 const result=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(result.error||'Could not sign you in.');
 session.save(result);
}
async function call(url,action,extra={}){
 const token=await session.token();
 if(!token)throw Object.assign(Error('Log in to continue.'),{status:401});
 const response=await fetch(url,{method:action?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(action?{body:JSON.stringify({action,...extra})}:{}),cache:'no-store'});
 const result=await response.json().catch(()=>({}));
 if(!response.ok)throw Object.assign(Error(result.error||'Could not complete this step.'),{status:response.status});
 return result;
}
const historyAPI=(action,extra)=>call('/api/wishlist?gmail=1',action,extra);
// Gmail and Shop share one write lock; a Gmail step can hold it for up to ~2 minutes (the server's
// lease). A conflict waits that out instead of failing, telling the person once it's taking a moment.
const BUSY_MS=120000;
async function whenFree(work,onWait=()=>{}){
 const until=Date.now()+BUSY_MS;
 for(let attempt=0;;attempt++){try{return await work();}catch(error){if(error.status!==409||Date.now()>until)throw error;if(attempt===1)onWait();await wait(3000);}}
}
const sourceCall=(name,action,extra={},onWait)=>whenFree(()=>historyAPI('connection-'+action,{source:name,...extra}),onWait);

// Searching past emails an earlier import already checked adds nothing to "checked", so that count is shown too.
const skipped=d=>d.already_read?`, skipped ${d.already_read.toLocaleString()} already checked`:'';
function gmailLine(d){
 if(d.status==='listing'&&!d.processed&&!d.already_read)return 'Finding your shopping emails…';
 if(d.status==='questions')return 'Almost done…';
 if(['listing','extracting'].includes(d.status))return `Checked ${d.processed.toLocaleString()} ${d.processed===1?'email':'emails'} so far${skipped(d)}.`;
 return '';
}
function shopLine(c){
 if(c?.status==='awaiting_approval')return 'Waiting for you to approve Jules in Shop…';
 if(c?.status==='extracting')return `Read ${c.processed} of ${c.processed+c.queued} orders.`;
 return c?.error??'';
}
// Short progress for the connect screen's account rows; the orb shows only while Jules is working.
function gmailShort(d){
 if(d.status==='listing'&&!d.processed&&!d.already_read)return 'Finding your shopping emails…';
 if(d.status==='questions')return 'Almost done…';
 return `Reading · ${d.processed.toLocaleString()} ${d.processed===1?'email':'emails'} checked${d.already_read?` · ${d.already_read.toLocaleString()} already checked`:''}`;
}
function progress(name,text,working){$(name+'-progress').hidden=!text;$(name+'-progress-text').textContent=text;$(name+'-orb').hidden=!working;}
// An action is a label plus an end mark (↗ leaves the page) so it reads the same as a pill or a row.
function action(id,label,disabled=false,go){
 const el=$(id);el.hidden=!label;if(!label)return;
 const mark=go??(label.endsWith('↗')?'↗':''),text=label.replace(/\s*↗$/,'');
 const parts=[Object.assign(document.createElement('span'),{textContent:text})];
 if(mark)parts.push(Object.assign(document.createElement('span'),{className:'action-row__go',textContent:mark,ariaHidden:'true'}));
 el.replaceChildren(...parts);if('disabled' in el)el.disabled=disabled;
}
function render(){
 const d=data,shop=d.connections?.shop,shopOn=(d.connections_available??[]).includes('shop');
 const gReading=running(d.status),sWorking=working(shop),gDone=d.status==='ready',sDone=shop?.status==='ready';
 const gIn=d.connected,sIn=Boolean(shop?.connected)||sWorking,consented=gIn||sIn;
 const left=[!gIn&&'Gmail',shopOn&&!sIn&&'Shop'].filter(Boolean);
 const view=shop?.status==='awaiting_approval'?'connect'
  :(gReading||sWorking)?(left.length&&!continued?'connect':'reading')
  :(gDone||sDone)&&(!left.length||continued)?'done':'connect';
 show(view);
 document.dispatchEvent(new CustomEvent('jules:activity',{detail:{agentWorking:gReading||sWorking,busy:gReading||sWorking,success:view==='done'}}));
 for(const a of document.querySelectorAll('.messages-link')){a.hidden=!textURL;if(textURL)a.href=textURL;}
 if(view==='connect'){
  const approving=shop?.status==='awaiting_approval';
  $('connect-title').textContent=approving?'Approve Shop.':consented?'Nice. One more?':'Let’s get to know each other.';
  $('connect-intro').textContent=approving?'Shop asks you to approve Jules on its own screen. Check the code matches, then come back.':consented?`${gIn?'Gmail':'Shop'} is connected and Jules is reading. Add ${left[0]??'another account'} and Jules sees more of what you buy.`:'Connect where you shop. Jules learns your style from what you actually buy, not a quiz.';
  // The consent collapses once agreed (here or by an earlier connection); Read or unticking opens it.
  const agreed=$('consent').checked||consented;
  if(consented)$('consent').checked=true;
  $('consent-full').hidden=agreed&&!consentOpen;$('consent-done').hidden=!agreed||consentOpen;
  // Gmail row
  $('gmail-ok').hidden=!gIn;$('gmail-details').hidden=gIn;$('gmail-what').textContent=gIn&&d.account?d.account:'Receipts, orders and returns from your email';
  progress('gmail',gIn?(d.failed&&gReading?'Reading paused. Jules will keep trying, or resume now.':d.status==='paused'?'Reading paused. Connect Gmail again to continue.':gReading?gmailShort(d):gDone?'Done reading.':''):'',gReading&&!d.failed);
  const gAction=!gIn||d.status==='paused'?'Connect Gmail ↗':d.consent_required?'Approve the updated consent':d.status==='not_started'?'Start reading':d.failed&&gReading?'Resume reading':null;
  // Shop row
  $('shop-card').hidden=!shopOn;
  $('shop-ok').hidden=!(shop?.connected);$('shop-details').hidden=sIn||shopWaiting;$('shop-approve').hidden=!approving;
  $('shop-what').textContent=approving?'Waiting for your approval':'Orders from the Shop app';
  $('shop-code').textContent=shop?.user_code??'';if(shop?.verification_url)$('shop-approve-link').href=shop.verification_url;
  progress('shop',shopWaiting?'Starting once Jules finishes a Gmail step. Up to two minutes.':approving?'':shop?.status==='extracting'?`Reading · ${shopLine(shop)}`:sDone?'Done reading.':shop?.error??'',shopWaiting||shop?.status==='extracting');
  const sAction=shopWaiting?'Connecting Shop…':!sIn?'Connect Shop ↗':shop?.status==='connected'?'Read Shop orders again':null;
  // One butter pill for the most useful next step, then quiet rows: approving Shop, else Gmail, else Shop.
  action('gmail-connect',gAction,!agreed);action('shop-connect',sAction,!agreed||shopWaiting);action('shop-approve-link',approving&&shop?.verification_url?'Approve in Shop ↗':null);
  const primary=approving?'shop-approve-link':gAction?'gmail-connect':sAction?'shop-connect':null;
  for(const id of ['gmail-connect','shop-connect','shop-approve-link']){
   const el=$(id),main=id===primary;el.className=main?'btn btn--butter':'action-row';
   if(main)$('primary-slot').replaceChildren(el);else $('action-rows').insertBefore(el,$('continue'));
  }
  if(!primary)$('primary-slot').replaceChildren();
  // One account connected: the other is optional.
  action('continue',consented&&left.length?`Skip ${left[0]} for now`:null,false,'→');
  $('not-now').hidden=consented||!textURL;
 }else if(view==='reading'){
  $('row-gmail').hidden=!gIn;
  $('row-gmail-state').textContent=gReading?(d.failed?'Paused':'Reading'):gDone?'Done':'';
  $('row-gmail-line').textContent=gReading?(d.failed?'Reading paused. Jules will keep trying, or resume now.':gmailLine(d)):gDone?'Done reading.':'';
  $('gmail-resume').hidden=!(gReading&&d.failed);
  $('row-shop').hidden=!sIn&&!shop?.error;
  $('row-shop-state').textContent=sWorking?'Reading':sDone?'Done':shop?.error?'Stopped':'';
  $('row-shop-line').textContent=sWorking?shopLine(shop):sDone?'Done reading.':shop?.error??'';
 }else if(view==='done'){
  $('done-gmail').hidden=!gDone;
  $('done-shop').hidden=!sDone&&!shop?.error;$('done-shop-state').textContent=sDone?'✓ Read':'Stopped';
  $('done-shop-line').hidden=sDone||!shop?.error;$('done-shop-line').textContent=shop?.error??'';
 }
}
// Background work reads on the server; the page refreshes progress. Without it (local runs) the page drives steps.
async function refresh(){
 clearTimeout(poll);
 try{
  data=await historyAPI();render();
  const active=running(data.status)||Object.values(data.connections??{}).some(working);
  if(!data.background){await drive();return;}
  if(active)poll=setTimeout(refresh,4000);
 }catch(error){handle(error);}
}
async function drive(){
 if(busy)return;busy=true;
 try{
  while(running(data.status)&&!data.failed){data=await historyAPI('step');render();}
  for(const name of Object.keys(SOURCES)){
   while(data.connections?.[name]?.status==='awaiting_approval'){await wait((data.connections[name].interval??5)*1000);data=await sourceCall(name,'poll');render();}
   while(data.connections?.[name]?.status==='extracting'){data=await sourceCall(name,'step');render();}
  }
 }catch(error){handle(error);}
 finally{busy=false;}
}
function handle(error){
 if([401,403].includes(error.status)&&!data){show('signed-out');return;}
 say(error.message,true);
}
async function act(button,work){
 if(button.disabled)return;button.disabled=true;say('');
 try{await work();}catch(error){say(error.message);}
 finally{button.disabled=false;}
}
$('consent').onchange=()=>{consentOpen=!$('consent').checked;if(data)render();};
$('consent-read').onclick=()=>{consentOpen=true;render();$('consent').focus();};
$('gmail-connect').onclick=()=>act($('gmail-connect'),async()=>{
 if(!$('consent').checked){say('Tick the box above to connect.');return;}
 if(data.connected&&data.status!=='paused'){data=await whenFree(()=>historyAPI(running(data.status)?'resume':'start',{consent:GMAIL_CONSENT}));render();await refresh();return;}
 const {url}=await historyAPI('connect',{consent:GMAIL_CONSENT});location.assign(url);
});
$('gmail-resume').onclick=()=>act($('gmail-resume'),async()=>{data=await whenFree(()=>historyAPI('resume'));render();await refresh();});
$('shop-connect').onclick=()=>act($('shop-connect'),async()=>{
 if(!$('consent').checked){say('Tick the box above to connect.');return;}
 const shop=data.connections?.shop;
 try{data=await sourceCall('shop',shop?.connected?'import':'connect',{consent:SOURCES.shop.consent},()=>{shopWaiting=true;render();});}
 finally{shopWaiting=false;}
 render();await refresh();
});
$('continue').onclick=()=>{continued=true;store('jules-onboarding-continued','1');render();};
$('retry').onclick=()=>{say('');start();};
$('resend').onclick=()=>act($('resend'),async()=>{
 $('resend-status').textContent='Sending…';
 const response=await fetch('/api/wishlist?phone_login=1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'resend',token:signinToken}),cache:'no-store'});
 const result=await response.json().catch(()=>({}));
 if(!response.ok){$('resend-status').textContent=result.error||'Couldn’t send a new link. Try again.';return;}
 $('resend').hidden=true;
 $('resend-status').textContent=result.status==='sent'?'Sent. Check Messages.':'We couldn’t confirm the text was sent. Check Messages before trying again.';
});

async function start(){
 try{
  const info=await call('/api/wishlist?onboarding=1');
  textURL=info.text_url??'';
  if(info.first_name){$('greeting').textContent=`Hi, ${info.first_name}`;$('greeting').hidden=false;}
  if(!info.gmail_available){show('unavailable');for(const a of document.querySelectorAll('.messages-link')){a.hidden=!textURL;if(textURL)a.href=textURL;}return;}
  data=await historyAPI();
  // Back from Google: start reading right away.
  if(params.get('gmail')==='connected'&&data.connected&&data.status==='not_started')data=await historyAPI('start');
  if(params.get('gmail')==='declined')say('Gmail access was declined. You can still connect Shop, or just text Jules photos and links.');
  if(params.has('gmail'))history.replaceState(null,'',location.pathname);
  if(data.connected||Object.values(data.connections??{}).some(c=>c?.connected))$('consent').checked=true;
  render();await refresh();
 }catch(error){handle(error);}
}
if(signinToken){
 try{await signInFromLink(signinToken);}
 catch{
  // A spent link in a browser that is already signed in just continues.
  if(!session.read())show('expired');
 }
}
if(!signinToken||session.read())await start();
