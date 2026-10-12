import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileReceipt,emptyReceiptState,relinkPending,projectReceiptState,projectReceiptEvidence,legacyReceiptEvidence,purchaseEvidence,correctionEvidence} from '../lib/receipt-extraction.js';
import {applyReceiptFeedback,receiptLearningView} from '../lib/receipt-feedback.js';
import {receiptWrite} from '../lib/evidence.js';
import {withObservationEvidence,dehydrateReport,hydrateReport,reportFacts,confirmationEvidence} from '../lib/style.js';
import {validateChanges,chatStatementEvidence} from '../lib/memory.js';

const fact=value=>({value,quote:value});
const text='Shop Order O1 O2 Jeans Shirt Blue White 31 M Brand quantity 1 purchased returned';
const event=(extra={})=>({kind:'purchased',existing_item_id:null,evidence:'purchased',merchant:fact('Shop'),order_reference:fact('O1'),product:fact('Jeans'),sku:fact(null),brand:fact('Brand'),color:fact('Blue'),size_label:fact('31'),size_system:fact(null),quantity:fact('1'),units_per_pack:fact(null),...extra});
const correction=(id,item_ids,action,extra={})=>({id,owner_id:'owner',source:'closet_edit',at:'2026-10-12',item_ids,action,...extra});
const summary=state=>projectReceiptState(state).items.map(i=>({id:i.id,product:i.product,brand:i.brand,recipient:i.recipient,outcome:i.outcome,duplicate_of:i.duplicate_of,disputed:i.purchase_disputed,sources:[...i.source_ids].sort(),events:i.source_events.map(e=>e.id).sort()}));

// Simulates an import: each email's validated records become evidence in order, as importStep persists them.
function importEmails(emails){
 let state=emptyReceiptState('owner'),pending=[];const rows=[];
 for(const [id,events] of emails){
  for(const [index,e] of events.entries()){
   const merged=reconcileReceipt(state,{id,text,date:Date.parse('2026-01-0'+(rows.length%9+1))},{events:[e]},{eventOffset:index});
   state=merged.state;pending.push(...merged.pending);rows.push(...merged.records.map(r=>purchaseEvidence(r,'model:test')));
  }
  ({state,pending}=relinkPending(state,pending));
 }
 return {state,pending,rows};
}

test('receipt history rebuilt from evidence matches the import that recorded it, including pending links and corrections',()=>{
 // A return arrives before its purchase, so it stays pending until the purchase links it.
 const imported=importEmails([['m1',[event({kind:'returned'})]],['m2',[event(),event({product:fact('Shirt'),color:fact('White'),size_label:fact('M'),order_reference:fact('O2')})]],['m3',[event({order_reference:fact('O2'),product:fact('Shirt'),color:fact('White'),size_label:fact('M')})]]]);
 const [jeans,shirt]=imported.state.items.map(i=>i.id);
 let state=imported.state;const corrections=[correction('a',[jeans],'set_recipient',{value:'self'}),correction('b',[shirt],'correct_fields',{values:{brand:'Other brand'}}),correction('c',[shirt],'report_return')];
 for(const c of corrections)state=applyReceiptFeedback(state,c);
 const rows=[...imported.rows,...corrections.map(correctionEvidence)];
 const replayed=projectReceiptEvidence('owner',rows);
 assert.deepEqual(summary(replayed.state),summary(state));
 assert.equal(replayed.pending.length,0);assert.equal(summary(replayed.state).find(i=>i.id===jeans).outcome.value,'returned');
 assert.deepEqual(receiptLearningView(projectReceiptState(replayed.state)).learning_observations.map(o=>o.item_id),[jeans]);
});

test('pre-evidence imports convert once without losing corrections, duplicates, gifts or pending events',()=>{
 const imported=importEmails([['m1',[event(),event({order_reference:fact('O2')})]],['m2',[event({kind:'shipped',order_reference:fact('O2'),product:fact('Shirt')})]]]);
 const [first,second]=imported.state.items.map(i=>i.id);
 let legacy=imported.state;
 legacy=applyReceiptFeedback(legacy,correction('gift',[first],'set_recipient',{value:'other',label:'sister'}));
 legacy=applyReceiptFeedback(legacy,correction('dup',[second],'mark_duplicate',{target_item_id:first}));
 legacy=applyReceiptFeedback(legacy,correction('fix',[first],'correct_fields',{values:{color:'Navy'}}));
 const rows=legacyReceiptEvidence(legacy,imported.pending);
 const replayed=projectReceiptEvidence('owner',rows);
 assert.deepEqual(summary(replayed.state),summary(legacy));assert.equal(replayed.state.items[0].color,'Navy');
 assert.equal(replayed.pending.length,imported.pending.length);
 assert.ok(rows.every(r=>['purchase_event','correction'].includes(r.kind)&&r.origin==='gmail'&&r.id&&r.source.type));
 // The first write after conversion persists those rows and strips proof from job data.
 const write=receiptWrite({feedback:legacy,pending:imported.pending,job:{status:'ready'}},{...replayed,legacy:rows});
 assert.equal(write.data.feedback,undefined);assert.equal(write.data.pending,undefined);assert.deepEqual(write.data.job,{status:'ready'});assert.equal(write.evidence.length,rows.length);
});

test('new corrections become evidence rows; replaying them twice is idempotent',()=>{
 const imported=importEmails([['m1',[event()]]]),id=imported.state.items[0].id,receipts={...projectReceiptEvidence('owner',imported.rows),legacy:[]};
 const changed=applyReceiptFeedback(receipts.state,correction('self',[id],'set_recipient',{value:'self'}));
 const write=receiptWrite({},receipts,changed);
 assert.deepEqual(write.evidence.map(r=>r.id),['correction:self']);
 const twice=projectReceiptEvidence('owner',[...imported.rows,...write.evidence,...write.evidence]);
 assert.equal(twice.state.items[0].recipient.value,'self');assert.equal(twice.state.feedback.length,1);
});

test('style readings are evidence; saved reports keep references; confirmed beliefs cite observation and confirmation',()=>{
 const report={id:'r1',status:'confirmed',analysis:{observations:[
  {id:'o1',text:'Navy knitwear in three outfits',source_ids:['s1','s2'],confidence:'high',basis:'file',preference:{field:'style',key:'navy knitwear',value:'Wears navy knitwear'}},
  {id:'context-notes',text:'I like navy',source_ids:['context'],confidence:'high',basis:'context',preference:null},
  {id:'profile-0',text:'Likes Brand',source_ids:['saved-profile'],confidence:'high',basis:'context',preference:{field:'brand',key:'brand',value:'Likes Brand'}}],crops:[]},
  cards:[{accepted:true,preferences:[{observation_id:'o1',field:'style',key:'navy knitwear',value:'Wears navy knitwear',accepted:true}]}]};
 const {report:backed,evidence}=withObservationEvidence(report);
 assert.deepEqual(evidence.map(e=>[e.id,e.kind]),[['style:r1:o1','photo_observation'],['style:r1:context-notes','user_note']]);
 const stored=dehydrateReport(backed);
 assert.deepEqual(stored.analysis.observations[0],{id:'o1',evidence_id:'style:r1:o1'});assert.equal(stored.analysis.observations[2].text,'Likes Brand');
 assert.deepEqual(hydrateReport(stored,evidence),backed);
 // Evidence removed (inputs changed) means the reading no longer shows it.
 assert.equal(hydrateReport(stored,[]).analysis.observations.length,1);
 const facts=reportFacts(backed,'2026-10-12');
 assert.deepEqual(facts[0].evidence_ids,['style:r1:o1','confirmation:r1:style/style-pack/navy knitwear']);assert.equal(facts[0].basis,'confirmed');
 assert.deepEqual(confirmationEvidence(backed,facts).map(e=>e.id),[facts[0].evidence_ids[1]]);
});

test('chat-stated beliefs cite the quoted message as evidence',()=>{
 const message={id:'00000000-0000-4000-8000-000000000001',direction:'inbound',body:'I wear US men’s 10 in sneakers.',created_at:'2026-10-12T00:00:00Z'};
 const facts=validateChanges([{field:'size',key:'sneakers/us_men',value:'10',action:'set',source_id:message.id,evidence:'I wear US men’s 10'}],[message]);
 assert.equal(facts[0].basis,'stated');
 const rows=chatStatementEvidence(facts);
 assert.deepEqual(rows.map(r=>[r.id,r.kind,r.source.quote]),[[facts[0].evidence_ids[0],'chat_statement','I wear US men’s 10']]);
 assert.match(rows[0].id,/^chat:00000000-0000-4000-8000-000000000001:[0-9a-f]{32}$/);
});
