import {localDay,nudgeTimezone,sendingHours,FALLBACK} from './nudges.js';
import {itemName} from './wardrobe.js';
import {deliverReply} from './replies.js';
import {sendGreeting} from './photon.js';
import {composeReply} from './compose.js';
import {randomUUID} from 'node:crypto';
import {removalReason} from './wardrobe.js';
import {projectReceiptState,cleanBrand,returnRecords,RECEIPT_SCHEMA,RECEIPT_PROMPT,receiptModel,purchaseEvidence} from './receipt-extraction.js';
import {loadReceipts} from './evidence.js';
import {accessToken,openToken,gmailGet,gmailLinked,recordGmailReconnect} from './gmail-client.js';
import {prepareReceiptEmail} from './receipt-email.js';
import {modelSource} from './order-media.js';
import {modelFor} from './models.js';
import {RETURNS_VERSION} from './gmail-import.js';
export {RETURNS_VERSION};
export {parseStatedDate,parseWindow} from './return-terms.js';

// Return-window reminders (PRD "Return-window reminders", founder decisions October 22). When a recent
// purchase's return window is about to close, Jules texts once. The deadline comes only from the purchase
// evidence (returnDeadline below): never a store's policy page, never an estimated delivery. Every decision is
// logged with its reason. Step 1 read and logged; step 2 sends.

const DAY=86400000,LOG_LIMIT=50;
export const REMIND_DAYS=3;// first chance: 3 days before the last return day; last chance: the day before
export const RECENT_DAYS=120;// purchases older than this are not considered
// Only the person's own email dates a parcel (not a Shop order or a screenshot, which show the order).
const PARCEL={delivery:'delivered',shipment:'shipped'};
const fromEmail=event=>!/^(screenshot|shop|wishlist):/.test(String(event.source_id??''));
// The order date may come from the order email or a Shop order (both state when it was ordered).
const orderDated=event=>!/^(screenshot|wishlist):/.test(String(event.source_id??''));

const addDays=(day,n)=>new Date(Date.parse(day)+n*DAY).toISOString().slice(0,10);
const addMonths=(day,n)=>{const d=new Date(day+'T00:00:00Z'),y=d.getUTCFullYear(),m=d.getUTCMonth()+n,last=new Date(Date.UTC(y,m+1,0)).getUTCDate();return new Date(Date.UTC(y,m,Math.min(d.getUTCDate(),last))).toISOString().slice(0,10);};
const days=(a,b)=>Math.round((Date.parse(b)-Date.parse(a))/DAY);

// The last return day for one item, from its recorded return terms (item.return_terms, set from verified
// quotes in lib/receipt-extraction.js), how they got it (item.fulfillment) and its dated events. zone: the
// person's time zone, for the local day of an email-dated event. Returns {deadline, basis, at_least?, evidence}
// or {deadline:null, reason}. Per stated term, in order (founder decisions October 22):
// - a stated return-by date;
// - a period counted from the order: the order's date;
// - a period counted from delivery or shipping: the delivery or shipping email's date;
// - bought in a store (quoted): the purchase date, whatever the period counts from, since they left with it;
// - otherwise the order date as a floor (at_least): the period can't start before the order, so the window
//   closes no earlier than that. Never an estimated delivery.
// Across several terms the earliest deadline wins: being early is safe, being late costs money.
export function returnDeadline(item,zone=FALLBACK.zone){
 const terms=item.return_terms??[];
 if(!terms.length)return {deadline:null,reason:'no_terms'};
 const sale=terms.find(t=>t.final_sale);
 if(sale)return {deadline:null,reason:'final_sale',evidence:{source_id:sale.source_id,quote:sale.final_sale}};
 const first=test=>(item.source_events??[]).filter(e=>Number.isFinite(e.at)&&test(e)).sort((a,b)=>a.at-b.at)[0]??null;
 const ordered=first(e=>e.kind==='purchased'&&orderDated(e)),inStore=item.fulfillment?.value==='in_store';
 const found=[];let reason='no_terms';
 for(const t of terms){
  if(t.return_by){found.push({deadline:t.return_by,basis:'stated_date',evidence:{source_id:t.source_id,quote:t.return_by_quote}});continue;}
  if(!t.window)continue;
  const from=(basis,event,extra={})=>{const day=localDay(event.at,zone);
   found.push({deadline:t.window.days?addDays(day,t.window.days):addMonths(day,t.window.months),basis,...extra,
    evidence:{source_id:t.source_id,quote:t.window_quote,from:{kind:event.kind,source_id:event.source_id,day,quote:event.evidence??null},...(basis==='window_from_in_store_purchase'?{in_store:item.fulfillment.quote}:{})}});};
  const parcel=PARCEL[t.window_from]?first(e=>e.kind===PARCEL[t.window_from]&&fromEmail(e)):null;
  if(t.window_from==='order'&&ordered)from('window_from_order',ordered);
  else if(parcel)from(`window_from_${t.window_from}`,parcel);
  else if(inStore&&ordered)from('window_from_in_store_purchase',ordered);
  else if(ordered)from('order_date_floor',ordered,{at_least:true});
  else reason='no_purchased_date';
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
 const left=days(localDay(now,zone),d.deadline),base={deadline:d.deadline,basis:d.basis,days_left:left,evidence:d.evidence,...(d.at_least?{at_least:true}:{})};
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

// ---------- Sending (step 2) ----------
// Once a day (lib/purchase-texts.js runDailyRefresh), for everyone with purchase history. A reminder counts
// like an alert under the shared rules (lib/nudges.js): the nudge limits and back-off don't hold it, and a day
// with one has no other nudge. Quiet hours do apply (it goes out 3 days early, so it can wait for 9am), and
// STOP and the person's own "return reminders" setting stop it. At most one text a day; items closing together
// share it (up to 3). Each item is reminded once. No follow-up text.
export const RETURN_OPERATION=(owner,day)=>`return-window:${owner}:${day}`;
export const MAX_ITEMS=3,REMINDED_LIMIT=200,OPEN_GRACE_DAYS=2;
export const remindersOn=data=>data?.return_reminders?.enabled!==false;
const short=day=>new Date(day+'T12:00:00Z').toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric',timeZone:'UTC'}).toLowerCase();
const plain=day=>new Date(day+'T12:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'}).toLowerCase();
const period=w=>w.days?`${w.days} days`:`${w.months} month${w.months>1?'s':''}`;

// What a reminder says about one item, from its deadline and the evidence behind it: the date, and plainly
// why. A floor is said as "at least until", never as the deadline.
export function reminderItem(item,decision){
 const term=(item.return_terms??[]).find(t=>t.source_id===decision.evidence?.source_id&&(t.window_quote===decision.evidence?.quote||t.return_by_quote===decision.evidence?.quote))??null;
 const from=decision.evidence?.from?.day?plain(decision.evidence.from.day):null,w=term?.window;
 const why={stated_date:'going by your order email',
  window_from_order:w&&`${period(w)} from your order on ${from}`,
  window_from_delivery:w&&`${period(w)} from delivery, and it arrived ${from}`,
  window_from_shipment:w&&`${period(w)} from shipping, and it shipped ${from}`,
  window_from_in_store_purchase:w&&`${period(w)}, and you bought it in store on ${from}`,
  order_date_floor:w&&`their email says ${period(w)}${term.window_from==='delivery'?' from when it arrives':term.window_from==='shipment'?' from when it ships':''}, and you ordered ${from}`}[decision.basis]??null;
 // The store as people say it: without a company suffix ("MFPEN Retail ApS" is MFPEN). Formatting only.
 return {id:item.id,name:itemName(item),brand:item.brand??null,merchant:item.merchant?cleanBrand(item.merchant):null,deadline:decision.deadline,day:short(decision.deadline),at_least:Boolean(decision.at_least),basis:decision.basis,why,
  evidence:decision.evidence??null};
}
// The factual draft; lib/compose.js writes it in Jules's voice and keeps the names and dates.
export function reminderDraft(items){
 // The store is named unless the item's name already says it (a brand's own store).
 const one=i=>`your ${i.merchant&&!i.name.toLowerCase().includes(i.merchant.toLowerCase())?i.merchant+' ':''}${i.name}`;
 const close=i=>i.at_least?`you have at least until ${i.day} to return it${i.why?` (${i.why})`:''}`:`the return window closes ${i.day}${i.why?` (${i.why})`:''}`;
 if(items.length===1)return `heads up: for ${one(items[0])}, ${close(items[0])}. keeping it?`;
 return `heads up, a few return windows are closing: ${items.map(i=>`${one(i)}: ${close(i).replace(/ to return it/,'')}`).join('; ')}. keeping them?`;
}
const reminderFacts=items=>({return_reminder:items.map(({name,merchant,deadline,day,at_least,why})=>({item:name,store:merchant,last_return_day:deadline,said_as:day,at_least,why})),
 names:[...new Set(items.flatMap(i=>[i.brand,i.merchant]).filter(n=>typeof n==='string'&&n.trim()))]});
// The reminder waiting for a reply: its items, until the last of their deadlines (plus a grace for late replies).
export const reminderOpen=(items,operation,now,test=false)=>({operation,at:new Date(now).toISOString(),items:items.map(({id,name,merchant,deadline,at_least})=>({id,name,merchant,deadline,at_least})),...(test?{test:true}:{})});
export function openReminder(state,now=Date.now()){
 const open=state?.open;if(!open?.items?.length)return null;
 const last=Math.max(...open.items.map(i=>Date.parse(i.deadline)));
 return Number.isFinite(last)&&now<=last+OPEN_GRACE_DAYS*DAY?open:null;
}
// The model's view of the open reminder (lib/ai.js): which purchases Jules asked about and their dates.
export const reminderContext=open=>({sent_at:open.at,asked:'whether they are keeping these purchases before the return window closes',
 items:open.items.map(i=>({item:i.name,store:i.merchant,last_return_day:i.deadline,...(i.at_least?{at_least:true}:{})}))});

// One person's daily reminder decision and text. Returns {status, items?, reason?}.
export async function sendReturnReminders(store,owner,env,{send=sendGreeting,now=Date.now(),compose=composeReply}={}){
 const row=await store.gmailImport(owner);if(!row)return {status:'no_history'};
 const {state}=await loadReceipts(store,owner,row),zone=returnZone(row.data);
 const reminded=new Set((row.data.returns?.reminded??[]).map(r=>r.item_id));
 const candidates=returnWindowCandidates(state,{now,zone,reminded}),due=candidates.filter(c=>c.status==='would_send').sort((a,b)=>a.deadline.localeCompare(b.deadline));
 let hold=null;const operation=RETURN_OPERATION(owner,localDay(now,zone));
 if(due.length){
  if(!remindersOn(row.data))hold={status:'skipped',reason:'reminders_off'};
  else if(await store.smsOptedOut(owner))hold={status:'skipped',reason:'opted_out'};
  else if(!sendingHours(now,nudgeTimezone(row.data)).ok)hold={status:'held',reason:'quiet_hours'};
  else if(await store.operation(operation))hold={status:'held',reason:'already_today'};
 }
 const chosen=hold?[]:due.slice(0,MAX_ITEMS),byId=new Map(state.items.map(i=>[i.id,i]));
 const items=chosen.map(c=>reminderItem(byId.get(c.id),c));
 const logged=candidates.map(c=>c.status!=='would_send'?c:hold?{...c,status:hold.status,reason:hold.reason}:chosen.includes(c)?{...c,status:'sent'}:{...c,status:'held',reason:'next_text'});
 // Written before the text goes out, so a failure afterwards can miss a reminder but never repeat one.
 const claimed=await store.claimGmailImport(owner);if(!claimed)return {status:'busy'};
 try{
  const data=structuredClone(claimed.data);recordReturnDecisions(data,logged,now);
  if(items.length){
   data.returns={...data.returns,reminded:[...(data.returns?.reminded??[]),...items.map(i=>({item_id:i.id,at:new Date(now).toISOString(),deadline:i.deadline,operation}))].slice(-REMINDED_LIMIT),open:reminderOpen(items,operation,now)};
  }
  if(!await store.finishGmailImport(owner,claimed.revision,data,claimed.token_ciphertext))return {status:'busy'};
 }catch(error){await store.finishGmailImport(owner,claimed.revision,claimed.data,claimed.token_ciphertext).catch(()=>{});throw error;}
 if(!items.length)return {status:hold?hold.status:'nothing_due',...(hold?{reason:hold.reason}:{}),due:due.length};
 const result=await deliverReply({store,send,conversation:await store.conversation(owner),operation,body:reminderDraft(items),source:'operator',env,purpose:'return_reminder',facts:reminderFacts(items),compose});
 console.log(JSON.stringify({event:'return_reminder',status:result.status,items:items.length,bases:items.map(i=>i.basis)}));
 return {status:result.status,items:items.length};
}

// Admin rehearsal (founder has one phone): the reminder about one wardrobe item, only to the designated test
// conversation, labelled as a test. The item's real deadline is used when it has one; otherwise the owner types
// a rehearsal date, shown as that. It ignores timing, quiet hours and "once per item", never marks the item
// reminded, and uses a fresh ledger key, so it can be sent again. It opens like a real one, so the founder's
// reply goes through the same path. STOP still blocks it.
export const TEST_LABEL='[test reminder] ';
export const reminderTestConversation=env=>env.PRICE_ALERT_TEST_CONVERSATION_ID??null;
export async function reminderTestCandidates(store,owner,{now=Date.now()}={}){
 const row=await store.gmailImport(owner);if(!row)return [];
 const {state}=await loadReceipts(store,owner,row),zone=returnZone(row.data);
 return projectReceiptState(state).items.filter(i=>!i.duplicate_of&&!i.part_of&&!removalReason(i)).slice(0,80).map(i=>{const d=returnDeadline(i,zone);
  return {id:i.id,name:itemName(i),merchant:i.merchant??null,deadline:d.deadline??null,at_least:Boolean(d.at_least),basis:d.basis??null};});
}
export async function sendTestReminder(store,owner,itemId,env,{rehearsal=null,send=sendGreeting,now=Date.now(),compose=composeReply}={}){
 if(!reminderTestConversation(env)||owner!==reminderTestConversation(env))throw Object.assign(Error('Test reminders go only to the designated test conversation (PRICE_ALERT_TEST_CONVERSATION_ID).'),{status:403});
 const row=await store.gmailImport(owner);if(!row)throw Object.assign(Error('This person has no purchase history.'),{status:409});
 const {state}=await loadReceipts(store,owner,row),zone=returnZone(row.data),item=projectReceiptState(state).items.find(i=>i.id===itemId&&!removalReason(i));
 if(!item)throw Object.assign(Error('That item is not in their wardrobe.'),{status:409});
 const real=returnDeadline(item,zone);
 let entry;
 if(real.deadline)entry=reminderItem(item,real);
 else{
  if(typeof rehearsal!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(rehearsal)||Number.isNaN(Date.parse(rehearsal)))throw Object.assign(Error('This item has no stated return terms. Pick a rehearsal date to send a test.'),{status:400});
  entry={...reminderItem(item,{deadline:rehearsal,basis:'rehearsal'}),why:null};
 }
 const operation=`return-test:${owner}:${randomUUID()}`;
 const result=await deliverReply({store,send,conversation:await store.conversation(owner),operation,body:TEST_LABEL+reminderDraft([entry]),source:'operator',env,purpose:'return_reminder',facts:reminderFacts([entry]),
  // The label is re-added after composing, so the test shows the exact message a person would get.
  compose:async args=>{const c=await compose({...args,draft:reminderDraft([entry])});return c.composed?{...c,body:TEST_LABEL+c.body}:{...c,body:args.draft};}});
 if(result.status==='sent'){
  const claimed=await store.claimGmailImport(owner);
  if(claimed){const data=structuredClone(claimed.data);data.returns={...data.returns,open:reminderOpen([entry],operation,now,true),log:[...(data.returns?.log??[]),{at:new Date(now).toISOString(),item_id:entry.id,status:'sent',reason:null,deadline:entry.deadline,basis:entry.basis,days_left:null,test:true}].slice(-LOG_LIMIT)};
   await store.finishGmailImport(owner,claimed.revision,data,claimed.token_ciphertext).catch(()=>{});}
 }
 console.log(JSON.stringify({event:'return_reminder',status:result.status,items:1,test:true}));
 return {status:result.status,item:entry.name,deadline:entry.deadline,rehearsal:!real.deadline};
}

// The person's own switch, chosen by the model from the meaning of their message (no keyword routing): the
// existing manage_purchase_texts tool with which=return_reminders (lib/purchase-texts.js), so the tool count holds.
export const RETURN_REMINDERS_ACTIONS=['turn_off','turn_on','status'];
export async function manageReturnReminders(store,owner,action,{messageId=null,now=Date.now(),wait=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 if(!RETURN_REMINDERS_ACTIONS.includes(action))throw Error('Invalid return reminders action');
 if(!await store.gmailImport(owner))return 'i don\'t have any of your purchases, so i don\'t send return reminders.';
 for(let attempt=0;attempt<4;attempt++){
  const row=await store.claimGmailImport(owner);
  if(!row){await wait(2000);continue;}
  const on=remindersOn(row.data),enabled=action==='turn_on';
  if(action==='status'||on===enabled){
   await store.finishGmailImport(owner,row.revision,row.data,row.token_ciphertext);
   console.log(JSON.stringify({event:'return_reminders_setting',action,changed:false,on}));
   return action==='status'?(on?'return reminders are on: when your purchase emails say when a return window closes, i text once, a few days before.':'return reminders are off. you can ask me to turn them back on anytime.')
    :on?'return reminders are already on.':'return reminders are already off.';
  }
  const data={...structuredClone(row.data),return_reminders:{enabled,changed_at:new Date(now).toISOString(),message_id:messageId}};
  if(!await store.finishGmailImport(owner,row.revision,data,row.token_ciphertext))break;
  console.log(JSON.stringify({event:'return_reminders_setting',action,changed:true,on:enabled}));
  return enabled?'done: i\'ll text you a few days before a return window closes, when your purchase emails say when.':'done: no more return-window reminders from me. your purchases and wardrobe stay as they are.';
 }
 console.log(JSON.stringify({event:'return_reminders_setting',action,changed:false,busy:true}));
 return 'i couldn\'t change that just now because i\'m updating your purchase history. ask me again in a minute.';
}
export const RETURN_REMINDER_GUIDE='\nRETURN REMINDER: return_reminder lists purchases Jules texted about because their return window closes soon. A reply saying they are keeping or returning any of them, or why, calls update_purchase_history. Stopping or resuming these reminders calls manage_purchase_texts with which return_reminders.';
