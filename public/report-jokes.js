import {mountAdminShell,adminJson,adminToken,skeletonRows,metricCell} from './admin-console.js';
import {readPage,savePage,sameData} from './list-cache.js';
// Admin › Style report. Engagement (lib/report-adoption.js): opens, shares, friends' opens, signups and votes,
// compared with the period before. Jokes (lib/report-copy.js copyWeek): the week's best and worst lines.
// Read-only. Only the open view's data is requested; a return visit draws the last engagement report at once.
mountAdminShell('style-report');
const $=id=>document.getElementById(id);
const el=(tag,props={},...children)=>{const node=Object.assign(document.createElement(tag),props);node.append(...children.filter(c=>c!=null));return node;};
const CARD={receipt:'Receipt',gatekeeper:'Gatekeeper',inout:'In / Out',emoji:'Emojis',spectrum:'Spectrum',match:'Style match',read:'The Read',judges:'Judges'};
const REASON={wrong:'Wrong',not_funny:'Not funny',wont_share:'Wouldn’t share'};
const SOURCE={generated:'AI',prewritten:'pre-written',fact:'plain fact'};
const METHOD={copy:['Copy link','is-ink'],story:['Image share','is-grape'],share_sheet:['Share sheet','is-strong'],download:['Download','is-line']};
const pct=v=>v==null?'—':`${Math.round(v*100)}%`;
const cell=(text,className='')=>el('td',{className,textContent:text});
const muted=text=>el('span',{className:'muted',textContent:text});
const clock=at=>new Date(at).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});

// ---------- Views ----------
let view=new URLSearchParams(location.search).get('view')==='jokes'?'jokes':'';
function showView(){
 for(const b of $('views').querySelectorAll('button'))b.setAttribute('aria-pressed',String(b.dataset.view===view));
 $('view-engagement').hidden=view==='jokes';$('view-jokes').hidden=view!=='jokes';$('compare-field').hidden=view==='jokes';
 $('heading-note').textContent=view==='jokes'?'Thumbs on report lines, last 7 days':'How reports are opened, shared and voted on';
 $('refreshed').textContent='';$('notice').textContent='';
 (view==='jokes'?loadJokes:loadEngagement)();
}
for(const b of $('views').querySelectorAll('button'))b.onclick=()=>{
 view=b.dataset.view;const url=new URL(location.href);
 if(view)url.searchParams.set('view',view);else url.searchParams.delete('view');
 history.replaceState(null,'',url);showView();
};

// ---------- SplitBar ----------
// Parts are [count, colour class]; widths go through the style object (the CSP blocks style attributes).
function splitBar(label,parts,{compact=false}={}){
 const bar=el('div',{className:`split-bar__bar${compact?' split-bar--compact':''}`,role:'img',ariaLabel:label});
 for(const [n,tone] of parts)if(n){const part=el('span',{className:tone});part.style.flexGrow=String(n);bar.append(part);}
 return bar;
}
function splitBlock(label,parts,total){
 const sum=parts.reduce((n,p)=>n+p.n,0);
 return el('div',{className:'split-bar'},splitBar(label,parts.map(p=>[p.n,p.tone])),
  el('p',{className:'split-bar__legend'},...parts.map(p=>el('span',{},el('i',{className:p.tone,ariaHidden:'true'}),el('strong',{textContent:String(p.n)}),` ${p.name} `,muted(`(${sum?Math.round(p.n/sum*100):0}%)`))),muted(total)));
}

// ---------- Engagement ----------
let report=null,refreshedAt=0,loading=false;
const period=()=>$('compare').value;
function busy(on){for(const id of ['strip','card-methods','card-cards','card-weeks'])$(id).toggleAttribute('aria-busy',on);}
function skeletons(){
 $('strip').replaceChildren(...['Reports built','Opened','Started a share','Friends opened','Signups','Votes up'].map(label=>{const bar=el('span',{className:'skeleton skeleton-bar',ariaHidden:'true'});bar.style.width='48px';return el('div',{className:'dv-metric'},el('span',{textContent:label}),bar);}));
 $('methods-rows').replaceChildren(...skeletonRows(3,7));$('cards-rows').replaceChildren(...skeletonRows(3,5));$('weeks-rows').replaceChildren(...skeletonRows(3,7));
}
function renderEngagement(){
 if(!report)return;
 const p=report.periods[period()];busy(false);
 $('strip').replaceChildren(...p.strip.map(c=>metricCell(c)));
 // How they shared.
 const m=p.methods;
 $('methods-note').textContent=m.total?`${m.total} share ${m.total===1?'tap':'taps'} by ${m.testers} ${m.testers===1?'tester':'testers'} · friends opened shows which shares went out`:'no share taps in this period';
 // The bar shows what came back: friends who opened each method's links (taps are only attempts).
 const back=m.rows.reduce((n,r)=>n+r.friends,0);
 $('methods-bar').replaceChildren(...(back?[splitBlock('Friends opened by method: '+m.rows.map(r=>`${METHOD[r.channel][0]} ${r.friends}`).join(', '),m.rows.map(r=>({n:r.friends,name:METHOD[r.channel][0].toLowerCase(),tone:METHOD[r.channel][1]})),`${back} ${back===1?'friend':'friends'} opened`)]:[]));
 $('methods-rows').replaceChildren(...m.rows.map(r=>el('tr',{},el('th',{scope:'row'},el('i',{className:`method-key ${METHOD[r.channel][1]}`,ariaHidden:'true'}),METHOD[r.channel][0]),
  cell(String(r.friends),'end'),cell(r.per_share==null?'—':String(r.per_share),'end'),cell(String(r.signups),'end'),cell(String(r.shares),'end muted'),cell(pct(r.share),'end muted'),cell(String(r.testers),'end muted'))));
 const unknown=m.unknown.friends||m.unknown.signups;
 $('methods-foot').hidden=!unknown;
 $('methods-foot').textContent=unknown?`Not split by method: ${m.unknown.friends} ${m.unknown.friends===1?'friend’s open':'friends’ opens'} and ${m.unknown.signups} ${m.unknown.signups===1?'signup':'signups'} from links shared before links said how they were shared.`:'';
 // By card.
 const c=p.cards,votes=c.up+c.down;
 $('cards-bar').replaceChildren(...(votes?[splitBlock(`All card votes: ${c.up} up, ${c.down} down`,[{n:c.up,name:'up',tone:'is-up'},{n:c.down,name:'down',tone:'is-down'}],`${votes} ${votes===1?'vote':'votes'} on ${c.rows.filter(r=>r.up+r.down).length} cards`)]:[]));
 $('cards-rows').replaceChildren(...c.rows.map(r=>{
  const n=r.up+r.down;
  const vote=!n?muted('No votes'):r.up_share==null?el('span',{},'Too few votes ',muted(`· ${r.up} up, ${r.down} down`))
   :el('span',{className:'split-cell'},splitBar(`${r.up} up, ${r.down} down`,[[r.up,'is-up'],[r.down,'is-down']],{compact:true}),el('span',{className:'nowrap'},el('strong',{textContent:pct(r.up_share)}),' up ',muted(`· ${r.up} up, ${r.down} down`)));
  const why=Object.entries(r.reasons).map(([k,v])=>`${REASON[k]??k} ${v}`).join(' · ')||'—';
  return el('tr',{},el('th',{scope:'row',textContent:CARD[r.card]??r.card}),cell(c.tracked||r.seen?String(r.seen):'not tracked','end'),el('td',{},vote),cell(why),cell(c.tracked||r.images?String(r.images):'not tracked','end'));
 }),...(c.rows.length?[]:[el('tr',{},el('td',{colSpan:5,className:'dv-empty',textContent:'No cards reached, voted on or shared in this period.'}))]));
 // By week.
 const nt='not tracked';
 $('weeks-rows').replaceChildren(...report.weeks.map(w=>el('tr',{className:w.current?'current':''},
  el('th',{scope:'row',textContent:w.current?'This week':new Date(w.week_of+'T12:00:00Z').toLocaleDateString(undefined,{month:'short',day:'numeric',timeZone:'UTC'})}),
  cell(String(w.built),'end'),
  w.tracked?el('td',{className:'end'},String(w.opened),muted(` · ${w.opens} ${w.opens===1?'visit':'visits'}`)):cell(nt,'end muted'),
  w.tracked?el('td',{className:'end'},String(w.shared),muted(` · ${w.shares} ${w.shares===1?'tap':'taps'}`)):cell(nt,'end muted'),
  w.tracked?cell(String(w.friends),'end'):cell(nt,'end muted'),
  cell(String(w.signups),'end'),cell(w.up+w.down?`${w.up} up · ${w.down} down`:'—','end'))));
 $('refreshed').textContent=refreshedAt?`Updated ${clock(refreshedAt)}`:'';
}
async function loadEngagement(){
 if(loading)return;loading=true;
 $('notice').textContent='';$('notice').className='';
 const token=await adminToken().catch(()=>null);
 if(!report){const saved=readPage(localStorage,'admin_style_report',token);if(saved){report=saved.data;refreshedAt=saved.at;renderEngagement();}else{busy(true);skeletons();}}
 else renderEngagement();
 // A refresh behind content already on screen says so in words.
 $('loader').hidden=!report;
 try{
  const fresh=await adminJson('/api/admin?view=style-report'),same=sameData(fresh,report);
  report=fresh;refreshedAt=Date.now();savePage(localStorage,'admin_style_report',token,fresh);
  if(same)$('refreshed').textContent=`Updated ${clock(refreshedAt)}`;else renderEngagement();
 }catch(error){
  $('notice').className='error';
  $('notice').textContent=report?`Could not refresh: ${error.message} Showing the numbers from ${clock(refreshedAt)}.`:`Could not load the style report numbers: ${error.message} Try Refresh.`;
  if(!report){busy(false);for(const id of ['strip','methods-rows','cards-rows','weeks-rows'])$(id).replaceChildren();}
 }finally{$('loader').hidden=true;loading=false;}
}
$('compare').onchange=renderEngagement;

// ---------- Jokes ----------
let jokes=null;
const votes=l=>`${l.ups} up · ${l.downs} down`;
function lines(list,empty){
 const head=el('div',{className:'dv-head',ariaHidden:'true'},el('span',{textContent:'Card'}),el('span',{textContent:'Line'}),el('span',{className:'end',textContent:'Votes'}));
 const rows=list.map(l=>el('div',{className:'dv-row'},
  el('span',{className:'muted',textContent:CARD[l.card]??l.card}),
  el('span',{className:'jokes-line'},el('strong',{textContent:l.text}),el('small',{textContent:`${SOURCE[l.source]??l.source} · prompt ${l.prompt??'—'} · shown to ${l.shown} · ${l.fact??''}`}),
   Object.keys(l.reasons??{}).length?el('small',{textContent:'why: '+Object.entries(l.reasons).map(([r,n])=>`${(REASON[r]??r).toLowerCase()} ×${n}`).join(', ')}):null),
  el('span',{className:'end',textContent:votes(l)})));
 return [head,...rows,...(list.length?[]:[el('p',{className:'dv-empty',textContent:empty})])];
}
function renderJokes(){
 $('best').replaceChildren(...lines(jokes.best,'No lines with only thumbs up this week.'));
 $('worst').replaceChildren(...lines(jokes.worst,'No thumbs down this week.'));
 const head=el('div',{className:'dv-head',ariaHidden:'true'},el('span',{textContent:'Card'}),el('span',{textContent:'Prompt'}),el('span',{className:'end',textContent:'Shown · AI'}),el('span',{className:'end',textContent:'Votes'}));
 $('prompts').replaceChildren(head,...jokes.prompts.map(p=>el('div',{className:'dv-row'},el('span',{textContent:CARD[p.card]??p.card}),el('span',{className:'muted',textContent:p.prompt??'—'}),el('span',{className:'end',textContent:`${p.shown} · ${p.generated}`}),el('span',{className:'end',textContent:votes(p)}))),
  ...(jokes.prompts.length?[]:[el('p',{className:'dv-empty',textContent:'No reports built this week.'})]));
 $('refreshed').textContent=`Since ${new Date(jokes.since).toLocaleDateString(undefined,{month:'short',day:'numeric'})}`;
}
async function loadJokes(force=false){
 if(jokes&&!force){renderJokes();return;}
 if(!jokes)for(const id of ['best','worst','prompts'])$(id).replaceChildren(...skeletonRows(3));
 try{jokes=await adminJson('/api/admin?view=report-copy');if(view==='jokes')renderJokes();}
 catch(error){if(!jokes)for(const id of ['best','worst','prompts'])$(id).replaceChildren();$('notice').className='error';$('notice').textContent=`Could not load the jokes: ${error.message} Try Refresh.`;}
}
$('refresh').onclick=()=>view==='jokes'?loadJokes(true):loadEngagement();
showView();
