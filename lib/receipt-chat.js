import {nextReceiptQuestion} from './receipt-notifications.js';
import {interpretReceiptAnswer,applyReceiptAnswerPartially} from './receipt-feedback.js';
import {receiptModel} from './receipt-extraction.js';
import {loadReceipts,receiptWrite} from './evidence.js';

// Agent skill: the conversational agent chooses this tool when the newest message answers or
// corrects the user's imported purchase history. The executor interprets the specific items and
// changes against the full history; code validates them and records them as correction evidence.
export const PURCHASE_HISTORY_TOOL={type:'function',name:'update_purchase_history',strict:true,
 description:'Record the user\'s answer or correction about purchases Jules found in their shopping history: who an item was for, a return, an order that was cancelled or never happened, a duplicate, or a wrong brand, product, size, color or quantity. Use only when the newest message answers or corrects that history. It does not search, save to the wishlist or change taste preferences.',
 parameters:{type:'object',additionalProperties:false,properties:{},required:[]}};
export const PURCHASE_HISTORY_GUIDE='\nPURCHASE HISTORY: The user has imported purchase history. When the newest message answers one of Jules\'s questions about it or corrects it, call update_purchase_history; it records the change and replies. Never claim a history change without that tool.';

// Applies chat answers that were queued while another step held the purchase-history lease. The
// caller holds the lease. Each answer keeps its own message as provenance, so applying one twice is a
// no-op (applyReceiptFeedback accepts an identical event again).
export function applyQueuedAnswers(state,answers,owner){
 let applied=0;
 for(const answer of answers??[]){
  if(typeof answer?.id!=='string'||!answer.proposal)continue;
  const result=applyReceiptAnswerPartially(state,answer.proposal,{id:answer.id,owner_id:owner,source:'chat_answer',at:answer.at});
  if(result.withheld.length)console.log(JSON.stringify({event:'purchase_history_actions_withheld',applied:result.applied,withheld:result.withheld,queued:true}));
  state=result.state;applied+=result.applied;
 }
 return {state,applied};
}
const CLAIM_WAITS=[500,1000,1500];
// Returns {body, updated, queued?, failure?}; never throws for the expected cases (the import worker
// holding the lease, the interpretation model failing), so a history answer never ends in the
// generic fallback. Replayed deliveries reuse the recorded correction instead of reinterpreting.
export async function updatePurchaseHistory(delivery,owner,store,env,{interpret=request=>receiptModel(request,env),wait=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 const current=await store.gmailImport(owner),receipts=current&&await loadReceipts(store,owner,current);
 if(!receipts?.state.items.length)return {body:'i don’t have any imported purchases to update yet.',updated:false};
 const id='imessage:'+delivery.message.id,prefix=id+':';
 let recorded=receipts.state.feedback.filter(e=>e.id.startsWith(prefix)),unclear=false;
 if(!recorded.length){
  const context=await store.context(owner,delivery.message.id),at=context.find(m=>m.provider_id===delivery.message.id)?.created_at??new Date().toISOString();
  let proposal;
  try{proposal=await interpretReceiptAnswer({...receipts.state,conversation:context,current_message_id:delivery.message.id},delivery.message.content?.text??'',interpret);}
  catch(error){
   console.log(JSON.stringify({event:'purchase_history_interpret_failed',error:error?.name??null}));
   return {body:'i couldn’t record that in your purchase history just now. could you tell me again in a minute?',updated:false,failure:'receipt_interpret'};
  }
  if(!proposal.actions.length)return {body:'i couldn’t tell which purchase you mean. which item is it?',updated:false};
  // The import worker holds the lease for one step at a time; wait briefly, then hand it the answer.
  let row=await store.claimGmailImport(owner);
  for(const ms of CLAIM_WAITS){if(row)break;await wait(ms);row=await store.claimGmailImport(owner);}
  if(!row){
   let queued=false;
   try{queued=Boolean(await store.queueHistoryAnswer(owner,{id,proposal,at}));}catch{console.log(JSON.stringify({event:'purchase_history_queue_failed'}));}
   console.log(JSON.stringify({event:'purchase_history_busy',queued}));
   return queued?{body:'got it. i’m still reading your purchases, so i’ll record that as soon as that finishes.',updated:false,queued:true}
    :{body:'i’m still reading your purchases, so i couldn’t record that yet. could you tell me again in a few minutes?',updated:false,failure:'purchase_history_busy'};
  }
  try{
   const fresh=await loadReceipts(store,owner,row);
   // Answers queued earlier apply first, in the order they arrived.
   const waiting=(row.chat_answers??[]).filter(a=>a?.id!==id),earlier=applyQueuedAnswers(fresh.state,waiting,owner);
   const {state,applied,withheld}=applyReceiptAnswerPartially(earlier.state,proposal,{id,owner_id:owner,source:'chat_answer',at});
   if(withheld.length)console.log(JSON.stringify({event:'purchase_history_actions_withheld',applied,withheld}));
   if(!applied&&!earlier.applied){await store.finishGmailImport(owner,row.revision,row.data,row.token_ciphertext).catch(()=>{});return {body:'i couldn’t tell which purchase you mean. which item is it?',updated:false};}
   unclear=withheld.length>0;
   const write=receiptWrite(row.data,fresh,state);
   if(!await store.finishGmailImport(owner,row.revision,write.data,row.token_ciphertext,write.evidence))throw Error('Feedback write conflict');
   if(waiting.length)await store.clearHistoryAnswers(owner,waiting.map(a=>a.id)).catch(()=>console.log(JSON.stringify({event:'purchase_history_queue_clear_failed'})));
   recorded=state.feedback.filter(e=>e.id.startsWith(prefix));
   if(!applied)return {body:'i couldn’t tell which purchase you mean. which item is it?',updated:true};
  }catch(error){
   await store.finishGmailImport(owner,row.revision,row.data,row.token_ciphertext).catch(()=>{});throw error;
  }
 }
 console.log(JSON.stringify({event:'purchase_history_updated',actions:recorded.map(e=>e.action)}));
 const body=recorded.every(e=>e.action==='defer_question')?'i’ll leave that unknown. you can correct it later.':'i’ve updated your purchase history and the shopping evidence i learn from it.';
 return {updated:true,body:unclear?body+' i couldn’t tell which item the rest of your answer was about. which one do you mean?':body};
}
// After the reply is delivered, continue with the next open question, if any.
export async function continuePurchaseQuestions(store,owner,env,send){
 try{await nextReceiptQuestion(store,owner,env,send);}catch{console.log(JSON.stringify({event:'receipt_next_question_failed'}));}
}
