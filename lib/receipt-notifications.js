import {deliverReply} from './replies.js';
import {sendGreeting} from './photon.js';
import {loadReceipts} from './evidence.js';
import {projectReceiptState,merchantKey} from './receipt-extraction.js';
import {effectiveRecipient,folded} from './receipt-feedback.js';
import {outfitReading} from './outfit-photos.js';
import {withUsage} from './usage.js';
import {CATEGORY_FOR,tagFingerprint,withoutBasics} from './item-tags.js';
export {withoutBasics};

// Texts after an import, in order: one completion count covering every source read in that round
// (Gmail and connected sources such as Shop), then straight away a short "who you are" summary (or the
// early read, when coverage is thin) from what Jules has at that point, then the open receipt questions
// one at a time and the style interview, which sharpen it. Each text is sent once per import through
// the message ledger.
export async function receiptNotification(store,owner,env,stage,body,send=sendGreeting,facts={}){
 const operation=`gmail:${owner}:${stage}`,existing=await store.operation(operation);
 if(existing)return existing;
 const conversation=await store.conversation(owner);
 return deliverReply({store,send,conversation,operation,body,source:'operator',env,facts});
}
const plural=(n,word)=>`${n} ${word}${n===1?'':'s'}`;
// Purchases that count: not removed, not a duplicate, not cancelled.
function activeItems(state){return projectReceiptState(state).items.filter(i=>!i.purchase_disputed&&!folded(i));}
// What was read, as the person would name it: "your shopping emails and Shop orders".
const READ={gmail:'shopping emails',shop:'Shop orders'};
function readList(sources){
 const names=sources.map(s=>READ[s]??`${s} history`);
 return 'your '+(names.length>1?names.slice(0,-1).join(', ')+' and '+names.at(-1):names[0]??'shopping history');
}
// summary: the "who you are" text follows the count, so the lead-in to the questions belongs to it.
export function completionText(state,sources=['gmail'],{summary=false}={}){
 const items=activeItems(state),returns=items.filter(i=>['returned','return_requested'].includes(i.outcome?.value)).length;
 const open=state.questions.some(q=>q.status==='open'),read=readList(sources);
 if(!items.length)return `done reading ${read}. i didn’t find any clothing purchases i could confirm. send me a photo or link anytime and i’ll learn your taste as we go.`;
 return `done reading ${read}. i found ${plural(items.length,'clothing purchase')}${returns?` and ${plural(returns,'return')}`:''}.`+(open&&!summary?' a few quick questions so i get the details right:':'');
}
// The import round a completion text covers. A Gmail import names the round (the 24-hour profile
// fallback keys on it); without one, the newest connected-source import does. Sources finished in the
// round are named in the text; a source still waiting for approval past the cutoff is left out.
// done: the round's Gmail import has finished (a round without Gmail is done when its source is).
export function importRound(data){
 const job=data?.job,finished=Object.entries(data?.connections??{}).filter(([,c])=>c?.status==='ready'&&c.imported_at);
 if(job?.started_at){
  const since=Date.parse(job.started_at);
  return {key:job.started_at,done:job.status==='ready',sources:['gmail',...finished.filter(([,c])=>!(Date.parse(c.imported_at)<since)).map(([name])=>name)]};
 }
 const latest=finished.sort((a,b)=>Date.parse(b[1].imported_at)-Date.parse(a[1].imported_at))[0];
 return latest?{key:`${latest[0]}:${latest[1].imported_at}`,done:true,sources:[latest[0]]}:null;
}
// Display name for a brand or store: legal-entity and storefront suffixes are formatting, not part
// of the name ("MFPEN Retail ApS" -> "MFPEN").
const display=name=>name.replace(/\s*\((?:u\.?s\.?a\.?|uk|us)\)/gi,'').replace(/(?:,?\s+(?:retail|aps|a\/s|ab|ag|gmbh|inc\.?|llc|ltd\.?|limited|sas|s\.?a\.?|b\.?v\.?|co\.?))+\s*$/i,'').trim()||name;
function top(items,field,limit){
 const groups=new Map();
 for(const item of items){const name=item[field];const key=merchantKey(name);if(!key)continue;
  const g=groups.get(key)??{name:display(name),count:0};g.count++;if(display(name).length<g.name.length)g.name=display(name);groups.set(key,g);}
 return [...groups.values()].sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name)).slice(0,limit).map(g=>g.name);
}
// Typical price per item from receipt-quoted prices: the middle half (25th to 75th percentile) in the
// currency with the most priced purchases, needing at least 3. Currencies are never converted.
const MONEY={USD:'$',$:'$',EUR:'€',GBP:'£'};
const nice=n=>n<20?Math.round(n):n<200?Math.round(n/10)*10:Math.round(n/50)*50;
// outlier: also name the most they paid when it is well above the usual range (at least 1.5 times its top),
// so one splurge is told apart from the usual spend (October 21 founder feedback).
export function priceRange(items,{outlier=false}={}){
 const byCurrency=new Map();
 for(const i of items)if(i.price?.amount>0&&i.price.currency)byCurrency.set(i.price.currency,[...(byCurrency.get(i.price.currency)??[]),i.price.amount]);
 const [currency,amounts]=[...byCurrency.entries()].sort((a,b)=>b[1].length-a[1].length)[0]??[];
 if(!amounts||amounts.length<3)return null;
 const sorted=[...amounts].sort((a,b)=>a-b),at=q=>{const pos=q*(sorted.length-1),i=Math.floor(pos);return sorted[i]+(sorted[Math.min(i+1,sorted.length-1)]-sorted[i])*(pos-i);};
 const low=nice(at(0.25)),high=nice(at(0.75)),money=n=>MONEY[currency]?`${MONEY[currency]}${n.toLocaleString('en-US')}`:`${n.toLocaleString('en-US')} ${currency}`;
 const range=low===high?`around ${money(low)}`:`${money(low)}–${money(high)}`,most=sorted.at(-1);
 return outlier&&most>=1.5*at(0.75)&&nice(most)>high?`${range}, sometimes as much as ${money(nice(most))}`:range;
}
// A tag counts only while it still matches the item's details (item-tags.js fingerprint).
const tagOf=(item,tags)=>{const t=tags?.[item.id];return t&&t.fp===tagFingerprint(item)?t:null;};
// Sizes by category, as people say them ("tops L/XL, bottoms 32"): the two most bought per category,
// most bought categories first. Without any tagged category, the most bought sizes as before.
const SIZE_GROUPS={tops:'tops',bottoms:'bottoms',outerwear:'outerwear',suits:'suits',activewear:'activewear',shoes:'shoes',dresses:'dresses',swimwear:'swimwear'};
function sizesByCategory(items,tags){
 const counts=(list,key)=>list.reduce((m,i)=>{const k=key(i),s=i.size_label?.trim();if(k&&s){m[k]??={n:0,sizes:{}};m[k].n++;m[k].sizes[s]=(m[k].sizes[s]??0)+1;}return m;},{});
 const ranked=sizes=>Object.entries(sizes).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).map(([s])=>s);
 // The two most bought, written smallest first (31/32, L/XL); a label outside the scale keeps its place.
 const LETTERS=['XXS','XS','S','M','L','XL','XXL','XXXL'],rank=s=>Number.isFinite(Number(s))?Number(s):LETTERS.includes(s.toUpperCase())?1000+LETTERS.indexOf(s.toUpperCase()):null;
 const ordered=list=>list.every(s=>rank(s)!==null)?[...list].sort((a,b)=>rank(a)-rank(b)):list;
 const byCategory=Object.entries(counts(items,i=>SIZE_GROUPS[CATEGORY_FOR[tagOf(i,tags)?.group]]));
 if(byCategory.length)return byCategory.sort((a,b)=>b[1].n-a[1].n).slice(0,3).map(([c,g])=>`${c} ${ordered(ranked(g.sizes).slice(0,2)).join('/')}`).join(', ');
 const all=counts(items,()=>'all').all;
 return all?ranked(all.sizes).slice(0,4).join(', '):null;
}
// Purchased sizes are what they bought, not a confirmed fit; gifts and removed items don't count.
// outfits: observations read from the person's own outfit photos, added as their own lines.
// A store that is also one of the brands named (a brand's own shop) is not named twice.
export function profileText(state,outfits=[],{tags={}}={}){
 const items=withoutBasics(activeItems(state).filter(i=>effectiveRecipient(i).value!=='other'),tags);
 const worn=outfits.map(o=>o.text);
 if(items.length<2){
  if(!worn.length)return null;
  return `here’s what i’m learning about your style from your outfit photos:\n${worn.join('\n')}\ntell me anytime if something’s off.`;
 }
 const brands=top(items,'brand',4),named=new Set(brands.map(merchantKey)),stores=top(items,'merchant',3+brands.length).filter(s=>!named.has(merchantKey(s))).slice(0,3);
 const sizes=sizesByCategory(items,tags);
 const spend=priceRange(items,{outlier:true});
 const lines=[brands.length&&`brands you buy most: ${brands.join(', ')}`,stores.length&&`${brands.length?'other stores you buy from':'where you shop'}: ${stores.join(', ')}`,sizes&&`sizes you’ve bought: ${sizes}`,spend&&`what you usually spend: ${spend} per item`].filter(Boolean);
 if(!lines.length&&!worn.length)return null;
 if(!worn.length)return `here’s what your purchases show so far:\n${lines.join('\n')}\ntell me anytime if something’s off.`;
 return `here’s what your purchases and outfit photos show so far:\n${[...lines,`what you wear: ${worn.join('; ')}`].join('\n')}\ntell me anytime if something’s off.`;
}
async function importState(store,owner){
 const row=await store.gmailImport(owner),round=importRound(row?.data);
 if(!round)return null;
 return {row,round,state:(await loadReceipts(store,owner,row)).state};
}
// Ends the summary when questions follow it, so they read as sharpening it rather than starting over.
export const SHARPEN='a few quick questions will sharpen it.';
// What the summary would say now, without sending anything: the early read when coverage is thin
// (lib/early-read.js), otherwise the purchase summary; null when there is nothing honest to say.
// Outfit photos already sent (texted during the import or uploaded on /style) are read here, once.
export async function profileSummary(store,owner,env,{round,state,row},{reading=outfitReading}={}){
 const outfits=await withUsage({store,env,conversation:owner,operation:'outfit-reading:'+round.key,feature:'style_reading'},()=>reading(store,owner,env)).catch(()=>[]);
 const early=await import('./early-read.js').then(m=>m.earlyReadFor(store,owner,env,{outfitLines:outfits.map(o=>o.text)})).catch(()=>{console.log(JSON.stringify({event:'early_read_failed'}));return null;});
 // Fewer than 2 purchases says too little on its own: an early read from orders alone waits, like the
 // purchase summary (what they told Jules, saved or wore still counts).
 const ordersOnly=early&&early.sources.every(s=>s==='your orders')&&activeItems(state).filter(i=>effectiveRecipient(i).value!=='other').length<2;
 const body=ordersOnly?null:early?.text??profileText(state,outfits,{tags:row?.data?.item_tags??{}});if(!body)return null;
 // Questions follow when a receipt question is open or the import's interview would ask one.
 const follows=state.questions.some(q=>q.status==='open')||await interviewWouldAsk(store,owner,env,round).catch(()=>false);
 return {body:follows?body+'\n'+SHARPEN:body,kind:early?'early_read':'purchases',level:early?.level??null,sources:early?.sources??null,follows};
}
async function interviewWouldAsk(store,owner,env,round){
 const interview=await import('./interview.js');
 const outfitAsked=(await store.operation(`gmail:${owner}:outfits:${round.key}`))?.status==='sent';
 return interview.importWouldAsk(store,owner,env,{outfitAsked});
}
// The summary goes right after the completion text, never before it, and once per import. It no longer
// waits for outfit photos or the interview: the questions follow it. prepared: the summary the caller
// already worked out (announceImport does, so the count text knows a summary follows). report false:
// the caller sends the report link itself once the questions are done (nextReceiptQuestion).
export async function sendProfile(store,owner,env,send=sendGreeting,loaded=null,{reading=outfitReading,prepared,report=true}={}){
 const current=loaded??await importState(store,owner);if(!current)return null;
 const {round}=current;
 if(!round.done||(await store.operation(`gmail:${owner}:ready:${round.key}`))?.status!=='sent')return null;
 // Already sent: the report link may still be waiting for the last question to close.
 if(await store.operation(`gmail:${owner}:profile:${round.key}`)){if(report)await reportAfterSummary(store,owner,env,send);return null;}
 const summary=prepared!==undefined?prepared:await profileSummary(store,owner,env,current,{reading});
 if(!summary)return null;
 console.log(JSON.stringify({event:'profile_summary',kind:summary.kind,level:summary.level,sources:summary.sources,follows:summary.follows}));
 // The brands and stores the summary can name, so the writer names each one once (lib/compose.js).
 const names=[...new Set(activeItems(current.state).flatMap(i=>[i.brand,i.merchant]).filter(n=>typeof n==='string'&&n.trim()).map(n=>display(n.trim())))].slice(0,60);
 const result=await receiptNotification(store,owner,env,'profile:'+round.key,summary.body,send,{names});
 if(report&&result?.status==='sent')await reportAfterSummary(store,owner,env,send);
 return result;
}
// Whether this import round's summary went out (the interview's close checks it).
export async function profileSent(store,owner){
 const round=importRound((await store.gmailImport(owner))?.data);
 return Boolean(round&&(await store.operation(`gmail:${owner}:profile:${round.key}`))?.status==='sent');
}
// The first style report link follows the summary (lib/style-report.js autoSendReport). A missing report
// is prepared the way the import worker does it (tags first), so the worker's own build then has nothing to add.
async function reportAfterSummary(store,owner,env,send){
 try{
  const prepare=()=>import('./gmail-worker.js').then(m=>m.prepareReport(store,owner,env,{rebuild:false,autoSend:null}));
  await import('./style-report.js').then(m=>m.autoSendReport(store,owner,env,{send,prepare}));
 }catch{console.log(JSON.stringify({event:'style_report_auto_failed'}));}
}
// After outfit photos are kept in chat while no question is open: a summary that could not be sent
// after the count (too little to say then) goes out now; otherwise the report link may follow.
export async function profileAfterOutfits(store,owner,env,send=sendGreeting){
 try{
  const current=await importState(store,owner);if(!current||current.state.questions.some(q=>q.status==='open'))return null;
  return await sendProfile(store,owner,env,send,current);
 }catch{console.log(JSON.stringify({event:'outfit_profile_failed'}));return null;}
}
// deliver false: nothing is sent. When the summary is already out and the next step is an open question
// not yet asked, the question is recorded as asked (a 'blocked' ledger row: recorded, never sent on its
// own, so history keeps only the reply that carries it) and returned as {question, text, status:'joined'}
// for the chat turn to send in its reply. Anything else returns {deferred:true} for the usual call after.
export async function nextReceiptQuestion(store,owner,env,send=sendGreeting,{prepared,deliver=true}={}){
 const current=await importState(store,owner);if(!current)return null;
 if(!deliver)return joinQuestion(store,owner,current);
 // The summary first (a no-op once sent); the questions then sharpen it.
 const summary=await sendProfile(store,owner,env,send,current,{prepared,report:false});
 const question=current.state.questions.find(q=>q.status==='open');
 // The persisted question ID and outbound message retain the original item scope.
 // Keyed by import, so a question still unanswered from an earlier import is asked again once.
 if(question)return receiptNotification(store,owner,env,`question:${current.round.key}:${question.id}`,question.question,send);
 const interview=await interviewFirst(store,owner,env,send,current).catch(()=>{console.log(JSON.stringify({event:'interview_start_failed'}));return null;});
 if(interview)return interview;
 // Onboarding's questions are done: the first report link can follow (lib/style-report.js autoSendReport).
 if((await store.operation(`gmail:${owner}:profile:${current.round.key}`))?.status==='sent')await reportAfterSummary(store,owner,env,send);
 return summary;
}
async function joinQuestion(store,owner,{round,state}){
 const deferred={deferred:true},sent=async stage=>(await store.operation(`gmail:${owner}:${stage}:${round.key}`))?.status==='sent';
 if(!round.done||!await sent('ready')||!await sent('profile'))return deferred;
 const question=state.questions.find(q=>q.status==='open');if(!question)return deferred;
 const operation=`gmail:${owner}:question:${round.key}:${question.id}`;
 // The reservation is the once-only claim: a question already asked (or claimed by a parallel send) is left to it.
 if(!await store.reserve(owner,operation,question.question,'operator'))return deferred;
 await store.finish(operation,'blocked');
 return {question:question.id,text:question.question,status:'joined'};
}
// After the receipt questions, gaps in the taste profile get a few interview questions (lib/interview.js).
// Only for someone who has never had an interview; the report link waits while a round is open.
async function interviewFirst(store,owner,env,send,{round}){
 const interview=await import('./interview.js');
 if(!interview.interviewEnabled(store,env))return null;
 if((await store.operation(`gmail:${owner}:ready:${round.key}`))?.status!=='sent')return null;
 const {state}=await store.interview(owner);
 if(interview.interviewOpen(state))return {status:'interview_open'};
 if(state.batches?.length||state.declined_at)return null;
 const outfitAsked=(await store.operation(`gmail:${owner}:outfits:${round.key}`))?.status==='sent';
 const result=await interview.startInterview(store,owner,env,'import',{send,outfitAsked});
 return result?.question?result:null;
}
// Completion: the count text, then the summary, then the first question. Called whenever the
// round may have settled; the ledger makes it once per round. A source that finishes after its round
// was announced (approval came after the cutoff) continues with its questions instead.
export async function announceImport(store,owner,env,send=sendGreeting){
 const row=await store.gmailImport(owner),round=importRound(row?.data);if(!round?.done)return null;
 const operation='ready:'+round.key,existing=await store.operation(`gmail:${owner}:${operation}`);
 if(existing){if(existing.status==='sent')await nextReceiptQuestion(store,owner,env,send);return {...existing,duplicate:true};}
 const {state}=await loadReceipts(store,owner,row);
 // Worked out before the count (nothing is sent yet), so the count knows whether a summary follows it.
 // A failure leaves it undefined, so the summary is worked out again after the count.
 const prepared=await profileSummary(store,owner,env,{round,state}).catch(()=>undefined);
 const result=await receiptNotification(store,owner,env,operation,completionText(state,round.sources,{summary:Boolean(prepared)}),send);
 // Observability only: how much of the taste profile this import filled (lib/coverage.js). Never blocks the texts.
 if(result.status==='sent')await import('./coverage.js').then(m=>m.logCoverage(store,owner,'import_ready')).catch(()=>{});
 if(result.status==='sent')await nextReceiptQuestion(store,owner,env,send,{prepared});
 return result;
}
