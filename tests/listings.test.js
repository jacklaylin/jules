import {test} from 'node:test';
import assert from 'node:assert/strict';
import {verifyListing,verifySearchMerchants,verifyWishlistRows} from '../lib/listings.js';
const url='https://www.barbour.com/us/jacket.html';
const name='Transport Windowpane Waxed Jacket';
const html=product=>new Response('<script type="application/ld+json">'+JSON.stringify(product)+'</script>',{headers:{'content-type':'text/html'}});
const product={'@type':'Product',name,offers:{'@type':'Offer',price:'700.00',priceCurrency:'USD',availability:'https://schema.org/OutOfStock'}};
test('live sold-out listings retain sourced prices and availability',async()=>{
 const value=await verifyListing(url,name,async()=>html(product));assert.equal(value.status,'verified');assert.equal(value.price_snapshot.amount,700);assert.equal(value.price_snapshot.source_url,url);assert.equal(value.availability,'OutOfStock');assert.ok(value.checked_at);
});
test('redirects are checked at the destination; category, missing, wrong product, unsafe and blocked pages cannot be shopping links',async()=>{
 let calls=0;
 const category=await verifyListing(url,name,async()=>++calls===1?new Response(null,{status:302,headers:{location:'/us/jackets'}}):html({'@type':'CollectionPage',name:'Jackets'}));assert.equal(category.status,'not_product');assert.equal(calls,2);
 for(const response of [new Response('missing',{status:404}),html({...product,name:'Other Coat'}),html([product,{...product,name:'Recommendation'}]),html([{'@type':'CollectionPage'},product])])assert.notEqual((await verifyListing(url,name,async()=>response)).status,'verified');
 const unsafe=await verifyListing(url,name,async()=>new Response(null,{status:302,headers:{location:'https://127.0.0.1/private'}}));assert.equal(unsafe.status,'invalid_redirect');
 assert.equal((await verifyListing('https://unknown.example/item',name,()=>assert.fail())).status,'unsupported');assert.equal((await verifyListing(url,name,async()=>{throw new Error('blocked');})).status,'check_failed');
});
test('missing, ambiguous and malformed retailer prices are checked but never invented',async()=>{
 for(const offers of [{},{price:'1,510',priceCurrency:'USD'},{price:-1,priceCurrency:'USD'},{price:'10',priceCurrency:'usd'},[{price:10,priceCurrency:'USD'},{price:20,priceCurrency:'USD'}]]){
  const value=await verifyListing(url,name,async()=>html({...product,offers}));assert.equal(value.status,'verified');assert.equal(value.price_snapshot,null);assert.notEqual(value.price_status,'found');
 }
});
test('a failed primary link is replaced only by a verified same-product merchant and all failures retain identity without shopping links',async()=>{
 const base={status:'found',products:[{name,url,merchant_options:[{url:'https://www.mytheresa.com/item'}]}]};
 const verify=async url=>url.includes('barbour')?{status:'not_product'}:{status:'verified',url,price_snapshot:{amount:1510,currency:'USD',source_url:url}};
 const result=await verifySearchMerchants(base,null,verify);assert.equal(result.products[0].url,'https://www.mytheresa.com/item');assert.equal(result.products[0].price_snapshot.amount,1510);assert.deepEqual(result.products[0].merchant_options,[]);
 const failed=await verifySearchMerchants(base,null,async()=>({status:'check_failed'}));assert.equal(failed.status,'identified_no_store');assert.equal(failed.products[0].sourcing_status,'store_not_found');assert.deepEqual(failed.products[0].merchant_options,[]);
});

test('saved rows refresh prices and remove stale links before returning wishlist metadata',async()=>{
 const rows=[{name,url,price_snapshot:{amount:1,currency:'USD'},links:[{url},{url:'https://www.barbour.com/missing'}]}];
 const verified=await verifyWishlistRows(rows,null,async value=>value===url?{status:'verified',url,price_snapshot:{amount:700,currency:'USD',source_url:url},availability:'OutOfStock'}:{status:'unavailable'});
 assert.equal(verified[0].links.length,1);assert.equal(verified[0].links[0].price_snapshot.amount,700);assert.equal(verified[0].price_snapshot,null);assert.equal(verified[0].links[0].availability,'OutOfStock');
 const failed=await verifyWishlistRows(rows,null,async()=>({status:'check_failed'}));assert.deepEqual(failed[0].links,[]);assert.equal(failed[0].sourcing_status,'store_not_found');
});

test('an HTTP 200 bot failover is a failed check and no-store replies expose no unverified URLs',async()=>{
 const checked=await verifyListing(url,name,async()=>new Response('<script>window.isBotPage = true</script>',{headers:{'content-type':'text/html'}}));assert.equal(checked.status,'check_failed');
 const {formatSearch}=await import('../lib/search.js');assert.ok(!formatSearch({intro:'Possible match',products:[{brand:'Barbour',name,url,sourcing_status:'store_not_found'}]}).includes('https://'));
});
