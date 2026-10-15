import {test} from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {backfillPhotoBackgrounds,hasTransparency} from '../lib/photo-backfill.js';

const clear=()=>sharp({create:{width:400,height:400,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).png().toBuffer();
const black=()=>sharp({create:{width:400,height:400,channels:4,background:{r:0,g:0,b:0,alpha:1}}}).png().toBuffer();
const stored='old-black-jpeg';
const corner=async base64=>[...(await sharp(Buffer.from(base64,'base64')).raw().toBuffer()).subarray(0,3)];
async function* rows(list){yield* list;}

function fixture(originals){
 const writes=[];
 const db={
  orderPhotos:()=>rows([
   {id:'order_photo:socks',conversation_id:'c1',data:{item_id:'socks',url:'https://cdn.bombas.example/socks.png',photo_source:'shop_order',mime_type:'image/jpeg',data:stored}},
   {id:'order_photo:tee',conversation_id:'c1',data:{item_id:'tee',url:'https://cdn.kith.example/tee.png',mime_type:'image/jpeg',data:stored}},
   {id:'order_photo:gone',conversation_id:'c2',data:{item_id:'gone',url:'https://cdn.gone.example/x.png',mime_type:'image/jpeg',data:stored}}]),
  replaceOrderPhoto:(row,data)=>writes.push(['order',row.id,data]),
  wishlistPhotos:()=>rows([
   {id:'w1',conversation_id:'c1',image_kind:'product',image:{mime_type:'image/jpeg',data:stored,source_url:'https://shop.example/p',asset_url:'https://cdn.shop.example/front.png'},
    additional_images:[{mime_type:'image/jpeg',data:stored,asset_url:'https://cdn.shop.example/back.png'},{mime_type:'image/jpeg',data:stored}]},
   {id:'w2',conversation_id:'c1',image_kind:'outfit_crop',image:{mime_type:'image/jpeg',data:stored},additional_images:[]}]),
  saveWishlistPhotos:(row,update)=>writes.push(['wishlist',row.id,update]),
 };
 const fetched=[];
 const fetcher=async url=>{fetched.push(url);const bytes=originals[url];return bytes?new Response(bytes,{headers:{'content-type':'image/png'}}):new Response('gone',{status:404});};
 return {db,writes,fetcher,fetched};
}

test('transparency is read from the original, not assumed from a dark backdrop',async()=>{
 assert.equal(await hasTransparency(await clear()),true);
 assert.equal(await hasTransparency(await black()),false);
 assert.equal(await hasTransparency(await sharp({create:{width:4,height:4,channels:3,background:'#000'}}).jpeg().toBuffer()),false);
});

test('report-only run replaces nothing but counts what it would fix',async()=>{
 const {db,writes,fetcher}=fixture({'https://cdn.bombas.example/socks.png':await clear(),'https://cdn.kith.example/tee.png':await black(),'https://cdn.shop.example/front.png':await clear(),'https://cdn.shop.example/back.png':await black()});
 const counts=await backfillPhotoBackgrounds(db,{fetcher});
 assert.deepEqual(writes,[]);
 assert.deepEqual(counts,{checked:5,fixed:2,not_transparent:2,download_failed:1,unreadable:0});
});

test('write replaces only transparent originals, onto white, keeping everything else',async()=>{
 const {db,writes,fetcher,fetched}=fixture({'https://cdn.bombas.example/socks.png':await clear(),'https://cdn.kith.example/tee.png':await black(),'https://cdn.shop.example/front.png':await clear(),'https://cdn.shop.example/back.png':await black()});
 await backfillPhotoBackgrounds(db,{fetcher,write:true});
 // A genuine black backdrop, a dead link and a non-product crop are never touched.
 assert.deepEqual(writes.map(w=>[w[0],w[1]]),[['order','order_photo:socks'],['wishlist','w1']]);
 assert.equal(fetched.length,5);
 const [,,order]=writes[0];
 assert.deepEqual(await corner(order.data),[255,255,255]);
 assert.equal(order.item_id,'socks');assert.equal(order.photo_source,'shop_order');assert.equal(order.url,'https://cdn.bombas.example/socks.png');
 const [,,update]=writes[1];
 assert.deepEqual(await corner(update.image.data),[255,255,255]);
 assert.equal(update.image.asset_url,'https://cdn.shop.example/front.png');assert.equal(update.image.source_url,'https://shop.example/p');
 // The opaque extra photo stays as stored, so additional_images is not rewritten.
 assert.equal('additional_images' in update,false);
});
