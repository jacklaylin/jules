import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createWishlistHandler} from '../api/wishlist.js';
import {groupWishlist} from '../lib/wishlist.js';
import {createStore} from '../lib/store.js';
const owner='00000000-0000-4000-8000-000000000001';
const rows=[{item_id:owner,reply_id:owner,source_image_id:owner,target:'jacket',name:'Jacket'}, {item_id:'00000000-0000-4000-8000-000000000002',reply_id:owner,source_image_id:owner,target:'jacket',name:'Jacket'}, {item_id:'00000000-0000-4000-8000-000000000003',reply_id:owner,source_image_id:owner,target:'bag',name:'Bag'}];
const group=groupWishlist(rows)[0].id;
function req(body){return Object.assign(Readable.from([JSON.stringify(body)]),{method:'POST',url:'/api/wishlist',headers:{authorization:'Bearer test','content-type':'application/json'}});}
function res(){return {setHeader(){},end(value){this.value=value;}};}
test('removal stops the selected group alert and hides all its encounters; undo restores without enabling alerts',async()=>{
 const calls=[];const handler=createWishlistHandler({env:{WISHLIST_ENABLED:'true'},auth:async()=>({status:200,conversation:owner}),storeFactory:()=>({wishlistEntries:async(conversation,options)=>{assert.equal(conversation,owner);assert.equal(options.includeRemoved,true);return rows;},disablePriceAlert:async(...args)=>calls.push(['disable',...args]),setWishlistRemoved:async(...args)=>{calls.push(['hide',...args]);for(const row of args[1])Object.assign(rows.find(r=>r.item_id===row.item_id&&r.reply_id===row.reply_id),{removed:args[2]});},recordEvidence:async(conversation,rows)=>calls.push(['evidence',conversation,rows])})});
 let response=res();await handler(req({action:'remove',group}),response);assert.equal(response.statusCode,200);assert.deepEqual(calls[0],['disable',owner,group]);assert.equal(calls[1][2].length,2);assert.equal(calls[1][3],true);assert.ok(calls[1][2].every(row=>row.item_id!==rows[2].item_id));
 // The removal is the user's own action, recorded as evidence.
 assert.equal(calls[2][0],'evidence');assert.equal(calls[2][2][0].kind,'wishlist_event');assert.equal(calls[2][2][0].data.action,'removed');assert.equal(calls[2][2][0].data.item_id,group);
 response=res();await handler(req({action:'restore',group}),response);assert.equal(response.statusCode,200);assert.equal(calls.length,5);assert.equal(calls[3][3],false);assert.equal(calls[4][2][0].data.action,'restored');
 // A repeated restore (a retry after a timeout) writes nothing and records no second event.
 response=res();await handler(req({action:'restore',group}),response);assert.equal(response.statusCode,200);assert.equal(JSON.parse(response.value).unchanged,true);assert.equal(calls.length,5);
});
test('removal rejects unauthenticated users and groups outside their wishlist',async()=>{
 for(const status of [401,200]){let writes=0;const handler=createWishlistHandler({env:{WISHLIST_ENABLED:'true'},auth:async()=>({status,conversation:owner}),storeFactory:()=>({wishlistEntries:async()=>[],setWishlistRemoved:async()=>writes++,disablePriceAlert:async()=>writes++})});const response=res();await handler(req({action:'remove',group}),response);assert.equal(response.statusCode,status===401?401:404);assert.equal(writes,0);}
});
test('store filters removed encounters and ownership checks precede writes, preserving the snapshot',async()=>{
 const writes=[];const store=createStore({SUPABASE_URL:'https://database.invalid',SUPABASE_SERVICE_ROLE_KEY:'test'},async(url,options)=>{if(options.method==='PATCH'){writes.push({url,body:JSON.parse(options.body)});return{ok:true,text:async()=>''};}return {ok:true,text:async()=>JSON.stringify(url.includes('wishlist_entry_metadata?')?[{removed:'true'},{removed:null},{removed:'false'}]:[{id:owner,product:{},wishlist_encounters:[{reply_id:owner,product:{name:'Jacket',image:{data:'photo'},links:[{url:'https://retailer.invalid/jacket'}]}}]}])};});
 assert.equal((await store.wishlistEntries(owner)).length,2);assert.equal((await store.wishlistEntries(owner,{includeRemoved:true})).length,3);
 await store.setWishlistRemoved(owner,[rows[0]],true);assert.equal(writes[0].body.product.wishlist_removed,true);assert.equal(writes[0].body.product.image.data,'photo');assert.equal(writes[0].body.product.links.length,1);
 await assert.rejects(store.setWishlistRemoved(owner,[{...rows[0],reply_id:rows[2].item_id}],true));assert.equal(writes.length,1);
});

test('remove reads the list, stops the alert and reads the card\'s photos together, and a stale card acts on the whole card',async()=>{
 const state=rows.map(row=>({...row,removed:false})),order=[],gates={};
 const hold=name=>new Promise(resolve=>{gates[name]=resolve;});
 const store={wishlistEntries:async()=>{order.push('list');await hold('list');return state;},
  disablePriceAlert:async(conversation,id)=>{order.push('alert:'+id);await hold('alert');},
  wishlistEncounters:async(conversation,entries)=>{order.push('photos:'+entries.length);return 'speculative';},
  setWishlistRemoved:async(conversation,entries,removed,read)=>{order.push(['hide',entries.length,read?await read:null]);for(const e of entries)Object.assign(state.find(r=>r.item_id===e.item_id&&r.reply_id===e.reply_id),{removed});},
  recordEvidence:async()=>order.push('evidence')};
 const headers={};const handler=createWishlistHandler({env:{WISHLIST_ENABLED:'true'},auth:async()=>({status:200,conversation:owner}),storeFactory:()=>store});
 const entries=groupWishlist(rows)[0].entries;
 const response=Object.assign(res(),{setHeader(name,value){headers[name]=value;}});
 const pending=handler(req({action:'remove',group,entries}),response);
 await new Promise(r=>setTimeout(r));
 // Both reads are out together; the alert stops alongside the hide, once the card is known to be theirs.
 assert.deepEqual(order,['photos:2','list']);
 gates.list();await new Promise(r=>setTimeout(r));assert.deepEqual(order.slice(2),['alert:'+group,['hide',2,'speculative']]);
 assert.ok(!order.includes('evidence'),'the event waits for both writes');
 gates.alert();await pending;
 assert.equal(response.statusCode,200);assert.equal(order.at(-1),'evidence');
 assert.match(headers['Server-Timing'],/auth;dur=[\d.]+, wishlist_remove;dur=\d+/);
 // A page drawn before the card gained an entry still restores all of it, reading the photos afresh.
 order.length=0;const stale=handler(req({action:'restore',group,entries:entries.slice(0,1)}),res());
 await new Promise(r=>setTimeout(r));gates.list();await stale;
 assert.deepEqual(order,['photos:1','list',['hide',2,null],'evidence']);assert.ok(state.slice(0,2).every(r=>r.removed===false));
 // A retry changes nothing and records nothing.
 order.length=0;const again=res();const retry=handler(req({action:'restore',group,entries}),again);await new Promise(r=>setTimeout(r));gates.list();await retry;
 assert.equal(JSON.parse(again.value).unchanged,true);assert.ok(!order.some(e=>e==='evidence'||e[0]==='hide'));
});
test('marking encounters reads their items once and writes every encounter',async()=>{
 const urls=[],patches=[];const second='00000000-0000-4000-8000-000000000002';
 const store=createStore({SUPABASE_URL:'https://database.invalid',SUPABASE_SERVICE_ROLE_KEY:'test'},async(url,options)=>{
  if(options.method==='PATCH'){patches.push({url,body:JSON.parse(options.body)});return {ok:true,text:async()=>''};}
  urls.push(url);return {ok:true,text:async()=>JSON.stringify([{id:owner,wishlist_encounters:[{reply_id:owner,product:{name:'Jacket',image:{data:'a'}}}]},{id:second,wishlist_encounters:[{reply_id:owner,product:{name:'Jacket',image:{data:'b'}}}]}])};});
 await store.setWishlistRemoved(owner,[{item_id:owner,reply_id:owner},{item_id:second,reply_id:owner}],true);
 assert.equal(urls.length,1);assert.match(urls[0],/wishlist_items\?conversation_id=eq\.[^&]+&id=in\.\(/);assert.match(urls[0],/wishlist_encounters\.reply_id=in\./);
 assert.equal(patches.length,2);assert.deepEqual(patches.map(p=>p.body.product.image.data).sort(),['a','b']);assert.ok(patches.every(p=>p.body.product.wishlist_removed===true));
 // A read already started for these entries is used instead of a second one.
 urls.length=0;await store.setWishlistRemoved(owner,[{item_id:owner,reply_id:owner}],false,Promise.resolve([{id:owner,wishlist_encounters:[{reply_id:owner,product:{name:'Jacket'}}]}]));
 assert.equal(urls.length,0);assert.equal(patches.at(-1).body.product.wishlist_removed,false);
});
