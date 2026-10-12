import {nextReceiptQuestion} from './receipt-notifications.js';
import {interpretReceiptAnswer,applyReceiptAnswer} from './receipt-feedback.js';
import {receiptModel} from './receipt-extraction.js';
import {loadReceipts,receiptWrite} from './evidence.js';

// Agent skill: the conversational agent chooses this tool when the newest message answers or
// corrects the user's imported purchase history. The executor interprets the specific items and
// changes against the full history; code validates them and records them as correction evidence.
export const PURCHASE_HISTORY_TOOL={type:'function',name:'update_purchase_history',strict:true,
 description:'Record the user\'s answer or correction about purchases Jules found in their shopping history: who an item was for, a return, an order that was cancelled or never happened, a duplicate, or a wrong brand, product, size, color or quantity. Use only when the newest message answers or corrects that history. It does not search, save to the wishlist or change taste preferences.',
 parameters:{type:'object',additionalProperties:false,properties:{},required:[]}};
export const PURCHASE_HISTORY_GUIDE='\nPURCHASE HISTORY: The user has imported purchase history. When the newest message answers one of Jules\'s questions about it or corrects it, call update_purchase_history; it records the change and replies. Never claim a history change without that tool.';

// Returns {body, updated}. Replayed deliveries reuse the recorded correction instead of reinterpreting.
export async function updatePurchaseHistory(delivery,owner,store,env,{interpret=request=>receiptModel(request,env)}={}){
 const current=await store.gmailImport(owner),receipts=current&&await loadReceipts(store,owner,current);
 if(!receipts?.state.items.length)return {body:'I don’t have any imported purchases to update yet.',updated:false};
 const prefix='imessage:'+delivery.message.id+':';
 let recorded=receipts.state.feedback.filter(e=>e.id.startsWith(prefix));
 if(!recorded.length){
  const context=await store.context(owner,delivery.message.id);
  const proposal=await interpretReceiptAnswer({...receipts.state,conversation:context,current_message_id:delivery.message.id},delivery.message.content?.text??'',interpret);
  if(!proposal.actions.length)return {body:'I couldn’t tell which purchase you mean. Which item is it?',updated:false};
  const row=await store.claimGmailImport(owner);if(!row)throw Error('Purchase history busy');
  try{
   const fresh=await loadReceipts(store,owner,row);
   const state=applyReceiptAnswer(fresh.state,proposal,{id:'imessage:'+delivery.message.id,owner_id:owner,source:'chat_answer',at:context.find(m=>m.provider_id===delivery.message.id)?.created_at??new Date().toISOString()});
   const write=receiptWrite(row.data,fresh,state);
   if(!await store.finishGmailImport(owner,row.revision,write.data,row.token_ciphertext,write.evidence))throw Error('Feedback write conflict');
   recorded=state.feedback.filter(e=>e.id.startsWith(prefix));
  }catch(error){
   await store.finishGmailImport(owner,row.revision,row.data,row.token_ciphertext).catch(()=>{});throw error;
  }
 }
 console.log(JSON.stringify({event:'purchase_history_updated',actions:recorded.map(e=>e.action)}));
 return {updated:true,body:recorded.every(e=>e.action==='defer_question')?'I’ll leave that unknown. You can correct it later.':'I’ve updated your purchase history and the shopping evidence I learn from it.'};
}
// After the reply is delivered, continue with the next open question, if any.
export async function continuePurchaseQuestions(store,owner,env,send){
 try{await nextReceiptQuestion(store,owner,env,send);}catch{console.log(JSON.stringify({event:'receipt_next_question_failed'}));}
}
