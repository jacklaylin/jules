import {test} from 'node:test';
import assert from 'node:assert/strict';
import {verifyListing,verifySearchMerchants} from '../lib/listings.js';
import {isSuppressedStore} from '../lib/retailers.js';
import {identityEvidence,unverifiedShowable,formatSearch} from '../lib/search.js';

const name='Still Chino Trousers';
const page=product=>new Response('<script type="application/ld+json">'+JSON.stringify(product)+'</script>',{headers:{'content-type':'text/html'}});
const listing={'@type':'Product',name,brand:'Our Legacy',offers:{'@type':'Offer',price:'250.00',priceCurrency:'USD',availability:'https://schema.org/InStock'}};

test('suppressed stores are recognised by host, including subdomains and country sites, and other stores are not',()=>{
 for(const url of ['https://www.lyst.com/clothing/our-legacy-still-chino-trousers-1/','https://lyst.com/x','https://www.modesens.com/product/x','https://joincheckmate.com/products/fivefourfive.it/545/1/2','https://www.shopstyle.co.uk/p/1','https://www.temu.com/goods.html?id=1','https://www.rakuten.com/shop/x','https://de.aliexpress.com/item/1.html','https://item.rakuten.co.jp/shop/1/','https://clothbase.com/items/cb0df269_brand-black-scout-derbys_brand','https://www.clothbase.com/x'])assert.ok(isSuppressedStore(url),url);
 for(const url of ['https://www.ssense.com/en-us/men/product/our-legacy/x/1','https://eu.fivefourfive.it/products/545','https://notlyst.com/x','https://temu.com.example.org/x','https://www.farfetch.com/x','not a url'])assert.equal(isSuppressedStore(url),false,url);
});

test('a suppressed store page never passes the listing check, read directly or reached by redirect',async()=>{
 // Even a page that carries a perfect product record is not a store.
 const direct=await verifyListing('https://www.lyst.com/clothing/our-legacy-still-chino-trousers-1/',name,()=>assert.fail('suppressed pages are not fetched'));
 assert.equal(direct.status,'not_product');assert.equal(direct.reason,'suppressed_store');
 let calls=0;
 const redirected=await verifyListing('https://shop.example.com/go/123',name,async()=>++calls===1?new Response(null,{status:302,headers:{location:'https://www.modesens.com/product/x'}}):page(listing));
 assert.equal(redirected.status,'not_product');assert.equal(redirected.reason,'suppressed_store');assert.equal(calls,1);
 // A store's own page with the same record still verifies.
 assert.equal((await verifyListing('https://www.ssense.com/en-us/men/product/our-legacy/x/1',name,async()=>page(listing))).status,'verified');
});

test('a product found only on a suppressed store is not offered as a store or kept as evidence; the store it links to is',async()=>{
 const lyst='https://www.lyst.com/clothing/our-legacy-still-chino-trousers-1/',store='https://www.ssense.com/en-us/men/product/our-legacy/x/1';
 const verify=async url=>isSuppressedStore(url)?{status:'not_product',reason:'suppressed_store'}:{status:'verified',url,product_name:name,product_brand:'Our Legacy'};
 // Aggregator as the primary link with a real store as another merchant: the store is shown.
 const both=await verifySearchMerchants({status:'found',products:[{name,brand:'Our Legacy',url:lyst,merchant_options:[{url:store}]}]},fetch,verify);
 assert.equal(both.products[0].sourcing_status,'store_found');assert.equal(both.products[0].url,store);
 // Aggregator only: not verified, not shown as possible evidence either.
 const only=await verifySearchMerchants({status:'found',products:[{name,brand:'Our Legacy',url:lyst,merchant_options:[]}]},fetch,verify);
 const p=only.products[0];
 assert.equal(p.sourcing_status,'store_not_found');assert.deepEqual(identityEvidence(p),[]);assert.equal(unverifiedShowable(p),false);
 assert.ok(!formatSearch({...only,intro:''}).includes('lyst.com'));
});
