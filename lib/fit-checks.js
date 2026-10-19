import {loadReceipts} from './evidence.js';
import {projectReceiptState} from './receipt-extraction.js';
import {wardrobeView,itemName} from './wardrobe.js';
import {deliverReply} from './replies.js';
import {sendGreeting} from './photon.js';

// Fit checks (step 2 of the proactive purchase texts): a few days after something the person bought for
// themselves arrives, Jules asks how it fits in the size they bought. The reply goes through the chat
// agent's update_purchase_history tool like any other purchase-history answer: the model reads it into a
// structured report_fit or report_return (lib/receipt-feedback.js), never a wording match.
// It shares the daily slot with the purchase text: at most one proactive text a day per person.
const DAY=86400000,HOLD_MS=15*60000;
// Wait a few days after delivery to ask; past the window the moment has passed and it stays quiet.
export const WAIT_DAYS=3,WINDOW_DAYS=21,SHIPPING_DAYS=5;
const today=now=>new Date(now).toISOString().slice(0,10);

// The ledger operations of every proactive text; any one of them today uses up the day.
export const PROACTIVE={purchase:(owner,day)=>`gmail:${owner}:purchases:${day}`,fit_check:(owner,day)=>`gmail:${owner}:fit-check:${day}`};
export async function textedToday(store,owner,now=Date.now()){
 for(const key of Object.values(PROACTIVE))if(await store.operation(key(owner,today(now))))return true;
 return false;
}

// When an item arrived, from the person's own email only: a delivery notice, else about five days after
// the shipping notice. Order screenshots and connected stores are dated by the order, not the parcel, so
// they never date a delivery. Null when nothing says it shipped (an in-store receipt, a pre-order).
const fromEmail=event=>!/^(screenshot|shop):/.test(String(event.source_id??''));
export function deliveryOf(item){
 const dated=kind=>(item.source_events??[]).filter(e=>e.kind===kind&&Number.isFinite(e.at)&&fromEmail(e)).map(e=>e.at);
 const delivered=dated('delivered'),shipped=dated('shipped');
 if(delivered.length)return {at:Math.min(...delivered),basis:'delivery_email'};
 if(shipped.length)return {at:Math.min(...shipped)+SHIPPING_DAYS*DAY,basis:'shipped_plus_five_days'};
 return null;
}

// Which items are due a fit check today, oldest delivery first, and why the others in the window are not.
// asked: item ids already asked about (once per item). Only items in the wardrobe (the person's own) with a
// recorded size label and no fit or return reported yet qualify.
export function fitCheckCandidates(state,view,asked=new Set(),now=Date.now()){
 const raw=new Map(projectReceiptState(state).items.map(i=>[i.id,i])),due=[],skipped={};
 const skip=reason=>{skipped[reason]=(skipped[reason]??0)+1;};
 for(const entry of [...view.items,...view.removed]){
  const item=raw.get(entry.id);if(!item)continue;
  const delivery=deliveryOf(item);
  if(!delivery){if(entry.bought_at&&now-Date.parse(entry.bought_at)<=WINDOW_DAYS*DAY)skip('no_delivery');continue;}
  if(now-delivery.at>WINDOW_DAYS*DAY)continue;
  // Removed from the wardrobe: a gift, a return, a cancellation, gone or never bought.
  if(entry.reason){skip(entry.reason);continue;}
  if(item.outcome?.value==='return_requested'){skip('return_requested');continue;}
  if(asked.has(item.id)){skip('already_asked');continue;}
  if(item.fit){skip('fit_known');continue;}
  if(!entry.size){skip('no_size');continue;}
  if(entry.category==='bags'){skip('not_sized');continue;}
  if(now<delivery.at+WAIT_DAYS*DAY){skip('too_early');continue;}
  due.push({...entry,delivery});
 }
 due.sort((a,b)=>a.delivery.at-b.delivery.at);
 return {due,skipped};
}

// The factual draft; lib/compose.js writes it in Jules's voice and keeps the item and its size label.
export function fitCheckDraft(item){
 return `how is the ${itemName(item)}${item.merchant?` from ${item.merchant}`:''} fitting in size ${item.size}? tell me if the size is right, if it runs big or small, or if you sent it back.`;
}

// At most one fit check a day, about one item, and never on a day another proactive text went out. The item
// is marked asked before the text goes out, so a failure afterwards can miss a check but never repeat one.
export async function sendFitCheck(store,owner,env,{send=sendGreeting,now=Date.now()}={}){
 const result=await fitCheck(store,owner,env,{send,now});
 console.log(JSON.stringify({event:'fit_check',status:result.status,reason:result.reason??null,delivery_basis:result.delivery_basis??null,waiting:result.waiting??null,skipped:result.skipped??null}));
 return result;
}
async function fitCheck(store,owner,env,{send,now}){
 if(env.FIT_CHECKS_ENABLED==='false')return {status:'skipped',reason:'disabled'};
 if(await textedToday(store,owner,now))return {status:'skipped',reason:'texted_today'};
 const current=await store.gmailImport(owner);if(!current)return {status:'nothing_due'};
 const receipts=await loadReceipts(store,owner,current),view=wardrobeView(receipts.state,{tags:current.data.item_tags??{}});
 const asked=new Set((current.data.refresh?.fit_checks??[]).map(c=>c.item_id));
 const {due,skipped}=fitCheckCandidates(receipts.state,view,asked,now);
 if(!due.length)return {status:'nothing_due',skipped};
 // Hold while they are mid-conversation; the item stays due tomorrow.
 const last=(await store.recent?.(owner,1).catch(()=>[])??[]).at(-1);
 if(last&&now-Date.parse(last.created_at)<HOLD_MS)return {status:'held',reason:'mid_conversation',waiting:due.length,skipped};
 const item=due[0];
 const row=await store.claimGmailImport(owner);if(!row)return {status:'busy'};
 const data=structuredClone(row.data),refresh=data.refresh??={pending:[],announced:[]};
 refresh.fit_checks=[...(refresh.fit_checks??[]).filter(c=>c.item_id!==item.id),{item_id:item.id,asked_at:new Date(now).toISOString(),delivery_basis:item.delivery.basis}].slice(-200);
 if(!await store.finishGmailImport(owner,row.revision,data,row.token_ciphertext))return {status:'busy'};
 const sent=await deliverReply({store,send,conversation:await store.conversation(owner),operation:PROACTIVE.fit_check(owner,today(now)),body:fitCheckDraft(item),source:'operator',env,purpose:'fit_check',
  facts:{fit_check:{item:itemName(item),size_label:item.size}}});
 return {status:sent.status,item_id:item.id,delivery_basis:item.delivery.basis,waiting:due.length-1,skipped};
}
