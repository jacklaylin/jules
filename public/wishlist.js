import {trackedFetch as fetch} from './activity.js';
import {mountHeader,enableTestChat} from './design-system.js';
mountHeader('wishlist');
import {createSession} from './wishlist-session.js';
const $ = id => document.getElementById(id);
const session=createSession({fetcher:fetch,storage:localStorage,lock:work=>navigator.locks?navigator.locks.request('jules-wishlist-refresh',work):work()});
let token=session.read()?.access_token||sessionStorage.getItem('jules_wishlist_token'), generation=0, detailVersion=0;
const urls=new Set(), imageCache=new Map();
const fragment=new URLSearchParams(location.hash.slice(1));
if(fragment.has('access_token')){token=fragment.get('access_token');session.save({access_token:token,refresh_token:fragment.get('refresh_token'),expires_at:Number(fragment.get('expires_at'))||Date.now()/1000+(Number(fragment.get('expires_in'))||3600)});sessionStorage.removeItem('jules_wishlist_token');}
if(location.hash)history.replaceState(null,'','/wishlist');
const message=text=>{$('notice').textContent=text;};
function clear(){generation++;detailVersion++;urls.forEach(URL.revokeObjectURL);urls.clear();imageCache.clear();$('grid').replaceChildren();$('detail-content').replaceChildren();$('detail').close();$('alert-picker').close();alertSelection=null;}
function login(){clear();token=null;enableTestChat(null);session.clear();sessionStorage.removeItem('jules_wishlist_token');$('login').hidden=false;$('collection').hidden=true;$('logout').hidden=true;}
async function authorizedFetch(query='',options={}){
 try{token=await session.token()||token;}catch(e){if(!session.read())login();throw e;}
 const send=()=>fetch('/api/wishlist'+query,{...options,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},cache:'no-store'});
 let response=await send();
 if(response.status===401&&session.read()?.refresh_token){try{token=await session.token(true);response=await send();}catch(e){if(!session.read())login();throw e;}}
 return response;
}
async function api(query='', options={}){
 const response=await authorizedFetch(query,options);
 const data=await response.json();if(!response.ok){if([401,403].includes(response.status))login();throw new Error(data.error||'Please try again.');}return data;
}
function node(tag,text,cls){const el=document.createElement(tag);if(text)el.textContent=text;if(cls)el.className=cls;return el;}
const date=value=>new Date(value).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
const money=(value,currency)=>new Intl.NumberFormat(undefined,{style:'currency',currency,maximumFractionDigits:0}).format(value);
const priceRange=ranges=>ranges?.length?ranges.map(r=>r.min===r.max?money(r.min,r.currency):`${money(r.min,r.currency)}–${money(r.max,r.currency)}`).join(' · '):'Price unavailable';
function skeleton(cls=''){const el=node('div',null,'skeleton '+cls);el.setAttribute('aria-hidden','true');return el;}
function photo(query,alt){
 const frame=node('div',null,'photo skeleton');frame.setAttribute('aria-busy','true');frame.setAttribute('aria-label','Loading image');const version=generation;
 const finish=()=>{frame.classList.remove('skeleton');frame.removeAttribute('aria-label');frame.setAttribute('aria-busy','false');};
 if(!imageCache.has(query)) imageCache.set(query,authorizedFetch(query).then(async r=>{if(!r.ok)throw new Error();return r.blob();}).then(blob=>{if(version!==generation)throw new Error();const url=URL.createObjectURL(blob);urls.add(url);return url;}));
 imageCache.get(query).then(async url=>{const img=node('img');img.alt=alt;img.src=url;await img.decode();if(version!==generation)return;finish();frame.replaceChildren(img);}).catch(()=>{if(version!==generation)return;finish();frame.textContent='Image unavailable';imageCache.delete(query);});return frame;
}
function detailSkeleton(){const info=node('div',null,'info detail-skeleton');info.append(skeleton('skeleton-title'),skeleton('skeleton-price'),skeleton('skeleton-date'));for(let i=0;i<3;i++){const link=node('div',null,'skeleton-link');link.append(skeleton('skeleton-date'),skeleton('skeleton-line'),skeleton('skeleton-price'));info.append(link);}return [skeleton('photo'),info];}
function photoCarousel(item){
 const slides=[];
 if(item.has_image)slides.push({query:`?item=${item.image_item}&image=product`,label:item.image_kind==='outfit_crop'?'Detail from your photo':'Product photo'});
 for(let i=0;i<Math.min(Number(item.photo_count)||0,2);i++)slides.push({query:`?item=${item.image_item}&image=reference&index=${i}`,label:'Product reference photo'});
 if(item.source_image_id)slides.push({query:`?item=${item.image_item}&source=${item.source_image_id}`,label:'Your original photo'});
 if(!slides.length)return node('div',item.photo_status==='retry_pending'?'Photo pending':'Image unavailable','photo');
 const gallery=node('section',null,'photo-carousel');gallery.setAttribute('aria-label','Item photos');
 const view=node('div',null,'carousel-view'),controls=node('div',null,'carousel-controls'),caption=node('span',null,'carousel-caption');caption.setAttribute('aria-live','polite');
 let index=0;
 const show=()=>{const slide=slides[index];view.replaceChildren(photo(slide.query,`${slide.label}: ${item.name}`));view.classList.toggle('original-photo',slide.label==='Your original photo');caption.textContent=`${slide.label} · ${index+1} / ${slides.length}`;};
 const move=step=>{index=(index+step+slides.length)%slides.length;show();};
 const prev=node('button','←'),next=node('button','→');prev.type=next.type='button';prev.setAttribute('aria-label','Previous photo');next.setAttribute('aria-label','Next photo');prev.onclick=()=>move(-1);next.onclick=()=>move(1);prev.disabled=next.disabled=slides.length<2;
 controls.append(prev,caption,next);gallery.append(view,controls);
 gallery.onkeydown=e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();move(e.key==='ArrowLeft'?-1:1);}};
 let start=null;view.addEventListener('pointerdown',e=>{start=e.clientX;});view.addEventListener('pointerup',e=>{if(start!==null&&Math.abs(e.clientX-start)>45)move(e.clientX<start?1:-1);start=null;});view.addEventListener('pointercancel',()=>{start=null;});
 show();return gallery;
}
function previewPhoto(entry){
 if(entry.image_item)return photo(`?item=${entry.image_item}&image=product`,entry.name);
 const frame=node('div',null,'photo skeleton');const img=node('img');img.alt=entry.name;img.referrerPolicy='no-referrer';
 img.onload=()=>{frame.classList.remove('skeleton');frame.replaceChildren(img);};img.onerror=()=>{frame.classList.remove('skeleton');frame.textContent='No preview';};img.src=entry.preview_image_url;return frame;
}
function links(entries){const box=node('div',null,'links');for(const entry of entries??[]){try{const u=new URL(entry.url);if(u.protocol!=='https:'||u.username||u.password)continue;const a=node('a',null,'link-preview');a.href=u.href;a.target='_blank';a.rel='noopener noreferrer';const copy=node('div',null,'link-copy');copy.append(node('span',entry.retailer||u.hostname,'retailer'),node('strong',entry.name),node('span',(entry.verification_status==='unverified'?'Saved link · price and stock unverified':entry.price?money(entry.price.amount,entry.price.currency):'Price unavailable')+(['OutOfStock','SoldOut'].includes(entry.availability)?' · Sold out':'')+' ↗','link-action'));if(entry.image_item||entry.preview_image_url)a.append(previewPhoto(entry));else a.append(node('div','No preview','photo'));a.append(copy);box.append(a);}catch{}}return box;}
async function detail(id){
 const version=++detailVersion;message('');$('detail-content').setAttribute('aria-busy','true');$('detail-content').replaceChildren(...detailSkeleton());$('detail').showModal();document.body.classList.add('detail-open');
 try{const {item}=await api('?group='+encodeURIComponent(id));if(version!==detailVersion||!$('detail').open)return;const info=node('div',null,'info');info.tabIndex=0;info.setAttribute('role','region');info.setAttribute('aria-label','Product details and links');info.append(node('h2',item.name));if(item.sourcing_status==='store_not_found'){info.append(node('p','Product identified · Store not found','sourcing-state'),node('p','I haven’t found a store I can recommend for this item.','sourcing-note'));}info.append(node('p',priceRange(item.price_ranges),'price-range'),node('p',`Sent ${date(item.sent_at)}`,'sent-date'),links(item.links));if(item.sourcing_status==='store_not_found'&&item.identity_sources?.length){info.append(node('h3','Identification sources'));const refs=node('div',null,'identity-sources');for(const reference of item.identity_sources){try{const u=new URL(reference.url);if(u.protocol!=='https:'||u.username||u.password)continue;const a=node('a',reference.name||u.hostname);a.href=u.href;a.target='_blank';a.rel='noopener noreferrer';refs.append(a);}catch{}}info.append(refs);}
 $('detail-content').setAttribute('aria-busy','false');$('detail-content').replaceChildren(photoCarousel(item),info);
 }catch(e){if(version===detailVersion){$('detail-content').setAttribute('aria-busy','false');$('detail-content').replaceChildren(node('p',e.message));}}
}
async function load(){
 clear();$('login').hidden=true;$('collection').hidden=false;$('logout').hidden=false;$('empty').hidden=true;$('count').textContent='';$('grid').setAttribute('aria-busy','true');for(let i=0;i<4;i++){const tile=node('div',null,'tile');tile.setAttribute('aria-hidden','true');tile.append(skeleton('photo'),skeleton('skeleton-card-title'),skeleton('skeleton-price'));$('grid').append(tile);}
 let items;try{({items}=await api());void enableTestChat(token);}catch(e){$('grid').replaceChildren();throw e;}finally{$('grid').setAttribute('aria-busy','false');}
 $('grid').replaceChildren();$('login').hidden=true;$('collection').hidden=false;$('logout').hidden=false;$('empty').hidden=items.length>0;$('count').textContent=items.length+' '+(items.length===1?'ITEM':'ITEMS');
 for(const item of items){const card=node('div',null,'product-card');const tile=node('button',null,'tile');tile.type='button';tile.append(item.has_image?photo(`?item=${item.image_item}&image=product`,item.name):node('div',item.photo_status==='retry_pending'?'Photo pending':'Image unavailable','photo'),node('strong',item.name),node('span',priceRange(item.price_ranges),'card-price'));if(item.sourcing_status==='store_not_found')tile.append(node('span','Product identified · Store not found','card-state'));tile.onclick=()=>detail(item.id);card.append(tile);if(item.alerts_enabled)card.append(alertToggle(item));card.append(removeButton(item,card));$('grid').append(card);}message('');
}
let alertSelection=null,toastTimer;
const alertPost=input=>api('',{method:'POST',body:JSON.stringify(input)});
function toast(text,undo){clearTimeout(toastTimer);$('toast').replaceChildren(node('span',text));if(undo){const button=node('button','Undo','undo-remove');button.type='button';button.onclick=async()=>{button.disabled=true;try{await undo();$('toast').hidden=true;}catch(e){message(e.message);button.disabled=false;}};$('toast').append(button);}$('toast').hidden=false;if(!undo)toastTimer=setTimeout(()=>{$('toast').hidden=true;},6000);}
function removeButton(item,card){
 const button=node('button',null,'remove-item'+(item.alerts_enabled?' beside-bell':''));button.type='button';button.setAttribute('aria-label',`Remove ${item.name} from wishlist`);button.title='Remove from wishlist';
 button.innerHTML='<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
 button.onclick=async()=>{button.disabled=true;try{await alertPost({action:'remove',group:item.id});card.remove();const count=$('grid').children.length;$('count').textContent=count+' '+(count===1?'ITEM':'ITEMS');$('empty').hidden=count>0;toast(item.price_alert?.active?'Removed. Price alert turned off.':'Removed from your wishlist.',async()=>{await alertPost({action:'restore',group:item.id});await load();});const next=$('grid').querySelector('.tile');if(next)next.focus();}catch(e){message(e.message);button.disabled=false;}};
 return button;
}
function alertToggle(item){
 const button=node('button',null,'alert-toggle');button.type='button';
 const paint=`bell-${crypto.randomUUID()}`;
 button.style.setProperty('--bell-paint',`url(#${paint})`);
 button.innerHTML=`<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><defs><linearGradient id="${paint}" x1="0" y1="0" x2="1" y2="1"><stop class="bell-start" offset="0"/><stop class="bell-end" offset="1"/></linearGradient></defs><path class="bell-shape" d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path class="bell-clapper" d="M10 21h4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg><span class="alert-on" aria-hidden="true">ON</span>`;
 const update=()=>{const active=Boolean(item.price_alert?.active);button.setAttribute('aria-pressed',String(active));button.setAttribute('aria-label',`${active?'Turn off':'Set up'} price alert for ${item.name}`);button.title=active?`Price alert on · ${item.price_alert.size}`:'Set up price alert';};update();
 button.onclick=async()=>{
   button.disabled=true;
   try{
     if(item.price_alert?.active){await alertPost({action:'alert-disable',group:item.id});item.price_alert.active=false;update();toast('Price alert turned off.');return;}
     alertSelection={item,update};const selected=alertSelection;
     $('alert-size').replaceChildren(node('option','Choose a size'));$('alert-size').firstChild.value='';$('alert-size').disabled=true;$('alert-save').disabled=true;$('alert-note').textContent='Checking sizes across your retailer links…';$('alert-picker').showModal();
     const {sizes}=await alertPost({action:'alert-options',group:item.id});
     if(alertSelection!==selected||!$('alert-picker').open)return;
     for(const size of sizes){const option=node('option',size);option.value=size;$('alert-size').append(option);}
     $('alert-size').disabled=!sizes.length;$('alert-note').textContent=sizes.length?'Sizes come from the retailer listings; availability can change.':'We couldn’t read sizes from these listings. Price alerts are unavailable for this item for now.';
   }catch(e){$('alert-note').textContent=e.message;message(e.message);}finally{button.disabled=false;}
 };return button;
}
$('alert-size').onchange=()=>{$('alert-save').disabled=!$('alert-size').value;};
$('alert-close').onclick=()=>{$('alert-picker').close();alertSelection=null;};
$('alert-picker').addEventListener('close',()=>{alertSelection=null;});
$('alert-form').onsubmit=async event=>{
 event.preventDefault();if(!alertSelection||!$('alert-size').value)return;
 const selected=alertSelection;$('alert-save').disabled=true;$('alert-size').disabled=true;$('alert-close').disabled=true;
 try{const data=await alertPost({action:'alert-enable',group:selected.item.id,size:$('alert-size').value});selected.item.price_alert=data;selected.update();$('alert-picker').close();toast("We'll text you if the price drops more than 10% and your size is available");}
 catch(e){$('alert-note').textContent=e.message;}finally{$('alert-save').disabled=!$('alert-size').value;$('alert-size').disabled=false;$('alert-close').disabled=false;}
};
$('login-form').onsubmit=async e=>{e.preventDefault();$('login-button').disabled=true;try{const data=await api('',{method:'POST',body:JSON.stringify({action:'login',email:$('email').value})});message(data.message);}catch(e){message(e.message);}finally{$('login-button').disabled=false;}};
$('logout').onclick=async()=>{$('logout').disabled=true;try{await api('',{method:'POST',body:JSON.stringify({action:'logout'})});login();message('Logged out.');}catch(e){message(e.message);}finally{$('logout').disabled=false;}};
const closeDetail=()=>{detailVersion++;$('detail').close();};
$('close').onclick=closeDetail;
$('detail').addEventListener('cancel',e=>{e.preventDefault();closeDetail();});
let backdropPress=false;
const outsideDetail=e=>{const r=$('detail').getBoundingClientRect();return e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom;};
$('detail').addEventListener('pointerdown',e=>{backdropPress=outsideDetail(e);});
$('detail').addEventListener('click',e=>{if(backdropPress&&outsideDetail(e))closeDetail();backdropPress=false;});
$('detail').addEventListener('close',()=>{document.body.classList.remove('detail-open');});
if(token)load().catch(e=>message(e.message));
if(fragment.get('error_description'))message('This sign-in link has expired. Request a new one.');
window.addEventListener('storage',event=>{if(event.key==='jules_wishlist_session'&&!event.newValue)login();});
