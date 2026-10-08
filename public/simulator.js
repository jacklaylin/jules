import {mountHeader} from './design-system.js';
import {createSession} from './wishlist-session.js';
import {trackedFetch} from './activity.js';
mountHeader('simulator');
const session=createSession({storage:localStorage,lock:work=>navigator.locks?navigator.locks.request('jules-wishlist-refresh',work):work()});
const $=id=>document.getElementById(id);
let snapshot,turns=[],busy=false,imageURLs=[];
const readFile=file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=reject;reader.readAsDataURL(file);});
function render(){
  imageURLs.forEach(url=>URL.revokeObjectURL(url));imageURLs=[];
  $('chat').replaceChildren();
  for(const message of snapshot?.messages??[]){
    if(message.direction==='outbound'&&message.status!=='sent')continue;
    const bubble=document.createElement('div');bubble.className='bubble '+message.direction;bubble.textContent=message.body;
    for(const ref of message.message_images??[]){const image=snapshot.images.find(i=>i.id===ref.id);if(image){const img=document.createElement('img'),url=URL.createObjectURL(new Blob([Uint8Array.from(atob(image.data),c=>c.charCodeAt(0))],{type:image.mime_type}));imageURLs.push(url);img.src=url;img.alt='Test product image';bubble.append(img);}}
    $('chat').append(bubble);
  }
  $('chat').scrollTop=$('chat').scrollHeight;
  $('actions').replaceChildren();
  const latest=turns.at(-1);
  for(const e of latest?.events??[]){const p=document.createElement('p');p.textContent=e.type+(e.status?' · '+e.status:'')+(e.urls?' · '+e.urls.length+' items':'')+(e.type==='shopping_outcome'?' · '+(e.result.intent_action??e.result.identification_policy)+(e.result.intent_decision?' / '+e.result.intent_decision:''):'');$('actions').append(p);}
  if(latest){const details=document.createElement('details'),summary=document.createElement('summary'),pre=document.createElement('pre');summary.textContent='Full turn diagnostics';pre.textContent=JSON.stringify({...latest,snapshot:undefined},null,2);details.append(summary,pre);$('actions').append(details);}
  $('state').textContent=JSON.stringify({wishlist:snapshot?.items??[],profile:snapshot?.profile?.facts??[],alerts:snapshot?.alerts??[]},null,2);
  $('download').disabled=!turns.length;
}
$('composer').onsubmit=async event=>{
  event.preventDefault();if(busy)return;
  const text=$('message').value,file=$('image').files[0];if(!text.trim()&&!file)return;
  busy=true;for(const id of ['send','reset','import'])$(id).disabled=true;
  $('status').textContent='Jules is thinking…';
  try{
    if(file&&file.size>1000000)throw Error('Use an image under 1 MB.');
    const token=await session.token()||sessionStorage.getItem('jules_wishlist_token')||sessionStorage.getItem('jules_token');
    if(!token)throw Error('Sign in through your wishlist first, then return here.');
    const input={text,snapshot,failure:$('failure').value,...(file?{image:await readFile(file)}:{})};
    const response=await trackedFetch('/api/chat-simulator',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(input)},'Jules is thinking');
    const result=await response.json();if(!response.ok)throw Error(result.error);
    snapshot=result.snapshot;turns.push({...result,snapshot:undefined,input:{text,failure:input.failure}});render();
    $('message').value='';$('image').value='';$('status').textContent=`${(result.elapsed_ms/1000).toFixed(1)}s · ${result.configuration.conversation_model} · ${result.outcome.includes('uncertain')?'Delivery failed in simulation; inspect saved state.':'Test turn complete.'}`;
  }catch(error){$('status').textContent=error.message;}finally{busy=false;for(const id of ['send','reset','import'])$(id).disabled=false;}
};
$('reset').onclick=()=>{snapshot=undefined;turns=[];render();$('status').textContent='New test conversation.';};
$('download').onclick=()=>{const link=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify({kind:'jules-chat-simulator',created_at:new Date().toISOString(),snapshot,turns},null,2)],{type:'application/json'}));link.href=url;link.download='jules-chat-simulator.json';link.click();URL.revokeObjectURL(url);};
$('import').onchange=async()=>{try{const file=$('import').files[0];if(!file||file.size>4000000)throw Error('Use a simulator report under 4 MB.');const report=JSON.parse(await file.text());if(report.kind!=='jules-chat-simulator'||!Array.isArray(report.snapshot?.messages)||!Array.isArray(report.turns))throw Error('Use a report exported by this simulator.');snapshot=report.snapshot;turns=report.turns;render();$('status').textContent='Conversation resumed. Send a follow-up to run the real logic again.';}catch(error){$('status').textContent=error.message;}};
render();
