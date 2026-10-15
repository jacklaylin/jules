import {createSession} from './wishlist-session.js';

// The person's private style report: a tap-through story. Cards come from /api/wishlist?report=1;
// thumbs and hidden lines are saved there. Sharing comes later (design/style-report-brief.md).
const $=id=>document.getElementById(id);
const session=createSession({storage:localStorage,lock:work=>navigator.locks?navigator.locks.request('jules-wishlist-refresh',work):work()});
const fragment=new URLSearchParams(location.hash.slice(1)),signinToken=fragment.get('signin');
// Admin preview of a tester's report (/report?person=<id>): read-only, through the owner's admin access.
const person=new URLSearchParams(location.search).get('person');
const el=(tag,props={},...children)=>{const node=Object.assign(document.createElement(tag),props);node.append(...children.filter(c=>c!=null&&c!==false));return node;};
let report=null,index=0;

function show(view){for(const id of ['view-message','view-intro','view-card','view-end'])$(id).hidden=id!==view;}
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
  el('h2',{className:'display story-title',textContent:'We have your receipts (literally)'}),
  el('div',{className:'receipt-roll'},paper,el('div',{className:'receipt-zig','aria-hidden':'true'})),
  el('footer',{className:'story-foot'},wordmark()));
}
const RENDER={receipt:receiptCard};
const CARD_NAMES={receipt:'Receipt'};

function renderCard(animate=true){
 const card=report.cards[index];
 $('progress').replaceChildren(...report.cards.map((_,i)=>el('span',{className:i<index?'done':i===index?'current':''})));
 $('progress-label').textContent=`Card ${index+1} of ${report.cards.length} · ${CARD_NAMES[card.type]??''}`;
 $('arrow-prev').disabled=index===0;
 $('card').replaceChildren(RENDER[card.type](card));
 // Saving a vote or hidden lines redraws the card in place without replaying its entrance.
 $('card').classList.toggle('is-still',!animate);
 const vote=report.votes?.[card.type];
 $('vote-up').setAttribute('aria-pressed',String(vote==='up'));$('vote-down').setAttribute('aria-pressed',String(vote==='down'));
 $('edit-lines').hidden=card.type!=='receipt'||Boolean(person);
 // An admin preview records nothing: no thumbs, no line edits.
 $('vote-up').hidden=$('vote-down').hidden=Boolean(person);
 show('view-card');
}
function go(i){if(i<0)return;if(i>=report.cards.length){show('view-end');return;}index=i;renderCard();}

async function save(body,done){
 try{const result=await api('POST',{card:report.cards[index].type,...body});report={...result.report,name:report.name};renderCard(false);if(done)toast(done);}
 catch(error){toast(error.message);}
}
$('intro-start').onclick=()=>go(0);
$('tap-next').onclick=()=>go(index+1);
$('tap-prev').onclick=()=>go(index-1);
$('close').onclick=()=>show('view-end');
$('arrow-next').onclick=()=>go(index+1);
$('arrow-prev').onclick=()=>go(index-1);
$('home').append(wordmark());
// Desktop keyboard: arrows move between cards, Escape closes, while a card shows and no sheet is open.
document.addEventListener('keydown',event=>{
 if($('view-card').hidden||document.querySelector('dialog[open]')||event.altKey||event.ctrlKey||event.metaKey)return;
 if(event.key==='ArrowRight'){event.preventDefault();go(index+1);}
 else if(event.key==='ArrowLeft'){event.preventDefault();go(index-1);}
 else if(event.key==='Escape')show('view-end');
});
$('restart').onclick=()=>go(0);
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
 $('intro-eyebrow').textContent=(person?'Admin preview · ':'')+[report.name?`For ${report.name}`:'For you',report.built_at&&day(report.built_at)].filter(Boolean).join(' · ');
 $('end-title').textContent=report.name?`That’s your report, ${report.name}.`:'That’s your report.';
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
