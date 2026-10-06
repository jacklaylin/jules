const $ = id => document.getElementById(id);
let token=sessionStorage.getItem('jules_wishlist_token'), generation=0, detailVersion=0;
const urls=new Set();
const fragment=new URLSearchParams(location.hash.slice(1));
if(fragment.has('access_token')){token=fragment.get('access_token');sessionStorage.setItem('jules_wishlist_token',token);}
if(location.hash)history.replaceState(null,'','/wishlist');
const message=text=>{$('notice').textContent=text;};
function clear(){generation++;urls.forEach(URL.revokeObjectURL);urls.clear();$('grid').replaceChildren();$('detail-content').replaceChildren();$('detail').close();}
function login(){clear();token=null;sessionStorage.removeItem('jules_wishlist_token');$('login').hidden=false;$('collection').hidden=true;$('logout').hidden=true;}
async function api(query='', options={}){
 const response=await fetch('/api/wishlist'+query,{...options,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},cache:'no-store'});
 const data=await response.json();if(!response.ok){if([401,403].includes(response.status))login();throw new Error(data.error||'Please try again.');}return data;
}
function node(tag,text,cls){const el=document.createElement(tag);if(text)el.textContent=text;if(cls)el.className=cls;return el;}
const label=p=>p.match==='likely_match'?'Possible match · unconfirmed':'Similar alternative';
const date=value=>new Date(value).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
function photo(query,alt){
 const frame=node('div',null,'photo');frame.textContent='Image unavailable';const version=generation;
 fetch('/api/wishlist'+query,{headers:{Authorization:`Bearer ${token}`},cache:'no-store'}).then(async r=>{if(!r.ok)throw new Error();return r.blob();}).then(blob=>{if(version!==generation||!frame.isConnected)return;const url=URL.createObjectURL(blob);urls.add(url);const img=node('img');img.alt=alt;img.src=url;frame.replaceChildren(img);}).catch(()=>{});return frame;
}
function links(entries){const box=node('div',null,'links');for(const entry of entries??[]){try{const u=new URL(entry.url);if(u.protocol!=='https:'||u.username||u.password)continue;const a=node('a',`${entry.retailer||u.hostname} ↗`);a.href=u.href;a.target='_blank';a.rel='noopener noreferrer';box.append(a);}catch{}}return box;}
async function detail(id){
 const version=++detailVersion;message('');$('detail-content').replaceChildren(node('p','Loading…'));$('detail').showModal();
 try{const {item}=await api('?item='+encodeURIComponent(id));if(version!==detailVersion||!$('detail').open)return;const p=item.product;const info=node('div',null,'info');info.append(node('span',label(p),'label'),node('h2',[p.brand,p.name].filter(Boolean).join(' ')),node('p',p.reason),node('p',`Found ${date(item.saved_at)}. Saved links; prices and availability have not been checked.`),links(p.links));
 const source=node('div',null,'source');for(const encounter of item.encounters){const panel=node('details');panel.append(node('summary','Original outfit · '+date(encounter.found_at)));if(encounter.source_image_id)panel.append(photo(`?item=${id}&source=${encounter.source_image_id}`,'Original outfit'));else panel.append(node('p','Source image unavailable.'));panel.append(node('p',label(encounter)+' · '+(encounter.reason||'')),links(encounter.links));source.append(panel);}info.append(source);$('detail-content').replaceChildren(photo(`?item=${id}&image=product`,p.image_kind==='outfit_crop'?'Crop from your outfit':p.name),info);
 }catch(e){if(version===detailVersion)$('detail-content').replaceChildren(node('p',e.message));}
}
async function load(){
 const {items}=await api();clear();$('login').hidden=true;$('collection').hidden=false;$('logout').hidden=false;$('empty').hidden=items.length>0;$('count').textContent=items.length+' ITEMS';
 for(const item of items){const tile=node('button',null,'tile');tile.type='button';tile.append(item.has_image?photo(`?item=${item.id}&image=product`,item.name):node('div','Image unavailable','photo'),node('strong',[item.brand,item.name].filter(Boolean).join(' ')),node('span',label(item),'label'));tile.onclick=()=>detail(item.id);$('grid').append(tile);}message('');
}
$('login-form').onsubmit=async e=>{e.preventDefault();$('login-button').disabled=true;try{const data=await api('',{method:'POST',body:JSON.stringify({action:'login',email:$('email').value})});message(data.message);}catch(e){message(e.message);}finally{$('login-button').disabled=false;}};
$('logout').onclick=async()=>{$('logout').disabled=true;try{await api('',{method:'POST',body:JSON.stringify({action:'logout'})});login();message('Logged out.');}catch(e){message(e.message);}finally{$('logout').disabled=false;}};
$('close').onclick=()=>{$('detail').close();};
if(token)load().catch(e=>message(e.message));
if(fragment.get('error_description'))message('This sign-in link has expired. Request a new one.');
