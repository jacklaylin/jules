import {test} from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {verifyListing} from '../lib/listings.js';
import {wishlistProducts,groupWishlist} from '../lib/wishlist.js';
import {repairWishlistPhotos} from '../lib/wishlist-photos.js';
import {enrichWishlistItem} from '../lib/wishlist-details.js';
import {sameReferenceProductURL} from '../lib/indexed-product.js';
const url='https://independent-shop.example.org/products/rib-shirt';
// Synthetic Shopify-style evidence, not a real offer.
const page=JSON.stringify({'@type':'ProductGroup',name:'Rib Shirt',brand:{name:'Fixture Brand'},url,hasVariant:[['red','20','InStock'],['blue','20','OutOfStock']].map(([variant,price,stock])=>({'@type':'Product',name:'Rib Shirt - '+variant,image:'https://independent-cdn.example.org/'+variant+'.jpg',offers:{url:url+'?variant='+variant,price,priceCurrency:'USD',availability:'https://schema.org/'+stock}}))});
const html='<script type="application/ld+json">'+page+'</script>';
test('neutral references tolerate exact localized redirects while explicit markets and variants stay distinct',async()=>{
 const localized=url.replace('/products/','/en-ca/products/');
 assert.equal(sameReferenceProductURL(url,localized),true);
 for(const other of [localized+'?variant=blue',localized.replace('rib-shirt','other-shirt'),localized.replace('independent-shop','other-shop')])assert.equal(sameReferenceProductURL(url,other),false);
 assert.equal(sameReferenceProductURL(url.replace('/products/','/en-us/products/'),localized),false);
 let update;const price={amount:28,currency:'CAD',source_url:localized,checked_at:new Date().toISOString()};
 const result=await enrichWishlistItem({wishlistItem:async()=>({product:{url,image:{data:'existing'},links:[{url,user_saved:true}]}}),correctWishlistProduct:async(_c,_id,value)=>{update=value;},saveWishlistPhotos:async()=>{}},'owner','item',{verify:async()=>({status:'verified',url:localized,product_name:'Rib Shirt',price_snapshot:price})});
 assert.equal(result.status,'ready');assert.equal(update.links[0].url,localized);assert.equal(update.links[0].user_source_url,url);assert.equal(update.links[0].price_snapshot,price);
});
test('new supplied links outside the ranking registry persist sourced name, price and CDN photos',async()=>{
 const bytes=await sharp({create:{width:10,height:10,channels:3,background:'white'}}).jpeg().toBuffer();
 const fetcher=async value=>new Response(value.includes('.jpg')?bytes:html,{headers:{'content-type':value.includes('.jpg')?'image/jpeg':'text/html'}});
 const [item]=await wishlistProducts({identification_policy:'text_wishlist',user_confirmed:true,products:[{url,name:'Item from independent-shop',reference_provenance:'user_link',sourcing_status:'store_not_found'}]},'',[],{},undefined,{env:{},fetcher});
 assert.equal(item.sourcing_status,'store_found');assert.equal(item.name,'Rib Shirt');assert.equal(item.links[0].price_snapshot.amount,20);assert.equal(item.links[0].availability,null);assert.equal(item.photo_status,'ready');assert.ok(item.image.data);
});
test('variant-bound metadata cannot use another variant price or photo',async()=>{
 const selected=await verifyListing(url+'?variant=blue',null,async()=>new Response(html,{headers:{'content-type':'text/html'}}),undefined,{});
 assert.equal(selected.product_name,'Rib Shirt - blue');assert.equal(selected.availability,'OutOfStock');assert.equal(selected.product_images[0],'https://independent-cdn.example.org/blue.jpg');
 const missing=await verifyListing(url+'?variant=missing',null,async()=>new Response(html,{headers:{'content-type':'text/html'}}),undefined,{});assert.equal(missing.status,'not_product');
 const plain='<script type="application/ld+json">'+JSON.stringify({'@type':'Product',url,name:'Wrong red shirt',image:'https://independent-cdn.example.org/red.jpg',offers:{url:url+'?variant=red',price:1,priceCurrency:'USD'}})+'</script>';
 assert.equal((await verifyListing(url+'?variant=blue',null,async()=>new Response(plain,{headers:{'content-type':'text/html'}}),undefined,{})).status,'not_product');
});
test('background recovery repairs saved details even with an existing image and retries failures with a cooldown',async()=>{
 const now=Date.now(),image={data:'existing',mime_type:'image/jpeg'};
 const product={url,name:'Item from independent-shop',image,links:[{url,user_saved:true,verification_status:'unverified'}]};
 const store={wishlistItem:async()=>({product}),correctWishlistProduct:async(_c,_id,update)=>Object.assign(product,update),saveWishlistPhotos:async(_c,_id,update)=>Object.assign(product,update)};
 const row=()=>({item_id:'saved',reply_id:'reply',text_origin:true,has_image:product.image?.mime_type,...product});
 assert.equal(groupWishlist([row()])[0].details_pending,true);
 let attempts=0;
 let rows=await repairWishlistPhotos([row()],{conversation:'owner',store,now,verify:async()=>{attempts++;return {status:'check_failed'};},photos:()=>assert.fail('Existing photo should survive')});
 rows=await repairWishlistPhotos(rows,{conversation:'owner',store,now:now+1000,verify:()=>assert.fail()});assert.equal(attempts,1);
 rows=await repairWishlistPhotos(rows,{conversation:'owner',store,now:now+300001,verify:async()=>({status:'verified',url,product_name:'Rib Shirt',product_brand:'Fixture Brand',price_snapshot:{amount:20,currency:'USD',source_url:url,checked_at:new Date(now).toISOString()}}),photos:()=>assert.fail()});
 assert.equal(product.image,image);const group=groupWishlist(rows)[0];assert.equal(group.name,'Fixture Brand Rib Shirt');assert.equal(group.details_pending,false);assert.equal(group.price_ranges[0].min,20);
});
