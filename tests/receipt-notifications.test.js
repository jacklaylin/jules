import test from 'node:test';
import assert from 'node:assert/strict';
import {completionText,profileText,announceImport,nextReceiptQuestion} from '../lib/receipt-notifications.js';
import {sweepGmailImports} from '../lib/gmail-worker.js';
import {purchaseEvidence,correctionEvidence,emptyReceiptState,projectReceiptEvidence} from '../lib/receipt-extraction.js';

const owner='owner';
const buy=(n,v,kind='purchased')=>purchaseEvidence({event_id:`m${n}:${kind}`,kind,source_id:`m${n}`,at:n,evidence:'x',values:{merchant:'SSENSE',order_reference:'O'+n,sku:null,brand:'Our Legacy',color:null,size_label:'32',size_system:null,quantity:1,units_per_pack:null,product:'Jeans '+n,...v},item_id:'item-'+n});
const fix=(n,action,extra={})=>correctionEvidence({id:'c'+n+action,owner_id:owner,source:'operator_review',at:'2026-10-14T00:00:00Z',item_ids:['item-'+n],action,review:{reason:'correct',note:null},...extra});
const stateOf=rows=>projectReceiptEvidence(owner,rows).state;
const history=[buy(1,{}),buy(2,{merchant:'MFPEN Retail ApS',brand:'MFPEN Retail ApS',size_label:'M'}),buy(3,{merchant:'FARFETCH',brand:'Our Legacy',size_label:'32'}),
 buy(3,{merchant:'FARFETCH',brand:'Our Legacy',size_label:'32'},'returned'),buy(4,{merchant:'Mr Porter',brand:'BODE',size_label:'XL'}),buy(5,{brand:'Gift Brand',size_label:'XS'}),buy(6,{brand:'Not Real'})];
const labelled=[...history,fix(5,'set_recipient',{value:'other',label:'sister'}),fix(6,'dispute_purchase')];

test('the completion text counts confirmed purchases and returns, never removed items',()=>{
 const state=stateOf(labelled);
 assert.match(completionText(state),/found 5 clothing purchases and 1 return\./);
 assert.ok(!/questions/.test(completionText(state)));
 assert.match(completionText({...state,questions:[{status:'open'}]}),/quick questions/);
 assert.match(completionText(emptyReceiptState(owner)),/didn’t find any clothing purchases/);
});
test('the profile summary lists brands, stores and purchased sizes from their own purchases only',()=>{
 const text=profileText(stateOf(labelled));
 assert.match(text,/brands you buy most: Our Legacy, BODE, MFPEN/);
 assert.match(text,/where you shop: FARFETCH, MFPEN, Mr Porter/);
 assert.match(text,/sizes you’ve bought: 32, M, XL/);
 assert.ok(!/Gift Brand|Not Real|XS/.test(text),'gifts and removed items are excluded');
 assert.ok(!/fit|price|\$/.test(text),'no fit or price claims');
 assert.equal(profileText(stateOf([buy(1,{})])),null,'too little history sends nothing');
});
function ledger(rows,{questions=[],job={status:'ready',started_at:'s1'}}={}){
 const operations=new Map(),sent=[];
 return {sent,operations,gmailImport:async()=>({data:{job,questions}}),evidence:async()=>rows,operation:async k=>operations.get(k),conversation:async()=>({id:owner,line:'l',sender_id:'p'}),
  reserve:async(o,k,body)=>{if(operations.has(k))return false;operations.set(k,{status:'sending',body});return true;},finish:async(k,status)=>{operations.get(k).status=status;},
  send:async(d,body)=>{sent.push(body);}};
}
test('completion is followed by the first question; the profile waits until questions are done',async()=>{
 const questions=[{id:'q1',status:'open',question:'Were the BODE shirts for you?',item_ids:['item-4']}];
 const store=ledger(labelled,{questions});
 await announceImport(store,owner,{},store.send);
 assert.equal(store.sent.length,2);assert.match(store.sent[0],/found 5/);assert.equal(store.sent[1],'Were the BODE shirts for you?');
 questions[0].status='answered';await nextReceiptQuestion(store,owner,{},store.send);
 assert.equal(store.sent.length,3);assert.match(store.sent[2],/what i’m learning about your style/);
 await nextReceiptQuestion(store,owner,{},store.send);assert.equal(store.sent.length,3,'the profile is sent once');
});
test('with no questions the profile follows the completion text straight away; never before completion',async()=>{
 let store=ledger(labelled);await announceImport(store,owner,{},store.send);
 assert.equal(store.sent.length,2);assert.match(store.sent[1],/brands you buy most/);
 store=ledger(labelled,{job:{status:'extracting',started_at:'s1'}});await nextReceiptQuestion(store,owner,{},store.send);assert.equal(store.sent.length,0);
});
test('the sweep sends profiles that are due even while a question stays unanswered',async()=>{
 const store=ledger(labelled,{questions:[{id:'q1',status:'open',question:'Q?'}]});
 store.operations.set('gmail:owner:ready:s1',{status:'sent'});store.operations.set('gmail:owner:question:q1',{status:'sent'});
 const sweepStore={...store,gmailProfilesDue:async()=>[owner],quietGmailImports:async()=>[]};
 const {sendProfile}=await import('../lib/receipt-notifications.js');
 const result=await sweepGmailImports(sweepStore,{},{profile:(s,o,e)=>sendProfile(s,o,e,store.send)});
 assert.equal(result.profiles,1);assert.match(store.sent[0],/what i’m learning/);
});
test('a re-import asks a still-unanswered question again once, so the completion text is never left hanging',async()=>{
 const questions=[{id:'q1',status:'open',question:'Were the BODE shirts for you?',item_ids:['item-4']}];
 const store=ledger(labelled,{questions,job:{status:'ready',started_at:'import-1'}});
 await announceImport(store,owner,{},store.send);assert.deepEqual(store.sent.slice(1),['Were the BODE shirts for you?']);
 const again=ledger(labelled,{questions,job:{status:'ready',started_at:'import-2'}});
 for(const [k,v] of store.operations)again.operations.set(k,v);
 await announceImport(again,owner,{},again.send);
 assert.match(again.sent[0],/quick questions/);assert.equal(again.sent[1],'Were the BODE shirts for you?');
 await nextReceiptQuestion(again,owner,{},again.send);assert.equal(again.sent.length,2,'asked once per import');
});
