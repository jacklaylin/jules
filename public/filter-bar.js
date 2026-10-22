// FilterBar never wraps: the chips show while every one fits on the row; otherwise the row swaps them for one
// Filter button that opens the same choices (a popover on desktop, a sheet on phones). Pages keep rendering their
// chips as before; a menu choice clicks the matching chip, so each page's own filter logic still runs.
// Grouped chips (the wishlist's [data-group] Category and Show groups, All first) get a section each in the menu,
// which stays open while you pick, with Clear and "Show N items" (the page's data-shown count) at its foot.

// Switching back to chips needs this much spare room, so a window edge on the limit doesn't flicker between modes.
export const FIT_SLACK=12;
// Needed width = the chips at their natural width, plus every other visible item and the gaps between them.
export function chipsFit({chipsWidth,otherWidths,gap,available,menuMode}){
 const needed=chipsWidth+otherWidths.reduce((sum,w)=>sum+w+gap,0);
 return needed<=available-(menuMode?FIT_SLACK:0);
}

const icon=path=>`<svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
const FILTER_ICON='<path d="M4 7h16M7 12h10M10 17h4"/>',CHEVRON='<path d="M6 9l6 6 6-6"/>',CHECK='<path d="M5 12.5l4.5 4.5L19 7.5"/>',CROSS='<path d="M6 6l12 12M18 6L6 18"/>';
const make=(tag,className,props={})=>Object.assign(document.createElement(tag),{className},props);
// The chip's own words, without its icon or count.
const chipLabel=chip=>[...chip.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE).map(n=>n.textContent).join('').trim();
const chipCount=chip=>chip.querySelector('.chip-count')?.textContent??'';

export function fitFilterBar(bar){
 const chips=bar.querySelector('.filter-chips');if(!chips)return;
 const wrap=make('div','filter-menu');wrap.hidden=true;
 const trigger=make('button','chip filter-menu__trigger',{type:'button'});trigger.setAttribute('aria-haspopup','dialog');trigger.setAttribute('aria-expanded','false');
 const clear=make('button','close-button filter-menu__clear',{type:'button',innerHTML:icon(CROSS)});clear.setAttribute('aria-label','Clear filter, show all');
 const dialog=make('dialog','filter-menu__panel sheet');dialog.tabIndex=-1;dialog.setAttribute('aria-label',chips.getAttribute('aria-label')||'Filter');
 const close=make('button','close-button',{type:'button',innerHTML:icon(CROSS)});close.setAttribute('aria-label','Close');
 const heading=make('div','dialog-heading filter-menu__heading sheet-head');heading.append(make('h2','',{textContent:'Filter'}),close);
 const list=make('div','filter-menu__list sheet-body');dialog.append(heading,list);
 const foot=make('div','sheet-foot filter-menu__foot');foot.hidden=true;
 const reset=make('button','btn filter-menu__reset',{type:'button',textContent:'Clear'}),done=make('button','btn btn--butter filter-menu__done',{type:'button'});
 foot.append(reset,done);dialog.append(foot);
 wrap.append(trigger,clear);chips.after(wrap);document.body.append(dialog);

 const all=()=>[...chips.querySelectorAll('.chip')];
 const selected=()=>all().find(chip=>chip.getAttribute('aria-pressed')==='true');
 const phone=matchMedia('(max-width:800px)');
 function syncMenu(){
  const first=all()[0],groups=[...chips.querySelectorAll('[data-group]')],grouped=groups.length>0;
  const picks=all().filter(chip=>chip!==first&&chip.getAttribute('aria-pressed')==='true'),on=grouped?null:selected();
  const shown=chips.dataset.shown;
  trigger.innerHTML=icon(FILTER_ICON);
  // Grouped: both picks joined ("Shoes · Alerts on") and how many they show.
  const label=grouped?picks.map(chipLabel).join(' · ')||chipLabel(first):on?chipLabel(on):'Filter';
  trigger.append(make('span','filter-menu__label',{textContent:label}));
  const count=grouped?shown??chipCount(first):on?chipCount(on):null;
  if(count!=null)trigger.append(make('span','chip-count',{textContent:count}));
  trigger.insertAdjacentHTML('beforeend',icon(CHEVRON));
  const filtered=picks.length>0;
  trigger.classList.toggle('chip--on',filtered);clear.hidden=!filtered;
  // Rebuilding the rows keeps focus on the row it was on, so a keyboard pick in an open menu stays in place.
  const focused=list.contains(document.activeElement)?document.activeElement.dataset.key:null;
  const row=(chip,key)=>{
   const pressed=chip.getAttribute('aria-pressed')==='true';
   const button=make('button','filter-menu__row',{type:'button'});button.setAttribute('aria-pressed',String(pressed));button.dataset.key=key;
   const name=make('span','filter-menu__name');name.innerHTML=`<span class="filter-menu__check">${pressed?icon(CHECK):''}</span>`;
   const glyph=chip.querySelector(':scope>svg');if(glyph)name.append(glyph.cloneNode(true));
   name.append(chipLabel(chip));
   button.append(name,make('span','chip-count',{textContent:chipCount(chip)}));
   button.onclick=()=>{if(!grouped)dialog.close();press(chip);};
   return button;
  };
  // All is the first chip; in grouped menus Clear does its job, so each section lists only its own picks.
  list.replaceChildren(...(grouped?groups.flatMap((group,g)=>{
   const options=[...group.querySelectorAll('.chip')].filter(chip=>chip!==first);
   if(!options.length)return [];
   const section=make('div','filter-menu__section');section.setAttribute('role','group');section.setAttribute('aria-label',group.getAttribute('aria-label')||'');
   section.append(make('p','filter-menu__section-title',{textContent:group.getAttribute('aria-label')||''}),...options.map((chip,i)=>row(chip,`${g}:${i}`)));
   return [section];
  }):all().map((chip,i)=>row(chip,String(i)))));
  if(focused)list.querySelector(`[data-key="${focused}"]`)?.focus({preventScroll:true});
  foot.hidden=!grouped;reset.disabled=!filtered;
  done.textContent=shown!=null?`Show ${shown} ${shown==='1'?'item':'items'}`:'Done';
 }
 // The chips are unreachable in menu mode; a menu choice reaches them for one click.
 function press(chip){chips.inert=false;chip.click();chips.inert=bar.classList.contains('filter-bar--menu');if(dialog.open)syncMenu();}
 function place(){
  if(phone.matches){for(const key of ['top','left','max-height'])dialog.style.removeProperty(key);return;}
  const r=trigger.getBoundingClientRect();
  // Below the button, never past the bottom of the window (the list scrolls instead).
  dialog.style.top=`${Math.round(r.bottom+8)}px`;dialog.style.maxHeight=`${Math.max(160,Math.round(innerHeight-r.bottom-24))}px`;dialog.style.left=`${Math.round(Math.max(16,Math.min(r.left,innerWidth-dialog.offsetWidth-16)))}px`;
 }
 // Focus goes to the sheet, not a row: a ring on a tapped-open menu reads as a stray highlight. Tab reaches the rows.
 trigger.onclick=()=>{syncMenu();dialog.showModal();place();trigger.setAttribute('aria-expanded','true');dialog.focus();list.querySelector('[aria-pressed=true]')?.scrollIntoView({block:'nearest'});};
 clear.onclick=()=>press(all()[0]);
 reset.onclick=()=>press(all()[0]);
 done.onclick=()=>dialog.close();
 close.onclick=()=>dialog.close();
 dialog.addEventListener('close',()=>{trigger.setAttribute('aria-expanded','false');if(!wrap.hidden)trigger.focus({preventScroll:true});});
 // A tap on the scrim (the dialog's own box outside its content) closes it.
 dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
 phone.addEventListener('change',()=>{if(dialog.open)place();});
 addEventListener('scroll',()=>{if(dialog.open&&!phone.matches)place();},{passive:true});

 let queued=false;
 function update(){
  queued=false;
  if(!all().length){bar.classList.remove('filter-bar--menu');wrap.hidden=true;return;}
  const menuMode=bar.classList.contains('filter-bar--menu');
  const style=getComputedStyle(bar),gap=parseFloat(style.columnGap)||0;
  const others=[...bar.children].filter(child=>child!==chips&&child!==wrap&&!child.hidden&&getComputedStyle(child).display!=='none');
  // The strip's negative margins cancel the padding that keeps focus rings visible.
  const strip=getComputedStyle(chips),chipsWidth=chips.scrollWidth+(parseFloat(strip.marginLeft)||0)+(parseFloat(strip.marginRight)||0);
  const fits=chipsFit({chipsWidth,otherWidths:others.map(child=>child.getBoundingClientRect().width),gap,available:bar.clientWidth,menuMode});
  bar.classList.toggle('filter-bar--menu',!fits);wrap.hidden=fits;chips.inert=!fits;
  if(fits&&dialog.open)dialog.close();
  if(!fits)syncMenu();
 }
 // A microtask, not an animation frame: frames pause in background tabs, and observers already run before paint.
 const schedule=()=>{if(!queued){queued=true;queueMicrotask(update);}};
 new ResizeObserver(schedule).observe(bar);
 new MutationObserver(records=>{if(records.some(r=>r.target!==bar&&!wrap.contains(r.target)))schedule();})
  .observe(bar,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['class','aria-pressed','hidden']});
 document.fonts?.ready.then(schedule);
 schedule();
}
