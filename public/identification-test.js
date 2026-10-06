import {createSession} from './wishlist-session.js';
const session=createSession({storage:localStorage,lock:work=>navigator.locks?navigator.locks.request('jules-wishlist-refresh',work):work()});
const form=document.getElementById('test-form'),status=document.getElementById('status'),results=document.getElementById('results');
let operation=null;
form.oninput=()=>{operation=null;};
form.onsubmit=async event=>{
  event.preventDefault();
  const file=document.getElementById('image').files[0];
  let token;try{token=await session.token()||sessionStorage.getItem('jules_wishlist_token')||sessionStorage.getItem('jules_token');}catch(error){status.textContent=error.message;return;}
  if(!token){status.textContent='Sign in at admin first.';return;}
  if(!file||file.size>3*1024*1024){status.textContent='Choose an image under 3 MB.';return;}
  operation??=crypto.randomUUID();
  document.getElementById('run').disabled=true;status.textContent='Searching and saving…';results.textContent='';
  try{
    const image=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=reject;reader.readAsDataURL(file);});
    const response=await fetch('/api/identification-test',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({operation,query:document.getElementById('query').value,image,provider_sharing:document.getElementById('sharing').checked})});
    const data=await response.json();if(!response.ok)throw new Error(data.error);
    status.textContent=`${data.saved} returned matches saved. Open or refresh your wishlist.`;
    results.textContent=JSON.stringify(data.result,null,2);
  }catch(error){status.textContent=error.message;}
  finally{document.getElementById('run').disabled=false;}
};
