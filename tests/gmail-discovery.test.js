import test from 'node:test';
import assert from 'node:assert/strict';
import {discoveryPlan,yearsAgo,relatedOrderQuery,knownStoreQuery,admitPage,advanceSearch,captureYield,discoveryQuery} from '../lib/gmail-discovery.js';
import {newImportJob,CONSENT_VERSION,createGmailHandler} from '../lib/gmail-import.js';
const now=Date.parse('2026-10-12T12:00:00Z');
test('five-year plan starts with recent receipts and returns and reserves related-order discovery',()=>{
 const job=newImportJob(now);assert.equal(job.limit,1000);assert.equal(job.after,yearsAgo(now,5));assert.equal(job.recent_after,yearsAgo(now,2));
 assert.deepEqual(job.search_plan.slice(0,5).map(p=>p.budget),[50,25,15,150,10]);
 assert.match(job.search_plan[1].query,/refund/);assert.match(job.search_plan[0].query,/subject:receipt/);
 assert.equal(job.search_plan[3].name,'known_stores');assert.equal(job.search_plan[3].query,null);
 assert.deepEqual(job.search_plan.slice(5,8).map(p=>p.name),['recent_receipts_backlog','recent_backlog','older_receipts']);
 assert.equal(job.search_plan[5].query,job.search_plan[0].query,'remaining order-subject mail comes before body-word searches');
 assert.ok(job.search_plan.every(p=>!p.query?.includes('-category:promotions')));
 assert.match(job.search_plan[4].query,/category:purchases/);assert.ok(!job.search_plan[0].query.includes('category:purchases'));
});
test('discovery pages interleave extraction, deduplicate across passes and enforce the total cap',()=>{
 const job=newImportJob(now);const page={messages:Array.from({length:50},(_,i)=>({id:'m'+i})),nextPageToken:'next'};
 admitPage(job,page);assert.equal(job.status,'extracting');assert.equal(job.ids.length,50);assert.equal(job.search_plan[0].done,true);
 advanceSearch(job);assert.equal(job.search_index,1);admitPage(job,page);assert.equal(job.ids.length,50);
 const capped=newImportJob(now);capped.ids=Array.from({length:990},(_,i)=>'old'+i);admitPage(capped,page);
 assert.equal(capped.ids.length,1000);assert.equal(capped.limited,true);advanceSearch(capped);assert.equal(capped.status,'questions');
});
test('duplicate-only pages progress; exhaustion moves to the next pass',()=>{
 const job=newImportJob(now);job.ids=['same'];admitPage(job,{messages:[{id:'same'}],nextPageToken:'p2'});advanceSearch(job);
 assert.equal(job.search_index,0);assert.equal(job.search_plan[0].page,'p2');admitPage(job,{messages:[]});advanceSearch(job);assert.equal(job.search_index,1);
});
test('related-order search requires actual receipt identity and a valid recent sender domain',()=>{
 const job=newImportJob(now),data={feedback:{items:[{order_reference:'ORDER-123',source_ids:['m1']}]},sources:[{id:'m1',date:now,sender_domain:'shop.example'}]};
 assert.match(relatedOrderQuery(data,job),/from:shop.example "ORDER-123"/);
 data.sources[0].sender_domain='evil.example) OR in:anywhere';assert.equal(relatedOrderQuery(data,job),null);
 data.sources[0].sender_domain='shop.example';data.sources[0].date=1;assert.equal(relatedOrderQuery(data,job),null);
});
test('PDF discovery is scoped to evidence-producing senders, not all private PDFs',()=>{
 const stage=discoveryPlan(now).find(p=>p.name==='older_discovery');assert.ok(!stage.query.includes('filename:pdf'));
 const q=discoveryQuery(stage,{sources:[{shopping_evidence:true,sender_domain:'shop.example'},{shopping_evidence:false,sender_domain:'health.example'},{shopping_evidence:true,sender_domain:'gmail.com'}]});
 assert.match(q,/filename:pdf/);assert.match(q,/from:shop.example/);assert.ok(!q.includes('health.example'));assert.ok(!q.includes('gmail.com'),'a forwarded receipt does not open every personal PDF');
});
test('first-100 yield excludes prior purchases, retains its checkpoint and measures later additions',()=>{
 const job=newImportJob(now);job.baseline_items=['prior'];job.processed=Array.from({length:100},(_,i)=>'m'+i);
 const feedback={items:[{id:'prior'},{id:'a',source_events:[{kind:'returned'}]}]};captureYield(job,feedback);
 assert.equal(job.first_100.purchases,1);assert.equal(job.first_100.outcome_items,1);
 job.processed.push('m100');feedback.items.push({id:'b'});captureYield(job,feedback);
 assert.equal(job.first_100.purchases,1);assert.equal(job.current_yield.purchases,2);
});
// Gmail's subject:word matches that word anywhere in the subject. This mirrors it on synthetic
// subjects shaped like real store templates, including a brand's "<Brand> Order Summary".
const subjectWords=query=>[...query.matchAll(/subject:([a-z]+)\b(?!\))/g)].map(m=>m[1]);
const matches=(query,subject)=>subjectWords(query).some(w=>subject.toLowerCase().split(/[^a-z0-9]+/).includes(w));
test('receipt searches find order and purchase words anywhere in the subject',()=>{
 for(const name of ['recent_receipts','recent_receipts_backlog','older_receipts']){const q=discoveryPlan(now).find(p=>p.name===name).query;
  for(const subject of ['Cycling Brand Order Summary','Order #CB1001 confirmed','A shipment from order #CB1001 is on the way','Your purchase from Cycling Brand','Thanks for your order!','Your Example Store receipt','Invoice INV-77','Votre commande est confirmée','Ihre Bestellung','You ordered: Bib Shorts'])
   assert.ok(matches(q,subject),name+': '+subject);
  assert.ok(!matches(q,'New arrivals this week'),'unrelated subjects are not matched');}
});
test('known-store search covers every order email from stores already found, across the whole window',()=>{
 const job=newImportJob(now);assert.equal(knownStoreQuery({sources:[]},job),null);
 const data={sources:[{shopping_evidence:true,sender_domain:'orders.bigstore.example'},{shopping_evidence:true,sender_domain:'cyclingbrand.example'},{shopping_evidence:true,sender_domain:'bigstore.example'},
  {shopping_evidence:true,sender_domain:'gmail.com'},{shopping_evidence:true,sender_domain:'evil.example) OR in:anywhere'},{shopping_evidence:true,sender_domain:null}]};
 const q=knownStoreQuery(data,job);
 assert.ok(q.startsWith(`after:${job.after} before:${job.before} -in:spam -in:trash `),'five years, not only the recent window');
 assert.match(q,/\{from:bigstore\.example from:cyclingbrand\.example\}/);assert.equal(q.match(/from:bigstore/g).length,1);
 assert.ok(!q.includes('gmail.com'));assert.ok(!q.includes('anywhere'));assert.match(q,/order/);
});
test('emails earlier imports found irrelevant do not use the limit, so a repeat import reaches further back',()=>{
 const job=newImportJob(now);job.search_index=job.search_plan.findIndex(p=>p.name==='older_discovery');job.ids=Array.from({length:990},(_,i)=>'new'+i);
 const already=new Set(Array.from({length:40},(_,i)=>'read'+i));
 admitPage(job,{messages:[...already].map(id=>({id})).concat([{id:'older1'},{id:'older2'}]),nextPageToken:'p2'},already);
 assert.deepEqual(job.ids.slice(-2),['older1','older2']);assert.equal(job.ids.length,992);assert.equal(job.limited,false);
 assert.equal(job.already_read,40);assert.equal(job.search_plan[job.search_index].already_read,40);assert.equal(job.search_plan[job.search_index].page,'p2');
 admitPage(job,{messages:Array.from({length:20},(_,i)=>({id:'deeper'+i}))},already);assert.equal(job.ids.length,1000);assert.equal(job.limited,true);
});
