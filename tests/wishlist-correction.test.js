import {test} from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {createCorrectionHandler} from '../api/wishlist-correction.js';
const item='00000000-0000-4000-8000-000000000001';
const req=body=>({method:'POST',headers:{'content-type':'application/json'},async *[Symbol.asyncIterator](){yield Buffer.from(JSON.stringify(body));}});
const res=()=>({setHeader(){},end(body){this.body=JSON.parse(body);}});
test('corrections require owner access before accessing private data',async()=>{
 const r=res();await createCorrectionHandler({auth:async()=>403,storeFactory:()=>assert.fail()})(req({}),r);assert.equal(r.statusCode,403);
});
test('verified corrections stay within the owner conversation and store sourced prices and real images',async()=>{
 const bytes=await sharp({create:{width:1100,height:1200,channels:3,background:'white'}}).jpeg().toBuffer();
 const input={item,url:'https://www.mytheresa.com/us/en/product',name:'House polo sweater',brand:'JW Anderson',amount:1510,currency:'USD',verified:true,image:bytes.toString('base64')};
 let update;
 const store={wishlistMember:async()=>({conversation_id:'owner'}),wishlistItem:async(c,id)=>{assert.equal(c,'owner');assert.equal(id,item);return {};},correctWishlistProduct:async(c,id,value)=>{assert.equal(c,'owner');assert.equal(id,item);update=value;}};
 const handler=createCorrectionHandler({env:{ADMIN_EMAIL:'owner@example.invalid'},auth:async()=>200,storeFactory:()=>store});
 const r=res();await handler(req(input),r);assert.equal(r.statusCode,200);assert.equal(update.price_snapshot.source_url,input.url);assert.equal(update.price_snapshot.amount,1510);assert.equal(update.match,'similar');assert.equal(update.image_kind,'product');assert.equal((await sharp(Buffer.from(update.image.data,'base64')).metadata()).width,1100);
 const invalid=res();await handler(req({...input,verified:false}),invalid);assert.equal(invalid.statusCode,400);
 const other=res();await createCorrectionHandler({env:{ADMIN_EMAIL:'owner@example.invalid'},auth:async()=>200,storeFactory:()=>({...store,wishlistItem:async()=>null,correctWishlistProduct:()=>assert.fail()})})(req(input),other);assert.equal(other.statusCode,404);
});
