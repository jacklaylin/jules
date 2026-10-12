import {mountPublicHeader} from './design-system.js';
import {createLogo} from './brand-ui.js';
import {createSession} from './wishlist-session.js';
mountPublicHeader();
const $=id=>document.getElementById(id),session=createSession({storage:localStorage,lock:work=>navigator.locks?navigator.locks.request('jules-wishlist-refresh',work):work()});
const fragment=new URLSearchParams(location.hash.slice(1));
if(fragment.has('access_token'))session.save({access_token:fragment.get('access_token'),refresh_token:fragment.get('refresh_token'),expires_at:Number(fragment.get('expires_at'))||Date.now()/1000+(Number(fragment.get('expires_in'))||3600)});
if(location.hash)history.replaceState(null,'',location.pathname+location.search);
const logo=createLogo();$('thinking-logo').append(logo);
let busy=false;
async function api(action){
 const token=await session.token();
 if(!token){$('login').hidden=false;throw Error('Sign in with your invited email to continue.');}
 const response=await fetch('/api/wishlist?onboarding=1',{method:action?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(action?{body:JSON.stringify({action})}:{}),cache:'no-store',keepalive:Boolean(action)});
 const data=await response.json();
 if(!response.ok){if([401,403].includes(response.status))$('login').hidden=false;throw Error(data.error||'Could not continue. Please try again.');}
 return data;
}
function thinking(){ $('connect').hidden=true;$('thinking').hidden=false;$('status').textContent='';logo.classList.add('logo--thinking'); }
function completed(data){
 thinking();logo.classList.remove('logo--thinking');$('thinking').querySelector('progress').hidden=true;
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
let importBusy=false;
async function gmailAPI(action,extra={}){
 const token=await session.token();if(!token){$('login').hidden=false;throw Error('Sign in with your invited email to continue.');}
 const response=await fetch('/api/wishlist?gmail=1',{method:action?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(action?{body:JSON.stringify({action,...extra})}:{}),cache:'no-store'});
 const data=await response.json();if(!response.ok)throw Error(data.error||'Could not complete this step.');return data;
}
function renderGmail(data){
 $('connect').hidden=$('thinking').hidden=true;
 $('gmail-connect').hidden=data.connected;$('gmail-history').hidden=!data.connected&&!data.items.length;
 $('gmail-account').textContent=data.account?'Connected account: '+data.account:'';
 const running=['listing','extracting','questions'].includes(data.status);
 $('gmail-progress').textContent=data.status==='ready'?`Import complete: ${data.items.length} purchase ${data.items.length===1?'item':'items'} found in ${data.processed} matching emails.`:data.status==='listing'?'Finding matching shopping emails…':data.status==='questions'?'Selecting the most useful questions…':data.status==='extracting'?`Reviewed ${data.processed} of ${data.total} matching emails.`:data.status==='paused'?'Import paused. Reconnect Gmail to continue.':'Gmail connected. Ready to import.';
 $('gmail-loader').hidden=!running;
 $('gmail-notice').textContent=[running?'Keep this page open to finish. Closing it pauses progress; reopening resumes saved work.':'',data.limited?'The 200-email pilot limit was reached; this history is partial.':'',data.warnings?`${data.warnings} ${data.warnings===1?'email has':'emails have'} unreadable, unsupported or truncated content; their readable evidence was retained.`:'',data.changed_sources?`${data.changed_sources} changed emails were held separately; prior corrections remain. You can correct found items below.`:'',data.pending_events?`${data.pending_events} shopping events could not be safely linked to purchases and remain unresolved.`:'',data.failed?'A step failed. Resume to retry without losing completed work.':''].filter(Boolean).join(' ');
 $('gmail-start').hidden=running||!data.connected;$('gmail-start').textContent=data.status==='ready'?'Import again':'Import last 90 days';$('gmail-resume').hidden=!running;
 $('gmail-disconnect').hidden=!data.connected;
 $('gmail-questions').hidden=!data.questions.length;$('gmail-question-list').replaceChildren();
 for(const q of data.questions){const form=document.createElement('form'),label=document.createElement('label'),input=document.createElement('textarea'),button=document.createElement('button');input.id=q.id;input.maxLength=1000;input.required=true;label.htmlFor=input.id;label.textContent=q.question;button.textContent='Save answer';form.append(label,input,button);form.onsubmit=async event=>{event.preventDefault();button.disabled=true;try{const updated=await gmailAPI('answer',{question_id:q.id,message:input.value});renderGmail(updated);$('status').textContent=updated.feedback_applied?'Answer saved.':'Please clarify which item and what you’d like to change; no correction was applied.';}catch(error){$('status').textContent=error.message;}finally{button.disabled=false;}};$('gmail-question-list').append(form);}
 $('gmail-items').replaceChildren();for(const item of data.items){const li=document.createElement('li');li.textContent=[item.brand,item.product,item.merchant&&'from '+item.merchant,item.size_label&&'size '+item.size_label,item.color,item.quantity&&'quantity '+item.quantity,item.recipient.value==='self'?'for you':item.recipient.value==='other'?'for '+(item.recipient.label||'someone else'):'recipient unknown',item.outcome.value!=='unknown'?item.outcome.value:null].filter(Boolean).join(' · ');$('gmail-items').append(li);}
}
async function runImport(){
 if(importBusy)return;importBusy=true;$('status').textContent='';$('gmail-resume').disabled=true;
 try{let data=await gmailAPI();renderGmail(data);while(['listing','extracting','questions'].includes(data.status)){data=await gmailAPI('step');renderGmail(data);} }
 catch(error){$('status').textContent=error.message;}
 finally{importBusy=false;$('gmail-resume').disabled=false;}
}
async function loadGmail(){
 const data=await gmailAPI();renderGmail(data);
 if(data.connected&&data.status==='not_started'&&new URLSearchParams(location.search).get('gmail')==='connected'){await gmailAPI('start');await runImport();}
 else if(['listing','extracting','questions'].includes(data.status))await runImport();
 else if(new URLSearchParams(location.search).get('gmail')==='declined')$('status').textContent='Gmail access was declined. You can still use your wishlist.';
}
$('gmail-connect-button').onclick=async()=>{if(!$('gmail-consent').checked){$('status').textContent='Review and confirm receipt analysis consent first.';return;}$('gmail-connect-button').disabled=true;try{const data=await gmailAPI('connect',{consent:'gmail-receipts-90d-v1'});location.assign(data.url);}catch(error){$('status').textContent=error.message;$('gmail-connect-button').disabled=false;}};
$('gmail-start').onclick=async()=>{try{await gmailAPI('start');await runImport();}catch(error){$('status').textContent=error.message;}};
$('gmail-resume').onclick=runImport;
$('gmail-disconnect').onclick=async()=>{try{renderGmail(await gmailAPI('disconnect'));$('status').textContent='Gmail disconnected. Imported history remains saved.';}catch(error){$('status').textContent=error.message;}};
$('gmail-delete').onclick=async()=>{if(!confirm('Delete imported history and its receipt-derived learning? This also disconnects Gmail. Independent shopping preferences remain.'))return;try{renderGmail(await gmailAPI('delete-history',{confirm:true}));$('status').textContent='Imported history deleted and Gmail disconnected.';}catch(error){$('status').textContent=error.message;}};
$('gmail-correction').onsubmit=async event=>{event.preventDefault();try{const updated=await gmailAPI('answer',{message:$('gmail-correction-text').value});renderGmail(updated);if(updated.feedback_applied)$('gmail-correction-text').value='';$('status').textContent=updated.feedback_applied?'Correction saved.':'Please clarify which item and what you’d like to change; no correction was applied.';}catch(error){$('status').textContent=error.message;}};
await load();
