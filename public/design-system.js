import {createLogo,initBrandActivity} from './brand-ui.js';
let menu,menuButton,nav,header,menuCount,wishlistCount=null;
export function mountPublicHeader(){
 for(const link of document.querySelectorAll('.public-header .wordmark'))link.replaceChildren(createLogo());
 initBrandActivity();
}
export function mountHeader(page){
 header=document.querySelector('.app-header');
 const brand=document.createElement('a');brand.className='wordmark';brand.href='/wishlist';brand.setAttribute('aria-label','Jules wishlist');brand.append(createLogo());
 nav=document.createElement('nav');nav.className='header-actions';nav.setAttribute('aria-label','Your collection');
 for(const [key,text,href] of [['wishlist','Wishlist','/wishlist'],['style','Your style','/style'],['simulator','Test chat','/simulator'],['logout','Log out',null]]){
  const control=document.createElement(href?'a':'button');control.className='nav-item';if(href)control.href=href;else control.type='button';
  if(key==='logout'){control.id='logout';control.hidden=true;}
  if(key==='simulator'){control.id='test-chat-link';control.hidden=true;}
  if(key===page)control.setAttribute('aria-current','page');
  const textNode=document.createElement('span');textNode.textContent=text;
  const mark=document.createElement('span');mark.className='nav-mark';mark.setAttribute('aria-hidden','true');const orb=document.createElement('span');orb.className='orb';mark.append(orb);control.append(textNode,mark);nav.append(control);
 }
 menuButton=document.createElement('button');menuButton.type='button';menuButton.className='menu-toggle';menuButton.textContent='Menu';menuButton.setAttribute('aria-expanded','false');menuButton.setAttribute('aria-controls','mobile-menu');menuButton.setAttribute('aria-haspopup','dialog');
 menu=document.createElement('dialog');menu.id='mobile-menu';menu.className='mobile-menu';menu.setAttribute('aria-label','Main navigation');
 const top=document.createElement('div');top.className='menu-header';const menuBrand=brand.cloneNode(true);const close=document.createElement('button');close.type='button';close.textContent='Close ×';close.className='menu-close';close.setAttribute('aria-label','Close menu');top.append(menuBrand,close);
 menuCount=document.createElement('p');menuCount.className='menu-count';menuCount.hidden=true;menu.append(top,menuCount);document.body.append(menu);
 function restore(){if(menu.open)return;header.insertBefore(nav,menuButton);menuButton.setAttribute('aria-expanded','false');document.body.classList.remove('menu-open');}
 function closeMenu(){if(menu.open)menu.close();restore();}
 menuButton.onclick=()=>{menu.insertBefore(nav,menuCount);menuButton.setAttribute('aria-expanded','true');document.body.classList.add('menu-open');menu.showModal();};
 close.onclick=closeMenu;menu.addEventListener('close',restore);menu.addEventListener('cancel',event=>{event.preventDefault();closeMenu();});
 nav.addEventListener('click',event=>{if(event.target.closest('a,button')&&menu.open)closeMenu();});
 const mobile=matchMedia('(max-width:800px)');mobile.addEventListener('change',event=>{if(!event.matches)closeMenu();});
 header.replaceChildren(brand,nav,menuButton);updateWishlistCount(wishlistCount);initBrandActivity();initHeader();
}
export function updateWishlistCount(count){wishlistCount=count;if(!menuCount)return;menuCount.hidden=count===null;menuCount.textContent=count===null?'':`${count} ${count===1?'item':'items'} on your wishlist`;}
let testChatToken,permissionRevision=0;
export async function enableTestChat(token){
 const link=document.getElementById('test-chat-link');if(!link)return;
 if(token===testChatToken)return;
 testChatToken=token;const revision=++permissionRevision;link.hidden=true;
 if(!token)return;
 try{const response=await fetch('/api/chat-simulator',{headers:{Authorization:'Bearer '+token},cache:'no-store'});if(revision===permissionRevision)link.hidden=!response.ok;}catch{if(revision===permissionRevision)link.hidden=true;}
}
function initHeader(){
 let headerTick=false;function updateHeader(){header.classList.toggle('compact',scrollY>8);headerTick=false;}
 window.addEventListener('scroll',()=>{if(!headerTick){headerTick=true;requestAnimationFrame(updateHeader);}},{passive:true});updateHeader();
}
