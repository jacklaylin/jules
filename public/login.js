import {mountPublicHeader} from './design-system.js';
import {createSession} from './wishlist-session.js';
mountPublicHeader();
const $=id=>document.getElementById(id),destination=(['onboarding','style','account'].includes(new URLSearchParams(location.search).get('next'))?new URLSearchParams(location.search).get('next'):'wishlist');
const session=createSession({storage:localStorage,lock:work=>navigator.locks?navigator.locks.request('jules-wishlist-refresh',work):work()});
let challenge;
try{if(await session.token())location.replace('/'+destination);}catch{$('login-status').textContent='Please sign in again to continue.';}
async function call(body){const response=await fetch('/api/wishlist?phone_login=1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await response.json();if(!response.ok)throw Error(data.error||'Could not sign in. Try again.');return data;}
$('login-form').onsubmit=async event=>{event.preventDefault();$('login-button').disabled=true;$('login-status').textContent='Requesting your code…';try{const data=await call({action:'request',phone:$('phone').value});challenge=data.challenge;$('login-status').textContent=data.message;$('login-form').hidden=true;$('verify-form').hidden=false;$('code').focus();}catch(error){$('login-status').textContent=error.message;}finally{$('login-button').disabled=false;}};
$('verify-form').onsubmit=async event=>{event.preventDefault();$('verify-button').disabled=true;$('login-status').textContent='Checking your code…';try{session.save(await call({action:'verify',challenge,code:$('code').value}));location.assign('/'+destination);}catch(error){$('login-status').textContent=error.message;}finally{$('verify-button').disabled=false;}};
$('change-number').onclick=()=>{challenge=null;$('verify-form').hidden=true;$('login-form').hidden=false;$('code').value='';$('login-status').textContent='';$('phone').focus();};
