import {createSession} from './wishlist-session.js';

// The person's private style report: a tap-through story. Cards come from /api/wishlist?report=1;
// thumbs and hidden lines are saved there. Sharing comes later (design/style-report-brief.md).
const $=id=>document.getElementById(id);
const session=createSession({storage:localStorage,lock:work=>navigator.locks?navigator.locks.request('jules-wishlist-refresh',work):work()});
const fragment=new URLSearchParams(location.hash.slice(1)),signinToken=fragment.get('signin');
// Admin preview of a tester's report (/report?person=<id>): read-only, through the owner's admin access.
const person=new URLSearchParams(location.search).get('person');
// A friend's view through a share link (/r/<link>): no sign-in, read-only, written about the person.
const sharedToken=location.pathname.match(/^\/r\/([A-Za-z0-9_-]{22})\/?$/)?.[1]??null;
// Read-only views record nothing and offer no edits or sharing.
const readOnly=Boolean(person||sharedToken);
const el=(tag,props={},...children)=>{const node=Object.assign(document.createElement(tag),props);node.append(...children.filter(c=>c!=null&&c!==false));return node;};
let report=null,index=0;

function show(view){
 for(const id of ['view-message','view-intro','view-card','view-end'])$(id).hidden=id!==view;
 // The intro and end screens keep the desktop controls: → starts from the intro, ← goes back from the end.
 const intro=view==='view-intro',end=view==='view-end';
 $('stage-chrome').hidden=!(intro||end);
 $('chrome-prev').hidden=!end;$('chrome-next').hidden=!intro;
 $('chrome-keys').textContent=intro?'→ to start · Esc to close':'← to go back · Esc to close';
}
// progress: null (none), 'waiting' (moving bar, length unknown) or a fraction 0–1.
let stepTimer;
function message(title,body,eyebrow='Style report',action=null,{progress=null,steps=[]}={}){
 $('message-title').textContent=title;$('message-body').textContent=body;$('message-eyebrow').textContent=eyebrow;
 $('message-action').hidden=!action;if(action){$('message-action').textContent=action.label;$('message-action').href=action.href;}
 $('message-progress').hidden=progress==null;$('message-progress').classList.toggle('is-waiting',progress==='waiting');
 if(typeof progress==='number'){const percent=Math.round(Math.min(1,Math.max(0,progress))*100);$('message-bar').style.width=percent+'%';$('message-progress').setAttribute('aria-valuenow',String(percent));}
 else{$('message-bar').style.width='';$('message-progress').removeAttribute('aria-valuenow');}
 // The build's own order of work, shown in turn while the page waits for it.
 clearInterval(stepTimer);$('message-step').hidden=!steps.length;
 if(steps.length){let n=0;$('message-step').textContent=steps[0];stepTimer=setInterval(()=>{if(n<steps.length-1)$('message-step').textContent=steps[++n];},2500);}
 show('view-message');
}
let toastTimer;
function toast(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{$('toast').hidden=true;},2600);}

async function api(method,body){
 if(sharedToken){
  const response=await fetch(`/api/wishlist?shared=${sharedToken}`,{cache:'no-store'});
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw Object.assign(Error(result.error||'Something went wrong. Try again.'),{status:response.status});
  return result;
 }
 const token=await session.token();
 if(!token)throw Object.assign(Error('Log in to continue.'),{status:401});
 const url=person?`/api/admin?view=report&conversation=${encodeURIComponent(person)}`:'/api/wishlist?report=1';
 const response=await fetch(url,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store'});
 const result=await response.json().catch(()=>({}));
 if(!response.ok)throw Object.assign(Error(result.error||'Something went wrong. Try again.'),{status:response.status});
 return result;
}

// The wordmark, with the orb as the dot on the j.
const wordmark=()=>el('span',{className:'report-wordmark','aria-label':'Jules'},el('span',{className:'report-j'},'ȷ',el('span',{className:'report-dot'})),'ules');
const day=at=>new Date(at).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}).toUpperCase();

// In a shared view the cards talk about the person ("Jack's receipts"); in the app, to them.
const theirs=()=>report.shared?(report.name?`${report.name}’s`:'their'):'your';
const Theirs=()=>{const t=theirs();return t.charAt(0).toUpperCase()+t.slice(1);};
// Shared cards end with a question back to the friend reading them.
const foot=(className='story-foot')=>el('footer',{className},report.shared&&el('span',{className:'story-ask',textContent:'What about you?'}),wordmark());
function receiptCard(card){
 const lines=card.lines.filter(l=>!l.hidden);
 const range=card.range?(card.range.from===card.range.to?`ORDERS ${card.range.from}`:`ORDERS ${card.range.from}–${card.range.to}`):null;
 const paper=el('div',{className:'receipt-paper'},
  el('div',{className:'receipt-mark'},wordmark()),
  el('p',{className:'receipt-head',textContent:'CUSTOMER COPY · CASHIER: JULES'}),
  el('p',{className:'receipt-meta',textContent:[day(report.built_at),report.name?.toUpperCase()].filter(Boolean).join(' · ')}),
  el('hr'),
  ...lines.map((l,i)=>{const row=el('p',{className:'receipt-line'},el('span',{textContent:l.label}),el('b',{textContent:`×${l.n}`}));row.style.animationDelay=`${0.5+i*0.09}s`;return row;}),
  el('hr'),
  el('p',{className:'receipt-total',textContent:`TOTAL: ${card.total}`}),
  el('hr'),
  range&&el('p',{className:'receipt-foot',textContent:range}),
  el('div',{className:'receipt-barcode','aria-hidden':'true'}));
 return el('article',{className:'story-card story-receipt','aria-label':'Your receipt'},
  el('h2',{className:'display story-title',textContent:`We have ${theirs()} receipts (literally)`}),
  el('div',{className:'receipt-roll'},paper,el('div',{className:'receipt-zig','aria-hidden':'true'})),
  foot());
}
// Gatekeeper: a dial from 0 (the mall) to 100 (deep cut), the score counting up as the needle sweeps,
// the verdict, the one-liner, and the person's brands ranked most niche first.
const svg=(tag,attrs={},...children)=>{const node=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(attrs))node.setAttribute(k,v);node.append(...children);return node;};
const ARC='M 20 130 A 110 110 0 0 1 240 130',ARC_LENGTH=Math.PI*110;
function gatekeeperCard(card,animate){
 const fill=svg('path',{d:ARC,class:'gate-fill','stroke-dasharray':`${(ARC_LENGTH*card.score/100).toFixed(1)} 999`});
 fill.style.setProperty('--len',`${(ARC_LENGTH*card.score/100).toFixed(1)}px`);
 const needle=svg('g',{class:'gate-needle'},svg('line',{x1:130,y1:130,x2:130,y2:42}));
 needle.style.setProperty('--angle',`${(-90+180*card.score/100).toFixed(1)}deg`);
 const number=el('span',{className:'gate-score',textContent:String(card.score)});
 if(animate&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
  // Count up with the needle: same delay and easing.
  number.textContent='0';const start=performance.now();
  const tick=now=>{const k=Math.min(1,Math.max(0,(now-start-300)/1300));number.textContent=String(Math.round(card.score*(1-Math.pow(1-k,3))));if(k<1&&number.isConnected!==false)requestAnimationFrame(tick);};
  requestAnimationFrame(tick);
 }
 return el('article',{className:'story-card story-gatekeeper','aria-label':`Gatekeeper score ${card.score} out of 100`},
  el('h2',{className:'display story-title',textContent:`How niche is ${theirs()} taste?`}),
  el('div',{className:'gate-dial'},
   svg('svg',{viewBox:'0 0 260 150',width:'100%','aria-hidden':'true'},svg('path',{d:ARC,class:'gate-track'}),fill,needle,svg('circle',{cx:130,cy:130,r:9,class:'gate-hub'})),
   el('div',{className:'gate-scale'},el('span',{textContent:'0 · Basically the mall'}),el('span',{textContent:'100 · Extremely esoteric'}))),
  el('div',{className:'gate-result'},number,el('span',{className:'gate-verdict',textContent:card.verdict})),
  el('p',{className:'gate-line',textContent:card.line}),
  el('div',{className:'gate-brands'},
   el('span',{className:'gate-label',textContent:`${Theirs()} niche interests`}),
   el('ol',{className:'gate-chips'},...card.brands.map((b,i)=>{const chip=el('li',{className:i===0?'gate-chip is-top':'gate-chip'},el('span',{className:'gate-rank',textContent:String(i+1).padStart(2,'0')}),b.name);chip.style.animationDelay=`${(0.9+i*0.06).toFixed(2)}s`;return chip;}))),
  foot());
}
// Scales the 360×640 card to the largest size that fits its space, centred: same layout on every screen.
const CARD_W=360,CARD_H=640;
function fitCard(){
 const box=$('card'),card=box.firstElementChild;if(!card||!box.clientWidth)return;
 const scale=Math.min(box.clientWidth/CARD_W,box.clientHeight/CARD_H);
 card.style.transform=`translate(${(box.clientWidth-CARD_W*scale)/2}px,${(box.clientHeight-CARD_H*scale)/2}px) scale(${scale})`;
}
addEventListener('resize',fitCard);
// Brand chips show whole rows only: chips that don't fit the card's height are dropped, never cut off.
function fitChips(){
 const list=$('card').querySelector('.gate-chips');if(!list)return;
 for(const chip of list.children)chip.hidden=false;
 const room=list.parentElement.offsetTop+list.parentElement.clientHeight;
 for(const chip of list.children)if(chip.offsetTop+chip.offsetHeight>room)chip.hidden=true;
}
addEventListener('resize',fitChips);
// In / Out (canvas card 4): the "in / out" meme as a notes-app list on a butter ground. IN lines slide
// in, then OUT lines (struck through), then the closing line. Every fact is counted by code.
function inOutCard(card){
 const line=(item,className)=>{const row=el('li',{className},el('span',{className:'note-text',textContent:item.text}),' ',el('span',{className:'note-fact',textContent:item.fact}));return row;};
 const stagger=(rows,from)=>{rows.forEach((row,k)=>{row.style.animationDelay=`${(from+k*0.12).toFixed(2)}s`;});return rows;};
 return el('article',{className:'story-card story-inout','aria-label':`In and out for ${card.now}`},
  el('div',{className:'note'},
   el('p',{className:'note-meta'},el('span',{textContent:day(report.built_at)}),el('span',{textContent:report.shared?`${report.name?report.name+'’s':'their'} notes`:'notes'})),
   el('h2',{className:'note-head',textContent:`in for ${card.now}:`}),
   el('ul',{className:'note-list'},...stagger(card.in.map(i=>line(i,'note-in')),0.35),
    card.still.length&&el('li',{className:'note-in note-still'},'still: ',el('b',{textContent:card.still.join(', ')}))),
   card.out.length&&el('h2',{className:'note-head',textContent:'out:'}),
   card.out.length&&el('ul',{className:'note-list'},...stagger(card.out.map(o=>line(o,'note-out')),0.8)),
   card.stats.length&&el('ul',{className:'note-stats'},...card.stats.map(st=>el('li',{},`${st.label}: `,el('b',{textContent:st.value})))),
   el('p',{className:'note-line',textContent:card.verdict}),
   foot('story-foot note-foot')));
}
// A locked card: a real card the person can't have yet, saying from real counts what unlocks it.
// Never shared, no thumbs.
const LOCK_ICON='M6 11 L18 11 L18 21 L6 21 Z M8.5 11 L8.5 7.5 C8.5 3.5 15.5 3.5 15.5 7.5 L15.5 11';
function lockedCard(card){
 const lock=el('span',{className:'locked-icon','aria-hidden':'true'},svg('svg',{viewBox:'0 0 24 24',width:24,height:24},svg('path',{d:LOCK_ICON})));
 const teaser=card.card==='inout'
  ?el('div',{className:'locked-teaser locked-note','aria-hidden':'true'},el('span',{textContent:'in: ??????'}),el('span',{textContent:'out: ??????'}),lock)
  :el('div',{className:'locked-teaser locked-dial','aria-hidden':'true'},el('span',{className:'locked-score',textContent:'??'}),lock);
 return el('article',{className:'story-card story-locked','aria-label':`Locked: ${card.title}`},
  teaser,
  el('p',{className:'label locked-label',textContent:'Locked'}),
  el('h2',{className:'display story-title',textContent:card.title}),
  el('p',{className:'locked-why',textContent:card.why}),
  el('div',{className:'locked-actions'},
   el('a',{className:'report-cta report-cta-small locked-cta',href:'/account',textContent:'Connect more orders'}),
   el('p',{className:'locked-hint',textContent:'Or text Jules a photo of an old receipt.'})),
  foot());
}
const RENDER={receipt:receiptCard,gatekeeper:gatekeeperCard,inout:inOutCard,locked:lockedCard};

function renderCard(animate=true){
 const card=report.cards[index];
 $('progress').replaceChildren(...report.cards.map((_,i)=>el('span',{className:i<index?'done':i===index?'current':''})));
 $('progress-label').textContent=`${index+1}/${report.cards.length}`;
 $('arrow-prev').disabled=index===0;
 $('card').replaceChildren(RENDER[card.type](card,animate));
 // Saving a vote or hidden lines redraws the card in place without replaying its entrance.
 $('card').classList.toggle('is-still',!animate);
 const vote=report.votes?.[card.type];
 $('vote-up').setAttribute('aria-pressed',String(vote==='up'));$('vote-down').setAttribute('aria-pressed',String(vote==='down'));
 $('edit-lines').hidden=card.type!=='receipt'||readOnly;
 $('share').hidden=readOnly;
 // An admin preview records nothing: no thumbs, no line edits.
 // A locked card takes no thumbs either: there's nothing to judge yet.
 const quiet=readOnly||card.type==='locked';
 $('vote-up').hidden=$('vote-down').hidden=quiet;
 if($('controls-label'))$('controls-label').hidden=quiet;
 show('view-card');
 // Measured once the card is on screen.
 fitCard();fitChips();
}
function go(i){if(i<0)return;if(i>=report.cards.length){show('view-end');return;}index=i;renderCard();}

async function save(body,done){
 try{const result=await api('POST',{card:report.cards[index].type,...body});report={...result.report,name:report.name};renderCard(false);if(done)toast(done);}
 catch(error){toast(error.message);}
}
$('intro-start').onclick=()=>go(0);
$('tap-next').onclick=()=>go(index+1);
$('tap-prev').onclick=()=>go(index-1);
$('arrow-next').onclick=()=>go(index+1);
$('arrow-prev').onclick=()=>go(index-1);
$('home').append(wordmark());$('chrome-home').append(wordmark());
const exit=person?'/admin':sharedToken?'/':'/wishlist';
// × leaves the whole report (not just the card): back to the wishlist, or to admin for a preview.
$('close').onclick=()=>{location.href=exit;};
$('chrome-close').href=exit;
$('chrome-next').onclick=()=>go(0);
$('chrome-prev').onclick=()=>go(report.cards.length-1);
// Desktop keyboard, while no sheet is open. Cards: arrows move. Intro: → starts.
// End: ← goes back to the last card. Escape always leaves the report.
document.addEventListener('keydown',event=>{
 if(!report||document.querySelector('dialog[open]')||event.altKey||event.ctrlKey||event.metaKey)return;
 const key=event.key;
 if(!$('view-card').hidden){
  if(key==='ArrowRight'){event.preventDefault();go(index+1);}
  else if(key==='ArrowLeft'){event.preventDefault();go(index-1);}
  else if(key==='Escape')location.href=exit;
 }else if(!$('view-intro').hidden){
  if(key==='ArrowRight'){event.preventDefault();go(0);}
  else if(key==='Escape')location.href=exit;
 }else if(!$('view-end').hidden){
  if(key==='ArrowLeft'){event.preventDefault();go(report.cards.length-1);}
  else if(key==='Escape')location.href=exit;
 }
});
$('restart').onclick=()=>go(0);
// Sharing: the person's own choice. The first tap makes an unguessable link; the phone's share sheet
// opens when there is one, otherwise the link is copied. Stop sharing turns the link off for everyone.
const shareUrl=()=>`${location.origin}/r/${report.share.token}`;
async function shareReport(){
 try{
  if(!report.share){const result=await api('POST',{action:'report-share'});report={...result.report,name:report.name};shareStatus();}
  const url=shareUrl();
  if(navigator.share){try{await navigator.share({title:'My style report',text:'Jules went through my orders. What would yours say?',url});return;}catch(error){if(error?.name==='AbortError')return;}}
  try{await navigator.clipboard.writeText(url);toast('Link copied. Anyone with it can see your shared cards.');}
  catch{toast('Here’s your link. Copy it from the end screen.');}
 }catch(error){toast(error.message||'Couldn’t make a link. Try again.');}
}
function shareStatus(){
 $('share-status').hidden=readOnly||!report?.share;
 if(report?.share&&!readOnly){$('share-link').href=shareUrl();$('share-link').textContent=shareUrl().replace(/^https?:\/\//,'');}
}
$('share').onclick=shareReport;$('end-share').onclick=shareReport;
$('unshare').onclick=async()=>{
 try{const result=await api('POST',{action:'report-unshare'});report={...result.report,name:report.name};shareStatus();toast('Link turned off. Nobody can open it now.');}
 catch(error){toast(error.message);}
};
$('vote-up').onclick=()=>save({action:'report-feedback',vote:'up'},'Noted. More like this.');
$('vote-down').onclick=()=>$('sheet-down').showModal();
for(const button of $('sheet-down').querySelectorAll('[data-reason]'))button.onclick=()=>{$('sheet-down').close();save({action:'report-feedback',vote:'down',reason:button.dataset.reason},'Thanks. Jules will do better next time.');};
for(const button of document.querySelectorAll('[data-close]'))button.onclick=()=>button.closest('dialog').close();
for(const dialog of document.querySelectorAll('dialog'))dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});

// Line toggles: every public line plus the private returns line, which starts off.
let draft=null;
$('edit-lines').onclick=()=>{
 const card=report.cards[index];
 draft={hidden:new Set(card.lines.filter(l=>!l.private&&l.hidden).map(l=>l.key)),show_returns:report.show_returns};
 const toggle=line=>{
  const on=()=>line.private?draft.show_returns:!draft.hidden.has(line.key);
  const button=el('button',{type:'button',className:'report-toggle'},el('span',{className:'report-toggle-text'},el('span',{className:'report-toggle-label',textContent:`${line.label} ×${line.n}`}),el('span',{className:'report-toggle-note',textContent:line.private?'Private. Off unless you turn it on.':''})),el('span',{className:'report-switch','aria-hidden':'true'}));
  const sync=()=>button.setAttribute('aria-pressed',String(on()));
  button.onclick=()=>{if(line.private)draft.show_returns=!draft.show_returns;else draft.hidden.has(line.key)?draft.hidden.delete(line.key):draft.hidden.add(line.key);sync();};
  sync();return button;
 };
 $('line-toggles').replaceChildren(...card.lines.map(toggle));
 $('sheet-lines').showModal();
};
$('lines-save').onclick=()=>{$('sheet-lines').close();save({action:'report-lines',hidden:[...draft.hidden],show_returns:draft.show_returns},'Saved.');};

async function signInFromLink(token){
 const response=await fetch('/api/wishlist?phone_login=1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'link',token}),cache:'no-store'});
 const result=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(result.error||'Could not sign you in.');
 session.save(result);
}
const READ_AGAIN_MS=15000;
function opened(result){
 clearInterval(stepTimer);report=result.report;
 // A card this page doesn't draw (for example from an older report) is skipped, never shown broken.
 report={...report,cards:report.cards.filter(c=>RENDER[c.type])};
 if(report.shared){
  // A friend's view: about the person, ending with an invitation to get their own.
  $('intro-eyebrow').textContent=[report.name?`${report.name}’s style report`:'A style report',report.built_at&&day(report.built_at)].filter(Boolean).join(' · ');
  $('intro-title').textContent=report.name?`${report.name}’s style report is in.`:'Someone’s style report is in.';
  $('end-title').textContent=report.name?`That’s ${report.name}’s report.`:'That’s their report.';
  $('end-body').textContent='Jules made it from their shopping history. What would yours say?';
  $('end-cta').textContent='Get your own report ↗';$('end-cta').href='/signup';
  $('end-share').hidden=true;
  if(!report.cards.length){message('Nothing shared here yet.','This report has no cards to show right now.','Style report',{label:'Get your own report ↗',href:'/signup'});return;}
 }else{
  $('intro-eyebrow').textContent=(person?'Admin preview · ':'')+[report.name?`For ${report.name}`:'For you',report.built_at&&day(report.built_at)].filter(Boolean).join(' · ');
  $('end-title').textContent=report.name?`That’s your report, ${report.name}.`:'That’s your report.';
  $('end-share').hidden=readOnly;
 }
 shareStatus();
 show('view-intro');
}
async function load(){
 const result=await api('GET');
 if(result.report)return opened(result);
 if(result.status==='reading'){
  // The import is still going: show how far it has got and check back. The report is built when it
  // finishes, so leaving the page loses nothing.
  const {read=0,total=0}=result.progress??{};
  message('Still reading your orders.',total?`Jules has read ${read.toLocaleString()} of ${total.toLocaleString()} shopping emails. Your report is made as soon as it’s done.`:'Jules is finding your shopping emails. Your report is made as soon as it’s done.','Your style',null,{progress:total?read/total:'waiting'});
  $('message-step').hidden=false;$('message-step').textContent='You can leave this page. It’ll be here under Your style.';
  const again=()=>load().catch(()=>setTimeout(again,READ_AGAIN_MS));setTimeout(again,READ_AGAIN_MS);return;
 }
 const NOT_READY={
  no_history:['Connect your orders first.','Your style report is made from your shopping history. Connect Gmail or Shop and Jules does the rest.',{label:'Connect your orders ↗',href:'/account'}],
  not_enough:['Not enough to go on yet.','Jules needs a few more orders to say anything worth sharing. Connect another account or text Jules a receipt.',{label:'Add more orders ↗',href:'/account'}]};
 const [title,body,action]=NOT_READY[result.status]??['Not ready yet.',person?'This tester has no report yet. Build it from their purchase history.':'Try again in a little while.',null];
 message(title,body,'Your style',action);
}
async function start(){
 if(person)$('message-leave').href='/admin';
 if(sharedToken){
  $('message-leave').href='/';$('message-leave').textContent='← Jules';
  message('One moment…','Opening the style report.','Style report',null,{progress:'waiting'});
  try{await load();}
  catch(error){message(error.status===404?'This link isn’t working.':'Couldn’t open this report.',error.status===404?'It was turned off, or it was never a report link.':error.message,'Style report',{label:'Get your own report ↗',href:'/signup'});}
  return;
 }
 message('One moment…',person?'Opening this tester’s report.':'Getting your style report.','Style report',null,{progress:'waiting',steps:person?[]:['Going through your orders…','Counting what you keep buying…','Writing your receipt…','Nearly there…']});
 if(signinToken){
  // Keep the token out of history and screenshots once it has been used.
  history.replaceState(null,'',location.pathname);
  try{await signInFromLink(signinToken);}catch{if(!session.read()){message('That link has expired.','Log in with your phone to see your report.','Style report',{label:'Log in ↗',href:'/login?next=report'});return;}}
 }
 try{await load();}
 catch(error){
  if(error.status===401||error.status===403)message('Log in to see your report.','It’s private to you.','Style report',{label:'Log in ↗',href:'/login?next=report'});
  else message('Couldn’t open your report.',error.message);
 }
}
start();
