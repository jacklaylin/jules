import test from 'node:test';
import assert from 'node:assert/strict';
import {completionText,profileText,announceImport,nextReceiptQuestion,sendProfile,SHARPEN} from '../lib/receipt-notifications.js';
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
 assert.ok(!/questions/.test(completionText({...state,questions:[{status:'open'}]},['gmail'],{summary:true})),'the summary that follows leads into the questions instead');
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
function ledger(rows,{questions=[],job={status:'ready',started_at:'s1'},optedOut=false}={}){
 const operations=new Map(),sent=[];
 return {sent,operations,gmailImport:async()=>({data:{job,questions}}),evidence:async()=>rows,operation:async k=>operations.get(k),conversation:async()=>({id:owner,line:'l',sender_id:'p'}),
  reserve:async(o,k,body)=>{if(operations.has(k))return false;operations.set(k,{conversation_id:o,status:optedOut?'blocked':'sending',body});return !optedOut;},finish:async(k,status)=>{operations.get(k).status=status;},
  send:async(d,body)=>{sent.push(body);}};
}
// The import texts in the order they were sent, by kind: ready (the count), profile, question.
const kinds=store=>[...store.operations.keys()].map(k=>k.split(':')[2]);
const body=(store,kind)=>[...store.operations.entries()].find(([k])=>k.split(':')[2]===kind)?.[1].body;
test('the summary follows the count straight away; open questions come after it, framed as sharpening it',async()=>{
 const questions=[{id:'q1',status:'open',question:'Were the BODE shirts for you?',item_ids:['item-4']}];
 const store=ledger(labelled,{questions});
 await announceImport(store,owner,{},store.send);
 assert.deepEqual(kinds(store),['ready','profile','question']);
 assert.ok(!/questions/.test(body(store,'ready')),'the count no longer leads into the questions');
 assert.ok(body(store,'profile').endsWith(SHARPEN),'the summary leads into them');
 assert.equal(store.sent[2],'Were the BODE shirts for you?');
 questions[0].status='answered';await nextReceiptQuestion(store,owner,{},store.send);
 assert.deepEqual(kinds(store),['ready','profile','question'],'nothing more once the questions are done: the summary is not resent');
});
test('with no questions the summary is the last import text and has no lead-in; never before completion',async()=>{
 let store=ledger(labelled);await announceImport(store,owner,{},store.send);
 assert.deepEqual(kinds(store),['ready','profile']);assert.ok(!store.sent[1].includes(SHARPEN));
 store=ledger(labelled,{job:{status:'extracting',started_at:'s1'}});await nextReceiptQuestion(store,owner,{},store.send);assert.equal(store.sent.length,0);
 store=ledger(labelled);assert.equal(await sendProfile(store,owner,{},store.send),null,'no summary while the count is unsent');assert.equal(store.sent.length,0);
});
test('fewer than 2 purchases and no photos: no summary, and the count keeps the lead-in to the questions',async()=>{
 const questions=[{id:'q1',status:'open',question:'Were the jeans for you?',item_ids:['item-1']}];
 const store=ledger([buy(1,{})],{questions});
 await announceImport(store,owner,{},store.send);
 assert.deepEqual(kinds(store),['ready','question']);assert.match(body(store,'ready'),/quick questions/);
});
test('a replayed delivery sends nothing twice: count, summary and question stay once each',async()=>{
 const questions=[{id:'q1',status:'open',question:'Q?',item_ids:['item-4']}];
 const store=ledger(labelled,{questions});
 await announceImport(store,owner,{},store.send);
 const result=await announceImport(store,owner,{},store.send);
 await nextReceiptQuestion(store,owner,{},store.send);
 assert.equal(result.duplicate,true);assert.deepEqual(kinds(store),['ready','profile','question']);assert.equal(store.sent.length,3);
});
test('an opted-out number gets nothing, the summary included',async()=>{
 const store=ledger(labelled,{optedOut:true});
 await announceImport(store,owner,{},store.send);await nextReceiptQuestion(store,owner,{},store.send);
 assert.equal(store.sent.length,0);assert.deepEqual(kinds(store),['ready'],'the summary never tries once the count was blocked');
});
test('the 24-hour sweep is not needed for the first summary; it only picks up one still unsent',async()=>{
 const store=ledger(labelled,{questions:[{id:'q1',status:'open',question:'Q?'}]});
 await announceImport(store,owner,{},store.send);
 assert.deepEqual(kinds(store),['ready','profile','question'],'sent with the count, a question still open');
 const sweepStore={...store,gmailProfilesDue:async()=>[owner],quietGmailImports:async()=>[]};
 assert.equal((await sweepGmailImports(sweepStore,{})).profiles,0,'nothing left for the sweep');
 // An interrupted send (count out, summary not): the sweep sends it, open question or not.
 const interrupted=ledger(labelled,{questions:[{id:'q1',status:'open',question:'Q?'}]});
 interrupted.operations.set('gmail:owner:ready:s1',{status:'sent'});interrupted.operations.set('gmail:owner:question:s1:q1',{status:'sent'});
 const result=await sweepGmailImports({...interrupted,gmailProfilesDue:async()=>[owner],quietGmailImports:async()=>[]},{},{profile:(s,o,e)=>sendProfile(s,o,e,interrupted.send)});
 assert.equal(result.profiles,1);assert.match(interrupted.sent[0],/what your purchases show so far/);
});
test('a re-import asks a still-unanswered question again once, so the completion text is never left hanging',async()=>{
 const questions=[{id:'q1',status:'open',question:'Were the BODE shirts for you?',item_ids:['item-4']}];
 const store=ledger(labelled,{questions,job:{status:'ready',started_at:'import-1'}});
 await announceImport(store,owner,{},store.send);assert.deepEqual(kinds(store),['ready','profile','question']);
 const again=ledger(labelled,{questions,job:{status:'ready',started_at:'import-2'}});
 for(const [k,v] of store.operations)again.operations.set(k,v);
 await announceImport(again,owner,{},again.send);
 assert.equal(again.sent.length,3,'the new round gets its count, its own summary and the question');assert.equal(again.sent[2],'Were the BODE shirts for you?');
 await nextReceiptQuestion(again,owner,{},again.send);assert.equal(again.sent.length,3,'asked once per import');
});
test('one completion text names every source read in the round',async()=>{
 const {importRound}=await import('../lib/receipt-notifications.js');
 const state={items:[],questions:[]};
 assert.match(completionText(state,['gmail','shop']),/^done reading your shopping emails and Shop orders\./);
 assert.match(completionText(state,['shop']),/^done reading your Shop orders\./);
 const at='2026-10-15T05:00:00Z';
 assert.deepEqual(importRound({job:{status:'ready',started_at:at},connections:{shop:{status:'ready',imported_at:'2026-10-15T05:02:00Z'}}}),{key:at,done:true,sources:['gmail','shop']});
 assert.deepEqual(importRound({job:{status:'ready',started_at:at},connections:{shop:{status:'awaiting_approval'}}}).sources,['gmail'],'a source still waiting is left out');
 assert.deepEqual(importRound({connections:{shop:{status:'ready',imported_at:at}}}),{key:'shop:'+at,done:true,sources:['shop']});
 assert.equal(importRound({job:{status:'extracting',started_at:at}}).done,false);
});
test('a Shop-only import gets the completion text and its questions',async()=>{
 const questions=[{id:'q1',status:'open',question:'Were the BODE shirts for you?'}];
 const store=ledger(labelled,{questions,job:undefined});const at='2026-10-15T05:00:00Z';
 store.gmailImport=async()=>({data:{questions,connections:{shop:{status:'ready',imported_at:at}}}});
 await announceImport(store,owner,{},store.send);
 assert.match(store.sent[0],/^done reading your Shop orders\. i found 5/);assert.equal(store.sent.at(-1),'Were the BODE shirts for you?');
});
