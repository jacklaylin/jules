import test from 'node:test';
import assert from 'node:assert/strict';
import {createReceiptFeedback,addReceiptQuestions,applyReceiptFeedback,receiptLearningView,proposeReceiptQuestions,interpretReceiptAnswer,applyReceiptAnswer,refreshReceiptEvidence} from '../lib/receipt-feedback.js';
const item=(id,source)=>({id,source_ids:[source],brand:'Example',product:'Jacket',merchant:'Store',size_label:'50R',quantity:1});
const state=()=>createReceiptFeedback('person',[item('a','s1'),item('b','s2'),item('c','s3')]);
const event=(id,action,item_ids=['a'],extra={})=>({id,owner_id:'person',source:'chat_answer',at:'2026-10-10T12:00:00Z',action,item_ids,...extra});
const question=(ids=['a'],topic='recipient',fields=[])=>({item_ids:ids,topic,fields,question:'Who were these items for?',reason:'Recipient is not established by evidence.',evidence_ids:ids.map(id=>'s'+({a:1,b:2,c:3}[id]))});
test('recipient questions are model proposals, not wording-based routes',async()=>{
 const result=await proposeReceiptQuestions({items:[item('a','s1')]},async request=>{assert.ok(request.schema);assert.ok(request.instructions.includes('already corrected'));return {questions:[question()]};});assert.equal(result.questions.length,1);
});
test('unknown recipient holds personal learning; explicit self permits purchased-size evidence, never fit',()=>{
 let s=state();assert.equal(receiptLearningView(s).learning_observations.length,0);
 s=applyReceiptFeedback(s,event('1','set_recipient',['a'],{value:'self'}));const o=receiptLearningView(s).learning_observations[0];assert.equal(o.purchased_size,'50R');assert.equal(o.confirmed_fit,null);assert.equal(o.kept,null);assert.equal(o.explicit_preference,false);
});
test('closet gift correction revokes prior personal learning without dropping purchase history',()=>{
 let s=applyReceiptFeedback(state(),event('1','set_recipient',['a'],{value:'self'}));assert.equal(receiptLearningView(s).learning_observations.length,1);
 s=applyReceiptFeedback(s,event('2','set_recipient',['a'],{source:'closet_edit',value:'other',label:'sister'}));const v=receiptLearningView(s);assert.equal(v.purchase_history.length,3);assert.equal(v.learning_observations.length,0);assert.equal(s.items[0].original.size_label,'50R');assert.equal(s.items[0].field_provenance.recipient.source,'closet_edit');
});
test('disputed purchase removes dependent history/learning; explicit restore remains possible',()=>{
 let s=applyReceiptFeedback(state(),event('1','set_recipient',['a'],{value:'self'}));s=applyReceiptFeedback(s,event('2','dispute_purchase'));assert.equal(receiptLearningView(s).purchase_history.length,2);assert.equal(receiptLearningView(s).learning_observations.length,0);
 s=applyReceiptFeedback(s,event('3','restore_purchase'));assert.equal(receiptLearningView(s).purchase_history.length,3);
});
test('return correction preserves purchase and never invents refund or disliked size',()=>{
 let s=applyReceiptFeedback(state(),event('1','set_recipient',['a'],{value:'self'}));s=applyReceiptFeedback(s,event('2','report_return'));assert.equal(s.items[0].outcome.refund,'unknown');assert.equal(s.items[0].size_label,'50R');assert.equal(receiptLearningView(s).purchase_history.length,3);assert.equal(receiptLearningView(s).learning_observations[0].explicit_preference,false);
});
test('duplicates count once and preserve source evidence; cycle and root redirection rejected',()=>{
 let s=applyReceiptFeedback(state(),event('1','mark_duplicate',['b'],{target_item_id:'a'}));assert.equal(receiptLearningView(s).purchase_history.length,2);assert.deepEqual(receiptLearningView(s).purchase_history[0].source_ids,['s1','s2']);
 assert.throws(()=>applyReceiptFeedback(s,event('2','mark_duplicate',['a'],{target_item_id:'b'})));assert.throws(()=>applyReceiptFeedback(s,event('3','mark_duplicate',['a'],{target_item_id:'c'})));
});
test('field corrections persist provenance and leave independent fields intact',()=>{
 const s=applyReceiptFeedback(state(),event('1','correct_fields',['a'],{values:{brand:'New brand',quantity:2}}));assert.equal(s.items[0].brand,'New brand');assert.equal(s.items[0].size_label,'50R');assert.equal(s.items[0].original.brand,'Example');assert.equal(s.feedback.length,1);
});
test('answering recipient question resolves it and prevents repeat after reanalysis',()=>{
 let s=addReceiptQuestions(state(),[question()]);const id=s.questions[0].id;s=applyReceiptFeedback(s,event('1','set_recipient',['a'],{value:'other',label:'sister',question_id:id}));assert.equal(receiptLearningView(s).questions.length,0);s=addReceiptQuestions(s,[question()]);assert.equal(s.questions.length,1);
});
test('partial answer retires old grouped wording; model can ask only about remaining items',()=>{
 let s=addReceiptQuestions(state(),[question(['a','b'])]);s=applyReceiptFeedback(s,event('1','set_recipient',['a'],{value:'other'}));assert.equal(s.questions[0].status,'needs_rephrase');assert.deepEqual(s.questions[0].pending_item_ids,['b']);assert.equal(receiptLearningView(s).questions.length,0);s=addReceiptQuestions(s,[question(['b'])]);assert.deepEqual(receiptLearningView(s).questions[0].item_ids,['b']);
});
test('unknown answer defers without generating learning or repeated questions',()=>{
 let s=addReceiptQuestions(state(),[question()]);s=applyReceiptFeedback(s,event('1','defer_question',['a'],{question_id:s.questions[0].id}));assert.equal(s.questions[0].status,'deferred');assert.equal(receiptLearningView(s).learning_observations.length,0);assert.equal(addReceiptQuestions(s,[question()]).questions.length,1);
});
test('foreign references, owners, stale answers, arbitrary profile fields and invalid counts rejected',()=>{
 assert.throws(()=>addReceiptQuestions(state(),[{...question(),evidence_ids:['foreign']} ]));assert.throws(()=>applyReceiptFeedback(state(),{...event('1','report_return'),owner_id:'someone-else'}));assert.throws(()=>applyReceiptFeedback(state(),event('1','report_return',['foreign'])));assert.throws(()=>applyReceiptFeedback(state(),event('1','correct_fields',['a'],{values:{gender:'x'}})));assert.throws(()=>applyReceiptFeedback(state(),event('1','correct_fields',['a'],{values:{quantity:0}})));
 let s=addReceiptQuestions(state(),[question()]);const id=s.questions[0].id;s=applyReceiptFeedback(s,event('1','set_recipient',['a'],{value:'self',question_id:id}));assert.throws(()=>applyReceiptFeedback(s,event('2','set_recipient',['a'],{value:'other',question_id:id})));
});
test('event replay is idempotent, conflicting replay rejected, grouped invalid edits atomic',()=>{
 const original=state(),e=event('1','report_return');const next=applyReceiptFeedback(original,e);assert.deepEqual(applyReceiptFeedback(next,e),next);assert.throws(()=>applyReceiptFeedback(next,{...e,action:'dispute_purchase'}));assert.throws(()=>applyReceiptFeedback(original,event('2','correct_fields',['a','foreign'],{values:{brand:'Other'}})));assert.equal(original.feedback.length,0);
});
test('a model-interpreted partial answer follows the same path as a closet edit',async()=>{
 const s=addReceiptQuestions(state(),[question(['a','b'])]);
 const proposal=await interpretReceiptAnswer(s,'The first was a gift; I am not sure about the other.',async request=>{assert.equal(request.context.message,'The first was a gift; I am not sure about the other.');return {actions:[{action:'set_recipient',item_ids:['a'],recipient:'other',recipient_label:'sister',corrections:[],target_item_id:null,question_id:s.questions[0].id}]};});
 const next=applyReceiptAnswer(s,proposal,{id:'answer-1',owner_id:'person',source:'chat_answer',at:'2026-10-10T12:00:00Z'});assert.equal(next.items[0].recipient.label,'sister');assert.equal(next.items[1].recipient.value,'unknown');assert.equal(next.questions[0].status,'needs_rephrase');
});
test('purchase confirmation resolves its question without establishing ownership',()=>{
 let s=addReceiptQuestions(state(),[question(['a'],'purchase')]);s=applyReceiptFeedback(s,event('1','restore_purchase'));assert.equal(s.questions[0].status,'resolved');assert.equal(s.items[0].recipient.value,'unknown');assert.equal(receiptLearningView(s).learning_observations.length,0);assert.equal(addReceiptQuestions(s,[question(['a'],'purchase')]).questions.length,1);
});
test('new evidence cannot reset user corrections, gift recipient, return or question history',()=>{
 let s=addReceiptQuestions(state(),[question()]);s=applyReceiptFeedback(s,event('1','set_recipient',['a'],{value:'other',label:'sister'}));s=applyReceiptFeedback(s,event('2','correct_fields',['a'],{values:{brand:'Correct brand'}}));s=applyReceiptFeedback(s,event('3','report_return'));
 s=refreshReceiptEvidence(s,[{...item('a','s4'),brand:'Old wrong brand',size_label:'52'}]);assert.equal(s.items[0].brand,'Correct brand');assert.equal(s.items[0].size_label,'52');assert.equal(s.items[0].recipient.label,'sister');assert.equal(s.items[0].outcome.value,'returned');assert.equal(s.questions[0].status,'resolved');assert.equal(s.feedback.length,3);assert.deepEqual(s.items[0].source_ids,['s1','s4']);
});
test('model selects at most five consequential questions from a larger uncertainty set',async()=>{
 const result=await proposeReceiptQuestions({uncertainties:Array.from({length:20},(_,i)=>({id:i}))},async request=>{
  assert.equal(request.schema.properties.questions.maxItems,5);
  assert.ok(request.instructions.includes('most to least important'));
  assert.ok(request.instructions.includes('not five batches'));
  assert.ok(request.instructions.includes('do not automatically refill'));
  return {questions:[question(['c']),question(['a'])]};
 });
 const s=addReceiptQuestions(state(),result.questions);assert.deepEqual(receiptLearningView(s).questions.map(q=>q.item_ids[0]),['c','a']);
});
test('five-question cap applies across updates; over-cap changes are atomic',()=>{
 const items=Array.from({length:7},(_,i)=>item('q'+i,'e'+i));
 const proposals=items.map(i=>({...question(),item_ids:[i.id],evidence_ids:i.source_ids}));
 const original=createReceiptFeedback('person',items);
 assert.throws(()=>addReceiptQuestions(original,proposals.slice(0,6)),/At most five/);
 const s=addReceiptQuestions(original,proposals.slice(0,5));assert.equal(receiptLearningView(s).questions.length,5);
 assert.throws(()=>addReceiptQuestions(s,[proposals[5]]),/At most five open/);
 assert.equal(s.questions.length,5);assert.equal(original.questions.length,0);
 const answered=applyReceiptFeedback(s,event('self','set_recipient',['q0'],{value:'self'}));
 assert.equal(receiptLearningView(answered).questions.length,4);
 assert.equal(answered.questions.length,5); // No automatic refill from lower-priority uncertainties.
});
test('explicit reanalysis replaces the ranked question set without reviving answered or deferred questions',async()=>{
 const {replaceReceiptQuestions}=await import('../lib/receipt-feedback.js');
 let s=addReceiptQuestions(state(),[question(['a']),question(['b']),question(['c'])]);
 s=applyReceiptFeedback(s,event('self','set_recipient',['a'],{value:'self'}));
 s=applyReceiptFeedback(s,event('later','defer_question',['b'],{question_id:s.questions.find(q=>q.item_ids[0]==='b').id}));
 const refreshed=replaceReceiptQuestions(s,[question(['a']),question(['b']),question(['c'])]);assert.deepEqual(receiptLearningView(refreshed).questions.map(q=>q.item_ids),[['c']]);
 const noLongerNeeded=replaceReceiptQuestions(refreshed,[]);assert.equal(receiptLearningView(noLongerNeeded).questions.length,0);assert.equal(noLongerNeeded.feedback.length,2);assert.equal(s.questions.find(q=>q.item_ids[0]==='c').status,'open');
});
