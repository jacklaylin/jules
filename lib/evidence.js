import {merchantKey,purchasedAt,projectReceiptEvidence,legacyReceiptEvidence,correctionEvidence,projectReceiptState,receiptShoppingFacts} from './receipt-extraction.js';
import {receiptLearningView} from './receipt-feedback.js';
import {HISTORY_ORIGINS} from './connected-sources.js';

// Evidence rows are the only place proof lives. Receipt history is rebuilt from them;
// gmail_imports keeps job state, raw prepared emails and open questions only.
export async function loadReceipts(store,owner,row){
 const data=row?.data??{};
 // Pre-evidence imports convert in memory until their next write persists the rows.
 const legacy=data.feedback?legacyReceiptEvidence(data.feedback,data.pending??[]):[];
 // Every history source replays together in recorded order, so an order found by two sources is one item.
 const rows=data.feedback?legacy:await store.evidence(owner,HISTORY_ORIGINS,{exclude:'photo_observation'});
 return {...projectReceiptEvidence(owner,rows,data.questions??data.feedback?.questions??[]),legacy};
}
// Splits a changed receipt state into job data (questions) and new evidence rows (corrections).
// The purchase summary is a cache of the view, refreshed on every write; it is never a belief.
export function receiptWrite(data,receipts,state=receipts.state,evidence=[]){
 const {feedback,pending,...rest}=data,known=new Set(receipts.state.feedback.map(e=>e.id));
 const orders=[...(receipts.orders??[]),...evidence.filter(e=>e.kind==='order_summary').map(e=>e.data)];
 return {data:{...compactSources(rest,state,receipts.pending),questions:state.questions,history_summary:purchaseSummary(state,Date.now(),orders)},evidence:[...receipts.legacy,...evidence,...state.feedback.filter(e=>!known.has(e.id)).map(correctionEvidence)]};
}
// Email text is never kept after analysis; proof lives in evidence quotes. Shopping emails keep
// small metadata for related-order search and change detection; every other email keeps only its
// id so a later import does not fetch it again. Older imports are compacted on their next write.
export function compactSources(data,state,pending=[]){
 if(!data.sources&&!data.changed_sources)return data;
 const used=new Set([...state.items.flatMap(i=>i.source_ids),...pending.map(p=>p.source_id)]),scanned=new Set(data.scanned_ids??[]),sources=[];
 for(const {text,...source}of data.sources??[]){if(source.shopping_evidence||used.has(source.id))sources.push({...source,shopping_evidence:true});else scanned.add(source.id);}
 return {...data,sources,scanned_ids:[...scanned],...(data.changed_sources?{changed_sources:data.changed_sources.map(({id,fingerprint,date})=>({id,fingerprint,date}))}:{})};
}
// Compact purchase history for the agent and search prompts: counts and recent items instead of
// one entry per purchase. Soft evidence only: no favorites, fit or ownership claims.
export function purchaseSummary(state,now=Date.now(),orders=[]){
 const view=receiptLearningView(projectReceiptState(state)),recent=now-2*365*86400000;
 const dated=item=>{const at=(item.source_events??[]).filter(e=>e.kind==='purchased'&&Number.isFinite(e.at)).map(e=>e.at);return at.length?Math.min(...at):null;};
 const personal=view.purchase_history.filter(i=>view.learning_observations.some(o=>o.item_id===i.id));
 const top=field=>Object.values(personal.reduce((m,i)=>{const name=i[field];if(!name)return m;const k=merchantKey(name);m[k]??={name,count:0,recent:0};if(name.length<m[k].name.length)m[k].name=name;m[k].count++;if((dated(i)??0)>=recent)m[k].recent++;return m;},{}))
  .sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name)).slice(0,8);
 const sizes=Object.values(personal.reduce((m,i)=>{if(!i.size_label)return m;const k=[i.size_label,i.size_system??''].join('|');m[k]??={size:i.size_label,system:i.size_system??null,count:0};m[k].count++;return m;},{})).sort((a,b)=>b.count-a.count).slice(0,6);
 const latest=[...personal].sort((a,b)=>(dated(b)??0)-(dated(a)??0)).slice(0,8).map(i=>({brand:i.brand??null,product:i.product??null,merchant:i.merchant??null,color:i.color??null,size:i.size_label??null,
  purchased:dated(i)?new Date(dated(i)).toISOString().slice(0,10):null,outcome:i.outcome?.value??'unknown'}));
 return {items:view.purchase_history.length,personal_items:personal.length,recent_personal_items:personal.filter(i=>(dated(i)??0)>=recent).length,
  top_brands:top('brand'),top_merchants:top('merchant'),purchased_sizes:sizes,latest_items:latest,store_orders:storeOrders(state,orders),
  meaning:'Receipt-derived shopping history: soft evidence, not favorites, verified fit, ownership or a size default. store_orders counts orders per store (from items and from order lists the user screenshotted), returns, and the order totals that were shown; it shows how often and how much they buy at a store, not loyalty.'};
}
const orderKey=ref=>typeof ref==='string'&&ref.trim()?ref.replace(/[#\s]/g,'').toUpperCase():null;
const day=at=>Number.isFinite(at)?new Date(at).toISOString().slice(0,10):null;
// Orders per store across item history and order summaries: an order seen both ways counts once.
// Totals are only those shown on an order list, grouped by currency (never converted).
export function storeOrders(state,orders=[]){
 const stores=new Map(),get=name=>{const k=merchantKey(name);if(!k)return null;if(!stores.has(k))stores.set(k,{store:name,orders:new Set(),returns:new Set(),dates:[],totals:{}});const s=stores.get(k);if(name.length<s.store.length)s.store=name;return s;};
 for(const item of state.items){
  const s=get(item.original?.merchant??item.merchant);if(!s)continue;
  s.orders.add(orderKey(item.original?.order_reference??item.order_reference)??'source:'+item.source_ids[0]);
  const at=purchasedAt(item);if(Number.isFinite(at))s.dates.push(at);
  if((item.source_events??[]).some(e=>['returned','refunded'].includes(e.kind))||item.outcome?.value==='returned')s.returns.add('item:'+item.id);
 }
 for(const o of orders){
  const s=get(o.merchant);if(!s)continue;
  if(o.kind==='return'){s.returns.add('return:'+(orderKey(o.reference)??o.at));if(Number.isFinite(o.at))s.dates.push(o.at);continue;}
  const key=orderKey(o.reference);if(!key)continue;
  const fresh=!s.orders.has(key);s.orders.add(key);if(Number.isFinite(o.at))s.dates.push(o.at);
  if(fresh&&o.total){(s.totals[o.total.currency]??=[]).push(o.total.amount);}
 }
 const median=list=>{const v=[...list].sort((a,b)=>a-b),m=Math.floor(v.length/2);return v.length%2?v[m]:Math.round((v[m-1]+v[m])*50)/100;};
 return [...stores.values()].map(s=>({store:s.store,orders:s.orders.size,returns:s.returns.size,first_order:day(Math.min(...s.dates)),last_order:day(Math.max(...s.dates)),
  order_totals:Object.entries(s.totals).map(([currency,v])=>({currency,orders:v.length,median:median(v),max:Math.max(...v)}))}))
  .sort((a,b)=>b.orders-a.orders||a.store.localeCompare(b.store)).slice(0,10);
}
// Reads the cached summary when the import has been written since this change; otherwise rebuilds.
// Full per-item detail is loaded only when something needs it (discovery ranking).
export async function purchaseHistory(store,owner){
 const row=await store.gmailImport(owner);
 if(!row)return {items:0,summary:null,detail:async()=>[]};
 let receipts=null;const load=async()=>receipts??=await loadReceipts(store,owner,row);
 const cached=!row.data?.feedback&&row.data?.history_summary;
 const summary=cached||(await load(),purchaseSummary(receipts.state,Date.now(),receipts.orders));
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
