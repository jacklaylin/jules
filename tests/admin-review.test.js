import test from 'node:test';
import assert from 'node:assert/strict';
import {REASONS,statusOf,matches,neighbour,position,filterLabel,reviewKey} from '../public/admin-review.js';

const item=(id,extra={})=>({id,brand:'Brand',product:`Item ${id}`,merchant:'Nordstrom',sources:['gmail'],reviews:[],removed:false,confirmed:false,duplicate_of:null,...extra});
const key=(k,extra={})=>({key:k,target:{tagName:'BODY'},...extra});
const toReview={status:'review'};
// What a save does to the item, as the server reports it back.
const label=(items,id,reason)=>items.map(i=>i.id!==id?i:{...i,reviews:[...i.reviews,{source:'operator_review',reason}],
 removed:['not_a_purchase','not_apparel'].includes(reason)||i.removed});

test('a reviewer clears ten "to review" items with only J/K, 1–7 and ⌘↵',()=>{
 let items=[item('a',{reviews:[{source:'operator_review',reason:'correct'}]}),...Array.from({length:10},(_,n)=>item(`r${n}`)),item('dup',{duplicate_of:'r0'})];
 assert.equal(position(items,null,toReview).total,10);
 // Start reviewing opens the first match; J then K comes back to it.
 let current=neighbour(items,null,toReview);
 assert.equal(current,'r0');
 assert.equal(neighbour(items,current,toReview,1),'r1');
 assert.equal(neighbour(items,'r1',toReview,-1),'r0');
 const keys=['1','2','3','7','1','1','2','7','1','1'];
 for(const [n,digit] of keys.entries()){
  assert.deepEqual(position(items,current,toReview),{index:1,total:10-n});
  const pick=reviewKey(key(digit),{open:true});
  assert.equal(pick.type,'label');
  assert.deepEqual(reviewKey(key('Enter',{metaKey:true}),{open:true}),{type:'save-next'});
  // Save and open next: the saved item leaves the filter; the next one comes from its old place.
  const before=items;items=label(items,current,pick.reason);
  const fresh=new Map(items.map(i=>[i.id,i]));
  current=neighbour(before.map(i=>fresh.get(i.id)),current,toReview);
 }
 assert.equal(current,null);
 assert.equal(position(items,null,toReview).total,0);
 assert.ok(items.filter(i=>i.id.startsWith('r')).every(i=>statusOf(i)!=='review'));
});

test('next and previous follow the whole filter, not only the status chip',()=>{
 const items=[item('a'),item('b',{merchant:'SSENSE'}),item('c',{sources:['gmail','shop']}),item('d',{merchant:'SSENSE',product:'Wool coat'})];
 assert.equal(neighbour(items,'b',{store:'SSENSE'}),'d');
 assert.equal(neighbour(items,'d',{store:'SSENSE'},-1),'b');
 assert.equal(neighbour(items,'a',{source:'multiple'}),'c');
 assert.equal(neighbour(items,'a',{query:'coat'}),'d');
 assert.equal(neighbour(items,'d',{}),null);
 assert.equal(neighbour(items,'a',{},-1),null);
 // An item outside the filter still has neighbours from its place in the list.
 assert.deepEqual(position(items,'a',{store:'SSENSE'}),{index:0,total:2});
 assert.equal(neighbour(items,'a',{store:'SSENSE'}),'b');
 assert.ok(matches(items[3],{status:'review',store:'SSENSE',query:'WOOL'}));
 assert.equal(filterLabel({status:'review'}),'To review');
 assert.equal(filterLabel({status:'',store:'SSENSE',query:' coat '}),'All · “coat” · SSENSE');
});

test('shortcuts work only on an open item review and never while typing',()=>{
 assert.equal(reviewKey(key('j'),{open:false}),null);
 assert.deepEqual(reviewKey(key('J'),{open:true}),{type:'next'});
 assert.deepEqual(reviewKey(key('k'),{open:true}),{type:'previous'});
 assert.deepEqual(REASONS.map((_,n)=>reviewKey(key(String(n+1)),{open:true}).reason),REASONS.map(([value])=>value));
 assert.equal(reviewKey(key('8'),{open:true}),null);
 for(const target of [{tagName:'INPUT',type:'text'},{tagName:'TEXTAREA'},{tagName:'SELECT'},{tagName:'DIV',isContentEditable:true}]){
  assert.equal(reviewKey(key('j',{target}),{open:true}),null);
  assert.equal(reviewKey(key('4',{target}),{open:true}),null);
 }
 // A focused label chip is not a text field.
 assert.deepEqual(reviewKey(key('j',{target:{tagName:'INPUT',type:'radio'}}),{open:true}),{type:'next'});
 // ⌘/Ctrl+Enter saves from a corrected field too.
 assert.deepEqual(reviewKey(key('Enter',{ctrlKey:true,target:{tagName:'INPUT',type:'text'}}),{open:true}),{type:'save-next'});
 assert.equal(reviewKey(key('Enter'),{open:true}),null);
 assert.equal(reviewKey(key('j',{metaKey:true}),{open:true}),null);
 // Saving, an open dialog or a duplicate item (no form) leave keys alone.
 assert.equal(reviewKey(key('j'),{open:true,busy:true}),null);
 assert.equal(reviewKey(key('j'),{open:true,dialog:true}),null);
 assert.equal(reviewKey(key('3'),{open:true,form:false}),null);
 assert.equal(reviewKey(key('Enter',{metaKey:true}),{open:true,form:false}),null);
 assert.deepEqual(reviewKey(key('j'),{open:true,form:false}),{type:'next'});
});
