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
 const calls=[];const handler=createWishlistHandler({env:{WISHLIST_ENABLED:'true'},auth:async()=>({status:200,conversation:owner}),storeFactory:()=>({wishlistEntries:async(conversation,options)=>{assert.equal(conversation,owner);assert.equal(options.includeRemoved,true);return rows;},disablePriceAlert:async(...args)=>calls.push(['disable',...args]),setWishlistRemoved:async(...args)=>calls.push(['hide',...args])})});
 let response=res();await handler(req({action:'remove',group}),response);assert.equal(response.statusCode,200);assert.deepEqual(calls[0],['disable',owner,group]);assert.equal(calls[1][2].length,2);assert.equal(calls[1][3],true);assert.ok(calls[1][2].every(row=>row.item_id!==rows[2].item_id));
 response=res();await handler(req({action:'restore',group}),response);assert.equal(response.statusCode,200);assert.equal(calls.length,3);assert.equal(calls[2][3],false);
});
test('removal rejects unauthenticated users and groups outside their wishlist',async()=>{
 for(const status of [401,200]){let writes=0;const handler=createWishlistHandler({env:{WISHLIST_ENABLED:'true'},auth:async()=>({status,conversation:owner}),storeFactory:()=>({wishlistEntries:async()=>[],setWishlistRemoved:async()=>writes++,disablePriceAlert:async()=>writes++})});const response=res();await handler(req({action:'remove',group}),response);assert.equal(response.statusCode,status===401?401:404);assert.equal(writes,0);}
});
test('store filters removed encounters and ownership checks precede writes, preserving the snapshot',async()=>{
 const writes=[];const store=createStore({SUPABASE_URL:'https://database.invalid',SUPABASE_SERVICE_ROLE_KEY:'test'},async(url,options)=>{if(options.method==='PATCH'){writes.push({url,body:JSON.parse(options.body)});return{ok:true,text:async()=>''};}return {ok:true,text:async()=>JSON.stringify(url.includes('wishlist_entry_metadata?')?[{removed:'true'},{removed:null},{removed:'false'}]:[{product:{},wishlist_encounters:[{reply_id:owner,product:{name:'Jacket',image:{data:'photo'},links:[{url:'https://retailer.invalid/jacket'}]}}]}])};});
 assert.equal((await store.wishlistEntries(owner)).length,2);assert.equal((await store.wishlistEntries(owner,{includeRemoved:true})).length,3);
 await store.setWishlistRemoved(owner,[rows[0]],true);assert.equal(writes[0].body.product.wishlist_removed,true);assert.equal(writes[0].body.product.image.data,'photo');assert.equal(writes[0].body.product.links.length,1);
 await assert.rejects(store.setWishlistRemoved(owner,[{...rows[0],reply_id:rows[2].item_id}],true));assert.equal(writes.length,1);
});
