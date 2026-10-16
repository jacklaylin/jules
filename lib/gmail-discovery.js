import {folded} from './receipt-feedback.js';
// Gmail retrieval syntax only. The model interprets shopping evidence and intent.
export const HISTORY_YEARS=5, RECENT_YEARS=2, EMAIL_LIMIT=1000;
// Any subject containing an order or purchase word, wherever it sits: stores word these subjects in
// endless ways ("MAAP Order Summary", "Order #1234 confirmed", "A shipment from order #1234 is on the
// way", "Your purchase from X"), so no list of exact phrases keeps up. Marketing that happens to use
// one of these words is left to triage.
const core='{subject:order subject:orders subject:ordered subject:purchase subject:purchased subject:receipt subject:invoice subject:facture subject:commande subject:bestellung subject:pedido subject:ordine}';
const events='{subject:refund subject:refunded subject:return subject:returned subject:cancelled subject:canceled subject:retour}';
const broad='{receipt invoice "order confirmation" "order confirmed" "your order" "purchase confirmation" "return confirmation" "return received" "return accepted" refund refunded cancelled canceled "return label" "collection booking" "shipping confirmation" "order shipped" facture commande retour category:purchases}';
// Order-related words for a known store's own mail; its newsletters are left to triage.
const storeTerms='{order receipt invoice shipped shipment refund return cancelled canceled}';
const DOMAIN=/^([a-z0-9-]+\.)+[a-z]{2,}$/i;
// Technical: personal mailbox providers. A forwarded receipt can come from one, but searching
// everything from it would read personal mail rather than a store's.
const MAILBOXES=new Set(['gmail.com','googlemail.com','hotmail.com','outlook.com','live.com','msn.com','yahoo.com','ymail.com','icloud.com','me.com','mac.com','aol.com','proton.me','protonmail.com','gmx.com','gmx.net','fastmail.com','hey.com']);
// Technical: the registrable part of a sender domain ("m.ssense.com" -> "ssense.com").
export function storeDomain(domain){
 const parts=String(domain??'').toLowerCase().split('.').filter(Boolean);if(parts.length<2)return null;
 return parts.slice(parts.length>2&&parts.at(-1).length===2&&['co','com','net','org'].includes(parts.at(-2))?-3:-2).join('.');
}
// Registrable domains of senders that produced shopping evidence, excluding personal mailboxes.
export function storeDomains(data,limit=40){
 return [...new Set((data.sources??[]).filter(s=>s.shopping_evidence!==false).map(s=>storeDomain(s.sender_domain)).filter(d=>d&&DOMAIN.test(d)&&!MAILBOXES.has(d)))].slice(0,limit);
}
export function yearsAgo(now,years){const d=new Date(now);d.setUTCFullYear(d.getUTCFullYear()-years);return Math.floor(d.getTime()/1000);}
export function discoveryPlan(now){
 const before=Math.floor(now/1000),recent=yearsAgo(now,RECENT_YEARS),after=yearsAgo(now,HISTORY_YEARS);
 const query=(from,to,terms)=>`after:${from} before:${to} -in:spam -in:trash ${terms}`;
 return [
  {name:'recent_receipts',query:query(recent,before,core),budget:50},
  {name:'recent_returns',query:query(recent,before,events),budget:25},
  {name:'related_orders',query:null,budget:15},
  // Every order email from stores already found, across the whole window, ahead of the generic
  // searches whose results are mostly other mail. One email from a store finds the rest of its orders.
  storeStage('known_stores'),
  {name:'recent_discovery',query:query(recent,before,broad),budget:10},
  // The rest of the recent order-subject emails come before the body-word searches, whose results
  // are mostly other mail.
  {name:'recent_receipts_backlog',query:query(recent,before,core),budget:250},
  {name:'recent_backlog',query:query(recent,before,broad),budget:350},
  // Stores first found during this import get the same search before the older passes, and again
  // before the last one, instead of waiting for the next import.
  storeStage('new_stores'),
  {name:'older_receipts',query:query(after,recent,core),budget:250},
  {name:'older_returns',query:query(after,recent,events),budget:100},
  storeStage('later_stores'),
  {name:'older_discovery',query:query(after,recent,broad),budget:EMAIL_LIMIT}
 ].map(s=>({...s,admitted:0,pages:0,page:null,done:false}));
}
export function relatedOrderQuery(data,job){
 const pairs=[];
 for(const item of data.feedback?.items??[]){
  const reference=item.original?.order_reference??item.order_reference;
  if(typeof reference!=='string'||reference.length<3||reference.length>100)continue;
  const source=(data.sources??[]).find(s=>item.source_ids.includes(s.id)&&s.date>=job.recent_after*1000);
  const domain=source?.sender_domain;
  if(!domain||!/^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(domain))continue;
  const pair=`(from:${domain} "${reference.replace(/["\\]/g,' ')}")`;
  if(!pairs.includes(pair))pairs.push(pair);if(pairs.length===8)break;
 }
 return pairs.length?`after:${job.after} before:${job.before} -in:spam -in:trash {${pairs.join(' ')}}`:null;
}
// Store searches run one store at a time with their own allowance, so a store with many emails cannot
// crowd out the others. Each store is searched once per import (job.stores_searched); stores whose
// search was cut short by the stage allowance are picked up by the next store stage.
export const STORE_BUDGET=150,PER_STORE=40,STORE_PAGES=10;
export function storeStage(name){return {name,stores:true,query:null,budget:STORE_BUDGET,per_store:PER_STORE,queue:null,store:null,store_admitted:0,store_pages:0};}
// The next store's query, or null when every store found so far has been searched. Most recently
// found stores come first: they have had the least searching.
export function nextStoreQuery(stage,data,job){
 if(!stage.store){
  const searched=new Set(job.stores_searched??[]);
  const store=storeDomains({sources:[...(data.sources??[])].reverse()},1000).find(d=>!searched.has(d));
  if(!store)return null;
  Object.assign(stage,{store,store_admitted:0,store_pages:0,page:null});
 }
 return `after:${job.after} before:${job.before} -in:spam -in:trash from:${stage.store} ${storeTerms}`;
}
export function admitStorePage(job,page,already=new Set()){
 const stage=job.search_plan[job.search_index];
 const remaining=Math.min(stage.per_store-stage.store_admitted,stage.budget-stage.admitted,job.limit-job.ids.length);
 const admitted=admitIds(job,stage,page,already,remaining);
 stage.store_admitted+=admitted.length;stage.store_pages++;stage.pages++;
 const next=page.nextPageToken??null,more=Boolean(next)&&stage.store_pages<STORE_PAGES;
 stage.page=more&&stage.store_admitted<stage.per_store?next:null;
 if(!stage.page){
  if(more)(job.stores_capped??=[]).includes(stage.store)||job.stores_capped.push(stage.store);
  (job.stores_searched??=[]).push(stage.store);stage.store=null;
 }
 if(stage.admitted>=stage.budget||job.ids.length>=job.limit){
  // A store cut short here is not marked searched, so the next store stage continues it.
  if(stage.store)stage.truncated=true;
  stage.done=true;stage.store=null;stage.page=null;
 }
 job.limited=job.ids.length>=job.limit;
 // A store with nothing new goes straight on to the next store or stage.
 if(admitted.length)job.status='extracting';else advanceSearch(job);
}
// Technical: new ids from a page, minus ones this job already has and ones already read, up to remaining.
function admitIds(job,stage,page,already,remaining){
 const seen=new Set(job.ids);
 const fresh=[...new Set((page.messages??[]).map(m=>m.id).filter(id=>typeof id==='string'&&id.length<=200&&!seen.has(id)))];
 const incoming=fresh.filter(id=>!already.has(id));
 if(fresh.length>incoming.length){stage.already_read=(stage.already_read??0)+fresh.length-incoming.length;job.already_read=(job.already_read??0)+fresh.length-incoming.length;}
 const admitted=incoming.slice(0,Math.max(0,remaining));
 if(incoming.length>admitted.length)stage.truncated=true;
 job.ids.push(...admitted);stage.admitted+=admitted.length;
 return admitted;
}
export function discoveryQuery(stage,data){
 if(!['recent_discovery','recent_backlog','older_discovery'].includes(stage.name))return stage.query;
 const domains=storeDomains(data,20);
 if(!domains.length)return stage.query;
 const index=stage.query.indexOf('{');
 return stage.query.slice(0,index)+'{'+stage.query.slice(index+1,-1)+' (filename:pdf {'+domains.map(d=>'from:'+d).join(' ')+'})}';
}
// already: emails earlier imports read and found irrelevant under the current reading rules. They are
// passed over without using the email limit, so a repeat import reaches further back instead of
// spending its limit on the same newest emails again.
export function admitPage(job,page,already=new Set()){
 const stage=job.search_plan[job.search_index];
 const admitted=admitIds(job,stage,page,already,Math.min(stage.budget-stage.admitted,job.limit-job.ids.length));stage.pages++;
 stage.page=page.nextPageToken??null;
 const truncated=Boolean(stage.page&&(stage.admitted>=stage.budget||stage.pages>=40));
 if(!stage.page||stage.admitted>=stage.budget||stage.pages>=40||job.ids.length>=job.limit){stage.done=true;stage.page=null;}
 if(truncated)stage.truncated=true;
 job.limited=job.ids.length>=job.limit;
 // A page with nothing new goes straight on to the next page or stage, without an empty reading step.
 if(admitted.length)job.status='extracting';else advanceSearch(job);
}
export function advanceSearch(job){
 const stage=job.search_plan[job.search_index];
 if(stage.done)job.search_index++;
 job.status=job.search_index>=job.search_plan.length||job.ids.length>=job.limit?'questions':'listing';
}
export function captureYield(job,feedback){
 const items=feedback.items.filter(i=>!i.purchase_disputed&&!folded(i)&&!job.baseline_items?.includes(i.id));
 const outcomes=items.filter(i=>(i.source_events??[]).some(e=>['returned','refunded','return_requested','cancelled'].includes(e.kind))).length;
 const snapshot={emails:job.processed.length,purchases:items.length,outcome_items:outcomes};
 if(job.processed.length>=100&&!job.first_100)job.first_100=snapshot;
 job.current_yield=snapshot;
}
