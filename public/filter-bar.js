// FilterBar never wraps: the chips show while every one fits on the row; otherwise the row swaps them for one
// Filter button that opens the same choices (a popover on desktop, a sheet on phones). Pages keep rendering their
// chips as before; a menu choice clicks the matching chip, so each page's own filter logic still runs.

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
const chipLabel=chip=>chip.firstChild?.nodeType===Node.TEXT_NODE?chip.firstChild.textContent.trim():chip.textContent.trim();
const chipCount=chip=>chip.querySelector('.chip-count')?.textContent??'';

export function fitFilterBar(bar){
 const chips=bar.querySelector('.filter-chips');if(!chips)return;
 const wrap=make('div','filter-menu');wrap.hidden=true;
 const trigger=make('button','chip filter-menu__trigger',{type:'button'});trigger.setAttribute('aria-haspopup','dialog');trigger.setAttribute('aria-expanded','false');
 const clear=make('button','close-button filter-menu__clear',{type:'button',innerHTML:icon(CROSS)});clear.setAttribute('aria-label','Clear filter, show all');
 const dialog=make('dialog','filter-menu__panel');dialog.setAttribute('aria-label',chips.getAttribute('aria-label')||'Filter');
 const close=make('button','close-button',{type:'button',innerHTML:icon(CROSS)});close.setAttribute('aria-label','Close');
 const heading=make('div','dialog-heading filter-menu__heading');heading.append(make('h2','',{textContent:'Filter'}),close);
 const list=make('div','filter-menu__list');dialog.append(heading,list);
 wrap.append(trigger,clear);chips.after(wrap);document.body.append(dialog);

 const all=()=>[...chips.querySelectorAll('.chip')];
 const selected=()=>all().find(chip=>chip.getAttribute('aria-pressed')==='true');
 const phone=matchMedia('(max-width:800px)');
 function syncMenu(){
  const on=selected(),first=all()[0];
  trigger.innerHTML=icon(FILTER_ICON);
  trigger.append(make('span','filter-menu__label',{textContent:on?chipLabel(on):'Filter'}));
  if(on)trigger.append(make('span','chip-count',{textContent:chipCount(on)}));
  trigger.insertAdjacentHTML('beforeend',icon(CHEVRON));
  const filtered=Boolean(on&&on!==first);
  trigger.classList.toggle('chip--on',filtered);clear.hidden=!filtered;
  list.replaceChildren(...all().map(chip=>{
   const pressed=chip.getAttribute('aria-pressed')==='true';
   const row=make('button','filter-menu__row',{type:'button'});row.setAttribute('aria-pressed',String(pressed));
   const name=make('span','filter-menu__name');name.innerHTML=`<span class="filter-menu__check">${pressed?icon(CHECK):''}</span>`;name.append(chipLabel(chip));
   row.append(name,make('span','chip-count',{textContent:chipCount(chip)}));
   row.onclick=()=>{dialog.close();chips.inert=false;chip.click();chips.inert=bar.classList.contains('filter-bar--menu');};
   return row;
  }));
 }
 function place(){
  if(phone.matches){for(const key of ['top','left','max-height'])dialog.style.removeProperty(key);return;}
  const r=trigger.getBoundingClientRect();
  // Below the button, never past the bottom of the window (the list scrolls instead).
  dialog.style.top=`${Math.round(r.bottom+8)}px`;dialog.style.maxHeight=`${Math.max(160,Math.round(innerHeight-r.bottom-24))}px`;dialog.style.left=`${Math.round(Math.max(16,Math.min(r.left,innerWidth-dialog.offsetWidth-16)))}px`;
 }
 trigger.onclick=()=>{syncMenu();dialog.showModal();place();trigger.setAttribute('aria-expanded','true');list.querySelector('[aria-pressed=true]')?.focus();};
 clear.onclick=()=>{chips.inert=false;selected()?.click();chips.inert=bar.classList.contains('filter-bar--menu');};
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
