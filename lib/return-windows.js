import {localDay,nudgeTimezone,FALLBACK} from './nudges.js';
import {removalReason} from './wardrobe.js';
import {projectReceiptState,returnRecords,RECEIPT_SCHEMA,RECEIPT_PROMPT,receiptModel,purchaseEvidence} from './receipt-extraction.js';
import {loadReceipts} from './evidence.js';
import {accessToken,openToken,gmailGet,gmailLinked,recordGmailReconnect} from './gmail-client.js';
import {prepareReceiptEmail} from './receipt-email.js';
import {modelSource} from './order-media.js';
import {modelFor} from './models.js';
import {RETURNS_VERSION} from './gmail-import.js';
export {RETURNS_VERSION};
export {parseStatedDate,parseWindow} from './return-terms.js';

// Return-window reminders (PRD "Return-window reminders", founder decision October 22), step 1: read and
// log only. A deadline comes only from the purchase evidence: a stated return-by date, or a stated window
// ("30 days from delivery") counted from a dated event the person's own email shows (the order email, the
// shipping notice, the delivery notice). Never a store's policy page, never an estimated delivery.
// No text is sent in this step; every decision is logged with its reason.

const DAY=86400000,LOG_LIMIT=50;
export const REMIND_DAYS=3;// first chance: 3 days before the last return day; last chance: the day before
export const RECENT_DAYS=120;// purchases older than this are not considered
// Which event a window counts from. Only the person's own email dates it (not a Shop order or a screenshot,
// which date the order view, not the parcel).
const ANCHOR={delivery:'delivered',shipment:'shipped',order:'purchased'};
const fromEmail=event=>!/^(screenshot|shop|wishlist):/.test(String(event.source_id??''));

const addDays=(day,n)=>new Date(Date.parse(day)+n*DAY).toISOString().slice(0,10);
const addMonths=(day,n)=>{const d=new Date(day+'T00:00:00Z'),y=d.getUTCFullYear(),m=d.getUTCMonth()+n,last=new Date(Date.UTC(y,m+1,0)).getUTCDate();return new Date(Date.UTC(y,m,Math.min(d.getUTCDate(),last))).toISOString().slice(0,10);};
const days=(a,b)=>Math.round((Date.parse(b)-Date.parse(a))/DAY);

// The last return day for one item, from its recorded return terms (item.return_terms, set from verified
// quotes in lib/receipt-extraction.js) and its dated events. zone: the person's time zone, for the local
// day of an email-dated event. Returns {deadline, basis, evidence} or {deadline:null, reason}.
// With several stated deadlines the earliest one wins: being early is safe, being late costs money.
export function returnDeadline(item,zone=FALLBACK.zone){
 const terms=item.return_terms??[];
 if(!terms.length)return {deadline:null,reason:'no_terms'};
 const sale=terms.find(t=>t.final_sale);
 if(sale)return {deadline:null,reason:'final_sale',evidence:{source_id:sale.source_id,quote:sale.final_sale}};
 const found=[];let reason='no_terms';
 for(const t of terms){
  if(t.return_by)found.push({deadline:t.return_by,basis:'stated_date',evidence:{source_id:t.source_id,quote:t.return_by_quote}});
  else if(t.window){
   const kind=ANCHOR[t.window_from];
   if(!kind){reason='window_start_not_stated';continue;}
   const anchors=(item.source_events??[]).filter(e=>e.kind===kind&&Number.isFinite(e.at)&&fromEmail(e)).sort((a,b)=>a.at-b.at);
   if(!anchors.length){reason=`no_${kind}_date`;continue;}
   const start=localDay(anchors[0].at,zone),deadline=t.window.days?addDays(start,t.window.days):addMonths(start,t.window.months);
   found.push({deadline,basis:`window_from_${t.window_from}`,evidence:{source_id:t.source_id,quote:t.window_quote,from:{kind,source_id:anchors[0].source_id,day:start,quote:anchors[0].evidence??null}}});
  }
 }
 if(!found.length)return {deadline:null,reason};
 return found.sort((a,b)=>a.deadline.localeCompare(b.deadline))[0];
}

// The step-1 decision for one item: would a reminder go out today (before the shared send rules, which
// step 2 adds), and if not, why. entryReason: why the wardrobe leaves the item out (lib/wardrobe.js), if it does.
export function reminderDecision(item,{now=Date.now(),zone=FALLBACK.zone,reminded=false}={}){
 const removed=removalReason(item);
 if(removed)return {status:'skip',reason:removed};
 if(item.outcome?.value==='kept')return {status:'skip',reason:'kept'};
 if(item.outcome?.value==='return_requested')return {status:'skip',reason:'return_requested'};
 const d=returnDeadline(item,zone);
 if(!d.deadline)return {status:'skip',reason:d.reason,...(d.evidence?{evidence:d.evidence}:{})};
 const left=days(localDay(now,zone),d.deadline),base={deadline:d.deadline,basis:d.basis,days_left:left,evidence:d.evidence};
 if(left<1)return {status:'skip',reason:'deadline_passed',...base};
 if(left>REMIND_DAYS)return {status:'skip',reason:'too_early',...base};
 if(reminded)return {status:'skip',reason:'already_reminded',...base};
 return {status:'would_send',reason:null,...base};
}

// Recent purchases with a decision each: the person's own items bought in the last RECENT_DAYS.
export function returnWindowCandidates(state,{now=Date.now(),zone=FALLBACK.zone,reminded=new Set()}={}){
 const bought=i=>Math.min(...(i.source_events??[]).filter(e=>e.kind==='purchased'&&Number.isFinite(e.at)).map(e=>e.at),Infinity);
 return projectReceiptState(state).items.filter(i=>!i.duplicate_of&&!i.part_of&&now-bought(i)<=RECENT_DAYS*DAY)
  .map(i=>({id:i.id,brand:i.brand??null,product:i.product??null,merchant:i.merchant??null,bought_at:new Date(bought(i)).toISOString(),...reminderDecision(i,{now,zone,reminded:reminded.has(i.id)})}));
}

// The daily log (step 1): each recent item's decision, written to the Vercel log, and kept on the history
// row (data.returns.log, last 50) only when an item's status or reason changes, so a quiet day adds nothing.
export function recordReturnDecisions(data,candidates,now=Date.now()){
 const log=data.returns?.log??[],last=new Map();for(const e of log)last.set(e.item_id,e);
 const added=[];
 for(const c of candidates){
  console.log(JSON.stringify({event:'return_window',status:c.status,reason:c.reason,basis:c.basis??null,days_left:c.days_left??null}));
  const prior=last.get(c.id);
  if(prior&&prior.status===c.status&&prior.reason===c.reason&&prior.deadline===(c.deadline??null))continue;
  added.push({at:new Date(now).toISOString(),item_id:c.id,status:c.status,reason:c.reason,deadline:c.deadline??null,basis:c.basis??null,days_left:c.days_left??null});
 }
 if(added.length)data.returns={...data.returns,log:[...log,...added].slice(-LOG_LIMIT)};
 return added;
}
export const returnZone=data=>nudgeTimezone(data)??FALLBACK.zone;

// The daily check's log (lib/purchase-texts.js): every recent item's decision, written under the row's lease.
export async function logReturnWindows(store,owner,{now=Date.now()}={}){
 const row=await store.claimGmailImport(owner);if(!row)return {status:'busy'};
 try{
  const data=structuredClone(row.data),{state}=await loadReceipts(store,owner,row);
  const candidates=returnWindowCandidates(state,{now,zone:returnZone(data)}),added=recordReturnDecisions(data,candidates,now);
  await store.finishGmailImport(owner,row.revision,added.length?data:row.data,row.token_ciphertext);
  return {status:'logged',items:candidates.length,would_send:candidates.filter(c=>c.status==='would_send').length,changed:added.length};
 }catch(error){await store.finishGmailImport(owner,row.revision,row.data,row.token_ciphertext).catch(()=>{});throw error;}
}

// Owner rehearsal and measurement (Admin › person › Return windows): re-read the order, shipping and delivery
// emails of purchases from the last REREAD_DAYS for the return terms they state, a few emails per call (the
// page calls again until none are left). Only return terms are saved, as attach-only evidence like the price
// and photo re-reads; items, events and corrections are unchanged. Each email is marked returns_version so it
// is read once.
export const REREAD_DAYS=45,REREAD_BATCH=4;
const fail=(status,message)=>Object.assign(Error(message),{status});
export function rereadQueue(row,state,now=Date.now()){
 const sources=new Map((row.data.sources??[]).map(s=>[s.id,s])),recent=new Set();
 for(const item of state.items){
  const bought=Math.min(...(item.source_events??[]).filter(e=>e.kind==='purchased'&&Number.isFinite(e.at)).map(e=>e.at),Infinity);
  if(now-bought>REREAD_DAYS*DAY)continue;
  for(const e of item.source_events??[])if(['purchased','shipped','delivered'].includes(e.kind)&&sources.has(e.source_id))recent.add(e.source_id);
 }
 return [...recent].filter(id=>(sources.get(id).returns_version??0)<RETURNS_VERSION);
}
export async function rereadReturnTerms(store,owner,env,{fetcher=fetch,prepare=prepareReceiptEmail,interpret=request=>receiptModel(request,env,fetcher),signIn=row=>accessToken(openToken(row.token_ciphertext,owner,env),env,fetcher),now=Date.now()}={}){
 const row=await store.gmailImport(owner);
 if(!row)throw fail(409,'No purchase history from Gmail for this person.');
 if(!gmailLinked(row))throw fail(409,'Gmail is disconnected or its sign-in expired. They need to connect Gmail again before emails can be re-read.');
 const {state}=await loadReceipts(store,owner,row),queue=rereadQueue(row,state,now),batch=queue.slice(0,REREAD_BATCH);
 if(!batch.length)return {read:0,remaining:0,found:0};
 let token;
 try{token=await signIn(row);}
 catch(error){if(!error?.reconnect)throw error;await recordGmailReconnect(store,owner,error,'return_terms');throw fail(409,'Google refused the stored Gmail sign-in. They need to connect Gmail again.');}
 const read=await Promise.allSettled(batch.map(async id=>{
  const source=await prepare(await gmailGet('messages/'+encodeURIComponent(id)+'?format=full',token,fetcher),token,{fetcher});
  return {source,proposal:await interpret({schema:RECEIPT_SCHEMA,instructions:RECEIPT_PROMPT,context:{source:modelSource(source),existing_items:[]}})};
 }));
 // Written under the lease against the history as it is now, so an import that ran meanwhile is respected.
 const claimed=await store.claimGmailImport(owner);if(!claimed)throw fail(409,'Purchase history is busy (an import or another edit is running). Try again in a moment.');
 try{
  let current=(await loadReceipts(store,owner,claimed)).state;const records=[],done=new Set();
  for(const [n,r]of read.entries()){
   if(r.status==='rejected'){console.log(JSON.stringify({event:'return_terms_reread_failed'}));continue;}
   const found=returnRecords(current,r.value.source,r.value.proposal);current=found.state;records.push(...found.records);done.add(batch[n]);
  }
  const data=structuredClone(claimed.data);data.sources=(data.sources??[]).map(s=>done.has(s.id)?{...s,returns_version:RETURNS_VERSION}:s);
  const model='model:'+modelFor('extract',env);
  if(!await store.finishGmailImport(owner,claimed.revision,data,claimed.token_ciphertext,records.map(r=>purchaseEvidence(r,model))))throw fail(409,'Purchase history changed while reading. Try again.');
  console.log(JSON.stringify({event:'return_terms_reread',read:done.size,failed:batch.length-done.size,found:records.length,remaining:queue.length-done.size}));
  return {read:done.size,failed:batch.length-done.size,found:records.length,remaining:queue.length-done.size};
 }catch(error){await store.finishGmailImport(owner,claimed.revision,claimed.data,claimed.token_ciphertext).catch(()=>{});throw error;}
}

// What Admin shows: recent purchases with their stated terms and today's decision, and the change log.
export async function returnWindowView(store,owner,{now=Date.now()}={}){
 const row=await store.gmailImport(owner);if(!row)return {items:[],log:[],reread:{remaining:0},connected:false,zone:FALLBACK.zone};
 const {state}=await loadReceipts(store,owner,row),zone=returnZone(row.data),terms=new Map(state.items.map(i=>[i.id,i.return_terms??[]]));
 const items=returnWindowCandidates(state,{now,zone}).map(c=>({...c,terms:terms.get(c.id)}));
 const counts={};for(const i of items)counts[i.reason??'would_send']=(counts[i.reason??'would_send']??0)+1;
 return {items,counts,with_terms:items.filter(i=>i.terms.length).length,with_deadline:items.filter(i=>i.deadline).length,log:[...(row.data.returns?.log??[])].reverse(),
  reread:{remaining:rereadQueue(row,state,now).length,days:REREAD_DAYS},connected:gmailLinked(row),zone};
}
