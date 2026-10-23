import test from 'node:test';
import assert from 'node:assert/strict';
import {purchaseEvidence,projectReceiptEvidence,cleanBrand,correctionEvidence} from '../lib/receipt-extraction.js';
import {applyReceiptFeedback} from '../lib/receipt-feedback.js';

const owner='00000000-0000-4000-8000-000000000001';
const record=(n,brand)=>purchaseEvidence({event_id:`m${n}:0`,kind:'purchased',source_id:`m${n}`,at:1700000000000+n,evidence:'Trousers M',category:'clothing',
 values:{merchant:'MFPEN Retail ApS',order_reference:'O'+n,sku:null,brand,color:'Black',product:'Service Trousers',size_label:'M',size_system:null,quantity:1,units_per_pack:null},item_id:'item-'+n});

test('a receipt brand loses the seller’s company suffix, in imports and in replays alike',()=>{
 for(const [raw,clean] of [['MFPEN Retail ApS','MFPEN'],['Apple Inc.','Apple'],['Acme Ltd','Acme'],['Our Legacy','Our Legacy'],['Inc','Inc'],[null,null]])assert.equal(cleanBrand(raw),clean,raw);
 const state=projectReceiptEvidence(owner,[record(1,'MFPEN Retail ApS'),record(2,'Dries Van Noten')]).state;
 assert.deepEqual(state.items.map(i=>i.brand),['MFPEN','Dries Van Noten']);
 // The store is shown the same way (founder, October 23: "make sure it's fixed everywhere").
 assert.equal(state.items[0].merchant,'MFPEN');
});

test('a brand the person set themself is kept exactly as written',()=>{
 const state=projectReceiptEvidence(owner,[record(1,'MFPEN Retail ApS')]).state;
 const fixed=applyReceiptFeedback(state,{id:'closet:1',owner_id:owner,source:'closet_edit',at:new Date().toISOString(),item_ids:['item-1'],action:'correct_fields',values:{brand:'MFPEN Studio Ltd'}});
 assert.equal(fixed.items[0].brand,'MFPEN Studio Ltd');
 const replayed=projectReceiptEvidence(owner,[record(1,'MFPEN Retail ApS'),correctionEvidence(fixed.feedback.at(-1))]).state;
 assert.equal(replayed.items[0].brand,'MFPEN Studio Ltd');
});

test('the store is shown as people say it, everywhere history is read: wardrobe, texts and admin',async()=>{
 const {cleanMerchant}=await import('../lib/receipt-extraction.js');
 for(const [raw,clean] of [['MFPEN Retail ApS','MFPEN'],['SSENSE Inc.','SSENSE'],['FARFETCH','FARFETCH'],['Abercrombie & Co','Abercrombie & Co'],['Mr Porter','Mr Porter'],[null,null]])assert.equal(cleanMerchant(raw),clean,raw);
 const {wardrobeView}=await import('../lib/wardrobe.js');
 const record={event_id:'e1:0',kind:'purchased',source_id:'e1',at:Date.parse('2026-10-02'),evidence:'Service Trousers',
  values:{merchant:'MFPEN Retail ApS',order_reference:'1001',product:'Service Trousers',sku:null,brand:'MFPEN Retail ApS',color:null,size_label:'M/32',size_system:null,quantity:1,units_per_pack:null},item_id:'trousers'};
 const {state}=projectReceiptEvidence('owner',[purchaseEvidence(record)]);
 assert.equal(state.items[0].merchant,'MFPEN');
 assert.equal(wardrobeView(state).items[0].merchant,'MFPEN');
});

test('the answer reader gets a compact history: each item as a person would name it, and only waiting questions',async()=>{
 const {answerView,interpretReceiptAnswer}=await import('../lib/receipt-feedback.js');
 const state=projectReceiptEvidence(owner,[record(1,'MFPEN Retail ApS'),record(2,'Dries Van Noten')]).state;
 const fixed=applyReceiptFeedback(state,{id:'closet:1',owner_id:owner,source:'closet_edit',at:'2026-10-22T00:00:00Z',item_ids:['item-1'],action:'correct_fields',values:{brand:'MFPEN Studio'}});
 fixed.questions=[{id:'q1',topic:'recipient',fields:[],question:'Was this for you?',item_ids:['item-2'],status:'open',reason:'r',evidence_ids:['e2']},{id:'q0',topic:'recipient',fields:[],question:'Old',item_ids:['item-2'],status:'resolved',reason:'r',evidence_ids:['e2']}];
 const view=answerView({...fixed,conversation:[{direction:'inbound'}],return_reminders:[{id:'item-1'}]});
 assert.deepEqual(view.items.map(i=>i.id),['item-1','item-2']);
 const first=view.items[0];
 assert.equal(first.brand,'MFPEN Studio');assert.equal(first.as_first_read.brand,'MFPEN','the original reading is kept when corrected');
 assert.deepEqual(first.events,['purchased']);assert.ok(first.bought);
 for(const k of ['source_events','original','field_provenance','source_ids'])assert.ok(!(k in first),k);
 assert.ok(!('feedback' in view),'no correction log');
 assert.deepEqual(view.questions.map(q=>q.id),['q1']);
 assert.equal(view.conversation.length,1);assert.equal(view.return_reminders[0].id,'item-1');
 let sent;await interpretReceiptAnswer(fixed,'keeping it',async request=>{sent=request.context.state;return {actions:[]};});
 assert.ok(JSON.stringify(sent).length<JSON.stringify(fixed).length/2,'much smaller than the full history');
});

test('stores show as people say them, one spelling per store, while matching keeps each email\'s own name',async()=>{
 const {storeName}=await import('../lib/receipt-extraction.js');
 for(const [raw,shown] of [['Cettire (cettire.com)','Cettire'],['Cotton On Orders (cottonon.com)','Cotton On'],['On Team (on.com)','On'],['MAAP (maap.cc)','MAAP'],['Amazon.com','Amazon'],['FWRD.com','FWRD'],
  ['FitFlop USA','FitFlop'],['Scuffers-UK','Scuffers'],['Suit Supply (U.S.A.)','Suit Supply'],['RC Outdoor Supply®','RC Outdoor Supply'],['RESEARCH STUDIO™','RESEARCH STUDIO'],['CHIMI SAS','CHIMI'],
  ['Tiffany & Co.','Tiffany & Co.'],['J.Crew','J.Crew'],['END.','END.'],['Saks Fifth Avenue','Saks Fifth Avenue'],['On','On']])assert.equal(storeName(raw),shown,raw);
 const rec=(n,merchant)=>purchaseEvidence({event_id:`e${n}:0`,kind:'purchased',source_id:'e'+n,at:Date.parse('2026-10-0'+n),evidence:'Item '+n,
  values:{merchant,order_reference:'O'+n,product:'Item '+n,sku:null,brand:null,color:null,size_label:null,size_system:null,quantity:1,units_per_pack:null},item_id:'item-'+n});
 const {state}=projectReceiptEvidence(owner,[rec(1,'SSENSE'),rec(2,'ssense.com'),rec(3,'SSENSE'),rec(4,'On Team (on.com)')]);
 assert.deepEqual(state.items.map(i=>i.merchant),['SSENSE','SSENSE','SSENSE','On']);
 assert.equal(state.items[3].original.merchant,'On Team (on.com)','the stored name stays as read, for matching');
});
