import test from 'node:test';
import assert from 'node:assert/strict';
import {validTags,untaggedItems,tagFingerprint,tagPurchaseHistory,tagBatch,BATCH} from '../lib/item-tags.js';
import {purchaseReview} from '../lib/purchase-review.js';
import {purchaseEvidence,projectReceiptEvidence} from '../lib/receipt-extraction.js';
import {applyReceiptFeedback} from '../lib/receipt-feedback.js';

const owner='00000000-0000-4000-8000-000000000001';
const record=(n,values)=>purchaseEvidence({event_id:`m${n}:0`,kind:'purchased',source_id:`m${n}`,at:1700000000000+n,evidence:`${values.product} M`,category:'clothing',
 values:{merchant:'Shop',order_reference:'O'+n,sku:null,brand:'Brand',color:null,size_label:'M',size_system:null,quantity:1,units_per_pack:null,...values},item_id:'item-'+n});
function fixture(rows,data={}){
 let row={conversation_id:owner,revision:1,token_ciphertext:'sealed',lease_until:null,data:{job:{status:'ready'},sources:[],questions:[],...data}},busy=false;
 return {get row(){return row;},set busy(v){busy=v;},finishes:0,
  gmailImport:async()=>structuredClone(row),evidence:async()=>structuredClone(rows),
  claimGmailImport:async()=>{if(busy)return null;busy=true;row.revision++;return structuredClone(row);},
  finishGmailImport:async function(o,revision,next,token){if(revision!==row.revision)return false;busy=false;this.finishes++;row={...row,data:structuredClone(next),token_ciphertext:token};return true;}};
}
const state=rows=>projectReceiptEvidence(owner,rows).state;
// A stand-in for the model: tags every supplied item the same way, optionally overriding fields.
const model=(override={})=>{const calls=[];const fn=async({context})=>{calls.push(context.items.map(i=>i.id));return {items:context.items.map(i=>({id:i.id,item_type:'crewneck sweater',group:'knitwear',color_family:'navy',color_quote:null,resale:'no',...override}))};};fn.calls=calls;return fn;};

test('tags keep the fixed vocabularies, short item types and only colours the receipt states',()=>{
 const s=state([record(1,{product:'Merino Crewneck',color:'Navy'}),record(2,{product:'Merino Crewneck Sweater in Forest Green'}),record(3,{product:'Merino Crewneck'})]);
 const items=s.items;
 const {tags,rejected}=validTags(items,{items:[
  {id:'item-1',item_type:'Crewneck Sweater',group:'knitwear',color_family:'navy',color_quote:null,resale:'no'},
  {id:'item-2',item_type:'crewneck sweater',group:'knitwear',color_family:'green',color_quote:'Forest Green',resale:'unknown'},
  {id:'item-3',item_type:'a very long description of a crewneck sweater that goes on',group:'knitwear',color_family:'black',color_quote:'black',resale:'yes'},
  {id:'foreign',item_type:'tee',group:'tops',color_family:'white',color_quote:null,resale:'no'},
  {id:'item-1',item_type:'tee',group:'tops',color_family:'white',color_quote:null,resale:'no'}]});
 assert.equal(tags['item-1'].item_type,'crewneck sweater');assert.equal(tags['item-1'].color_family,'navy');assert.equal(tags['item-1'].resale,false);
 // The product text says the colour, quoted exactly: kept.
 assert.equal(tags['item-2'].color_family,'green');assert.equal(tags['item-2'].resale,null);
 // No stated colour and the quote is not in the product text: unknown, never guessed.
 assert.equal(tags['item-3'].color_family,'unknown');assert.equal(tags['item-3'].item_type,null);assert.equal(tags['item-3'].resale,true);
 assert.deepEqual(rejected.sort(),['unknown_item','unknown_item','unquoted_colour']);
 const bad=validTags(items,{items:[{id:'item-1',item_type:'tee',group:'hats',color_family:'navy',color_quote:null,resale:'no'}]});
 assert.deepEqual(bad.tags,{});assert.deepEqual(bad.rejected,['vocabulary']);
});

test('a correction to an item re-tags it; removed and duplicate items are not tagged',()=>{
 let s=state([record(1,{product:'Tee',color:'Black'}),record(2,{product:'Jeans'}),record(3,{product:'Jeans copy'})]);
 const tags=Object.fromEntries(s.items.map(i=>[i.id,{fp:tagFingerprint(i)}]));
 assert.deepEqual(untaggedItems(s,tags),[]);
 s=applyReceiptFeedback(s,{id:'operator:1',owner_id:owner,source:'operator_review',at:'2026-10-15T00:00:00Z',item_ids:['item-1'],action:'correct_fields',values:{color:'White'},review:{reason:'wrong_details',note:null}});
 s=applyReceiptFeedback(s,{id:'operator:2',owner_id:owner,source:'operator_review',at:'2026-10-15T00:00:00Z',item_ids:['item-3'],action:'mark_duplicate',target_item_id:'item-2',review:{reason:'duplicate',note:null}});
 assert.deepEqual(untaggedItems(s,tags).map(i=>i.id),['item-1']);
 assert.deepEqual(untaggedItems(s,{}).map(i=>i.id).sort(),['item-1','item-2']);
});

test('adding the activewear category leaves existing tags current; an owner who picks it gets an activewear group',async()=>{
 let s=state([record(1,{product:'Team Bib Evo'}),record(2,{product:'Pace Breaker Short 5"'})]);
 // A fingerprint made before the category existed (no owner category) still matches: nothing re-tags.
 const tags=Object.fromEntries(s.items.map(i=>[i.id,{fp:tagFingerprint(i),group:'activewear'}]));
 assert.deepEqual(untaggedItems(s,tags),[]);
 s=applyReceiptFeedback(s,{id:'closet:1',owner_id:owner,source:'closet_edit',at:'2026-10-20T00:00:00Z',item_ids:['item-2'],action:'correct_fields',values:{wardrobe_category:'activewear'}});
 assert.deepEqual(untaggedItems(s,tags).map(i=>i.id),['item-2']);
 const fn=async({context})=>{fn.context=context;return {items:context.items.map(i=>({id:i.id,item_type:'running shorts',group:'shorts',color_family:'unknown',color_quote:null,resale:'no'}))};};
 const result=await tagBatch(s,tags,fn);
 assert.equal(fn.context.items[0].owner_category,'activewear');
 assert.equal(result.tags['item-2'].group,'activewear');assert.deepEqual(result.rejected,['outside_owner_category']);
});

test('an owner-set category re-tags only that item, tells the tagger, and keeps its group inside it',async()=>{
 let s=state([record(1,{product:'Aviators'}),record(2,{product:'Tee'})]);
 const tags=Object.fromEntries(s.items.map(i=>[i.id,{fp:tagFingerprint(i)}]));
 s=applyReceiptFeedback(s,{id:'closet:1',owner_id:owner,source:'closet_edit',at:'2026-10-19T00:00:00Z',item_ids:['item-1'],action:'correct_fields',values:{wardrobe_category:'eyewear'}});
 assert.deepEqual(untaggedItems(s,tags).map(i=>i.id),['item-1']);
 const fn=async({context})=>{fn.context=context;return {items:context.items.map(i=>({id:i.id,item_type:'sunglasses',group:'accessories',color_family:'unknown',color_quote:null,resale:'no'}))};};
 const result=await tagBatch(s,tags,fn);
 assert.equal(fn.context.items[0].owner_category,'eyewear');
 // The tagger said accessories; the owner said eyewear, so the counted group is eyewear.
 assert.equal(result.tags['item-1'].group,'eyewear');assert.deepEqual(result.rejected,['outside_owner_category']);
 assert.deepEqual(untaggedItems(s,result.tags),[]);
});

test('tagging runs in batches under the purchase-history lease and stores tags on the row',async()=>{
 const rows=Array.from({length:BATCH+5},(_,n)=>record(n+1,{product:'Sweater '+(n+1),color:'Navy'}));
 const store=fixture(rows),interpret=model();
 const run=await tagPurchaseHistory(store,owner,{},{interpret,budgetMs:60000});
 assert.deepEqual(run,{tagged:BATCH+5,remaining:0,busy:false});
 assert.equal(interpret.calls.length,2);assert.equal(interpret.calls[0].length,BATCH);
 // Newest purchases are tagged first.
 assert.equal(interpret.calls[0][0],'item-'+(BATCH+5));
 assert.equal(Object.keys(store.row.data.item_tags).length,BATCH+5);assert.equal(store.row.data.job.status,'ready');
 // Nothing left: a second run makes no model call.
 const again=await tagPurchaseHistory(store,owner,{},{interpret,budgetMs:60000});
 assert.equal(again.tagged,0);assert.equal(interpret.calls.length,2);
});

test('a busy history is left alone, and a failed model call releases the lease',async()=>{
 const store=fixture([record(1,{product:'Tee',color:'Black'})]);
 store.busy=true;
 assert.deepEqual(await tagPurchaseHistory(store,owner,{},{interpret:model()}),{tagged:0,remaining:null,busy:true});
 store.busy=false;
 await assert.rejects(tagPurchaseHistory(store,owner,{},{interpret:async()=>{throw Error('model down');}}));
 assert.equal(store.row.data.item_tags,undefined);
 // The lease was given back, so the next edit can claim the row.
 assert.ok(await store.claimGmailImport(owner));
});

test('tags for items no longer in the history are dropped',async()=>{
 const s=state([record(1,{product:'Tee',color:'Black'})]);
 const {tags}=await tagBatch(s,{'item-gone':{fp:'x'}},model());
 assert.deepEqual(Object.keys(tags),['item-1']);
});

test('the owner review shows current tags and hides tags made from details since corrected',async()=>{
 const rows=[record(1,{product:'Tee',color:'Black'}),record(2,{product:'Jeans',color:'Blue'})];
 const s=state(rows),fresh=s.items.find(i=>i.id==='item-1');
 const store=fixture(rows,{item_tags:{'item-1':{fp:tagFingerprint(fresh),item_type:'t-shirt',group:'tops',color_family:'black',resale:false},'item-2':{fp:'stale',item_type:'jeans',group:'denim',color_family:'blue',resale:false}}});
 const review=await purchaseReview(store,owner);
 assert.deepEqual(review.items.find(i=>i.id==='item-1').tags,{item_type:'t-shirt',group:'tops',color_family:'black',resale:false});
 assert.equal(review.items.find(i=>i.id==='item-2').tags,null);
 assert.deepEqual(review.tag_status,{tagged:1,pending:1});
});
