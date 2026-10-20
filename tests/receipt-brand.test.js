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
 assert.equal(state.items[0].merchant,'MFPEN Retail ApS','only the brand is cleaned');
});

test('a brand the person set themself is kept exactly as written',()=>{
 const state=projectReceiptEvidence(owner,[record(1,'MFPEN Retail ApS')]).state;
 const fixed=applyReceiptFeedback(state,{id:'closet:1',owner_id:owner,source:'closet_edit',at:new Date().toISOString(),item_ids:['item-1'],action:'correct_fields',values:{brand:'MFPEN Studio Ltd'}});
 assert.equal(fixed.items[0].brand,'MFPEN Studio Ltd');
 const replayed=projectReceiptEvidence(owner,[record(1,'MFPEN Retail ApS'),correctionEvidence(fixed.feedback.at(-1))]).state;
 assert.equal(replayed.items[0].brand,'MFPEN Studio Ltd');
});
