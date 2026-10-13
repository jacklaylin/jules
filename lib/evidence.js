import {projectReceiptEvidence,legacyReceiptEvidence,correctionEvidence,projectReceiptState,receiptShoppingFacts} from './receipt-extraction.js';
import {receiptLearningView} from './receipt-feedback.js';

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
// The purchase summary is a cache of the view, refreshed on every write; it is never a belief.
export function receiptWrite(data,receipts,state=receipts.state,evidence=[]){
 const {feedback,pending,...rest}=data,known=new Set(receipts.state.feedback.map(e=>e.id));
 return {data:{...rest,questions:state.questions,history_summary:purchaseSummary(state)},evidence:[...receipts.legacy,...evidence,...state.feedback.filter(e=>!known.has(e.id)).map(correctionEvidence)]};
}
// Compact purchase history for the agent and search prompts: counts and recent items instead of
// one entry per purchase. Soft evidence only: no favorites, fit or ownership claims.
export function purchaseSummary(state,now=Date.now()){
 const view=receiptLearningView(projectReceiptState(state)),recent=now-2*365*86400000;
 const dated=item=>{const at=(item.source_events??[]).filter(e=>e.kind==='purchased'&&Number.isFinite(e.at)).map(e=>e.at);return at.length?Math.min(...at):null;};
 const personal=view.purchase_history.filter(i=>view.learning_observations.some(o=>o.item_id===i.id));
 const top=field=>Object.values(personal.reduce((m,i)=>{const name=i[field];if(!name)return m;const k=name.toLowerCase();m[k]??={name,count:0,recent:0};m[k].count++;if((dated(i)??0)>=recent)m[k].recent++;return m;},{}))
  .sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name)).slice(0,8);
 const sizes=Object.values(personal.reduce((m,i)=>{if(!i.size_label)return m;const k=[i.size_label,i.size_system??''].join('|');m[k]??={size:i.size_label,system:i.size_system??null,count:0};m[k].count++;return m;},{})).sort((a,b)=>b.count-a.count).slice(0,6);
 const latest=[...personal].sort((a,b)=>(dated(b)??0)-(dated(a)??0)).slice(0,8).map(i=>({brand:i.brand??null,product:i.product??null,merchant:i.merchant??null,color:i.color??null,size:i.size_label??null,
  purchased:dated(i)?new Date(dated(i)).toISOString().slice(0,10):null,outcome:i.outcome?.value??'unknown'}));
 return {items:view.purchase_history.length,personal_items:personal.length,recent_personal_items:personal.filter(i=>(dated(i)??0)>=recent).length,
  top_brands:top('brand'),top_merchants:top('merchant'),purchased_sizes:sizes,latest_items:latest,
  meaning:'Receipt-derived shopping history: soft evidence, not favorites, verified fit, ownership or a size default.'};
}
// Reads the cached summary when the import has been written since this change; otherwise rebuilds.
// Full per-item detail is loaded only when something needs it (discovery ranking).
export async function purchaseHistory(store,owner){
 const row=await store.gmailImport(owner);
 if(!row)return {items:0,summary:null,detail:async()=>[]};
 let receipts=null;const load=async()=>receipts??=await loadReceipts(store,owner,row);
 const cached=!row.data?.feedback&&row.data?.history_summary;
 const summary=cached||purchaseSummary((await load()).state);
 return {items:summary.items,summary:summary.items?summary:null,
  detail:async()=>{const {state}=await load();return state.items.length?receiptShoppingFacts(state,receiptLearningView(projectReceiptState(state))):[];}};
}


// A confirmed save, a removal or a restore is the user's own action on an item. Items Jules
// merely sent are workflow history, not evidence of interest.
export function wishlistEvidence(action,item,{reply_id=null,at=new Date().toISOString()}={}){
 return {id:`wishlist:${action}:${item.id}:${action==='saved'&&reply_id?reply_id:at}`,kind:'wishlist_event',origin:'wishlist',
  source:{type:action==='saved'?'message':'wishlist_page',id:reply_id},recorded_by:'user',
  data:{action,item_id:item.id,name:item.name??null,urls:(item.links??[]).map(l=>l.url).slice(0,5),at}};
}
