import {test} from 'node:test';
import {Readable} from 'node:stream';
import assert from 'node:assert/strict';
import {repairWishlistPhotos} from '../lib/wishlist-photos.js';
import {createWishlistHandler} from '../api/wishlist.js';
import {createStore} from '../lib/store.js';
const now=Date.parse('2026-10-08T02:00:00Z');
const photo={mime_type:'image/jpeg',data:Buffer.from('photo').toString('base64')};
const product={url:'https://www.prada.com/us/en/p/example/EXAMPLE',name:'Example sneakers',text_origin:true,links:[{url:'https://www.prada.com/us/en/p/example/EXAMPLE'}]};
function fixture(){const items=new Map(['a','b','c'].map(id=>[id,{id,product:{...product}}]));const writes=[];return{items,writes,wishlistItem:async(_conversation,id)=>items.get(id),saveWishlistPhotos:async(_conversation,id,update)=>{writes.push({id,update});Object.assign(items.get(id).product,update);}};}
test('recovered items fetch and persist their photos; existing images are preserved',async()=>{
 const store=fixture();let calls=0;
 const rows=await repairWishlistPhotos([{item_id:'a'},{item_id:'b',has_image:'image/jpeg'}],{conversation:'owned',store,now,photos:async(url,name)=>{calls++;assert.equal(url,product.url);assert.equal(name,product.name);return [photo];}});
 assert.equal(calls,1);assert.equal(rows[0].has_image,'image/jpeg');assert.equal(store.items.get('a').product.image,photo);assert.equal(store.writes[0].update.photo_status,'ready');
});
test('download failure keeps the item and retries after five minutes, without repeated requests on refresh',async()=>{
 const store=fixture();let calls=0;const photos=async()=>{calls++;throw Error('retailer unavailable');};
 let rows=await repairWishlistPhotos([{item_id:'a'}],{conversation:'owned',store,now,photos});
 assert.equal(rows[0].photo_status,'retry_pending');assert.equal(store.items.get('a').product.url,product.url);
 rows=await repairWishlistPhotos(rows,{conversation:'owned',store,now:now+1000,photos});assert.equal(calls,1);
 await repairWishlistPhotos(rows,{conversation:'owned',store,now:now+300001,photos:async()=>[photo]});assert.equal(store.items.get('a').product.image,photo);
});
test('a stored item image repairs missing encounter metadata without another retailer download',async()=>{
 const store=fixture();store.items.get('a').product.image=photo;
 const rows=await repairWishlistPhotos([{item_id:'a'}],{conversation:'owned',store,now,photos:()=>assert.fail()});assert.equal(rows[0].has_image,'image/jpeg');assert.equal(store.writes.length,1);
});
test('recovery is bounded and a failing first batch does not starve later items',async()=>{
 const store=fixture();const rows=['a','b','c'].map(item_id=>({item_id}));let calls=0;
 const first=await repairWishlistPhotos(rows,{conversation:'owned',store,now,photos:async()=>{calls++;throw Error();}});assert.equal(calls,2);
 await repairWishlistPhotos(first,{conversation:'owned',store,now:now+1000,photos:async()=>{calls++;return [photo];}});assert.equal(calls,3);assert.equal(store.items.get('c').product.image,photo);
});
test('wishlist reads never block on photos; separate recovery requires authentication',async()=>{
 const store=fixture();store.wishlistEntries=async()=>[{...product,item_id:'a',reply_id:'reply'}];let downloads=0;
 const handler=createWishlistHandler({env:{WISHLIST_ENABLED:'true'},storeFactory:()=>store,auth:async headers=>headers.authorization?{status:200,conversation:'owned'}:{status:401},photos:async()=>{downloads++;return [photo];},verify:async()=>({status:'unavailable'})});
 const res=()=>({setHeader(){},end(body){this.body=body;}});
 const denied=res();await handler({method:'GET',url:'/api/wishlist',headers:{}},denied);assert.equal(denied.statusCode,401);assert.equal(downloads,0);
 const allowed=res();await handler({method:'GET',url:'/api/wishlist',headers:{authorization:'test'}},allowed);assert.equal(allowed.statusCode,200);assert.equal(JSON.parse(allowed.body).items[0].has_image,false);assert.equal(downloads,0);
 const post=authorization=>Object.assign(Readable.from([JSON.stringify({action:'recover-photos'})]),{method:'POST',url:'/api/wishlist',headers:{authorization,'content-type':'application/json'}});
 const deniedPost=res();await handler(post(undefined),deniedPost);assert.equal(deniedPost.statusCode,401);assert.equal(downloads,0);
 const recovered=res();await handler(post('test'),recovered);assert.equal(recovered.statusCode,200);assert.equal(JSON.parse(recovered.body).items[0].has_image,true);assert.equal(downloads,1);
});
test('photo persistence updates every encounter by reply ID and leaves item identity and links intact',async()=>{
 const requests=[];const store=createStore({SUPABASE_URL:'https://db.example',SUPABASE_SERVICE_ROLE_KEY:'fake'},async(url,options)=>{
  requests.push({url,...options});return{ok:true,text:async()=>options.method==='GET'?JSON.stringify([{product,wishlist_encounters:[{reply_id:'first',product},{reply_id:'second',product}]}]):''};
 });
 await store.saveWishlistPhotos('owned','item',{image:photo,photo_status:'ready',url:'https://wrong.example'});
 const writes=requests.filter(r=>r.method==='PATCH');assert.equal(writes.length,3);assert.ok(writes[1].url.includes('reply_id=eq.first'));assert.ok(writes[2].url.includes('reply_id=eq.second'));
 for(const write of writes){const saved=JSON.parse(write.body).product;assert.equal(saved.url,product.url);assert.deepEqual(saved.links,product.links);assert.deepEqual(saved.image,photo);}
});
