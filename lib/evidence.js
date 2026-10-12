import {projectReceiptEvidence,legacyReceiptEvidence,correctionEvidence} from './receipt-extraction.js';

// Evidence rows are the only place proof lives. Receipt history is rebuilt from them;
// gmail_imports keeps job state, raw prepared emails and open questions only.
export async function loadReceipts(store,owner,row){
 const data=row?.data??{};
 // Pre-evidence imports convert in memory until their next write persists the rows.
 const legacy=data.feedback?legacyReceiptEvidence(data.feedback,data.pending??[]):[];
 const rows=data.feedback?legacy:await store.evidence(owner,'gmail');
 return {...projectReceiptEvidence(owner,rows,data.questions??data.feedback?.questions??[]),legacy};
}
// Splits a changed receipt state into job data (questions) and new evidence rows (corrections).
export function receiptWrite(data,receipts,state=receipts.state,evidence=[]){
 const {feedback,pending,...rest}=data,known=new Set(receipts.state.feedback.map(e=>e.id));
 return {data:{...rest,questions:state.questions},evidence:[...receipts.legacy,...evidence,...state.feedback.filter(e=>!known.has(e.id)).map(correctionEvidence)]};
}

// A confirmed save, a removal or a restore is the user's own action on an item. Items Jules
// merely sent are workflow history, not evidence of interest.
export function wishlistEvidence(action,item,{reply_id=null,at=new Date().toISOString()}={}){
 return {id:`wishlist:${action}:${item.id}:${action==='saved'&&reply_id?reply_id:at}`,kind:'wishlist_event',origin:'wishlist',
  source:{type:action==='saved'?'message':'wishlist_page',id:reply_id},recorded_by:'user',
  data:{action,item_id:item.id,name:item.name??null,urls:(item.links??[]).map(l=>l.url).slice(0,5),at}};
}
