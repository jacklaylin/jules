import {createLogo,initBrandActivity} from './brand-ui.js';
let menu,menuButton,nav,header;
export function mountPublicHeader(){
 for(const link of document.querySelectorAll('.public-header .wordmark'))link.replaceChildren(createLogo());
 initBrandActivity();
}
export function mountHeader(page){
 header=document.querySelector('.app-header');
 const brand=document.createElement('a');brand.className='wordmark';brand.href='/wishlist';brand.setAttribute('aria-label','Jules wishlist');brand.append(createLogo());
 nav=document.createElement('nav');nav.className='header-actions';nav.setAttribute('aria-label','Your collection');
 for(const [key,text,href] of [['wishlist','Wishlist','/wishlist'],['wardrobe','Wardrobe','/wardrobe'],['style','Your style','/report'],['admin','Admin','/admin'],['logout','Log out',null],['account','Account','/account']]){
  const control=document.createElement(href?'a':'button');control.className='nav-item';if(href)control.href=href;else control.type='button';
  if(key==='logout'){control.id='logout';control.hidden=true;}
  if(key==='admin'){control.id='admin-link';control.hidden=true;}
  if(key===page)control.setAttribute('aria-current','page');
  const textNode=document.createElement('span');textNode.textContent=text;
  // Account is an avatar in the desktop bar and a labelled row in the phone menu.
  if(key==='account'){control.className='nav-item nav-account';textNode.className='nav-text';const avatar=document.createElement('span');avatar.className='avatar';avatar.setAttribute('aria-hidden','true');avatar.innerHTML='<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="8.5" r="3.8"/><path d="M4.8 20c1.2-3.6 4-5.4 7.2-5.4s6 1.8 7.2 5.4"/></svg>';control.append(avatar,textNode);nav.append(control);continue;}
  const mark=document.createElement('span');mark.className='nav-mark';mark.setAttribute('aria-hidden','true');const orb=document.createElement('span');orb.className='orb';mark.append(orb);control.append(textNode,mark);nav.append(control);
 }
 menuButton=document.createElement('button');menuButton.type='button';menuButton.className='menu-toggle';menuButton.textContent='Menu';menuButton.setAttribute('aria-expanded','false');menuButton.setAttribute('aria-controls','mobile-menu');menuButton.setAttribute('aria-haspopup','dialog');
 menu=document.createElement('dialog');menu.id='mobile-menu';menu.className='mobile-menu';menu.setAttribute('aria-label','Main navigation');menu.tabIndex=-1;
 const top=document.createElement('div');top.className='menu-header';const menuBrand=brand.cloneNode(true);const close=document.createElement('button');close.type='button';close.textContent='Close ×';close.className='menu-close';close.setAttribute('aria-label','Close menu');top.append(menuBrand,close);
 menu.append(top);document.body.append(menu);
 function restore(){if(menu.open)return;header.insertBefore(nav,menuButton);menuButton.setAttribute('aria-expanded','false');document.body.classList.remove('menu-open');}
 function closeMenu(){if(menu.open)menu.close();restore();}
 menuButton.onclick=()=>{menu.append(nav);menuButton.setAttribute('aria-expanded','true');document.body.classList.add('menu-open');menu.showModal();menu.focus?.();};
 close.onclick=closeMenu;menu.addEventListener('close',restore);menu.addEventListener('cancel',event=>{event.preventDefault();closeMenu();});
 nav.addEventListener('click',event=>{if(event.target.closest('a,button')&&menu.open)closeMenu();});
 const mobile=matchMedia('(max-width:800px)');mobile.addEventListener('change',event=>{if(!event.matches)closeMenu();});
 header.replaceChildren(brand,nav,menuButton);initBrandActivity();initHeader();
}
// The owner sees one Admin entry; everyone else never learns the console exists.
let adminToken,permissionRevision=0;
export async function enableAdminLink(token){
 const link=document.getElementById('admin-link');if(!link)return;
 if(token===adminToken)return;
 adminToken=token;const revision=++permissionRevision;link.hidden=true;
 if(!token)return;
 try{const response=await fetch('/api/admin?view=access',{headers:{Authorization:'Bearer '+token},cache:'no-store'});if(revision===permissionRevision)link.hidden=!response.ok;}catch{if(revision===permissionRevision)link.hidden=true;}
}
function initHeader(){
 let headerTick=false;function updateHeader(){header.classList.toggle('compact',scrollY>8);headerTick=false;}
 window.addEventListener('scroll',()=>{if(!headerTick){headerTick=true;requestAnimationFrame(updateHeader);}},{passive:true});updateHeader();
}
