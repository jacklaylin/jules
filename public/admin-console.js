// Owner console shell: one sign-in shared by every admin tool, and one menu that stays on screen.
// Pages keep their own actions; they call adminFetch so expired or non-owner sessions return to sign-in.
import {createLogo,initBrandActivity} from './brand-ui.js';
import {createSession} from './wishlist-session.js';
import {captureSignIn,LEGACY_KEYS} from './admin-session.js';
import {trackedFetch} from './activity.js';

export const ADMIN_SECTIONS=[
 ['Conversations',[['people','People','/admin','Threads, profiles and feedback']]],
 ['Test lab',[
  ['test-chat','Test chat','/admin/test-chat','Real Jules logic, no phone messages'],
  ['replays','Replays & evals','/admin/replays','Sourcing replays and routing eval'],
  ['search','Search check','/admin/search','Live search diagnostic'],
  ['identify','Photo identification','/admin/identify','Image search and saved-item corrections'],
 ]],
 ['Operations',[['costs','Costs','/admin/costs','Daily spend and budget']]],
];
const session=createSession({storage:localStorage,lock:work=>navigator.locks?navigator.locks.request('jules-wishlist-refresh',work):work()});
let gate,content,signout;
export const adminToken=()=>session.token();

export async function adminFetch(path,options={}){
 const send=token=>trackedFetch(path,{...options,headers:{'Content-Type':'application/json',...options.headers,...(token?{Authorization:'Bearer '+token}:{})},cache:'no-store'});
 let token=await session.token();
 if(!token){showGate();throw new Error('Sign in with the owner email to use admin tools.');}
 let response=await send(token);
 if(response.status===401&&session.read()?.refresh_token){token=await session.token(true);if(token)response=await send(token);}
 if(response.status===401||response.status===403){showGate(response.status===403?'This account is not the owner account.':'');throw new Error('Owner sign-in required.');}
 return response;
}
export async function adminJson(path,options){
 const response=await adminFetch(path,options);
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error(data.error??'Request failed.');
 return data;
}

function showGate(message=''){
 if(!gate)return;
 gate.hidden=false;content.hidden=true;signout.hidden=true;
 gate.querySelector('.admin-gate-notice').textContent=message;
}
function hideGate(){gate.hidden=true;content.hidden=false;signout.hidden=false;}

function element(tag,props={},...children){const node=Object.assign(document.createElement(tag),props);node.append(...children);return node;}

export function mountAdminShell(page){
 const error=captureSignIn({location,history,localStore:localStorage,tabStore:sessionStorage});
 document.body.classList.add('admin-console');
 content=document.querySelector('main');
 const brand=element('a',{className:'wordmark',href:'/admin'},createLogo());brand.setAttribute('aria-label','Jules admin');
 signout=element('button',{type:'button',className:'admin-signout',textContent:'Sign out'});
 const bar=element('header',{className:'admin-bar'},brand,element('span',{className:'admin-label',textContent:'Admin'}),
  element('div',{className:'admin-bar-actions'},element('a',{href:'/wishlist',textContent:'Your wishlist ↗'}),signout));
 const nav=element('nav',{className:'admin-nav'});nav.setAttribute('aria-label','Admin tools');
 for(const [title,pages] of ADMIN_SECTIONS){
  const list=element('div',{className:'admin-nav-group'},element('h2',{textContent:title}));
  for(const [key,text,href,hint] of pages){
   const link=element('a',{href},element('span',{textContent:text}),element('small',{textContent:hint}));
   if(key===page)link.setAttribute('aria-current','page');
   list.append(link);
  }
  nav.append(list);
 }
 const email=element('input',{type:'email',id:'admin-email',autocomplete:'email',required:true,placeholder:'you@example.com'});
 const submit=element('button',{className:'primary',textContent:'Email me a sign-in link'});
 const form=element('form',{},element('label',{htmlFor:'admin-email',textContent:'Owner email'}),email,submit);
 gate=element('div',{className:'admin-gate',hidden:true},element('p',{className:'eyebrow',textContent:'Owner only'}),element('h1',{textContent:'Sign in to admin'}),
  element('p',{className:'muted',textContent:'One sign-in covers every admin tool in this browser. The link opens People.'}),form,element('p',{className:'admin-gate-notice',role:'status'}));
 form.onsubmit=async event=>{
  event.preventDefault();submit.disabled=true;
  try{
   const response=await trackedFetch('/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:email.value})});
   const data=await response.json().catch(()=>({}));
   gate.querySelector('.admin-gate-notice').textContent=response.ok?'Check your email and open the sign-in link. It expires after one hour.':data.error??'Could not send the sign-in link.';
  }catch{gate.querySelector('.admin-gate-notice').textContent='Could not send the sign-in link.';}
  finally{submit.disabled=false;}
 };
 signout.onclick=async()=>{
  signout.disabled=true;
  try{const token=await session.token();if(token)await trackedFetch('/api/wishlist',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({action:'logout'})});}catch{}
  session.clear();[...LEGACY_KEYS,'jules_simulator'].forEach(key=>sessionStorage.removeItem(key));
  signout.disabled=false;showGate('Signed out on this browser.');
 };
 const layout=element('div',{className:'admin-layout'},nav);
 content.before(bar,layout);layout.append(content,gate);
 initBrandActivity();
 if(error||!session.read())showGate(error??'');else hideGate();
}
