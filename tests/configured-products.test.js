import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileReceipt,emptyReceiptState,projectReceiptEvidence,purchaseEvidence,RECEIPT_SCHEMA} from '../lib/receipt-extraction.js';
import {applyReceiptFeedback,receiptLearningView,addReceiptQuestions,applyReceiptAnswer} from '../lib/receipt-feedback.js';
import {wardrobeView} from '../lib/wardrobe.js';
import {reviewEvent} from '../lib/purchase-review.js';
import {judgeLabel} from '../lib/receipt-recheck.js';
import {statusOf} from '../public/admin-review.js';

// A bag builder order: the bag is one priced line; the bag body, strap and carabiners chosen for it
// are unpriced lines of their own.
const fact=v=>({value:v,quote:v});
const line=(product,color,extra={})=>({kind:'purchased',basis:{value:'order_confirmation',quote:'Order confirmed'},category:'bag',existing_item_id:null,evidence:product,merchant:fact('Labo Mono'),order_reference:fact('O1'),product:fact(product),sku:fact(null),brand:fact('Labo Mono'),color:fact(color),size_label:fact(null),size_system:fact(null),quantity:fact('1'),units_per_pack:fact(null),recipient:{value:'unknown',quote:null},part_of_event:null,...extra});
const email={id:'m1',date:Date.UTC(2026,7,12),fingerprint:'f',text:'Labo Mono Order confirmed O1 Build Your Sling Bag $123.00 Bag Builder - Medium Sling Bag Gridstop Blue Bag Builder - Climbing Rope Strap Orange Coal Bag Builder - Carabiners Black'};
const proposal=(refs=[null,0,0,0])=>({events:[
 line('Build Your Sling Bag',null,{unit_price:fact('$123.00'),currency:fact(null),part_of_event:refs[0]}),
 line('Bag Builder - Medium Sling Bag','Gridstop Blue',{part_of_event:refs[1]}),
 line('Bag Builder - Climbing Rope Strap','Orange Coal',{part_of_event:refs[2]}),
 line('Bag Builder - Carabiners','Black',{part_of_event:refs[3]})]});
const read=refs=>reconcileReceipt(emptyReceiptState('o'),email,proposal(refs));
const bag=state=>state.items.find(i=>i.product==='Build Your Sling Bag');
const correction=(id,action,item_ids,extra={})=>({id,owner_id:'o',source:'closet_edit',at:'2026-10-15T00:00:00Z',action,item_ids,...extra});

test('the receipt model can mark lines as parts of one configured product',()=>{
 assert.ok(RECEIPT_SCHEMA.properties.events.items.required.includes('part_of_event'));
 const {state,records}=read();
 assert.equal(state.items.length,4,'every line is kept as evidence');
 const parts=state.items.filter(i=>i.part_of);
 assert.equal(parts.length,3);assert.ok(parts.every(p=>p.part_of===bag(state).id));
 assert.equal(records[1].part_of,bag(state).id);
 // One wardrobe item, with the parts listed on it.
 const w=wardrobeView(state);
 assert.equal(w.items.length,1);assert.equal(w.items[0].product,'Build Your Sling Bag');
 assert.deepEqual(w.items[0].parts.map(p=>p.color),['Gridstop Blue','Orange Coal','Black']);
 const history=receiptLearningView(state).purchase_history;
 assert.equal(history.length,1);assert.equal(history[0].parts.length,3);
});

test('replaying stored evidence rebuilds the same grouping',()=>{
 const {state,records}=read();
 const replayed=projectReceiptEvidence('o',records.map(r=>purchaseEvidence(r))).state;
 assert.deepEqual(replayed.items.map(i=>[i.id,i.part_of]),state.items.map(i=>[i.id,i.part_of]));
});

test('code rejects part links that do not name another purchased line of the email',()=>{
 // A self-reference, an out-of-range index and a chain (a part of a part) leave items separate.
 for(const refs of [[0,null,null,null],[null,9,null,null]])assert.equal(read(refs).state.items.filter(i=>i.part_of).length,0);
 const chained=read([null,0,1,null]).state;
 assert.equal(chained.items.find(i=>i.product==='Bag Builder - Climbing Rope Strap').part_of,null);
 // No model grouping: four separate items, as before.
 assert.equal(wardrobeView(read([null,null,null,null]).state).items.length,4);
});

test('a person can fold parts into the product and separate them again',()=>{
 let state=read([null,null,null,null]).state;const id=bag(state).id,parts=state.items.filter(i=>i.id!==id).map(i=>i.id);
 state=applyReceiptFeedback(state,correction('1','mark_part_of',parts,{target_item_id:id}));
 assert.equal(wardrobeView(state).items.length,1);
 // Edits to a part go to the product; a product cannot be folded into its own part.
 assert.throws(()=>applyReceiptFeedback(state,correction('2','set_recipient',[parts[0]],{value:'self'})));
 assert.throws(()=>applyReceiptFeedback(state,correction('3','mark_part_of',[id],{target_item_id:parts[0]})));
 state=applyReceiptFeedback(state,correction('4','separate_part',[parts[0]]));
 assert.equal(wardrobeView(state).items.length,2);
 // The person's separation survives a re-read of the same email.
 const again=reconcileReceipt(state,email,proposal()).state;
 assert.equal(again.items.find(i=>i.id===parts[0]).part_of,null);
});

test('two lines of one built bag merge even when the read already gave one of them parts',()=>{
 // The read grouped the strap and carabiners under the bag body, so the order shows two bags.
 for(const [from,into] of [['Bag Builder - Medium Sling Bag','Build Your Sling Bag'],['Build Your Sling Bag','Bag Builder - Medium Sling Bag']])for(const reason of ['part_of_item','duplicate']){
  let state=read([null,null,1,1]).state;const id=p=>state.items.find(i=>i.product===p).id;
  assert.equal(wardrobeView(state).items.length,2);
  state=applyReceiptFeedback(state,{...reviewEvent('o',{item_ids:[id(from)],reason,target_item_id:id(into),note:null}),at:'2026-10-15T00:00:00Z'});
  const w=wardrobeView(state);
  assert.equal(w.items.length,1,`${reason} ${from}`);assert.equal(w.items[0].product,into);
  // The strap and carabiners move with it; as a part, the merged line is listed too.
  assert.deepEqual(w.items[0].parts.map(p=>p.product).sort(),['Bag Builder - Carabiners','Bag Builder - Climbing Rope Strap',...(reason==='part_of_item'?[from]:[])].sort());
  // The person's merge replays from stored evidence the same way.
  const again=reconcileReceipt(state,email,proposal([null,null,1,1])).state;
  assert.equal(wardrobeView(again).items.length,1);
 }
});

test('questions about parts resolve once they are folded into the product',()=>{
 let state=read([null,null,null,null]).state;const id=bag(state).id,strap=state.items.find(i=>i.color==='Orange Coal').id;
 state=addReceiptQuestions(state,[{item_ids:[strap],topic:'recipient',fields:[],question:'Was the strap for you?',reason:'Recipient unknown.',evidence_ids:['m1']}]);
 state=applyReceiptAnswer(state,{actions:[{item_ids:[strap],action:'mark_part_of',recipient:null,recipient_label:null,corrections:[],target_item_id:id,question_id:null}]},{id:'imessage:1',owner_id:'o',source:'chat_answer',at:'2026-10-15T00:00:00Z'});
 assert.equal(state.questions[0].status,'resolved');
 // New questions skip parts.
 const next=addReceiptQuestions(state,[{item_ids:[strap],topic:'details',fields:['color'],question:'Strap color?',reason:'Unclear.',evidence_ids:['m1']}]);
 assert.equal(next.questions.filter(q=>q.status==='open').length,0);
});

test('admin review labels a part, separates it, and re-check judges the label',()=>{
 const e=reviewEvent('o',{item_ids:['p'],reason:'part_of_item',target_item_id:'bag',note:null});
 assert.equal(e.action,'mark_part_of');assert.equal(e.target_item_id,'bag');
 assert.equal(reviewEvent('o',{item_ids:['p'],reason:'part_of_item',target_item_id:null,note:null}).action,'separate_part');
 assert.throws(()=>reviewEvent('o',{item_ids:['p'],reason:'part_of_item',note:null}));
 assert.equal(statusOf({part_of:'bag',reviews:[]}),'duplicate');
 const item={product:'Strap',merchant:'Labo Mono'},target={product:'Bag',merchant:'Labo Mono'};
 assert.equal(judgeLabel({reason:'part_of_item'},item,[{product:'Strap',merchant:'Labo Mono',part_of:{product:'Bag'}}],target).match,true);
 assert.equal(judgeLabel({reason:'part_of_item'},item,[{product:'Strap',merchant:'Labo Mono',part_of:null}],target).match,false);
});
