import test from 'node:test';
import assert from 'node:assert/strict';
import {createReceiptFeedback,applyReceiptFeedback,receiptLearningView} from '../lib/receipt-feedback.js';
import {projectReceiptState} from '../lib/receipt-extraction.js';
import {wardrobeView,wardrobeEvent,removalReason,handleWardrobe} from '../lib/wardrobe.js';

const OWNER='owner-1';
const bought=(id,extra={})=>({id,source_ids:[`gmail:${id}`],brand:'COS',product:`Item ${id}`,merchant:'cos.com',size_label:'M',color:'Navy',
 source_events:[{kind:'purchased',at:Date.parse('2026-01-0'+id.slice(-1)+'T00:00:00Z'),source_id:`gmail:${id}`}],...extra});
const question=(item_ids,topic,extra={})=>({item_ids,topic,fields:[],question:`Question about ${item_ids.join(', ')}?`,reason:'matters',evidence_ids:item_ids.map(id=>`gmail:${id}`),...extra});
const state=(items=[bought('i1'),bought('i2'),bought('i3')],questions=[])=>createReceiptFeedback(OWNER,items,questions);
// Applies one wardrobe input the way the API does: a labelled button becomes a structured event.
const act=(s,input)=>applyReceiptFeedback(s,wardrobeEvent(OWNER,s,input));
const ids=v=>v.items.map(i=>i.id);

test('the wardrobe shows owned purchases newest first and keeps unknown recipients', () => {
 const view=wardrobeView(state());
 assert.deepEqual(ids(view),['i3','i2','i1']);
 assert.equal(view.removed.length,0);
 assert.deepEqual(Object.keys(view.items[0]).sort(),['bought_at','brand','category','color','id','merchant','parts','photo','photo_source','product','size','suggestion'].sort());
});

test('each remove reason maps to its own correction and lands in Removed with that reason', () => {
 for(const [reason,expected] of [['returned','returned'],['gift','gift'],['gone','gone'],['never_bought','never_bought']]){
  const after=act(state(),{action:'remove',item_id:'i1',reason});
  const view=wardrobeView(after);
  assert.ok(!ids(view).includes('i1'),reason);
  assert.deepEqual(view.removed.map(r=>[r.id,r.reason]),[['i1',expected]],reason);
  assert.equal(after.feedback.at(-1).source,'closet_edit');
 }
});

test('restore undoes every kind of removal', () => {
 for(const reason of ['returned','gift','gone','never_bought']){
  const removed=act(state(),{action:'remove',item_id:'i2',reason});
  const restored=act(removed,{action:'restore',item_id:'i2'});
  assert.deepEqual(ids(wardrobeView(restored)),['i3','i2','i1'],reason);
 }
});

test('a cancelled or returned order on the receipt can be restored as kept', () => {
 const cancelled=state([bought('i1',{source_events:[{kind:'purchased',at:1,source_id:'gmail:i1'},{kind:'cancelled',at:2,source_id:'gmail:i1b'}]})]);
 assert.deepEqual(wardrobeView(cancelled).removed.map(r=>r.reason),['cancelled']);
 assert.deepEqual(ids(wardrobeView(act(cancelled,{action:'restore',item_id:'i1'}))),['i1']);
});

test('a gift stops teaching taste; no longer owned keeps the purchase as learning', () => {
 const personal=s=>receiptLearningView(projectReceiptState(s)).learning_observations.map(o=>o.item_id);
 // Both items start as the person's own, so both teach taste.
 const s=state([bought('i1'),bought('i2')],[question(['i1','i2'],'recipient')]);
 const mine=act(s,{action:'answer',question_id:wardrobeView(s).questions[0].id,answer:'mine'});
 assert.deepEqual(personal(mine).sort(),['i1','i2']);
 const gone=act(mine,{action:'remove',item_id:'i1',reason:'gone'});
 assert.equal(removalReason(projectReceiptState(gone).items.find(i=>i.id==='i1')),'gone');
 assert.ok(personal(gone).includes('i1'),'no longer owned is still something they chose');
 const gift=act(gone,{action:'remove',item_id:'i2',reason:'gift'});
 assert.ok(!personal(gift).includes('i2'),'a gift never shapes their taste');
});

test('questions answer with one tap, and Not sure defers without recording a guess', () => {
 const s=state([bought('i1'),bought('i2')],[question(['i1'],'recipient'),question(['i2'],'return')]);
 const view=wardrobeView(s);
 assert.deepEqual(view.questions.map(q=>[q.topic,q.answers]),[['recipient',['mine','gift']],['return',['kept','returned']]]);
 const mine=act(s,{action:'answer',question_id:view.questions[0].id,answer:'mine'});
 assert.equal(mine.items.find(i=>i.id==='i1').recipient.value,'self');
 assert.equal(wardrobeView(mine).questions.length,1);
 const unsure=act(s,{action:'answer',question_id:view.questions[1].id,answer:'not_sure'});
 assert.equal(unsure.items.find(i=>i.id==='i2').outcome.value,'unknown');
 assert.equal(wardrobeView(unsure).questions.length,1);
 const kept=act(s,{action:'answer',question_id:view.questions[1].id,answer:'kept'});
 assert.equal(projectReceiptState(kept).items.find(i=>i.id==='i2').outcome.value,'kept');
 assert.throws(()=>wardrobeEvent(OWNER,s,{action:'answer',question_id:view.questions[0].id,answer:'kept'}),/Choose one of the answers/);
});

test('a duplicate answer folds the copy into the first item', () => {
 const s=state([bought('i1'),bought('i2')],[question(['i1','i2'],'duplicate')]);
 const after=act(s,{action:'answer',question_id:wardrobeView(s).questions[0].id,answer:'same'});
 assert.deepEqual(ids(wardrobeView(after)),['i1']);
 assert.equal(wardrobeView(after).removed.length,0);
});

test('fix details records only the fields that changed', () => {
 const event=wardrobeEvent(OWNER,state(),{action:'fix',item_id:'i1',values:{product:'Item i1',brand:'Uniqlo',size_label:' L ',color:''}});
 assert.deepEqual(event.values,{brand:'Uniqlo',size_label:'L',color:null});
 assert.throws(()=>wardrobeEvent(OWNER,state(),{action:'fix',item_id:'i1',values:{product:'Item i1'}}),/Change at least one detail/);
 assert.throws(()=>wardrobeEvent(OWNER,state(),{action:'fix',item_id:'i1',values:{merchant:'x'}}),/cannot be edited/);
 const after=applyReceiptFeedback(state(),event);
 assert.equal(wardrobeView(after).items.find(i=>i.id==='i1').size,'L');
});

test('invalid wardrobe input is refused before anything is written', () => {
 assert.throws(()=>wardrobeEvent(OWNER,state(),{action:'remove',item_id:'i1',reason:'ugly'}),/Choose why/);
 assert.throws(()=>wardrobeEvent(OWNER,state(),{action:'remove',item_id:'nope',reason:'gone'}),/no longer in your history/);
 assert.throws(()=>wardrobeEvent(OWNER,state(),{action:'restore',item_id:'i1'}),/already in your wardrobe/);
 assert.throws(()=>wardrobeEvent(OWNER,state(),{action:'delete',item_id:'i1'}),/Unknown action/);
});

test('the wardrobe API needs a signed-in person and works without any history', async () => {
 const res=()=>{const r={headers:{},setHeader(k,v){r.headers[k]=v;},writeHead(s){r.statusCode=s;},end(b){r.body=b?JSON.parse(b):null;}};return r;};
 const denied=res();
 await handleWardrobe({method:'GET',headers:{}},denied,{store:{},env:{},auth:async()=>({status:401})});
 assert.equal(denied.statusCode,401);
 const empty=res();
 await handleWardrobe({method:'GET',headers:{}},empty,{store:{gmailImport:async()=>null},env:{JULES_PUBLIC_LINE:'+1 (415) 555-0100'},auth:async()=>({status:200,conversation:'c1'})});
 assert.equal(empty.statusCode,200);
 assert.deepEqual(empty.body.items,[]);
 assert.match(empty.body.text_url,/^sms:\+?\d+/);
});
