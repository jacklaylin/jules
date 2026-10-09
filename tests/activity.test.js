import test from 'node:test';
import assert from 'node:assert/strict';

// Exercise request lifecycle with a minimal DOM, without making a network request.
function element(){return {children:[],className:'',hidden:false,textContent:'',setAttribute(){},append(...children){this.children.push(...children);},querySelector(selector){return this.children.find(child=>'.'+child.className===selector);}};}
const events=[];
globalThis.document={createElement:element,head:element(),body:element(),dispatchEvent:event=>events.push(event.detail)};
const {withActivity,trackedFetch}=await import('../public/activity.js');
const latest=()=>events.at(-1);
const gate=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};

test('concurrent activity stays visible until the last request completes',async()=>{
 const a=gate(),b=gate();const first=withActivity('Loading wishlist',()=>a.promise),second=withActivity('Reading style',()=>b.promise,{agent:true});
 assert.deepEqual(latest(),{busy:true,agentWorking:true,success:false});
 a.resolve('first');assert.equal(await first,'first');assert.equal(latest().busy,true);assert.equal(latest().agentWorking,true);
 b.resolve('second');await second;assert.deepEqual(latest(),{busy:false,agentWorking:false,success:true});
 assert.equal(document.body.children[0].hidden,true);
});
test('a failed batch never emits successful completion; the next batch can recover',async()=>{
 const a=gate(),b=gate();const first=withActivity('Reading style',()=>a.promise,{agent:true}),second=withActivity('Loading wishlist',()=>b.promise);
 a.reject(new Error('fixture failure'));await assert.rejects(first,/fixture failure/);assert.equal(latest().success,false);
 b.resolve();await second;assert.equal(latest().success,false);
 await withActivity('Retry',async()=>{}, {agent:true});assert.equal(latest().success,true);
});
test('only supported analysis/chat actions trigger agent motion, and HTTP errors stop without a success pop',async()=>{
 let observed=[];globalThis.fetch=async()=>{observed.push(latest());return {ok:true};};
 await trackedFetch('/api/style');assert.equal(observed.at(-1).agentWorking,false);
 await trackedFetch('/api/style',{method:'POST',body:JSON.stringify({action:'analyze'})});assert.equal(observed.at(-1).agentWorking,true);
 await trackedFetch('/api/chat-simulator',{method:'POST',body:'{}'});assert.equal(observed.at(-1).agentWorking,true);
 await trackedFetch('/api/style',{method:'POST',body:JSON.stringify({action:'tone'})});assert.equal(observed.at(-1).agentWorking,false);
 globalThis.fetch=async()=>({ok:false,status:503});const response=await trackedFetch('/api/style',{method:'POST',body:JSON.stringify({action:'analyze'})});assert.equal(response.status,503);assert.equal(latest().success,false);assert.equal(latest().busy,false);
});
test('private image requests bypass page activity',async()=>{
 const count=events.length;globalThis.fetch=async()=>({ok:true});await trackedFetch('/api/style?crop=0');await trackedFetch('/api/wishlist?item=fixture&source=photo');await trackedFetch('/api/image');assert.equal(events.length,count);
});
