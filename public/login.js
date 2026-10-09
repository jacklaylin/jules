import {mountPublicHeader as initPublicBrand} from './design-system.js';
import {createSession} from './wishlist-session.js';
initPublicBrand();
const session=createSession({storage:localStorage,lock:work=>navigator.locks?navigator.locks.request('jules-wishlist-refresh',work):work()}),status=document.getElementById('login-status'),button=document.getElementById('login-button');
try{if(await session.token())location.replace('/wishlist');}catch{status.textContent='Please sign in again to continue.';}
document.getElementById('login-form').onsubmit=async event=>{event.preventDefault();button.disabled=true;status.textContent='Requesting your sign-in link…';try{const response=await fetch('/api/wishlist',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'login',email:document.getElementById('email').value})});const data=await response.json();if(!response.ok)throw new Error(data.error||'Could not request a sign-in link. Please try again.');status.textContent=data.message;}catch(error){status.textContent=error.message;}finally{button.disabled=false;}};
