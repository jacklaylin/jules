import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {largerPhotoURL} from '../lib/photo-sizes.js';
import {fetchOrderPhoto} from '../lib/order-photos.js';
import {sharpenOrderPhotos} from '../lib/photo-backfill.js';

test('known image hosts give a large copy of the same picture; other addresses are left alone',()=>{
 const cases=[
  ['https://cdn.shopify.com/s/files/1/0401/files/AW24_DROP326364_compact_cropped.jpg?v=17','https://cdn.shopify.com/s/files/1/0401/files/AW24_DROP326364.jpg?v=17&width=1200'],
  ['https://cdn.shopify.com/s/files/1/x/files/name_160x160.webp?v=1','https://cdn.shopify.com/s/files/1/x/files/name.webp?v=1&width=1200'],
  ['https://m.media-amazon.com/images/I/71PhaJKAaYL.SS90_.jpg','https://m.media-amazon.com/images/I/71PhaJKAaYL._SL1200_.jpg'],
  ['https://m.media-amazon.com/images/I/71PhaJKAaYL._AC_SX90_.jpg','https://m.media-amazon.com/images/I/71PhaJKAaYL._SL1200_.jpg'],
  ['https://dks.scene7.com/is/image/dkscdn/25NIK?$DSG_ShoppingCart$','https://dks.scene7.com/is/image/dkscdn/25NIK?wid=1200&hei=1200&fmt=jpg'],
  ['https://www.jcrew.com/s7-img-facade/BQ788_BK0001?$bag_tn150$','https://www.jcrew.com/s7-img-facade/BQ788_BK0001?wid=1200&hei=1200'],
  ['https://www.mrporter.com/variants/images/46376663162991239/in/w100_a3-4.jpg','https://www.mrporter.com/variants/images/46376663162991239/in/w2000_q60.jpg'],
  ['https://media.endclothing.com/media/f_auto,q_auto:eco,w_400,h_400/prodmedia/a.jpg','https://media.endclothing.com/media/f_auto,q_auto:eco,w_1200,h_1200/prodmedia/a.jpg'],
  ['https://cdn.dam.salomon.com/a/LC27/PNG-2000px.png?width=400&fit=cover','https://cdn.dam.salomon.com/a/LC27/PNG-2000px.png?width=1200&fit=cover'],
 ];
 for(const [from,to] of cases)assert.equal(largerPhotoURL(from),to,from);
 for(const same of ['https://d3vfig6e0r0snz.cloudfront.net/x/images/products/a.png','https://cdn.shopify.com/s/files/1/x/files/name.jpg?v=1&width=1200','http://cdn.shopify.com/s/files/1/x/files/a_small.jpg','not a url','https://media.endclothing.com/media/w_1600,h_1600/a.jpg'])
  assert.equal(largerPhotoURL(same),null,same);
});

const jpeg=size=>sharp({create:{width:size,height:size,channels:3,background:'#123'}}).jpeg().toBuffer();
const web=(sizes,seen=[])=>async url=>{seen.push(url);const size=sizes[url];return size?new Response(await jpeg(size),{headers:{'content-type':'image/jpeg'}}):new Response('missing',{status:404});};
test('an order photo is fetched at a large size first and falls back to the address the email gave',async()=>{
 const small='https://cdn.shopify.com/s/files/1/x/files/bag_compact.jpg?v=1',large='https://cdn.shopify.com/s/files/1/x/files/bag.jpg?v=1&width=1200';
 assert.equal((await fetchOrderPhoto(small,web({[small]:160,[large]:1200}))).width,900);
 assert.equal((await fetchOrderPhoto(small,web({[small]:160}))).width,160,'large copy missing: original');
});
test('the one-off repair replaces only small photos it can really enlarge, and only with --write',async()=>{
 const rows=[
  {id:'order_photo:a',data:{url:'https://cdn.shopify.com/s/files/1/x/files/a_compact.jpg?v=1',width:160,height:160}},
  {id:'order_photo:b',data:{url:'https://d3vfig6e0r0snz.cloudfront.net/x/b.png',width:67,height:100}},
  {id:'order_photo:c',data:{url:'https://cdn.shopify.com/s/files/1/x/files/c_compact.jpg?v=1',width:900,height:900}},
  {id:'order_photo:d',data:{url:'https://cdn.shopify.com/s/files/1/x/files/d_compact.jpg?v=1',width:160,height:160}},
 ];
 const fetcher=web({'https://cdn.shopify.com/s/files/1/x/files/a.jpg?v=1&width=1200':1200,'https://cdn.shopify.com/s/files/1/x/files/d.jpg?v=1&width=1200':180});
 const replaced=[],db={orderPhotos:async function*(){yield* rows;},replaceOrderPhoto:async(row,data)=>replaced.push([row.id,data])};
 const dry=await sharpenOrderPhotos(db,{fetcher});assert.deepEqual(replaced,[]);
 assert.deepEqual([dry.checked,dry.sharpened,dry.unsupported_host,dry.not_larger],[3,1,1,1]);
 await sharpenOrderPhotos(db,{fetcher,write:true});
 assert.equal(replaced.length,1);assert.equal(replaced[0][0],'order_photo:a');assert.equal(replaced[0][1].width,900);assert.equal(replaced[0][1].url,rows[0].data.url,'the email address is kept');
});
