import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { wishlistProducts, wishlistUser, sessionHash } from '../lib/wishlist.js';
import { createWishlistHandler } from '../api/wishlist.js';
import { receiveInInbox } from '../lib/inbox.js';
import { createStore } from '../lib/store.js';
const id='00000000-0000-4000-8000-000000000001', other='00000000-0000-4000-8000-000000000002';
function request(method='GET',url='/api/wishlist',body,authorization='Bearer test') {const req=Readable.from(body?[JSON.stringify(body)]:[]);Object.assign(req,{method,url,headers:{authorization,'content-type':'application/json'}});return req;}
function response(){return{headers:{},setHeader(k,v){this.headers[k]=v;},end(value){this.value=value;}};}
const env={WISHLIST_ENABLED:'true',SUPABASE_URL:'https://database.invalid',SUPABASE_ANON_KEY:'test',SITE_ORIGIN:'https://shopper.invalid'};
const product={name:'Test jacket',brand:'Test',url:'https://retailer.example.com/jacket',match:'likely_match',reason:'A possible match',candidate_image:'https://encrypted-tbn0.gstatic.com/test',merchant_options:[{url:'https://other.example.com/jacket',retailer:{name:'Other'}}]};
const result={identification_policy:'visual_comparison',products:[product],checked_at:'2026-10-06T00:00:00Z'};
test('wishlist keeps only links actually sent, snapshots images, and excludes ordinary searches',async()=>{
 const entries=await wishlistProducts(result,product.url,[{id}],{},async()=>Buffer.from('photo'));
 assert.equal(entries.length,1);assert.equal(entries[0].source_image_id,id);assert.equal(entries[0].image.data,Buffer.from('photo').toString('base64'));assert.equal(entries[0].links.length,1);
 assert.equal((await wishlistProducts(result,product.url+'\nhttps://other.example.com/jacket',[],{},async()=>Buffer.from('photo')))[0].links.length,2);
 assert.deepEqual(await wishlistProducts(result,'Nothing found',[],{}),[]);
 assert.deepEqual(await wishlistProducts({...result,identification_policy:'text_search'},product.url,[],{}),[]);
 const fallback=await wishlistProducts(result,product.url,[{id}],{},async()=>{throw new Error();});assert.equal(fallback[0].image,null);
});
test('wishlist auth checks confirmed server identity, invitation, and local logout revocation',async()=>{
 let calls=0;const fetcher=async()=>{calls++;return{ok:true,json:async()=>({email:'TEST@EXAMPLE.COM',email_confirmed_at:'now'})};};
 const store={wishlistRevoked:async()=>false,wishlistMember:async email=>{assert.equal(email,'test@example.com');return{conversation_id:id};}};
 assert.equal((await wishlistUser({},env,store,fetcher)).status,401);assert.equal(calls,0);
 assert.deepEqual(await wishlistUser({authorization:'Bearer test'},env,store,fetcher),{status:200,conversation:id});
 assert.equal((await wishlistUser({authorization:'Bearer test'},env,{...store,wishlistMember:async()=>null},fetcher)).status,403);
 assert.equal((await wishlistUser({authorization:'Bearer test'},env,{...store,wishlistRevoked:async()=>true},fetcher)).status,401);assert.equal(calls,2);
 assert.equal((await wishlistUser({authorization:'Bearer test'},env,store,async()=>({ok:true,json:async()=>({email:'test@example.com'})}))).status,403);
});
test('API scopes items and source bytes to the invited conversation and strips stored image data',async()=>{
 let bytes=0;
 const store={wishlistItem:async(conversation,item)=>{assert.equal(conversation,id);return item===id?{id,product:{...product,image:{mime_type:'image/jpeg',data:'private'}},wishlist_encounters:[{source_image_id:id,product,messages:{created_at:'now'}}]}:null;},image:async()=>{bytes++;return{mime_type:'image/jpeg',data:Buffer.from('safe').toString('base64')};}};
 const handler=createWishlistHandler({env,storeFactory:()=>store,auth:async()=>({status:200,conversation:id})});
 let res=response();await handler(request('GET',`/api/wishlist?item=${other}`),res);assert.equal(res.statusCode,404);
 res=response();await handler(request('GET',`/api/wishlist?item=${id}&source=${other}`),res);assert.equal(res.statusCode,404);assert.equal(bytes,0);
 res=response();await handler(request('GET',`/api/wishlist?item=${id}&source=${id}`),res);assert.equal(res.statusCode,200);assert.equal(bytes,1);assert.equal(res.headers['Cache-Control'],'no-store');
 res=response();await handler(request('GET',`/api/wishlist?item=${id}`),res);assert.equal(JSON.parse(res.value).item.product.image,undefined);
 const denied=createWishlistHandler({env,storeFactory:()=>({}),auth:async()=>({status:401})});res=response();await denied(request(),res);assert.equal(res.statusCode,401);
});
test('logout immediately records only a token hash and revoked sessions fail before provider calls',async()=>{
 let stored;const handler=createWishlistHandler({env,storeFactory:()=>({wishlistRevoke:async hash=>stored=hash}),fetcher:async()=>({ok:true})});
 const res=response();await handler(request('POST','/api/wishlist',{action:'logout'}),res);assert.equal(res.statusCode,200);assert.equal(stored,sessionHash('Bearer test'));assert.equal(stored.length,64);
});
test('login only emails invited people; repair requires admin and never sends iMessages',async()=>{
 let emails=0;const store={wishlistMember:async email=>email==='invited@example.com'?{conversation_id:id}:null};
 const handler=createWishlistHandler({env,storeFactory:()=>store,fetcher:async()=>{emails++;return{ok:true};},admin:async()=>403});
 for(const email of ['unknown@example.com','invited@example.com']){const res=response();await handler(request('POST','/api/wishlist',{action:'login',email}),res);assert.equal(res.statusCode,200);}
 assert.equal(emails,1);const res=response();await handler(request('POST','/api/wishlist',{action:'repair'}),res);assert.equal(res.statusCode,403);
});
test('identification snapshots before send and saves only after accepted send; failures remain repairable',async()=>{
 const events=[];let fail=false;
 const store={receive:async()=>id,claimAI:async()=>true,context:async()=>[{direction:'inbound',message_images:[{id}]}],searchResult:async()=>{},wishlistPayload:async()=>events.push('snapshot'),wishlistHasItems:async()=>false,prepareAI:async()=>events.push('prepared'),finish:async(op,status)=>events.push(status),saveWishlist:async()=>events.push('saved')};
 const options={store,progress:async()=>async()=>{},generate:async(ctx,e,f,m)=>{await m.recordSearch({...result,products:[{...product,candidate_image:null}]});return product.url;},send:async()=>{events.push('send');if(fail)throw new Error();}};
 const delivery={message:{id:'provider',content:{text:'Find the jacket'}}};
 await receiveInInbox(delivery,{...env,AI_ENABLED:'true'},options);assert.deepEqual(events,['snapshot','prepared','send','sent','saved']);
 events.length=0;fail=true;await receiveInInbox(delivery,{...env,AI_ENABLED:'true'},options);assert.deepEqual(events,['snapshot','prepared','send','uncertain']);
 events.length=0;fail=false;store.saveWishlist=async()=>{throw new Error();};assert.equal(await receiveInInbox(delivery,{...env,AI_ENABLED:'true'},options),'imessage_ai_reply_sent');assert.deepEqual(events,['snapshot','prepared','send','sent']);
});
test('database list/detail queries always include conversation ownership',async()=>{
 const paths=[];const store=createStore({SUPABASE_URL:'https://database.invalid',SUPABASE_SERVICE_ROLE_KEY:'test'},async url=>{paths.push(url);return{ok:true,text:async()=>'[]'};});
 await store.wishlist(id);await store.wishlistItem(id,other);assert.ok(paths.every(path=>path.includes('conversation_id=eq.'+id)));
});

test('groups candidate links under the source item and keeps jacket and bag separate',async()=>{
 const {groupWishlist}=await import('../lib/wishlist.js');
 const base={reply_id:id,source_image_id:other,item_id:id,has_image:'image/jpeg',message_images:{messages:{created_at:'2026-10-05T12:00:00Z'}},messages:{created_at:'2026-10-06T12:00:00Z'},brand:'Example'};
 const rows=[{...base,name:'First jacket',links:[{url:'https://shop.example.com/one'}]},{...base,item_id:other,name:'Second coat',links:[{url:'https://shop.example.com/two'}]},{...base,target:'bag',name:'Third item',links:[{url:'https://shop.example.com/bag'}]}];
 const groups=groupWishlist(rows);assert.equal(groups.length,2);const jacket=groups.find(g=>g.name==='Jacket');assert.equal(jacket.links.length,2);assert.equal(jacket.sent_at,'2026-10-05T12:00:00Z');assert.equal(jacket.image_item,id);assert.deepEqual(jacket.price_ranges,[]);
 assert.equal(groupWishlist([...rows,rows[0]])[0].links.length,2);
 assert.equal(groupWishlist([{...rows[0],source_image_id:id},rows[0]]).length,2);
});
test('price ranges use sourced snapshots and never blend currencies or invent missing prices',async()=>{
 const {groupWishlist}=await import('../lib/wishlist.js');
 const rows=[625,700].map((amount,i)=>({reply_id:id,source_image_id:other,item_id:id,target:'jacket',name:'Jacket',links:[{url:`https://shop.example.com/${i}`}],price_snapshot:{amount,currency:'USD',source_url:`https://shop.example.com/${i}`,checked_at:'2026-10-06T12:00:00Z'}}));
 let groups=groupWishlist(rows);assert.deepEqual(groups[0].price_ranges,[{currency:'USD',min:625,max:700}]);
 groups=groupWishlist([...rows,{...rows[0],links:[{url:'https://shop.example.com/CHF'}],price_snapshot:{amount:600,currency:'CHF',source_url:'https://shop.example.com/CHF',checked_at:'today'}}]);assert.equal(groups[0].price_ranges.length,2);
 assert.deepEqual(groupWishlist([{...rows[0],price_snapshot:{...rows[0].price_snapshot,source_url:'https://wrong.example.com'}}])[0].price_ranges,[]);
});
test('group detail and list use metadata only and remain scoped to the authenticated conversation',async()=>{
 const {groupWishlist}=await import('../lib/wishlist.js');
 const rows=[{reply_id:id,source_image_id:other,item_id:id,target:'jacket',name:'Jacket',links:[{url:product.url}],has_image:'image/jpeg'}];
 const handler=createWishlistHandler({env,auth:async()=>({status:200,conversation:id}),storeFactory:()=>({wishlistEntries:async conversation=>{assert.equal(conversation,id);return rows;}})});
 let res=response();await handler(request(),res);assert.equal(res.statusCode,200);assert.equal(JSON.parse(res.value).items.length,1);assert.equal(JSON.parse(res.value).items[0].links,undefined);
 res=response();await handler(request('GET',`/api/wishlist?group=${groupWishlist(rows)[0].id}`),res);assert.equal(res.statusCode,200);assert.equal(JSON.parse(res.value).item.links.length,1);
 res=response();await handler(request('GET',`/api/wishlist?group=${id}`),res);assert.equal(res.statusCode,404);
});
