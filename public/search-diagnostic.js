import {trackedFetch as fetch} from './activity.js';
import {createSession} from './wishlist-session.js';
const session=createSession({storage:localStorage,lock:work=>navigator.locks?navigator.locks.request('jules-wishlist-refresh',work):work()});
for(const button of document.querySelectorAll('button'))button.onclick=async()=>{
 const status=document.getElementById('status'),output=document.getElementById('result');
 button.disabled=true;status.textContent='Running live search…';output.textContent='';
 try{
  const token=await session.token()||sessionStorage.getItem('jules_wishlist_token')||sessionStorage.getItem('jules_token');
  if(!token)throw Error('Sign in at admin first.');
  const response=await fetch('/api/identification-test',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({action:'text_search_diagnostic',mode:button.dataset.mode})});
  const data=await response.json();if(!response.ok)throw Error(data.error);
  status.textContent='Search completed.';output.textContent=JSON.stringify(data,null,2);
 }catch(error){status.textContent=error.message;}finally{button.disabled=false;}
};
