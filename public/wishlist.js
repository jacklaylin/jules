import {createSession} from './wishlist-session.js';
const $ = id => document.getElementById(id);
const session=createSession({storage:localStorage,lock:work=>navigator.locks?navigator.locks.request('jules-wishlist-refresh',work):work()});
let token=session.read()?.access_token||sessionStorage.getItem('jules_wishlist_token'), generation=0, detailVersion=0;
const urls=new Set(), imageCache=new Map();
const fragment=new URLSearchParams(location.hash.slice(1));
if(fragment.has('access_token')){token=fragment.get('access_token');session.save({access_token:token,refresh_token:fragment.get('refresh_token'),expires_at:Number(fragment.get('expires_at'))||Date.now()/1000+(Number(fragment.get('expires_in'))||3600)});sessionStorage.removeItem('jules_wishlist_token');}
if(location.hash)history.replaceState(null,'','/wishlist');
const message=text=>{$('notice').textContent=text;};
function clear(){generation++;detailVersion++;urls.forEach(URL.revokeObjectURL);urls.clear();imageCache.clear();$('grid').replaceChildren();$('detail-content').replaceChildren();$('detail').close();}
function login(){clear();token=null;session.clear();sessionStorage.removeItem('jules_wishlist_token');$('login').hidden=false;$('collection').hidden=true;$('logout').hidden=true;}
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
function previewPhoto(entry){
 if(entry.image_item)return photo(`?item=${entry.image_item}&image=product`,entry.name);
 const frame=node('div',null,'photo skeleton');const img=node('img');img.alt=entry.name;img.referrerPolicy='no-referrer';
 img.onload=()=>{frame.classList.remove('skeleton');frame.replaceChildren(img);};img.onerror=()=>{frame.classList.remove('skeleton');frame.textContent='No preview';};img.src=entry.preview_image_url;return frame;
}
function links(entries){const box=node('div',null,'links');for(const entry of entries??[]){try{const u=new URL(entry.url);if(u.protocol!=='https:'||u.username||u.password)continue;const a=node('a',null,'link-preview');a.href=u.href;a.target='_blank';a.rel='noopener noreferrer';const copy=node('div',null,'link-copy');copy.append(node('span',entry.retailer||u.hostname,'retailer'),node('strong',entry.name),node('span',entry.price?money(entry.price.amount,entry.price.currency)+' ↗':'View product ↗','link-action'));if(entry.image_item||entry.preview_image_url)a.append(previewPhoto(entry));else a.append(node('div','No preview','photo'));a.append(copy);box.append(a);}catch{}}return box;}
async function detail(id){
 const version=++detailVersion;message('');$('detail-content').setAttribute('aria-busy','true');$('detail-content').replaceChildren(...detailSkeleton());$('detail').showModal();document.body.classList.add('detail-open');
 try{const {item}=await api('?group='+encodeURIComponent(id));if(version!==detailVersion||!$('detail').open)return;const info=node('div',null,'info');info.tabIndex=0;info.setAttribute('role','region');info.setAttribute('aria-label','Product details and links');info.append(node('h2',item.name),node('p',priceRange(item.price_ranges),'price-range'),node('p',`Sent ${date(item.sent_at)}`,'sent-date'),links(item.links));
 $('detail-content').setAttribute('aria-busy','false');$('detail-content').replaceChildren(photo(`?item=${item.image_item}&image=product`,item.name),info);
 }catch(e){if(version===detailVersion){$('detail-content').setAttribute('aria-busy','false');$('detail-content').replaceChildren(node('p',e.message));}}
}
async function load(){
 clear();$('login').hidden=true;$('collection').hidden=false;$('logout').hidden=false;$('empty').hidden=true;$('count').textContent='';$('grid').setAttribute('aria-busy','true');for(let i=0;i<4;i++){const tile=node('div',null,'tile');tile.setAttribute('aria-hidden','true');tile.append(skeleton('photo'),skeleton('skeleton-card-title'),skeleton('skeleton-price'));$('grid').append(tile);}
 let items;try{({items}=await api());}catch(e){$('grid').replaceChildren();throw e;}finally{$('grid').setAttribute('aria-busy','false');}
 $('grid').replaceChildren();$('login').hidden=true;$('collection').hidden=false;$('logout').hidden=false;$('empty').hidden=items.length>0;$('count').textContent=items.length+' '+(items.length===1?'ITEM':'ITEMS');
 for(const item of items){const tile=node('button',null,'tile');tile.type='button';tile.append(item.has_image?photo(`?item=${item.image_item}&image=product`,item.name):node('div','Image unavailable','photo'),node('strong',item.name),node('span',priceRange(item.price_ranges),'card-price'));tile.onclick=()=>detail(item.id);$('grid').append(tile);}message('');
}
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
function neonPress(event){const control=event.target.closest('button,a');if(control&&!control.disabled)control.dataset.neon=String(Math.floor(Math.random()*6));}
document.addEventListener('pointerdown',neonPress);
document.addEventListener('keydown',event=>{if(!event.repeat&&['Enter',' '].includes(event.key))neonPress(event);});
document.addEventListener('pointerover',event=>{const control=event.target.closest('button,a');if(control&&!control.contains(event.relatedTarget))neonPress(event);});
const header=document.querySelector('header');
let headerTick=false;
function updateHeader(){header.classList.toggle('compact',scrollY>(header.classList.contains('compact')?20:80));headerTick=false;}
window.addEventListener('scroll',()=>{if(!headerTick){headerTick=true;requestAnimationFrame(updateHeader);}},{passive:true});
updateHeader();

window.addEventListener('storage',event=>{if(event.key==='jules_wishlist_session'&&!event.newValue)login();});
