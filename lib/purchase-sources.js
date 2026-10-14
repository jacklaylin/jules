import {RECEIPT_SCHEMA,reconcileReceipt,relinkPending,projectReceiptState} from './receipt-extraction.js';
import {proposeReceiptQuestions,replaceReceiptQuestions,addReceiptQuestions,MAX_RECEIPT_QUESTIONS} from './receipt-feedback.js';

// Shared rails for every purchase-history source (Gmail, Shop, future MCPs). A source only has to
// produce prepared records {id, date, text}; reading them with the model, validating every quoted
// field, linking them to items already found by any source, writing evidence and refreshing the
// follow-up questions are the same for all sources.

// Items whose order reference appears in this record, so the model can link instead of duplicating.
export function existingItems(state,source){
 return state.items.filter(i=>[i.order_reference,i.original?.order_reference].some(r=>r&&source.text.includes(r))).slice(0,200)
  .map(i=>({id:i.id,merchant:i.merchant,order_reference:i.order_reference,product:i.product,sku:i.sku,size_label:i.size_label,color:i.color,original:i.original}));
}
// Applies one model proposal event by event: an event that fails validation is withheld; the others stand.
export function applyProposal(state,source,proposal,{log='history'}={}){
 const pending=[],records=[];let withheld_events=0;
 for(const [index,event]of(Array.isArray(proposal?.events)?proposal.events.slice(0,40):[]).entries()){
  try{const merged=reconcileReceipt(state,source,{events:[event]},{eventOffset:index});state=merged.state;pending.push(...merged.pending);records.push(...merged.records);}
  catch(error){withheld_events++;console.log(JSON.stringify({event:log+'_event_withheld',reason:error.message,kind:typeof event?.kind==='string'?event.kind.slice(0,40):null}));}
 }
 return {state,pending,records,withheld_events,withheld_fields:records.reduce((n,r)=>n+(r.withheld_fields?.length??0),0)};
}
// Reads a batch of prepared records in parallel. Each record's outcome is reported separately so a
// caller can retry or skip it; a batch where every call failed throws (likely a provider outage).
export async function extractBatch(state,pending,sources,{interpret,instructions,log='history'}){
 const results=await Promise.allSettled(sources.map(source=>interpret({schema:RECEIPT_SCHEMA,instructions,context:{source,existing_items:existingItems(state,source)}})));
 if(sources.length>1&&results.every(r=>r.status==='rejected'))throw results[0].reason;
 const records=[],outcomes=[];let withheld_events=0,withheld_fields=0;
 for(const [n,result]of results.entries()){
  if(result.status==='rejected'){outcomes.push({id:sources[n].id,status:'failed'});continue;}
  const applied=applyProposal(state,sources[n],result.value,{log});
  state=applied.state;pending=[...pending,...applied.pending];records.push(...applied.records);
  withheld_events+=applied.withheld_events;withheld_fields+=applied.withheld_fields;
  outcomes.push({id:sources[n].id,status:'done',records:applied.records.length});
 }
 ({state,pending}=relinkPending(state,pending));
 return {state,pending,records,outcomes,withheld_events,withheld_fields};
}
// After an import finishes, the most useful open questions are reselected across all sources.
// Questions are optional: an invalid proposal is dropped, and a failed selection keeps the existing
// open questions rather than pausing a completed history. Returns {state, failed}.
export async function refreshQuestions(state,pending,{interpret,profile=[],reason,log='history'}){
 try{
  const proposed=await proposeReceiptQuestions({items:projectReceiptState(state).items,previous_feedback:state.feedback,previous_questions:state.questions,pending_events:pending,profile,
   question_selection:`${reason} Select the combined top five unresolved questions again, including existing open questions only when still unanswered by new evidence and consequential. The selected set replaces previous open questions; resolved and deferred questions must not be repeated.`},interpret);
  const proposals=Array.isArray(proposed?.questions)?proposed.questions.slice(0,MAX_RECEIPT_QUESTIONS):[];
  const valid=proposals.filter(p=>{try{addReceiptQuestions(state,[p]);return true;}catch{return false;}});
  if(valid.length<proposals.length)console.log(JSON.stringify({event:log+'_questions_dropped',proposed:proposals.length,dropped:proposals.length-valid.length}));
  return {state:replaceReceiptQuestions(state,valid),failed:false};
 }catch(error){
  console.log(JSON.stringify({event:log+'_question_selection_failed',error:error.message?.slice(0,80)??null}));
  return {state,failed:true};
 }
}
