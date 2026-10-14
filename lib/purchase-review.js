import {randomUUID} from 'node:crypto';
import {loadReceipts,receiptWrite} from './evidence.js';
import {CONNECTED_SOURCES} from './connected-sources.js';
import {projectReceiptState} from './receipt-extraction.js';
import {applyReceiptFeedback,effectiveRecipient,REVIEW_REASONS} from './receipt-feedback.js';

// Owner review of imported purchase history (admin People page). Corrections reuse the same
// structured feedback events as chat answers, recorded as operator_review evidence with a label
// saying what was wrong, so they also form a measurement set for improving Gmail reading.
const EDITABLE=['brand','product','color','size_label','size_system','quantity'];
const ACTION_FOR={correct:'restore_purchase',not_a_purchase:'dispute_purchase',not_apparel:'dispute_purchase',wrong_details:'correct_fields',duplicate:'mark_duplicate',recipient:'set_recipient',returned:'report_return'};
const MISSED_LIMIT=200;
const busy=()=>Object.assign(Error('Purchase history is busy (an import or another edit is running). Try again in a moment.'),{status:409});
const invalid=message=>Object.assign(Error(message),{status:400});
const short=(value,max)=>typeof value==='string'&&value.trim()&&value.length<=max?value.trim():null;

// Which source a record came from: connected sources prefix their record IDs with their name.
export const recordSource=id=>Object.keys(CONNECTED_SOURCES).find(name=>String(id).startsWith(name+':'))??'gmail';
// Connected-source import report: what the service returned and what each record yielded.
const connectionReport=(name,c)=>({name,label:CONNECTED_SOURCES[name].label,status:c?.status??'not_connected',connected:Boolean(c?.credential),found:c?.found??0,processed:c?.processed??0,
 failed:c?.failed??0,withheld:c?.withheld??0,imported_at:c?.imported_at??null,listing:c?.listing??null,reads:c?.reads??[],error:c?.error??null});
export async function purchaseReview(store,owner){
 const row=await store.gmailImport(owner);
 if(!row)return {connected:false,status:'not_started',items:[],pending:[],missed:[],skipped_labels:[],connections:[]};
 const {state,pending}=await loadReceipts(store,owner,row),view=projectReceiptState(state);
 const sources=new Map((row.data.sources??[]).map(s=>[s.id,s]));
 const reviews=id=>state.feedback.filter(e=>e.item_ids?.includes(id)).map(e=>({action:e.action,reason:e.review?.reason??null,note:e.review?.note??null,source:e.source,at:e.at}));
 const items=view.items.map(i=>({id:i.id,brand:i.brand??null,product:i.product??null,merchant:i.merchant??null,order_reference:i.order_reference??null,sku:i.sku??null,
  size_label:i.size_label??null,size_system:i.size_system??null,color:i.color??null,quantity:i.quantity??null,price:i.price??null,original:Object.fromEntries(EDITABLE.map(f=>[f,i.original?.[f]??null])),
  removed:Boolean(i.purchase_disputed),confirmed:Boolean(i.purchase_confirmed_by_user),duplicate_of:i.duplicate_of??null,confirmed_fields:i.confirmed_fields??[],
  recipient:effectiveRecipient(i),outcome:i.outcome?.value??'unknown',
  events:(i.source_events??[]).map(e=>({kind:e.kind,at:e.at??null,evidence:e.evidence??null,source_id:e.source_id,source:recordSource(e.source_id)})),sources:[...new Set(i.source_ids.map(recordSource))],
  emails:[...new Set(i.source_ids)].filter(id=>recordSource(id)==='gmail').map(id=>({id,date:sources.get(id)?.date??null,sender_domain:sources.get(id)?.sender_domain??null})),
  reviews:reviews(i.id)}));
 const at=item=>Math.min(...item.events.filter(e=>e.kind==='purchased'&&e.at).map(e=>e.at),Infinity);
 items.sort((a,b)=>(at(b)===Infinity?0:at(b))-(at(a)===Infinity?0:at(a)));
 return {connected:Boolean(row.token_ciphertext),status:row.data.job?.status??'not_started',quality:row.data.job?.quality??null,items,
  pending:pending.map(p=>({kind:p.kind,merchant:p.merchant??null,product:p.product??null,order_reference:p.order_reference??null,evidence:p.evidence??null,at:p.at??null,source_id:p.source_id,source:recordSource(p.source_id)})),
  missed:row.data.missed_reports??[],skipped_labels:row.data.triage_labels??[],
  connections:Object.keys(CONNECTED_SOURCES).filter(name=>row.data.connections?.[name]).map(name=>connectionReport(name,row.data.connections[name]))};
}
// Builds the structured correction for one labelled review; code never infers intent from text.
export function reviewEvent(owner,input,now=new Date().toISOString()){
 if(!REVIEW_REASONS.includes(input.reason))throw invalid('Choose what was wrong.');
 const item_ids=Array.isArray(input.item_ids)?input.item_ids.filter(id=>typeof id==='string'&&id.length<=200):[];
 if(!item_ids.length||item_ids.length>50||item_ids.length!==input.item_ids.length)throw invalid('Choose an item.');
 const note=input.note==null||input.note===''?null:short(input.note,500);
 if(input.note&&!note)throw invalid('Keep the note under 500 characters.');
 const event={id:'operator:'+randomUUID(),owner_id:owner,source:'operator_review',at:now,item_ids,action:ACTION_FOR[input.reason],review:{reason:input.reason,note}};
 if(input.reason==='recipient'){
  if(!['self','other','unknown'].includes(input.recipient))throw invalid('Choose who it was for.');
  event.value=input.recipient;event.label=input.recipient==='other'?short(input.recipient_label??'',100):null;
 }else if(input.reason==='duplicate'){
  if(typeof input.target_item_id!=='string')throw invalid('Choose the item it duplicates.');
  event.target_item_id=input.target_item_id;
 }else if(input.reason==='wrong_details'){
  const values={};
  for(const [field,value] of Object.entries(input.values??{})){
   if(!EDITABLE.includes(field))throw invalid('That field cannot be edited.');
   if(field==='quantity')values[field]=value===null||value===''?null:Number(value);
   else values[field]=value===null||String(value).trim()===''?null:String(value).trim().slice(0,300);
  }
  if(!Object.keys(values).length)throw invalid('Change at least one detail.');
  event.values=values;
 }
 return event;
}
export async function reviewPurchase(store,owner,input){
 const event=reviewEvent(owner,input);
 const row=await store.claimGmailImport(owner);if(!row)throw busy();
 try{
  const receipts=await loadReceipts(store,owner,row);
  let state;try{state=applyReceiptFeedback(receipts.state,event);}catch(error){throw invalid(error.message);}
  const write=receiptWrite(row.data,receipts,state);
  if(!await store.finishGmailImport(owner,row.revision,write.data,row.token_ciphertext,write.evidence))throw busy();
  console.log(JSON.stringify({event:'purchase_review_recorded',action:event.action,reason:event.review.reason,items:event.item_ids.length}));
 }catch(error){await store.finishGmailImport(owner,row.revision,row.data,row.token_ciphertext).catch(()=>{});throw error;}
}
// A purchase the import missed. Kept with the import so deleting imported history removes it.
export async function reportMissedPurchase(store,owner,input){
 const report={id:randomUUID(),store:short(input.store??'',120),when:short(input.when??'',60),description:short(input.description??'',500),at:new Date().toISOString()};
 if(!report.store||!report.description)throw invalid('Enter the store and what was bought.');
 const row=await store.claimGmailImport(owner);if(!row)throw busy();
 const data={...row.data,missed_reports:[...(row.data.missed_reports??[]),report].slice(-MISSED_LIMIT)};
 if(!await store.finishGmailImport(owner,row.revision,data,row.token_ciphertext))throw busy();
 console.log(JSON.stringify({event:'purchase_missed_reported'}));
}
