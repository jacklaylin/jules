import {nextReceiptQuestion} from './receipt-notifications.js';
import {interpretReceiptAnswer,applyReceiptAnswerPartially} from './receipt-feedback.js';
import {receiptModel} from './receipt-extraction.js';
import {loadReceipts,receiptWrite} from './evidence.js';
import {readScreenshots,applyScreenshotRead,withScreenshotNotes,screenshotReads,screenshotSourceId,screenshotReport} from './order-screenshots.js';
import {SCREENSHOT_ORIGIN} from './connected-sources.js';

// Agent skill: the conversational agent chooses this tool when the newest message answers or
// corrects the user's imported purchase history. The executor interprets the specific items and
// changes against the full history; code validates them and records them as correction evidence.
export const PURCHASE_HISTORY_TOOL={type:'function',name:'update_purchase_history',strict:true,
 description:'Record the user\'s answer or correction about purchases Jules found in their shopping history: who an item was for, a return, an order that was cancelled or never happened, a duplicate, or a wrong brand, product, size, color or quantity. Use only when the newest message answers or corrects that history. It does not search, save to the wishlist or change taste preferences.',
 parameters:{type:'object',additionalProperties:false,properties:{},required:[]}};
export const PURCHASE_HISTORY_GUIDE='\nPURCHASE HISTORY: The user has imported purchase history. When the newest message answers one of Jules\'s questions about it or corrects it, call update_purchase_history; it records the change and replies. Never claim a history change without that tool.';

// Applies chat answers and order screenshots that were queued while another step held the
// purchase-history lease. The caller holds the lease. Each answer keeps its own message as
// provenance, so applying one twice is a no-op (applyReceiptFeedback accepts an identical event
// again); a screenshot read already noted in the job data is skipped. Returns the new state, how many
// answers applied, the screenshot evidence rows and notes to write, and the earlier screenshot reads
// they replace (the caller deletes those with dropReplaced before writing).
export function applyQueuedAnswers(state,answers,owner,data={}){
 let applied=0;const evidence=[],notes=[],replaced=[];
 for(const answer of answers??[]){
  if(typeof answer?.id!=='string')continue;
  if(answer.kind==='order_screenshot'){
   if(!answer.read?.source)continue;
   const known={...data,screenshots:withScreenshotNotes(data,notes,replaced).screenshots};
   const reads=screenshotReads(known,answer.read.messages,answer.read.store);
   if(reads.recorded)continue;
   const read=applyScreenshotRead(state,[],answer.read,{model:answer.model,at:answer.at});
   // Not counted in applied: that counts answers, which lead on to the next open question.
   state=read.state;evidence.push(...read.evidence);notes.push(read.note);replaced.push(...reads.replaced.filter(n=>n.id!==read.note.id));
   console.log(JSON.stringify({event:'order_screenshot_imported',queued:true,added:read.note.added,linked:read.note.linked,orders:read.note.orders,returns:read.note.returns,needs_store:read.note.needs_store}));
   continue;
  }
  if(!answer.proposal)continue;
  const result=applyReceiptAnswerPartially(state,answer.proposal,{id:answer.id,owner_id:owner,source:'chat_answer',at:answer.at});
  if(result.withheld.length)console.log(JSON.stringify({event:'purchase_history_actions_withheld',applied:result.applied,withheld:result.withheld,queued:true}));
  state=result.state;applied+=result.applied;
 }
 return {state,applied,evidence,notes,replaced};
}
// Deletes the evidence of screenshot reads a newer read replaced (the caller holds the lease).
export async function dropReplaced(store,owner,replaced){
 // Always by source ID: deleteEvidence without one would remove the whole origin.
 for(const note of replaced??[])if(typeof note?.id==='string'&&note.id.startsWith('screenshot:'))await store.deleteEvidence(owner,SCREENSHOT_ORIGIN,note.id);
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
   const waiting=(row.chat_answers??[]).filter(a=>a?.id!==id),earlier=applyQueuedAnswers(fresh.state,waiting,owner,row.data);
   const {state,applied,withheld}=applyReceiptAnswerPartially(earlier.state,proposal,{id,owner_id:owner,source:'chat_answer',at});
   if(withheld.length)console.log(JSON.stringify({event:'purchase_history_actions_withheld',applied,withheld}));
   if(!applied&&!earlier.applied&&!earlier.notes.length){await store.finishGmailImport(owner,row.revision,row.data,row.token_ciphertext).catch(()=>{});return {body:'i couldn’t tell which purchase you mean. which item is it?',updated:false};}
   unclear=withheld.length>0;
   await dropReplaced(store,owner,earlier.replaced);
   const write=receiptWrite(withScreenshotNotes(row.data,earlier.notes,earlier.replaced),fresh,state,earlier.evidence);
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
// Adds the purchases, orders and returns in order screenshots the agent identified
// (lib/order-screenshots.js) to the same evidence-backed history as Gmail and Shop. messageIds are
// the screenshots' messages, read together; storeName is the store the user named, if any.
// Returns {body, user, added, linked, queued?, replayed?, failure?}: body is the factual draft for the
// agent, user the line sent to the user. Never throws for the expected cases. A replayed delivery
// reports what was recorded instead of reading again.
export async function importOrderScreenshots({store,owner,messageIds,caption,storeName=null,images,env,fetcher=fetch,interpret=request=>receiptModel(request,env,fetcher),transcribe,wait=ms=>new Promise(r=>setTimeout(r,ms))}){
 if(!images?.length||!messageIds?.length)return {body:'There was no screenshot to read. Ask the user to send the order screenshot again.',user:null,added:0,linked:0};
 const entry='screenshot-read:'+screenshotSourceId(messageIds)+':'+String(storeName??'').trim().toLowerCase();
 const current=await store.gmailImport(owner);
 const known=screenshotReads(current?.data,messageIds,storeName);
 if(known.recorded)return {...screenshotReport(known.recorded),replayed:true};
 if((current?.chat_answers??[]).some(a=>a?.id===entry))return queuedReply();
 let read=null,failed=0;
 try{
  const receipts=current?await loadReceipts(store,owner,current):null;
  ({read,failed}=await readScreenshots(images,{messageIds,caption,store:storeName,state:receipts?.state??{items:[]},env,interpret,fetcher,...(transcribe?{transcribe}:{})}));
 }catch(error){
  console.log(JSON.stringify({event:'order_screenshot_read_failed',reason:String(error?.message??'').slice(0,60)}));
  failed=images.length;
 }
 if(!read&&failed)return {body:'The screenshot couldn’t be read just now, so nothing was added to their purchase history. Ask them to send it again in a minute.',user:'i couldn’t read that screenshot just now. could you send it again in a minute?',added:0,linked:0,failure:'screenshot_read'};
 if(!read)return {...screenshotReport({}),added:0,linked:0};
 const model='model:'+(env.OPENAI_MODEL||'gpt-4.1-mini'),at=new Date().toISOString();
 // A person who never imported email has no history row yet; it holds the lease and job data.
 if(!current)await store.ensureGmailImport(owner);
 let row=await store.claimGmailImport(owner);
 for(const ms of CLAIM_WAITS){if(row)break;await wait(ms);row=await store.claimGmailImport(owner);}
 if(!row){
  // An import is running: hand it the screenshot, which it applies before its next step.
  let queued=false;
  try{queued=Boolean(await store.queueHistoryAnswer(owner,{id:entry,kind:'order_screenshot',read,model,at}));}catch{console.log(JSON.stringify({event:'order_screenshot_queue_failed'}));}
  console.log(JSON.stringify({event:'order_screenshot_busy',queued}));
  return queued?queuedReply():{body:'Their purchase history is busy with an import, so the screenshot couldn’t be added yet. Ask them to send it again in a few minutes.',user:'i’m still reading your other orders, so i couldn’t add that one yet. could you send it again in a few minutes?',added:0,linked:0,failure:'purchase_history_busy'};
 }
 try{
  // A concurrent delivery may have recorded these screenshots (or a read covering them) meanwhile.
  const reads=screenshotReads(row.data,messageIds,storeName);
  if(reads.recorded){await store.finishGmailImport(owner,row.revision,row.data,row.token_ciphertext).catch(()=>{});return {...screenshotReport(reads.recorded),replayed:true};}
  const waiting=(row.chat_answers??[]).filter(a=>a?.id!==entry);
  // Earlier reads of these screenshots are replaced: their evidence goes before this read is applied.
  const replaced=reads.replaced;await dropReplaced(store,owner,replaced);
  const fresh=await loadReceipts(store,owner,row),earlier=applyQueuedAnswers(fresh.state,waiting,owner,withScreenshotNotes(row.data,[],replaced));
  await dropReplaced(store,owner,earlier.replaced);
  const applied=applyScreenshotRead(earlier.state,fresh.pending,read,{model,at});
  const data=withScreenshotNotes(withScreenshotNotes(row.data,earlier.notes,[...replaced,...earlier.replaced]),[applied.note]);
  const write=receiptWrite(data,fresh,applied.state,[...earlier.evidence,...applied.evidence]);
  if(!await store.finishGmailImport(owner,row.revision,write.data,row.token_ciphertext,write.evidence))throw Error('Screenshot write conflict');
  if(waiting.length)await store.clearHistoryAnswers(owner,waiting.map(a=>a.id)).catch(()=>console.log(JSON.stringify({event:'purchase_history_queue_clear_failed'})));
  const note=applied.note;
  console.log(JSON.stringify({event:'order_screenshot_imported',images:images.length,messages:messageIds.length,failed,added:note.added,linked:note.linked,orders:note.orders,returns:note.returns,
   withheld:note.withheld,needs_store:note.needs_store,store_named:Boolean(note.store),replaced:replaced.length,dated:note.dated}));
  return screenshotReport(note);
 }catch(error){
  await store.finishGmailImport(owner,row.revision,row.data,row.token_ciphertext).catch(()=>{});
  console.log(JSON.stringify({event:'order_screenshot_write_failed',reason:String(error?.message??'').slice(0,60),code:error?.database_code??null}));
  return {body:'The screenshot was read but couldn’t be saved to their purchase history just now. Ask them to send it again in a minute.',user:'i read that screenshot but couldn’t save it just now. could you send it again in a minute?',added:0,linked:0,failure:'screenshot_write'};
 }
}
const queuedReply=()=>({body:'Their purchase history is busy with an import, so what is in this screenshot will be added as soon as that finishes.',user:'got it. i’ll add those to your history as soon as i finish reading your other orders.',added:0,linked:0,queued:true});
// After the reply is delivered, continue with the next open question, if any.
export async function continuePurchaseQuestions(store,owner,env,send){
 try{await nextReceiptQuestion(store,owner,env,send);}catch{console.log(JSON.stringify({event:'receipt_next_question_failed'}));}
}
