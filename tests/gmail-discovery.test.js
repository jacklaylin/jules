import test from 'node:test';
import assert from 'node:assert/strict';
import {discoveryPlan,yearsAgo,relatedOrderQuery,admitPage,advanceSearch,captureYield,discoveryQuery} from '../lib/gmail-discovery.js';
import {newImportJob,CONSENT_VERSION,createGmailHandler} from '../lib/gmail-import.js';
const now=Date.parse('2026-10-12T12:00:00Z');
test('five-year plan starts with recent receipts and returns and reserves related-order discovery',()=>{
 const job=newImportJob(now);assert.equal(job.limit,1000);assert.equal(job.after,yearsAgo(now,5));assert.equal(job.recent_after,yearsAgo(now,2));
 assert.deepEqual(job.search_plan.slice(0,4).map(p=>p.budget),[50,25,15,10]);
 assert.match(job.search_plan[1].query,/refund/);assert.match(job.search_plan[0].query,/subject:receipt/);
 assert.equal(job.search_plan[4].name,'recent_backlog');assert.equal(job.search_plan[5].name,'older_receipts');
 assert.ok(job.search_plan.every(p=>!p.query?.includes('-category:promotions')));
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
 const stage=discoveryPlan(now)[7];assert.ok(!stage.query.includes('filename:pdf'));
 const q=discoveryQuery(stage,{sources:[{shopping_evidence:true,sender_domain:'shop.example'},{shopping_evidence:false,sender_domain:'health.example'}]});
 assert.match(q,/filename:pdf/);assert.match(q,/from:shop.example/);assert.ok(!q.includes('health.example'));
});
test('first-100 yield excludes prior purchases, retains its checkpoint and measures later additions',()=>{
 const job=newImportJob(now);job.baseline_items=['prior'];job.processed=Array.from({length:100},(_,i)=>'m'+i);
 const feedback={items:[{id:'prior'},{id:'a',source_events:[{kind:'returned'}]}]};captureYield(job,feedback);
 assert.equal(job.first_100.purchases,1);assert.equal(job.first_100.outcome_items,1);
 job.processed.push('m100');feedback.items.push({id:'b'});captureYield(job,feedback);
 assert.equal(job.first_100.purchases,1);assert.equal(job.current_yield.purchases,2);
});
