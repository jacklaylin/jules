import {createLogo,initBrandActivity} from './brand-ui.js';
import {animate,spring} from './vendor/motion-mini.js';
let menu,menuButton,nav,header;
export function mountPublicHeader(){
 for(const link of document.querySelectorAll('.public-header .wordmark'))link.replaceChildren(createLogo());
 initBrandActivity();
}
export function mountHeader(page){
 header=document.querySelector('.app-header');
 const brand=document.createElement('a');brand.className='wordmark';brand.href='/wishlist';brand.setAttribute('aria-label','Jules wishlist');brand.append(createLogo());
 nav=document.createElement('nav');nav.className='header-actions';nav.setAttribute('aria-label','Your collection');
 // Log out lives on the Account page only.
 for(const [key,text,href] of [['wishlist','Wishlist','/wishlist'],['wardrobe','Wardrobe','/wardrobe'],['style','Your style','/report'],['admin','Admin','/admin'],['account','Account','/account']]){
  const control=document.createElement('a');control.className='nav-item';control.href=href;
  if(key==='admin'){control.id='admin-link';control.hidden=true;}
  if(key===page)control.setAttribute('aria-current','page');
  const textNode=document.createElement('span');textNode.textContent=text;
  // Account is an avatar in the desktop bar and a labelled row in the phone menu.
  if(key==='account'){control.className='nav-item nav-account';textNode.className='nav-text';const avatar=document.createElement('span');avatar.className='avatar';avatar.setAttribute('aria-hidden','true');avatar.innerHTML='<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="8.5" r="3.8"/><path d="M4.8 20c1.2-3.6 4-5.4 7.2-5.4s6 1.8 7.2 5.4"/></svg>';control.append(avatar,textNode);nav.append(control);continue;}
  // Each section owns one Jules colour, drawn as a bar under its label on hover and on the current page.
  control.classList.add('nav-item--'+key);textNode.className='nav-label';control.append(textNode);nav.append(control);
 }
 menuButton=document.createElement('button');menuButton.type='button';menuButton.className='menu-toggle';menuButton.textContent='Menu';menuButton.setAttribute('aria-expanded','false');menuButton.setAttribute('aria-controls','mobile-menu');menuButton.setAttribute('aria-haspopup','dialog');
 menu=document.createElement('dialog');menu.id='mobile-menu';menu.className='mobile-menu';menu.setAttribute('aria-label','Main navigation');menu.tabIndex=-1;
 const top=document.createElement('div');top.className='menu-header';const menuBrand=brand.cloneNode(true);const close=document.createElement('button');close.type='button';close.textContent='Close ×';close.className='menu-close';close.setAttribute('aria-label','Close menu');top.append(menuBrand,close);
 menu.append(top);document.body.append(menu);
 function restore(){if(menu.open)return;header.insertBefore(nav,menuButton);menuButton.setAttribute('aria-expanded','false');document.body.classList.remove('menu-open');}
 function closeMenu(){if(menu.open)closeDialog(menu);else restore();}
 menuButton.onclick=()=>{menu.append(nav);menuButton.setAttribute('aria-expanded','true');document.body.classList.add('menu-open');menu.showModal();menu.focus?.();};
 close.onclick=closeMenu;menu.addEventListener('close',restore);
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

// Shared micro-motion (Motion mini, vendored). Pages call these instead of importing Motion, so every exit,
// removal and confirmation uses the same springs and all of them respect reduced motion.
const reducedMotion=()=>Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
const settle={type:spring,visualDuration:.35,bounce:.18};
const exit={duration:.16,ease:[.4,0,1,1]};
// Paused timelines (background tabs) never finish, so exits also settle on a timer.
const finished=(...animations)=>Promise.race([Promise.all(animations),new Promise(resolve=>setTimeout(resolve,exit.duration*1000+150))]).catch(()=>{});
// Plays the exit, then closes, so 'close' listeners still run once the dialog is actually gone.
const closing=new WeakMap();
export function closeDialog(dialog){
 if(closing.has(dialog))return closing.get(dialog);
 if(!dialog?.open)return Promise.resolve();
 if(reducedMotion()){dialog.close();return Promise.resolve();}
 const backdrop=dialog.animate({opacity:[1,0]},{duration:exit.duration*1000,easing:'ease-in',pseudoElement:'::backdrop',fill:'forwards'});
 const panel=animate(dialog,{opacity:[1,0],transform:['none','translateY(10px) scale(.98)']},exit);
 const done=finished(panel,backdrop.finished).then(()=>{dialog.close();panel.cancel();backdrop.cancel();dialog.style.opacity=dialog.style.transform='';closing.delete(dialog);});
 closing.set(dialog,done);return done;
}
// Escape on any modal plays the same exit as its Close button.
globalThis.document?.addEventListener('cancel',event=>{if(event.target.localName==='dialog'){event.preventDefault();closeDialog(event.target);}},true);
// Fades the element out, removes it, then springs its siblings into their new places.
export async function removeWithMotion(element){
 const parent=element.parentElement;
 if(!parent||reducedMotion()){element.remove();return;}
 await finished(animate(element,{opacity:0,transform:'scale(.92)'},exit));
 const siblings=[...parent.children].filter(child=>child!==element),before=siblings.map(child=>child.getBoundingClientRect());
 element.remove();
 siblings.forEach((child,i)=>{const after=child.getBoundingClientRect(),dx=before[i].left-after.left,dy=before[i].top-after.top;if(dx||dy)animate(child,{transform:[`translate(${dx}px,${dy}px)`,'none']},settle);});
}
// A small springy confirmation when a control turns on.
export function popIn(element){if(element&&!reducedMotion())animate(element,{transform:['scale(.8)','none']},{type:spring,visualDuration:.3,bounce:.5});}
// Answering a question with a thumb (a suggested photo, a report card): the chosen button fills (its
// `is-pressed` class), springs up with a nod toward its meaning (tilt: negative = up, positive = down)
// while the other choices fade back, then the whole group drops away. Resolves once it is gone, so the
// caller can swap in the answered state without a jump. Instant under reduced motion.
export async function answerWithMotion(button,group,{tilt=-14}={}){
 button?.classList.add('is-pressed');
 if(!button||!group||reducedMotion())return;
 for(const other of group.querySelectorAll('button'))if(other!==button)animate(other,{opacity:.3,transform:'scale(.88)'},exit);
 await Promise.race([animate(button,{transform:['scale(1)',`scale(1.24) rotate(${tilt}deg)`,'scale(1) rotate(0deg)']},{duration:.46,ease:[.34,1.56,.64,1]}),new Promise(resolve=>setTimeout(resolve,610))]).catch(()=>{});
 await finished(animate(group,{opacity:[1,0],transform:['none','translateY(10px) scale(.96)']},{duration:.18,ease:[.4,0,1,1]}));
}
// Rises a freshly shown toast or panel into place (its own CSS still owns the fade and position).
export function riseIn(element){if(element&&!reducedMotion())animate(element,{translate:['0 16px','0 0']},settle);}
