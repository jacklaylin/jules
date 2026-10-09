import {mountHeader,enableTestChat} from './design-system.js';
import {createSession} from './wishlist-session.js';
import {trackedFetch} from './activity.js';
import {readSimulatorResponse} from './simulator-response.js';
mountHeader('simulator');
const session=createSession({storage:localStorage,lock:work=>navigator.locks?navigator.locks.request('jules-wishlist-refresh',work):work()});
const $=id=>document.getElementById(id);
let snapshot,turns=[],busy=false,imageURLs=[],seenMessages=new Set();
try{const saved=JSON.parse(sessionStorage.getItem('jules_simulator')??'null');if(saved?.snapshot){snapshot=saved.snapshot;turns=saved.turns??[];}}catch{}
function preserve(){try{sessionStorage.setItem('jules_simulator',JSON.stringify({snapshot,turns}));}catch{$('status').textContent='This conversation is too large to keep in the tab. Export it before leaving.';}}
const readFile=file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=reject;reader.readAsDataURL(file);});
function render(){
  imageURLs.forEach(url=>URL.revokeObjectURL(url));imageURLs=[];
  $('chat').replaceChildren();
  if(!snapshot?.messages?.length){const empty=document.createElement('p');empty.className='chat-empty';empty.textContent='Your personal shopper, right here. Ask a question, share a product, or send a photo.';$('chat').append(empty);}
  const visibleMessages=(snapshot?.messages??[]).filter(message=>message.direction!=='outbound'||message.status==='sent');
  for(const [index,message] of visibleMessages.entries()){
    const group=document.createElement('div');group.className='message-group '+message.direction;
    const key=message.id??JSON.stringify([message.created_at,message.direction,message.body]);if(!seenMessages.has(key)){group.classList.add('new-message');seenMessages.add(key);}
    const bubble=document.createElement('div');bubble.className='bubble'+(visibleMessages[index+1]?.direction!==message.direction?' group-end':'');bubble.textContent=message.body;
    for(const ref of message.message_images??[]){const image=snapshot.images.find(i=>i.id===ref.id);if(image){const img=document.createElement('img'),url=URL.createObjectURL(new Blob([Uint8Array.from(atob(image.data),c=>c.charCodeAt(0))],{type:image.mime_type}));imageURLs.push(url);img.src=url;img.alt='Test product image';bubble.classList.add('photo-bubble');bubble.append(img);}}
    const meta=document.createElement('span');meta.className='message-meta';meta.textContent=(message.created_at?new Date(message.created_at).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}):'')+(message.direction==='inbound'?' · You':' · Jules');group.append(bubble,meta);$('chat').append(group);
  }
  $('chat').scrollTop=$('chat').scrollHeight;
  $('test-items').replaceChildren();$('test-count').textContent=(snapshot?.wishlist_live?.length??snapshot?.items?.length??0)+' items';
  for(const item of snapshot?.wishlist_live??snapshot?.items??[]){
    const card=document.createElement('div');card.className='test-item';
    const title=document.createElement('strong');title.textContent=item.name??'Saved item';card.append(title);
    for(const link of item.links??[]){try{const url=new URL(link.url);if(url.protocol!=='https:'||url.username||url.password)continue;const a=document.createElement('a');a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';a.textContent=url.hostname.replace(/^www\./,'')+' ↗';card.append(a);}catch{}}
    $('test-items').append(card);
  }
  $('actions').replaceChildren();
  const latest=turns.at(-1);
  const labels={memory:'Profile learning',profile_updated:'Profile updated',shopping_outcome:'Intent',wishlist_saved:'Saved to your wishlist',delivery:'Test delivery',alert_enabled:'Test price alert enabled',feedback_saved:'Feedback saved'};
  for(const e of latest?.events??[]){const p=document.createElement('p');p.className='action-receipt';p.textContent=(labels[e.type]??e.type)+(e.status?' · '+e.status:'')+(e.urls?' · '+e.urls.length+' items':'')+(e.type==='shopping_outcome'?' · '+(e.result.intent_action??e.result.identification_policy)+(e.result.intent_decision?' / '+e.result.intent_decision:''):'');$('actions').append(p);}
  if(latest){const details=document.createElement('details'),summary=document.createElement('summary'),pre=document.createElement('pre');summary.textContent='Full turn diagnostics';pre.textContent=JSON.stringify({...latest,snapshot:undefined},null,2);details.append(summary,pre);$('actions').append(details);}
  $('state').textContent=JSON.stringify({wishlist:snapshot?.items??[],profile:snapshot?.profile?.facts??[],alerts:snapshot?.alerts??[]},null,2);
  $('download').disabled=!turns.length;
}
$('composer').onsubmit=async event=>{
  event.preventDefault();if(busy)return;
  const text=$('message').value,file=$('image').files[0];if(!text.trim()&&!file)return;
  busy=true;for(const id of ['send','attach','reset','import'])$(id).disabled=true;
  $('status').textContent='Jules is thinking…';const typing=document.createElement('div');typing.className='chat-typing';typing.setAttribute('aria-label','Jules is working');typing.innerHTML='<span class="bubble typing" aria-hidden="true"><i></i><i></i><i></i></span>';$('chat').append(typing);$('chat').scrollTop=$('chat').scrollHeight;
  try{
    if(file&&file.size>1000000)throw Error('Use an image under 1 MB.');
    const token=await session.token()||sessionStorage.getItem('jules_wishlist_token')||sessionStorage.getItem('jules_token');
    if(!token)throw Error('Sign in through your wishlist first, then return here.');
    const input={text,snapshot,failure:$('failure').value,...(file?{image:await readFile(file)}:{})};
    const response=await trackedFetch('/api/chat-simulator',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(input)},'Jules is thinking');
    const result=await readSimulatorResponse(response,{turn:true});
    snapshot=result.snapshot;turns.push({...result,snapshot:undefined,input:{text,failure:input.failure}});render();
    if($('message').value===text){$('message').value='';$('message').style.height='';}
    if($('image').files[0]===file){$('image').value='';$('attachment').hidden=true;}
    $('status').textContent=`${(result.elapsed_ms/1000).toFixed(1)}s · ${result.outcome.includes('uncertain')?'Delivery failed in simulation; inspect saved state.':'Test message sent.'}`;preserve();
  }catch(error){turns.push({outcome:'failed',error:error.message,input:{text,failure:$('failure').value}});preserve();render();$('status').textContent=error.message;}finally{typing.remove();busy=false;for(const id of ['send','attach','reset','import'])$(id).disabled=false;}
};
$('reset').onclick=()=>{snapshot={messages:[],profile:{facts:[],version:0},items:[],alerts:[],images:[],wishlist_live:snapshot?.wishlist_live??[]};turns=[];preserve();render();$('status').textContent='New test conversation.';};
$('toggle-diagnostics').onclick=()=>{const show=$('diagnostics').hidden;$('diagnostics').hidden=!show;$('simulator-layout').classList.toggle('diagnostics-open',show);$('toggle-diagnostics').setAttribute('aria-expanded',String(show));};
$('attach').onclick=()=>$('image').click();
$('image').onchange=()=>{const file=$('image').files[0];$('attachment').hidden=!file;$('attachment-name').textContent=file?.name??'';};
$('clear-image').onclick=()=>{$('image').value='';$('attachment').hidden=true;};
$('message').oninput=()=>{$('message').style.height='auto';$('message').style.height=Math.min($('message').scrollHeight,120)+'px';};
$('message').onkeydown=event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();$('composer').requestSubmit();}};
$('download').onclick=()=>{const link=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify({kind:'jules-chat-simulator',created_at:new Date().toISOString(),snapshot,turns},null,2)],{type:'application/json'}));link.href=url;link.download='jules-chat-simulator.json';link.click();URL.revokeObjectURL(url);};
$('import').onchange=async()=>{try{const file=$('import').files[0];if(!file||file.size>4000000)throw Error('Use a simulator report under 4 MB.');const report=JSON.parse(await file.text());if(report.kind!=='jules-chat-simulator'||!Array.isArray(report.snapshot?.messages)||!Array.isArray(report.turns))throw Error('Use a report exported by this simulator.');snapshot=report.snapshot;turns=report.turns;render();preserve();$('status').textContent='Conversation resumed. Send a follow-up to run the real logic again.';}catch(error){$('status').textContent=error.message;}};
$('logout').onclick=async()=>{try{const token=await session.token();const response=await trackedFetch('/api/wishlist',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({action:'logout'})});if(!response.ok)throw Error('Could not log out. Try again.');session.clear();sessionStorage.removeItem('jules_wishlist_token');sessionStorage.removeItem('jules_token');sessionStorage.removeItem('jules_simulator');location.href='/wishlist';}catch(error){$('status').textContent=error.message;}};
session.token().then(async token=>{if(token){void enableTestChat(token);$('logout').hidden=false;const response=await trackedFetch('/api/chat-simulator',{headers:{Authorization:'Bearer '+token}},'Loading your wishlist');const data=await readSimulatorResponse(response);snapshot??={messages:[],profile:{facts:[],version:0},items:[],alerts:[],images:[]};snapshot.wishlist_live=data.items;render();}else{$('status').textContent='Sign in through your wishlist, then return to Test chat.';}}).catch(error=>{$('status').textContent=error.message;});
render();
