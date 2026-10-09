import {mountPublicHeader as initPublicBrand} from './design-system.js';
import {SIGNUP_CONSENT,SIGNUP_VERSION} from './signup-consent.js';
initPublicBrand();
const $=id=>document.getElementById(id),form=$('signup-form'),button=$('signup-button'),status=$('signup-status');
$('consent-text').textContent=SIGNUP_CONSENT;
let available=false,requestId=crypto.randomUUID();
form.addEventListener('input',()=>{requestId=crypto.randomUUID();});
try{const response=await fetch('/api/wishlist?public_signup=1');const config=await response.json();available=response.ok&&config.enabled;button.disabled=!available;status.textContent=available?'':'Signups are not open yet. Please check back soon.';}catch{status.textContent='Could not check signup availability. Please reload to try again.';}
form.onsubmit=async event=>{event.preventDefault();if(!available||button.disabled||!form.reportValidity())return;button.disabled=true;status.textContent='Saving your signup…';try{const response=await fetch('/api/wishlist?public_signup=1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:$('phone').value,consent:$('consent').checked,consent_version:SIGNUP_VERSION,request_id:requestId})});const result=await response.json();if(!response.ok||result.saved!==true)throw new Error(result.error||'Could not save your signup. Please try again.');form.hidden=true;$('signup-success').hidden=false;status.textContent='';if(result.text_url){$('start-text').href=result.text_url;$('start-text').hidden=false;$('start-help').hidden=false;} $('signup-success').setAttribute('tabindex','-1');$('signup-success').focus();}catch(error){status.textContent=error.message;}finally{button.disabled=!available;}};
