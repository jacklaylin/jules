import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {wishlistPreviewURL,validWishlistPreview,splitWishlistPreview} from '../lib/wishlist-preview.js';
import {createImageHandler} from '../api/image.js';
import {createPreviewHandler} from '../lib/wishlist-preview-handler.js';
import {sendGreeting} from '../lib/photon.js';
import {rememberWishlistTarget,consumeWishlistTarget} from '../public/wishlist-deep-link.js';
const item='12345678-1234-1234-1234-123456789abc';
const env={SITE_ORIGIN:'https://jules.example',SUPABASE_SERVICE_ROLE_KEY:'test-only-key'};
const url=wishlistPreviewURL(item,true,env);
test('preview item targets survive sign-in in another tab and cannot resolve against another account',()=>{
 const data=new Map(),storage={getItem:key=>data.get(key),setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};
 rememberWishlistTarget('?item='+item,storage,100);
 assert.deepEqual(consumeWishlistTarget([{id:'owned-group',entries:[{item_id:item}]}],storage,200),{id:'owned-group'});
 assert.equal(consumeWishlistTarget([],storage,200),null);
 rememberWishlistTarget('?item='+item,storage,100);assert.deepEqual(consumeWishlistTarget([],storage,200),{missing:true});
 rememberWishlistTarget('?item='+item,storage,100);assert.equal(consumeWishlistTarget([],storage,2000000),null);
 rememberWishlistTarget('?item=unsafe',storage,100);assert.equal(data.size,0);
});
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},end(body){this.body=body;}});
async function request(read,path=url,method='GET'){
 const res=response();await createPreviewHandler({env,read})({method,url:path},res);return res;
}
test('preview signatures bind the item and image revision and reject malformed tokens',()=>{
 assert.ok(validWishlistPreview(new URL(url),env));
 for(const value of [url.replace(item,item.replace('12345678','87654321')),url.replace('v=photo','v=pending'),url.replace(/sig=.*/,'sig='+'é'.repeat(43))])assert.equal(validWishlistPreview(new URL(value),env),false);
 assert.equal(wishlistPreviewURL(item,true,{SITE_ORIGIN:env.SITE_ORIGIN}),null);
 assert.deepEqual(splitWishlistPreview('Saved.\n'+url,env),{body:'Saved.',preview:url});
 assert.deepEqual(splitWishlistPreview('Saved.\nhttps://other.example',env),{body:'Saved.\nhttps://other.example'});
});
test('invalid and missing previews never expose product records',async()=>{
 assert.equal((await request(()=>assert.fail(),url.replace(/sig=.*/,'sig=wrong'))).statusCode,404);
 assert.equal((await request(async()=>null)).statusCode,404);
 assert.equal((await request(async()=>({wishlist_removed:true}))).statusCode,404);
 assert.equal((await request(()=>assert.fail(),url,'POST')).statusCode,405);
});
test('HTML contains escaped product-only metadata and an authenticated item destination',async()=>{
 const res=await request(async()=>({name:'Rib <Long> Sleeve',brand:'Everybody.World',description:'PRIVATE PROFILE',display_name:'PRIVATE CUSTOM NAME',source_image_id:'PRIVATE PHOTO',price_snapshot:{amount:123}}));
 assert.equal(res.statusCode,200);assert.match(res.body,/og:image/);assert.match(res.body,/Saved: Everybody.World Rib &lt;Long&gt; Sleeve/);
 assert.match(res.body,new RegExp('/wishlist\\?item='+item));assert.ok(!res.body.includes('PRIVATE'));assert.ok(!res.body.includes('123</'));
 assert.equal(res.headers['X-Robots-Tag'],'noindex, nofollow');
});
test('existing product photos become cached previews without provider calls',async()=>{
 const data=(await sharp({create:{width:20,height:40,channels:3,background:'#ffff00'}}).jpeg().toBuffer()).toString('base64');
 const res=await request(async()=>({name:'Shirt',image_kind:'product',image:{mime_type:'image/jpeg',data}}),url+'&image=1');
 assert.equal(res.statusCode,200);assert.equal(res.headers['Content-Type'],'image/jpeg');
 const metadata=await sharp(res.body).metadata();assert.equal(metadata.width,1200);assert.equal(metadata.height,630);
 assert.match(res.headers['Cache-Control'],/s-maxage=86400/);
});
test('outfit crops and missing photos use a branded fallback rather than publishing user images',async()=>{
 for(const product of [{image_kind:'outfit_crop',image:{mime_type:'image/jpeg',data:'INVALID PRIVATE IMAGE'}},{}]){
  const res=await request(async()=>product,url+'&image=1');assert.equal(res.statusCode,200);assert.equal((await sharp(res.body).metadata()).format,'jpeg');assert.match(res.headers['Cache-Control'],/s-maxage=60/);
 }
});
test('Photon sends native rich-link content after confirmation and preview failure does not fail the save reply',async()=>{
 for(const fail of [false,true]){
  const sent=[],logs=[];
  const conversation={send:async input=>{const content=typeof input==='string'?{type:'text',text:input}:await input.build();sent.push(content);if(fail&&content.type==='richlink')throw Error('Transport interrupted');return {id:'confirmation'};}};
  const result=await sendGreeting({space:{phone:'test-only'},message:{sender:{id:'test-only'}}},'Saved.\n'+url,env,{connect:async()=>({stop:async()=>{}}),provider:Object.assign(()=>({user:async()=>({}),space:{create:async()=>conversation}}),{config:()=>({})}),log:line=>logs.push(JSON.parse(line))});
  assert.equal(result.id,'confirmation');assert.deepEqual(sent,[{type:'text',text:'Saved.'},{type:'richlink',url}]);assert.equal(logs[0].event,fail?'wishlist_rich_preview_failed':'wishlist_rich_preview_sent');
 }
});

test('public previews require a valid signature while original message images still require owner authorization',async()=>{
 const handler=createImageHandler({env,auth:async()=>403,storeFactory:()=>assert.fail(),previewHandler:createPreviewHandler({env,read:async()=>({name:'Shirt'})})});
 const privateImage=response();await handler({url:'/api/image?id='+item,method:'GET',headers:{}},privateImage);assert.equal(privateImage.statusCode,403);
 const bad=response();await handler({url:'/api/image?preview=1&item='+item,method:'GET',headers:{}},bad);assert.equal(bad.statusCode,404);
 const good=response();await handler({url,method:'GET',headers:{}},good);assert.equal(good.statusCode,200);assert.match(good.body,/og:title/);
});
