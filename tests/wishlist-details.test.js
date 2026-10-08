import {test} from 'node:test';
import assert from 'node:assert/strict';
import {enrichWishlistItem} from '../lib/wishlist-details.js';
import {browserResourceURL} from '../lib/rendered-listing.js';
const url='https://www.mrporter.com/en-us/mens/product/example/123';
test('enrichment repairs an owned saved reference with exact retailer metadata and photos',async()=>{
 const calls=[],price={amount:368,currency:'USD',source_url:url,checked_at:'2026-10-08T00:00:00Z'};
 const store={wishlistItem:async(c,id)=>{assert.equal(c,'owner');assert.equal(id,'item');return {product:{url,name:'Item from mrporter.com',links:[{url,user_saved:true}]}};},
 correctWishlistProduct:async(c,id,update)=>{calls.push('details');assert.equal(update.name,'Trousers');assert.equal(update.links[0].price_snapshot,price);assert.equal(update.links[0].user_saved,true);},
 saveWishlistPhotos:async(c,id,update)=>{calls.push('photos');assert.equal(update.image.data,'photo');}};
 const result=await enrichWishlistItem(store,'owner','item',{verify:async()=>({status:'verified',url,product_name:'Trousers',product_brand:'Dries',price_snapshot:price}),photos:async()=>[{data:'photo',mime_type:'image/jpeg'}]});
 assert.equal(result.status,'ready');assert.deepEqual(calls,['details','photos']);
});
test('failed or redirected enrichment cannot invent details or replace the saved product',async()=>{
 for(const check of [{status:'check_failed'},{status:'verified',url:'https://www.mrporter.com/wrong'}]){
 const result=await enrichWishlistItem({wishlistItem:async()=>({product:{url}}),correctWishlistProduct:()=>assert.fail()},'owner','item',{verify:async()=>check});assert.equal(result.status,'retry_pending');}
});
test('browser recovery restricts requests to merchant and public asset domains',()=>{
 for(const value of ['http://www.mrporter.com/item','https://127.0.0.1','https://www.mrporter.com.evil.example','https://secret@www.mrporter.com/item','https://www.mrporter.com:8443/item'])assert.equal(browserResourceURL(value),false);
 assert.equal(browserResourceURL('https://cache.mrporter.com/item.jpg'),true);
});

test('a new supplied-link save collects the actual name, price and product photo before persistence',async t=>{
 const {wishlistProducts}=await import('../lib/wishlist.js');const {default:sharp}=await import('sharp');
 const bytes=await sharp({create:{width:10,height:10,channels:3,background:'brown'}}).png().toBuffer();
 const data={'@type':'Product',name:'Cotton Trousers',brand:{name:'Dries Van Noten'},url,image:['https://www.mrporter.com/variants/images/item/in/test.jpg'],offers:{url,price:'368',priceCurrency:'USD'}};
 t.mock.method(globalThis,'fetch',async value=>String(value).endsWith('.jpg')?new Response(bytes,{headers:{'content-type':'image/png'}}):new Response('<script type="application/ld+json">'+JSON.stringify(data)+'</script>',{headers:{'content-type':'text/html'}}));
 const [item]=await wishlistProducts({identification_policy:'text_wishlist',user_confirmed:true,products:[{url,name:'Item from mrporter.com',reference_provenance:'user_link'}]},'',[],{});
 assert.equal(item.name,'Cotton Trousers');assert.equal(item.brand,'Dries Van Noten');assert.equal(item.links[0].price_snapshot.amount,368);assert.equal(item.links[0].verification_status,'verified');assert.ok(item.image.data);assert.equal(item.photo_status,'ready');
});
