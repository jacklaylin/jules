import {trackedFetch as fetch} from './activity.js';
import {mountHeader,enableAdminLink} from './design-system.js';
import {createSession} from './wishlist-session.js';
import {matchPhotoBackground} from './photo-background.js';
mountHeader('wardrobe');

// The wardrobe (PRD section 29): what Jules counts as yours, from your receipts. Every change goes
// through /api/wishlist?wardrobe=1 as a structured correction; this page never edits facts itself.
const $=id=>document.getElementById(id);
const session=createSession({fetcher:fetch,storage:localStorage,lock:work=>navigator.locks?navigator.locks.request('jules-wishlist-refresh',work):work()});
const fragment=new URLSearchParams(location.hash.slice(1));
// Same sign-in rules as the wishlist: the shared rotating session, or an older per-tab token.
let token=session.read()?.access_token||sessionStorage.getItem('jules_wishlist_token');
if(fragment.has('access_token'))token=fragment.get('access_token'),sessionStorage.removeItem('jules_wishlist_token'),session.save({access_token:fragment.get('access_token'),refresh_token:fragment.get('refresh_token'),expires_at:Number(fragment.get('expires_at'))||Date.now()/1000+(Number(fragment.get('expires_in'))||3600)});
if(location.hash)history.replaceState(null,'','/wardrobe'+location.search);

const el=(tag,props={},...children)=>{const node=Object.assign(document.createElement(tag),props);node.append(...children.filter(c=>c!=null&&c!==false));return node;};
const CATEGORY_LABELS={tops:'Tops',bottoms:'Bottoms',dresses:'Dresses',outerwear:'Outerwear',suits:'Suits',shoes:'Shoes',bags:'Bags',accessories:'Accessories',other:'Other'};
const REASON_LABELS={returned:'Returned',cancelled:'Order cancelled',gift:'Gift for someone',gone:'Don’t have it anymore',never_bought:'Never bought'};
const ANSWER_LABELS={mine:'Mine',gift:'A gift',bought:'I bought it',not_bought:'I didn’t',kept:'Kept it',returned:'Returned',same:'Same item',not_sure:'Not sure'};
// Outline drawings stand in when there is no photo: none in the purchase itself and no searched photo the
// owner has confirmed. A searched photo is shown only as a suggestion until they say it's theirs.
const OUTLINES={
 tops:'M92 74 L130 58 Q150 80 170 58 L208 74 L258 124 L228 154 L210 138 L210 336 L90 336 L90 138 L72 154 L42 124 Z',
 bottoms:'M98 50 L202 50 L216 356 L166 356 L150 146 L134 356 L84 356 Z',
 dresses:'M122 50 L178 50 L174 124 L232 358 L68 358 L126 124 Z M128 50 L122 24 M172 50 L178 24',
 outerwear:'M100 46 L130 36 L150 64 L170 36 L200 46 L240 90 L262 330 L232 334 L218 150 L226 372 L74 372 L82 150 L68 334 L38 330 L60 90 Z',
 suits:'M96 62 L130 50 L150 150 L170 50 L204 62 L244 106 L258 316 L230 320 L216 160 L216 340 L84 340 L84 160 L70 320 L42 316 L56 106 Z M130 50 L116 112 L150 196 L184 112 L170 50',
 shoes:'M42 262 L44 226 Q48 200 80 196 L132 176 Q156 160 178 176 L206 200 Q248 208 262 232 L262 262 Z M40 262 L264 262 L264 286 L40 286 Z',
 bags:'M110 164 Q110 96 150 96 Q190 96 190 164 M78 160 L222 160 L234 332 Q234 342 224 342 L76 342 Q66 342 66 332 Z',
 accessories:'M70 250 Q70 140 150 140 Q230 140 230 250 Z M40 250 L260 250',
 other:'M150 150 L56 236 L244 236 Z M150 150 Q150 112 172 108'
};
function outline(category){
 const frame=el('div',{className:'photo outline-photo'});
 frame.innerHTML=`<svg viewBox="0 0 300 400" aria-hidden="true"><path d="${OUTLINES[category]??OUTLINES.other}" fill="none" stroke="currentColor" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
 return frame;
}
// The photo from the order email or Shop order, in the shared .photo frame; the outline if it can't load.
const photoURLs=new Map();
// kind: 'photo' (the item's photo; source=search for a confirmed searched photo) or 'suggestion' (pending).
function photoURL(id,kind='photo',source=null){
 const key=kind+':'+(source??'')+':'+id;
 if(!photoURLs.has(key))photoURLs.set(key,(async()=>{
  // Plain fetch: photo loads don't show the page activity indicator.
  const send=()=>globalThis.fetch(`/api/wishlist?wardrobe=1&${kind}=${encodeURIComponent(id)}${source?`&source=${source}`:''}`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});
  let response=await send();
  if(response.status===401&&session.read()?.refresh_token){token=await session.token(true);response=await send();}
  if(!response.ok)throw Error('Photo unavailable');
  return URL.createObjectURL(await response.blob());
 })().catch(error=>{photoURLs.delete(key);throw error;}));
 return photoURLs.get(key);
}
// A photo much smaller than its frame is shown at up to twice its own size, not stretched into a blur.
const SMALL_PHOTO=300;
function photo(item){
 const kind=item?.suggestion?'suggestion':item?.photo?'photo':null;
 if(!kind)return outline(item?.category);
 const frame=el('div',{className:'photo skeleton'+(kind==='suggestion'?' suggested-photo':'')});
 photoURL(item.id,kind,kind==='photo'&&item.photo_source==='search_confirmed'?'search':null).then(async url=>{
  const img=el('img',{alt:name(item)});img.src=url;await img.decode();
  if(Math.max(img.naturalWidth,img.naturalHeight)<SMALL_PHOTO){frame.classList.add('photo--small');img.style.maxWidth=img.naturalWidth*2+'px';img.style.maxHeight=img.naturalHeight*2+'px';}
  matchPhotoBackground(frame,img);frame.classList.remove('skeleton');frame.replaceChildren(img);})
  .catch(()=>{if(frame.parentNode)frame.replaceWith(Object.assign(outline(item.category),{id:frame.id}));});
 return frame;
}
const name=item=>item.product||item.brand||'Item';
const line=item=>[item.brand,item.size].filter(Boolean).join(' · ');
const day=at=>new Date(at).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});

let view=null,category='all',current=null,undo=null,toastTimer;
const message=text=>{$('notice').textContent=text;};

// A rejected token is renewed once before the page asks you to sign in again, as on the wishlist.
async function api(method='GET',body,{quiet=false}={}){
 try{token=await session.token()||token;}catch(error){if(!session.read())token=null;else throw error;}
 if(!token)throw Object.assign(Error('Please sign in.'),{status:401});
 const send=()=>(quiet?globalThis.fetch:fetch)('/api/wishlist?wardrobe=1',{method,headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store'});
 let response=await send();
 if(response.status===401&&session.read()?.refresh_token){
  try{token=await session.token(true);}catch(error){if(!session.read())token=null;else throw error;}
  if(!token)throw Object.assign(Error('Please sign in.'),{status:401});
  response=await send();
 }
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw Object.assign(Error(data.error||'Something went wrong. Try again.'),{status:response.status});
 return data;
}
function login(){view=null;token=null;session.clear();sessionStorage.removeItem('jules_wishlist_token');enableAdminLink(null);$('login').hidden=false;$('wardrobe').hidden=true;}

function toast(text,action=null){
 clearTimeout(toastTimer);undo=action;
 const box=$('toast');box.replaceChildren(text);
 if(action){const button=el('button',{type:'button',className:'btn undo-remove',textContent:'Undo'});button.onclick=async()=>{box.hidden=true;await act(action);};box.append(button);}
 box.hidden=false;toastTimer=setTimeout(()=>{box.hidden=true;undo=null;},action?6000:3000);
}

// One wardrobe action, then the fresh view from the server.
async function act(input,{done}={}){
 try{view=await api('POST',input);render();done?.();return true;}
 catch(error){if(error.status===401)login();toast(error.message);return false;}
}

// A searched photo waiting for the owner: labelled on the photo, answered with thumbs inside the photo.
const THUMB='<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 21 L7 10 L11 10 L14 3 C16 3 17 4 17 6 L16 9 L21 9 C22 9 23 10 22.6 11.4 L20.5 19.4 C20.2 20.4 19.4 21 18.4 21 Z M3 10 L7 10 L7 21 L3 21 Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>';
function suggestionLabel(){return el('span',{className:'suggested-label',textContent:'Is this yours?'});}
function suggestionAsk(item){
 const answer=(value,label)=>{const b=el('button',{type:'button',className:'suggest-thumb'+(value==='no'?' suggest-thumb--down':''),title:label});b.innerHTML=THUMB;b.setAttribute('aria-label',`${label}: ${name(item)}`);
  b.onclick=event=>{event.stopPropagation();act({action:'photo',item_id:item.id,answer:value},{done:()=>toast(value==='yes'?'Photo saved.':'Got it. Jules won’t use that photo.')});};return b;};
 return el('div',{className:'suggest-ask'},answer('no','Not mine'),answer('yes','This is mine'));
}
function card(item){
 const media=photo(item);
 const tile=el('button',{type:'button',className:'tile'},item.suggestion?el('div',{className:'suggested-frame'},media,suggestionLabel()):media,el('strong',{},name(item)),line(item)?el('span',{className:'card-price'},line(item)):null);
 tile.onclick=()=>openDetail(item.id);
 return el('div',{className:'product-card'+(item.suggestion?' has-suggestion':'')},tile,item.suggestion?suggestionAsk(item):null);
}

function renderQuestions(){
 const items=new Map(view.items.map(i=>[i.id,i]));
 const list=view.questions.map(q=>{
  const first=items.get(q.item_ids[0]);
  const answers=[...q.answers.map(answer=>{const b=el('button',{type:'button',className:'chip',textContent:ANSWER_LABELS[answer]});b.onclick=()=>act({action:'answer',question_id:q.id,answer},{done:()=>toast('Thanks. Jules has that now.')});return b;}),
   q.topic==='details'&&first?Object.assign(el('button',{type:'button',className:'chip',textContent:'Fix details'}),{onclick:()=>openFix(first)}):null,
   Object.assign(el('button',{type:'button',className:'chip',textContent:ANSWER_LABELS.not_sure}),{onclick:()=>act({action:'answer',question_id:q.id,answer:'not_sure'})})];
  return el('article',{className:'question'},photo(first),el('div',{className:'question-body'},el('strong',{},q.question),el('div',{className:'question-answers'},...answers)));
 });
 $('questions').hidden=!list.length;
 $('questions-title').textContent=`Jules has ${list.length} ${list.length===1?'question':'questions'}`;
 $('question-list').replaceChildren(...list);
}

function renderCategories(){
 const present=Object.keys(CATEGORY_LABELS).filter(c=>view.items.some(i=>i.category===c));
 if(category!=='all'&&!present.includes(category))category='all';
 const chip=(key,label)=>{const b=el('button',{type:'button',className:'chip'+(key===category?' chip--on':''),textContent:label},el('span',{className:'chip-count'},String(key==='all'?view.items.length:view.items.filter(i=>i.category===key).length)));b.setAttribute('aria-pressed',String(key===category));b.onclick=()=>{category=key===category?'all':key;render();};return b;};
 $('categories').replaceChildren(...(present.length>1?[chip('all','All'),...present.map(c=>chip(c,CATEGORY_LABELS[c]))]:[]));
}

function render(){
 if(!view)return;
 $('login').hidden=true;$('wardrobe').hidden=false;
 const count=view.items.length,reading=['listing','extracting','questions'].includes(view.status);
  $('reading').hidden=!reading;
 for(const link of document.querySelectorAll('.text-jules')){link.hidden=!view.text_url;if(view.text_url)link.href=view.text_url;}
 renderQuestions();renderCategories();
 const shown=view.items.filter(i=>category==='all'||i.category===category);
 const total=`${count} ${count===1?'item':'items'}`;
 $('count').textContent=count?(category==='all'?total:`${shown.length} of ${total}`):'';
 $('grid').replaceChildren(...shown.map(card));
 $('toolbar').hidden=!count;
 $('empty').hidden=Boolean(count)||reading;
 const removed=view.removed.length;
 $('removed-open').hidden=!removed;$('removed-open').textContent=`Removed (${removed})`;
 $('gmail-state').replaceChildren(view.connections?.gmail?'Connected':Object.assign(el('a',{href:'/account#gmail-card',textContent:'Connect'})));
 $('shop-state').replaceChildren(view.connections?.shop?'Connected':Object.assign(el('a',{href:'/account#shop-card',textContent:'Connect'})));
 if(current&&!view.items.some(i=>i.id===current)&&$('detail').open)$('detail').close();
}

function openDetail(id){
 const item=view.items.find(i=>i.id===id);if(!item)return;current=id;
 const media=photo(item);
 $('detail-photo').replaceWith(item.suggestion?Object.assign(el('div',{className:'suggested-frame detail-suggestion'},media,suggestionLabel(),suggestionAsk(item)),{id:'detail-photo'}):Object.assign(media,{id:'detail-photo'}));
 $('detail-brand').textContent=item.brand??'';$('detail-title').textContent=name(item);
 const facts=[['Size',item.size??'Unknown'],['Color',item.color??'Unknown'],['Bought',[item.merchant,item.bought_at&&day(item.bought_at)].filter(Boolean).join(' · ')||'Unknown'],
  // A configured product lists the parts chosen for it (the strap and carabiners of a built bag).
  ...(item.parts?.length?[['Built with',item.parts.map(p=>[p.product,p.color].filter(Boolean).join(', ')).join(' · ')]]:[])];
 $('detail-facts').replaceChildren(...facts.flatMap(([k,v])=>[el('dt',{},k),el('dd',{},v)]));
 const ask=$('detail-ask');
 if(view.text_url){ask.hidden=false;ask.href=`${view.text_url}&body=${encodeURIComponent(`what goes with my ${[item.brand,item.product].filter(Boolean).join(' ').toLowerCase()||'this'}?`)}`;}
 $('detail').showModal();
}

function openFix(item){
 current=item.id;
 $('fix-product').value=item.product??'';$('fix-brand').value=item.brand??'';$('fix-size').value=item.size??'';$('fix-color').value=item.color??'';
 $('fix-error').hidden=true;$('fix').showModal();
}

$('detail-close').onclick=()=>$('detail').close();
$('detail-fix').onclick=()=>{const item=view.items.find(i=>i.id===current);if(item)openFix(item);};
$('detail-remove').onclick=()=>$('remove').showModal();
for(const button of $('remove').querySelectorAll('[data-reason]'))button.onclick=async()=>{
 const item=view.items.find(i=>i.id===current);if(!item)return;
 $('remove').close();
 await act({action:'remove',item_id:item.id,reason:button.dataset.reason},{done:()=>{$('detail').close();toast(`Removed ${name(item)}.`,{action:'restore',item_id:item.id});}});
};
$('fix-form').onsubmit=async event=>{
 event.preventDefault();
 const values=Object.fromEntries(['product','brand','size_label','color'].map(f=>[f,$('fix-form').elements[f].value]));
 try{view=await api('POST',{action:'fix',item_id:current,values});$('fix').close();render();if($('detail').open)openDetail(current);toast('Saved.');}
 catch(error){if(error.status===401)return login();$('fix-error').textContent=error.message;$('fix-error').hidden=false;}
};
$('add').onclick=()=>$('add-sheet').showModal();
$('removed-open').onclick=()=>{renderRemoved();$('removed').showModal();};
function renderRemoved(){
 $('removed-list').replaceChildren(...view.removed.map(item=>{
  const restore=el('button',{type:'button',className:'chip',textContent:'Restore'});
  restore.onclick=()=>act({action:'restore',item_id:item.id},{done:()=>{renderRemoved();toast(`${name(item)} is back in your wardrobe.`);if(!view.removed.length)$('removed').close();}});
  return el('div',{className:'removed-row'},photo(item),el('div',{},el('strong',{},name(item)),el('p',{className:'fine'},REASON_LABELS[item.reason]??'')),restore);
 }));
}
for(const dialog of document.querySelectorAll('dialog'))for(const close of dialog.querySelectorAll('[data-close]'))close.onclick=()=>dialog.close();


// While signed in, the page shows the collection with placeholder cards straight away, as the wishlist does.
function loading(){
 $('login').hidden=true;$('wardrobe').hidden=false;$('count').textContent='';
 for(const id of ['reading','questions','toolbar','empty','removed-open'])$(id).hidden=true;
 $('grid').setAttribute('aria-busy','true');
 $('grid').replaceChildren(...Array.from({length:4},()=>{const tile=el('div',{className:'tile'},el('div',{className:'skeleton photo'}),el('div',{className:'skeleton skeleton-card-title'}),el('div',{className:'skeleton skeleton-price'}));tile.setAttribute('aria-hidden','true');return tile;}));
}
// Photos for purchases that had none are looked for a few at a time while the page is open. Each one
// arrives as a suggestion; nothing becomes an item's photo without the owner's yes.
async function findPhotos(){
 for(let pass=0;pass<12&&view;pass++){
  try{const next=await api('POST',{action:'suggest_photos'},{quiet:true});const remaining=next.photo_search?.remaining??0;delete next.photo_search;view=next;render();if(!remaining)return;}
  catch{return;}
 }
}
async function load(){
 if(!token){login();return;}
 loading();
 try{view=await api();render();void enableAdminLink(token);void findPhotos();}
 catch(error){$('grid').replaceChildren();if(error.status===401)return login();message(error.message);}
 finally{$('grid').setAttribute('aria-busy','false');}
}
load();
