// Gmail retrieval syntax only. The model interprets shopping evidence and intent.
export const HISTORY_YEARS=5, RECENT_YEARS=2, EMAIL_LIMIT=1000;
// Subject terms in parentheses match words anywhere in the subject, so templated subjects with an order
// number between the words ("Order #1234 confirmed", "A shipment from order #1234 is on the way",
// "Order #1234 has been canceled", the store-platform defaults many brand shops send) are found too.
const core='{subject:receipt subject:invoice subject:"order confirmation" subject:(order confirmed) subject:"purchase confirmation" subject:"your order" subject:(thank order) subject:(thanks order) subject:(thank purchase) subject:(order shipped) subject:(order shipment) subject:facture subject:commande}';
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
  {name:'known_stores',query:null,budget:150},
  {name:'recent_discovery',query:query(recent,before,broad),budget:10},
  {name:'recent_backlog',query:query(recent,before,broad),budget:350},
  {name:'older_receipts',query:query(after,recent,core),budget:250},
  {name:'older_returns',query:query(after,recent,events),budget:100},
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
export function knownStoreQuery(data,job){
 const domains=storeDomains(data);
 return domains.length?`after:${job.after} before:${job.before} -in:spam -in:trash {${domains.map(d=>'from:'+d).join(' ')}} ${storeTerms}`:null;
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
 const stage=job.search_plan[job.search_index],seen=new Set(job.ids);
 const remaining=Math.min(stage.budget-stage.admitted,job.limit-job.ids.length);
 const fresh=[...new Set((page.messages??[]).map(m=>m.id).filter(id=>typeof id==='string'&&id.length<=200&&!seen.has(id)))];
 const incoming=fresh.filter(id=>!already.has(id));
 if(fresh.length>incoming.length){stage.already_read=(stage.already_read??0)+fresh.length-incoming.length;job.already_read=(job.already_read??0)+fresh.length-incoming.length;}
 const admitted=incoming.slice(0,Math.max(0,remaining));
 job.ids.push(...admitted);stage.admitted+=admitted.length;stage.pages++;
 stage.page=page.nextPageToken??null;
 const truncated=incoming.length>admitted.length||Boolean(stage.page&&(stage.admitted>=stage.budget||stage.pages>=40));
 if(!stage.page||stage.admitted>=stage.budget||stage.pages>=40||job.ids.length>=job.limit){stage.done=true;stage.page=null;}
 if(truncated)stage.truncated=true;
 job.limited=job.ids.length>=job.limit;
 job.status='extracting';
}
export function advanceSearch(job){
 const stage=job.search_plan[job.search_index];
 if(stage.done)job.search_index++;
 job.status=job.search_index>=job.search_plan.length||job.ids.length>=job.limit?'questions':'listing';
}
export function captureYield(job,feedback){
 const items=feedback.items.filter(i=>!i.purchase_disputed&&!i.duplicate_of&&!job.baseline_items?.includes(i.id));
 const outcomes=items.filter(i=>(i.source_events??[]).some(e=>['returned','refunded','return_requested','cancelled'].includes(e.kind))).length;
 const snapshot={emails:job.processed.length,purchases:items.length,outcome_items:outcomes};
 if(job.processed.length>=100&&!job.first_100)job.first_100=snapshot;
 job.current_yield=snapshot;
}
