import {trackedFetch as fetch} from './activity.js';
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

const correctionStatus=document.getElementById('correction-status');
async function correctionRequest(path,options={}){
 const token=await session.token()||sessionStorage.getItem('jules_wishlist_token')||sessionStorage.getItem('jules_token');
 const response=await fetch(path,{...options,headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},cache:'no-store'});
 const data=await response.json();if(!response.ok)throw new Error(data.error);return data;
}
document.getElementById('load-items').onclick=async()=>{
 try{const {items}=await correctionRequest('/api/wishlist');const select=document.getElementById('correction-item');select.replaceChildren();for(const item of items){const option=document.createElement('option');option.value=item.image_item;option.textContent=item.name;select.append(option);}correctionStatus.textContent='Saved items loaded.';}catch(e){correctionStatus.textContent=e.message;}
};
document.getElementById('correction-form').onsubmit=async event=>{
 event.preventDefault();const button=document.getElementById('save-correction');button.disabled=true;
 try{
  const file=document.getElementById('correction-image').files[0];if(!file||file.size>3*1024*1024)throw new Error('Choose an image under 3 MB.');
  const image=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=reject;reader.readAsDataURL(file);});
  await correctionRequest('/api/wishlist-correction',{method:'POST',body:JSON.stringify({item:document.getElementById('correction-item').value,url:document.getElementById('correction-url').value,name:document.getElementById('correction-name').value,brand:document.getElementById('correction-brand').value,amount:Number(document.getElementById('correction-amount').value),currency:document.getElementById('correction-currency').value,image,verified:document.getElementById('correction-verified').checked})});
  correctionStatus.textContent='Correction saved. Refresh your wishlist.';
 }catch(e){correctionStatus.textContent=e.message;}finally{button.disabled=false;}
};

document.getElementById('refresh-photo').onclick=async()=>{
 const button=document.getElementById('refresh-photo');button.disabled=true;correctionStatus.textContent='Loading product website photos…';
 try{await correctionRequest('/api/wishlist-correction',{method:'POST',body:JSON.stringify({action:'refresh_photo',item:document.getElementById('correction-item').value})});correctionStatus.textContent='Website photos saved. Refresh your wishlist.';}catch(e){correctionStatus.textContent=e.message;}finally{button.disabled=false;}
};

document.getElementById('verify-listings').onclick=async()=>{
 const button=document.getElementById('verify-listings');button.disabled=true;correctionStatus.textContent='Checking saved product pages and prices…';
 try{const data=await correctionRequest('/api/wishlist-correction',{method:'POST',body:JSON.stringify({action:'verify_listings'})});correctionStatus.textContent=`Checked ${data.checked} links; withheld ${data.removed} unverified shopping links. Prices updated. Refresh your wishlist.`;}catch(e){correctionStatus.textContent=e.message;}finally{button.disabled=false;}
};
