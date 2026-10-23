import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRemoval,takeOut} from '../public/wishlist-remove.js';

const gate=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function page(items){
 const cache=new Map(items.map(item=>[item.id,item])),log=[],sent=[],requests=[];
 const removal=createRemoval({cache,
  send:input=>{sent.push(input);const request=gate();requests.push(request);return request.promise;},
  removeCard:async card=>{log.push(['exit',card]);},refilter:()=>log.push(['refilter',[...cache.keys()]]),redraw:()=>log.push(['redraw',[...cache.keys()]]),
  notify:(text,undo,extra)=>log.push(['toast',text,undo,extra]),dismiss:()=>log.push(['dismiss']),fail:error=>log.push(['error',error.message]),
  bought:async item=>log.push(['bought',item.id])});
 return {cache,log,sent,requests,removal,toast:()=>log.findLast(e=>e[0]==='toast')};
}
const items=[{id:'a',name:'A'},{id:'b',name:'B',price_alert:{active:true,size:'M'},entries:[{item_id:'i',reply_id:'r'}]},{id:'c',name:'C'}];

test('a remove answers before the server: the card leaves and the toast shows while the request is still out',async()=>{
 const p=page(items);let finished=false;
 const done=p.removal.remove(items[1],'card-b').then(ok=>{finished=ok;});
 await Promise.resolve();
 assert.deepEqual(p.sent,[{action:'remove',group:'b',entries:items[1].entries}]);
 assert.deepEqual([...p.cache.keys()],['a','c']);assert.deepEqual(p.log[0],['exit','card-b']);
 assert.equal(p.toast()[1],'Removed. Alert turned off.');assert.equal(finished,false,'request still out');
 p.requests[0].resolve({ok:true});await done;assert.equal(finished,true);
 assert.ok(!p.log.some(e=>e[0]==='redraw'||e[0]==='error'),'a success never redraws');
});
test('a refused remove puts the card back in its place and shows the error',async()=>{
 const p=page(items);const done=p.removal.remove(items[1],'card-b');
 p.requests[0].reject(new Error('Could not load your wishlist. Please try again.'));
 assert.equal(await done,false);
 assert.deepEqual([...p.cache.keys()],['a','b','c']);assert.equal(p.cache.get('b'),items[1]);
 assert.deepEqual(p.log.slice(-3),[['dismiss'],['redraw',['a','b','c']],['error','Could not load your wishlist. Please try again.']]);
});
test('Undo waits for the removal, then brings the card back at once with its alert off',async()=>{
 const p=page(items);const done=p.removal.remove(items[1],'card-b');const undo=p.toast()[2]();
 await Promise.resolve();assert.equal(p.sent.length,1,'restore is not sent before the removal lands');
 p.requests[0].resolve({ok:true});await done;await new Promise(r=>setTimeout(r));
 assert.deepEqual([...p.cache.keys()],['a','b','c']);assert.equal(p.cache.get('b').price_alert.active,false);
 assert.deepEqual(p.sent[1],{action:'restore',group:'b',entries:items[1].entries});
 p.requests[1].resolve({ok:true});await undo;
});
test('a refused Undo takes the card out again and reports the error to the toast',async()=>{
 const p=page(items);const done=p.removal.remove(items[1],'card-b');p.requests[0].resolve({ok:true});await done;
 const undo=p.toast()[2]();await new Promise(r=>setTimeout(r));p.requests[1].reject(new Error('Please try again.'));
 await assert.rejects(undo,/Please try again/);assert.deepEqual([...p.cache.keys()],['a','c']);
});
test('Undo or I bought it after a refused remove sends nothing more; the card is already back',async()=>{
 const p=page(items);const done=p.removal.remove(items[0],'card-a');const [, , undo,extra]=p.toast();
 p.requests[0].reject(new Error('nope'));await done;await undo();await extra.run();
 assert.equal(p.sent.length,1);assert.ok(!p.log.some(e=>e[0]==='bought'));assert.deepEqual([...p.cache.keys()],['a','b','c']);
});
test('I bought it from the remove toast waits for the removal, then records the purchase',async()=>{
 const p=page(items);const done=p.removal.remove(items[2],'card-c');const run=p.toast()[3].run();
 await Promise.resolve();assert.ok(!p.log.some(e=>e[0]==='bought'));
 p.requests[0].resolve({ok:true});await done;await run;assert.deepEqual(p.log.at(-1),['bought','c']);
 // A bought item has no I bought it button.
 const q=page([{id:'d',bought:{at:'2026-10-01'}}]);void q.removal.remove(q.cache.get('d'));assert.equal(q.toast()[3],null);
});
test('takeOut keeps the order of the cards that are left',()=>{
 const cache=new Map([['a',1],['b',2],['c',3]]);const back=takeOut(cache,'b');cache.delete('a');cache.set('d',4);back();
 assert.deepEqual([...cache.keys()],['b','c','d']);back();assert.equal(cache.size,3,'putting back twice adds nothing');
});
