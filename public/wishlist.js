import {trackedFetch as fetch} from './activity.js';
import {mountHeader,enableTestChat,updateWishlistCount} from './design-system.js';
mountHeader('wishlist');
import {createSession} from './wishlist-session.js';
import {rememberWishlistTarget,consumeWishlistTarget} from './wishlist-deep-link.js';
const $ = id => document.getElementById(id);
const session=createSession({fetcher:fetch,storage:localStorage,lock:work=>navigator.locks?navigator.locks.request('jules-wishlist-refresh',work):work()});
let token=session.read()?.access_token||sessionStorage.getItem('jules_wishlist_token'), generation=0, detailVersion=0;
const urls=new Set(), imageCache=new Map(), itemCache=new Map();
const fragment=new URLSearchParams(location.hash.slice(1));
if(fragment.has('access_token')){token=fragment.get('access_token');session.save({access_token:token,refresh_token:fragment.get('refresh_token'),expires_at:Number(fragment.get('expires_at'))||Date.now()/1000+(Number(fragment.get('expires_in'))||3600)});sessionStorage.removeItem('jules_wishlist_token');}
if(location.hash)history.replaceState(null,'','/wishlist'+location.search);
rememberWishlistTarget(location.search,localStorage);
const message=text=>{$('notice').textContent=text;};
function clear(){generation++;detailVersion++;urls.forEach(URL.revokeObjectURL);urls.clear();imageCache.clear();itemCache.clear();$('grid').replaceChildren();$('detail-content').replaceChildren();$('detail').close();$('alert-picker').close();alertSelection=null;}
function login(){updateWishlistCount(null);clear();token=null;enableTestChat(null);session.clear();sessionStorage.removeItem('jules_wishlist_token');$('login').hidden=false;$('collection').hidden=true;$('logout').hidden=true;}
async function authorizedFetch(query='',options={}){
 const {quiet=false,...requestOptions}=options;
 try{token=await session.token()||token;}catch(e){if(!session.read())login();throw e;}
 const send=()=>(quiet?globalThis.fetch:fetch)('/api/wishlist'+query,{...requestOptions,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},cache:'no-store'});
 let response=await send();
 if(!query&&(!options.method||options.method==='GET'))$('collection').dataset.serverTiming=response.headers.get('Server-Timing')||'';
 if(response.status===401&&session.read()?.refresh_token){try{token=await session.token(true);response=await send();}catch(e){if(!session.read())login();throw e;}}
 return response;
}
async function api(query='', options={}){
 const response=await authorizedFetch(query,options);
 const data=await response.json();if(!response.ok){if([401,403].includes(response.status))login();throw new Error(data.error||'Please try again.');}return data;
}
function node(tag,text,cls){const el=document.createElement(tag);if(text)el.textContent=text;if(cls)el.className=cls;return el;}
const date=value=>new Date(value).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
function pendingPhoto(pending){const frame=node('div',null,'photo photo-pending');if(pending){const orb=node('span',null,'orb');orb.setAttribute('aria-hidden','true');frame.append(orb);}frame.append(node('span',pending?'Photo pending':'Image unavailable','photo-status'));return frame;}
const money=(value,currency)=>new Intl.NumberFormat(undefined,{style:'currency',currency,maximumFractionDigits:0}).format(value);
const priceRange=ranges=>ranges?.length?ranges.map(r=>(r.min===r.max?money(r.min,r.currency):`${money(r.min,r.currency)}–${money(r.max,r.currency)}`)+(r.indexed?' · indexed price':'')).join(' · '):'Price unavailable';
function skeleton(cls=''){const el=node('div',null,'skeleton '+cls);el.setAttribute('aria-hidden','true');return el;}
function photo(query,alt){
 const frame=node('div',null,'photo skeleton');frame.setAttribute('aria-busy','true');frame.setAttribute('aria-label','Loading image');const version=generation;
 const finish=()=>{frame.classList.remove('skeleton');frame.removeAttribute('aria-label');frame.setAttribute('aria-busy','false');};
 if(!imageCache.has(query)) imageCache.set(query,authorizedFetch(query,{quiet:true}).then(async r=>{if(!r.ok)throw new Error();return r.blob();}).then(blob=>{if(version!==generation)throw new Error();const url=URL.createObjectURL(blob);urls.add(url);return url;}));
 imageCache.get(query).then(async url=>{const img=node('img');img.alt=alt;img.src=url;await img.decode();if(version!==generation)return;finish();frame.replaceChildren(img);frame.dataset.readyMs=performance.now().toFixed(1);}).catch(()=>{if(version!==generation)return;finish();frame.textContent='Image unavailable';imageCache.delete(query);});return frame;
}
function detailSkeleton(){const info=node('div',null,'info detail-skeleton');info.append(skeleton('skeleton-title'),skeleton('skeleton-price'),skeleton('skeleton-date'));for(let i=0;i<3;i++){const link=node('div',null,'skeleton-link');link.append(skeleton('skeleton-date'),skeleton('skeleton-line'),skeleton('skeleton-price'));info.append(link);}return [skeleton('photo'),info];}
function photoCarousel(item){
 const slides=[];
 if(item.has_image)slides.push({query:`?item=${item.image_item}&image=product`,label:item.image_kind==='outfit_crop'?'Detail from your photo':'Product photo'});
 for(let i=0;i<Math.min(Number(item.photo_count)||0,2);i++)slides.push({query:`?item=${item.image_item}&image=reference&index=${i}`,label:'Product reference photo'});
 if(item.source_image_id)slides.push({query:`?item=${item.image_item}&source=${item.source_image_id}`,label:'Your original photo'});
 if(!slides.length)return pendingPhoto(item.photo_status==='retry_pending');
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
function links(entries){const box=node('div',null,'links');for(const entry of entries??[]){try{const u=new URL(entry.url);if(u.protocol!=='https:'||u.username||u.password)continue;const a=node('a',null,'link-preview');a.href=u.href;a.target='_blank';a.rel='noopener noreferrer';const copy=node('div',null,'link-copy');copy.append(node('span',entry.retailer||u.hostname,'retailer'),node('strong',entry.name),node('span',(entry.verification_status==='unverified'?'Saved link · price and stock unverified':entry.price?money(entry.price.amount,entry.price.currency)+(entry.price.evidence_level==='indexed'?' · indexed price · sizes unconfirmed':''):entry.verification_status==='indexed'?'Current price and sizes unconfirmed':'Price unavailable')+(['OutOfStock','SoldOut'].includes(entry.availability)?' · Sold out when checked':'')+' ↗','link-action'));if(entry.image_item||entry.preview_image_url)a.append(previewPhoto(entry));else a.append(node('div','No preview','photo'));a.append(copy);box.append(a);}catch{}}return box;}
async function detail(id){
 $('detail-content').dataset.group=id;
 const openedAt=performance.now();const version=++detailVersion;message('');$('detail-content').setAttribute('aria-busy','true');const saved=itemCache.get(id);if(saved){const summary=node('div',null,'info');summary.append(node('h2',saved.name),node('p',priceRange(saved.price_ranges),'price-range'),node('p',`Sent ${date(saved.sent_at)}`,'sent-date'));$('detail-content').replaceChildren(photoCarousel(saved),summary);}else $('detail-content').replaceChildren(...detailSkeleton());$('detail').showModal();document.body.classList.add('detail-open');requestAnimationFrame(()=>{if(version===detailVersion)$('detail-content').dataset.summaryMs=(performance.now()-openedAt).toFixed(1);});
 try{const {item}=await api('?group='+encodeURIComponent(id));if(version!==detailVersion||!$('detail').open)return;const info=node('div',null,'info');info.tabIndex=0;info.setAttribute('role','region');info.setAttribute('aria-label','Product details and links');info.append(node('h2',item.name));if(item.sourcing_status==='store_not_found'){info.append(node('p','Product identified · Store not found','sourcing-state'),node('p','I haven’t found a store I can recommend for this item.','sourcing-note'));}info.append(node('p',priceRange(item.price_ranges),'price-range'),node('p',`Sent ${date(item.sent_at)}`,'sent-date'),links(item.links));if(item.sourcing_status==='store_not_found'&&item.identity_sources?.length){info.append(node('h3','Identification sources'));const refs=node('div',null,'identity-sources');for(const reference of item.identity_sources){try{const u=new URL(reference.url);if(u.protocol!=='https:'||u.username||u.password)continue;const a=node('a',reference.name||u.hostname);a.href=u.href;a.target='_blank';a.rel='noopener noreferrer';refs.append(a);}catch{}}info.append(refs);}
 if(item.price_checked_at)info.append(node('p',`Price checked ${date(item.price_checked_at)}. Price and availability may have changed.`,'price-note'));
 $('detail-content').setAttribute('aria-busy','false');$('detail-content').replaceChildren(photoCarousel(item),info);$('detail-content').dataset.detailsMs=(performance.now()-openedAt).toFixed(1);
 }catch(e){if(version===detailVersion){$('detail-content').setAttribute('aria-busy','false');if(saved)$('detail-content .info')?.append(node('p',e.message));else $('detail-content').replaceChildren(node('p',e.message));}}
}
async function load(){
 clear();const version=generation;$('login').hidden=true;$('collection').hidden=false;$('logout').hidden=false;$('empty').hidden=true;$('count').textContent='';$('grid').setAttribute('aria-busy','true');for(let i=0;i<4;i++){const tile=node('div',null,'tile');tile.setAttribute('aria-hidden','true');tile.append(skeleton('photo'),skeleton('skeleton-card-title'),skeleton('skeleton-price'));$('grid').append(tile);}
 let items;try{({items}=await api());if(version!==generation)return;void enableTestChat(token);}catch(e){$('grid').replaceChildren();throw e;}finally{$('grid').setAttribute('aria-busy','false');}
 $('grid').replaceChildren();$('login').hidden=true;$('collection').hidden=false;$('logout').hidden=false;$('empty').hidden=items.length>0;$('count').textContent=items.length+' '+(items.length===1?'ITEM':'ITEMS');updateWishlistCount(items.length);
 for(const item of items){itemCache.set(item.id,item);const card=node('div',null,'product-card');card.dataset.group=item.id;const tile=node('button',null,'tile');tile.type='button';tile.append(item.has_image?photo(`?item=${item.image_item}&image=product`,item.name):pendingPhoto(item.photo_status==='retry_pending'),node('strong',item.name),node('span',priceRange(item.price_ranges),'card-price'));if(item.sourcing_status==='store_not_found')tile.append(node('span','Product identified · Store not found','card-state'));tile.onclick=()=>detail(item.id);card.append(tile,removeButton(item,card));if(item.alerts_enabled)card.append(alertToggle(item));$('grid').append(card);}message('');requestAnimationFrame(()=>{if(version===generation)$('collection').dataset.readyMs=performance.now().toFixed(1);});void recoverPhotos(items,generation);void recoverAlertBaselines(items,generation);
 const target=consumeWishlistTarget(items,localStorage);
 if(target?.id)void detail(target.id);else if(target?.missing)message('This item is not available in your signed-in wishlist.');
}

async function recoverAlertBaselines(items,version){
 if(!items.some(item=>item.price_alert?.active&&item.price_alert.baseline_pending))return;
 try{
  const {recovered}=await api('',{method:'POST',quiet:true,body:JSON.stringify({action:'recover-alerts'})});
  if(version!==generation)return;
  for(const id of recovered??[]){
   const item=itemCache.get(id);if(!item?.price_alert)continue;item.price_alert.baseline_pending=false;
   const card=[...$('grid').children].find(card=>card.dataset.group===id);
   card?.querySelector('.alert-toggle')?.replaceWith(alertToggle(item));
  }
 }catch{/* Monitoring stays enabled; a later visit or scheduled check retries. */}
}
async function recoverPhotos(items,version){
 if(!items.some(item=>!item.has_image||item.details_pending))return;
 try{
  const recovered=await api('',{method:'POST',quiet:true,body:JSON.stringify({action:'recover-photos'})});
  if(version!==generation)return;
  for(const update of recovered.items??[]){
   const item=itemCache.get(update.id);if(!item)continue;
   const changed=item.has_image!==update.has_image||item.name!==update.name||JSON.stringify(item.price_ranges)!==JSON.stringify(update.price_ranges);
   Object.assign(item,update);
   if(!changed)continue;
   const card=[...$('grid').children].find(card=>card.dataset.group===item.id);
   card?.querySelector('.tile .photo')?.replaceWith(item.has_image?photo(`?item=${item.image_item}&image=product`,item.name):pendingPhoto(item.photo_status==='retry_pending'));
   const title=card?.querySelector('.tile strong');if(title)title.textContent=item.name;
   const price=card?.querySelector('.card-price');if(price)price.textContent=priceRange(item.price_ranges);
   if($('detail').open&&$('detail-content').dataset.group===item.id)void detail(item.id);
  }
 }catch{/* Saved items stay visible; photo recovery retries on a later visit. */}
}

let alertSelection=null,toastTimer;
const alertPost=input=>api('',{method:'POST',body:JSON.stringify(input)});
function toast(text,undo){clearTimeout(toastTimer);$('toast').replaceChildren(node('span',text));if(undo){const button=node('button','Undo','undo-remove');button.type='button';button.onclick=async()=>{button.disabled=true;try{await undo();$('toast').hidden=true;}catch(e){message(e.message);button.disabled=false;}};$('toast').append(button);}$('toast').hidden=false;if(!undo)toastTimer=setTimeout(()=>{$('toast').hidden=true;},6000);}
function removeButton(item,card){
 const button=node('button','×','remove-item');button.type='button';button.setAttribute('aria-label',`Remove ${item.name} from wishlist`);button.title='Remove from wishlist';
 button.onclick=async()=>{button.disabled=true;try{await alertPost({action:'remove',group:item.id});card?.remove();itemCache.delete(item.id);const count=$('grid').children.length;$('count').textContent=count+' '+(count===1?'ITEM':'ITEMS');updateWishlistCount(count);$('empty').hidden=count>0;toast(item.price_alert?.active?'Removed. Price alert turned off.':'Removed from your wishlist.',async()=>{await alertPost({action:'restore',group:item.id});await load();});const next=$('grid').querySelector('.tile');if(next)next.focus();}catch(e){message(e.message);button.disabled=false;}};
 return button;
}
function alertToggle(item){
 const button=node('button',null,'alert-toggle');button.type='button';
 button.innerHTML=`<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path class="bell-shape" d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path class="bell-clapper" d="M10 21h4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg><span class="alert-on" aria-hidden="true">ON</span>`;
 const update=()=>{const active=Boolean(item.price_alert?.active);button.setAttribute('aria-pressed',String(active));button.setAttribute('aria-label',`${active?'Turn off':'Set up'} price alert for ${item.name}`);button.dataset.baselinePending=String(Boolean(active&&item.price_alert.baseline_pending));button.title=active?`Price alert on · ${item.price_alert.size}${item.price_alert.baseline_pending?' · Starting price not verified yet':''}`:'Set up price alert';};update();
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
