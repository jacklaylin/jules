import {mountAdminShell,adminJson} from './admin-console.js';
// Admin › Report jokes: the week's best and worst style report lines (lib/report-copy.js copyWeek).
// Read-only. Patterns found here become written voice rules by hand; votes never rewrite rules.
mountAdminShell('jokes');
const $=id=>document.getElementById(id);
const el=(tag,props={},...children)=>{const node=Object.assign(document.createElement(tag),props);node.append(...children.filter(c=>c!=null));return node;};
const CARD={receipt:'Receipt',gatekeeper:'Gatekeeper',inout:'In / Out',emoji:'Emojis',match:'Style match',read:'The Read',judges:'Judges'};
const REASON={wrong:'wrong',not_funny:'not funny',wont_share:'wouldn’t share'};
const SOURCE={generated:'AI',prewritten:'pre-written',fact:'plain fact'};
const votes=l=>`👍 ${l.ups} · 👎 ${l.downs}`;
function lines(list,empty){
 const head=el('div',{className:'dv-head',ariaHidden:'true'},el('span',{textContent:'Card'}),el('span',{textContent:'Line'}),el('span',{className:'end',textContent:'Votes'}));
 const rows=list.map(l=>el('div',{className:'dv-row'},
  el('span',{className:'muted',textContent:CARD[l.card]??l.card}),
  el('span',{className:'jokes-line'},el('strong',{textContent:l.text}),el('small',{textContent:`${SOURCE[l.source]??l.source} · prompt ${l.prompt??'—'} · shown to ${l.shown} · ${l.fact??''}`}),
   Object.keys(l.reasons??{}).length?el('small',{textContent:'why: '+Object.entries(l.reasons).map(([r,n])=>`${REASON[r]??r} ×${n}`).join(', ')}):null),
  el('span',{className:'end',textContent:votes(l)})));
 return [head,...rows,...(list.length?[]:[el('p',{className:'dv-empty',textContent:empty})])];
}
async function load(){
 try{
  const week=await adminJson('/api/admin?view=report-copy');
  $('best').replaceChildren(...lines(week.best,'No 👍-only lines this week.'));
  $('worst').replaceChildren(...lines(week.worst,'No 👎 this week.'));
  const head=el('div',{className:'dv-head',ariaHidden:'true'},el('span',{textContent:'Card'}),el('span',{textContent:'Prompt'}),el('span',{className:'end',textContent:'Shown · AI'}),el('span',{className:'end',textContent:'Votes'}));
  $('prompts').replaceChildren(head,...week.prompts.map(p=>el('div',{className:'dv-row'},el('span',{textContent:CARD[p.card]??p.card}),el('span',{className:'muted',textContent:p.prompt??'—'}),el('span',{className:'end',textContent:`${p.shown} · ${p.generated}`}),el('span',{className:'end',textContent:votes(p)}))),
   ...(week.prompts.length?[]:[el('p',{className:'dv-empty',textContent:'No reports built this week.'})]));
  $('summary').textContent=`Since ${new Date(week.since).toLocaleDateString(undefined,{month:'short',day:'numeric'})}`;
 }catch(error){$('notice').className='error';$('notice').textContent=`Could not load the jokes: ${error.message}`;}
}
load();
