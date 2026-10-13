import {deliverReply} from './replies.js';
import {sendGreeting} from './photon.js';
export async function receiptNotification(store,owner,env,stage,body,send=sendGreeting){
 const operation=`gmail:${owner}:${stage}`,existing=await store.operation(operation);
 if(existing)return existing;
 const conversation=await store.conversation(owner);
 return deliverReply({store,send,conversation,operation,body,source:'operator',env});
}
export async function nextReceiptQuestion(store,owner,env,send=sendGreeting){
 const row=await store.gmailImport(owner);
 const question=(row?.data.questions??row?.data.feedback?.questions??[]).find(q=>q.status==='open');
 if(!question)return null;
 // The persisted question ID and outbound message retain the original item scope.
 return receiptNotification(store,owner,env,'question:'+question.id,question.question,send);
}
