import {interpretReceiptAnswer,applyReceiptAnswer} from './receipt-feedback.js';
import {receiptModel} from './receipt-extraction.js';
import {deliverReply} from './replies.js';

export async function receiptChatReply(delivery,owner,store,env,{interpret=request=>receiptModel(request,env),send}={}){
 if(env.GMAIL_IMPORT_ENABLED!=='true'||delivery.message.attachments?.length)return null;
 const current=await store.gmailImport(owner);if(!current?.data.feedback?.items.length)return null;
 const prefix='imessage:'+delivery.message.id+':';
 let recorded=current.data.feedback.feedback.filter(e=>e.id.startsWith(prefix));
 if(!recorded.length){
  const context=await store.context(owner,delivery.message.id);
  const proposal=await interpretReceiptAnswer({...current.data.feedback,conversation:context,current_message_id:delivery.message.id},delivery.message.content?.text??'',interpret);
  if(!proposal.actions.length)return null;
  const row=await store.claimGmailImport(owner);if(!row)return null;
  try{
   const data=structuredClone(row.data);data.feedback=applyReceiptAnswer(data.feedback,proposal,{id:'imessage:'+delivery.message.id,owner_id:owner,source:'chat_answer',at:context.find(m=>m.provider_id===delivery.message.id)?.created_at??new Date().toISOString()});
   if(!await store.finishGmailImport(owner,row.revision,data,row.token_ciphertext))throw Error('Feedback write conflict');
   recorded=data.feedback.feedback.filter(e=>e.id.startsWith(prefix));
  }catch{
   await store.finishGmailImport(owner,row.revision,row.data,row.token_ciphertext).catch(()=>{});return null;
  }
 }
 const conversation={id:owner,sender_id:delivery.message.sender.id,line:delivery.space.phone};
 const body=recorded.every(e=>e.action==='defer_question')?'I’ll leave that unknown. You can correct it later.':'I’ve updated your purchase history and the shopping evidence I learn from it.';
 const result=await deliverReply({store,send,conversation,operation:'receipt-feedback:'+delivery.message.id,body,source:'operator',env});
 return result.status==='sent'?'imessage_receipt_feedback_sent':'imessage_receipt_feedback_uncertain';
}
