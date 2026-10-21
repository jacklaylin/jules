import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {aggregatorSignals} from '../lib/aggregator-signals.js';
import {verifyListing} from '../lib/listings.js';
import {withSourcing} from '../lib/search.js';

// Structural extracts of live pages captured October 21 (tests/fixtures/aggregators/README.md).
const fixture=name=>readFileSync(new URL('./fixtures/'+name+'.html',import.meta.url),'utf8');
const html=body=>'<html><head><script type="application/ld+json">'+JSON.stringify({'@type':'Product',name:'Still Chino Trousers',brand:'Our Legacy',offers:{'@type':'Offer',price:'250.00',priceCurrency:'USD'}})+'</script></head><body>'+body+'</body></html>';

test('captured aggregator pages are flagged by their structure alone, without the blocked-store list',()=>{
 // Lyst: no checkout; the buy button is its own /track/lead/ click-through, opened in a new tab.
 const lyst=aggregatorSignals(fixture('aggregators/lyst'),'https://www.lyst.com/clothing/our-legacy-third-cut-jeans-414/');
 assert.equal(lyst.suspect,true);assert.equal(lyst.own_checkout,false);assert.ok(lyst.outbound_redirects>0);
 // Stylight: no checkout; the buy button carries the selling store's address in base64.
 const stylight=aggregatorSignals(fixture('aggregators/stylight'),'https://www.stylight.com/Item/Givenchy/Logo-Embroidered-Cotton-T-Shirt-White--62398427-7c03-5841-ad8e-bac276028076/');
 assert.equal(stylight.suspect,true);assert.equal(stylight.embedded_store_link,true);assert.deepEqual(stylight.other_stores,['r114wg-zn.myshopify.com']);
});

test('real stores and marketplaces are not flagged, including ones whose items come from other sellers',()=>{
 for(const [name,url] of [
  ['aggregators/farfetch','https://www.farfetch.com/shopping/men/our-legacy-mini-jacket-item-20015670.aspx'],
  ['aggregators/ssense','https://www.ssense.com/en-us/men/product/our-legacy/beige-cloak-car-coat/18885321'],
  ['aggregators/grailed','https://www.grailed.com/listings/108697234-our-legacy-our-legacy-tower-hiking-boot-fw23-size-43'],
  ['barbour-sizes','https://www.barbour.com/us/paul-smith-loves-barbour-transport-windowpane-waxed-jacket'],
  ['natalino-sizes','https://natalino.co.uk/products/sport-jacket'],
  ['depop-forward','https://www.depop.com/products/x/'],
 ]){const s=aggregatorSignals(fixture(name),url);assert.equal(s.suspect,false,name);}
 // Farfetch, SSENSE and Grailed each show their own checkout.
 for(const name of ['farfetch','ssense','grailed'])assert.equal(aggregatorSignals(fixture('aggregators/'+name),'https://www.'+name+'.com/x').own_checkout,true,name);
});

test('a page is suspect only when it lacks its own checkout and its buy link leaves for another store',()=>{
 const url='https://www.finds.example/item/1';
 const affiliate='<a href="https://go.skimresources.com/?id=1&url=https%3A%2F%2Fwww.ssense.com%2Fen-us%2Fmen%2Fproduct%2Four-legacy%2Fx%2F1" target="_blank" rel="sponsored">Shop</a>';
 // An affiliate hop to another store, no checkout: suspect, and the store it leads to is named.
 const hop=aggregatorSignals(html(affiliate),url);
 assert.equal(hop.suspect,true);assert.deepEqual(hop.other_stores,['ssense.com']);
 // The same link on a page with its own cart (a brand's "also at" link): not suspect.
 assert.equal(aggregatorSignals(html('<form action="/cart/add" method="post"><button name="add">Add to bag</button></form>'+affiliate),url).suspect,false);
 assert.equal(aggregatorSignals(html('<button class="product-form__add-to-cart">Add</button>'+affiliate),url).suspect,false);
 // A Shopify store always checks out on its own site.
 assert.equal(aggregatorSignals('<script>Shopify.country = "US";</script>'+html(affiliate),url).suspect,false);
 // No checkout in the page as read, but nothing leaving either (a page whose cart is drawn by script): not suspect.
 assert.equal(aggregatorSignals(html('<a href="https://www.instagram.com/brand/" target="_blank">IG</a><a href="https://pinterest.com/pin/create/button/?url=https%3A%2F%2Fwww.finds.example%2Fitem%2F1">Pin</a><img data-src="https://cdn.other.example/a.jpg">'),url).suspect,false);
 // The product data names another store as where the offer is.
 const offer=aggregatorSignals(html(''),url,[{url:'https://www.mrporter.com/en-us/mens/product/our-legacy/x/1',price:'250.00'}]);
 assert.equal(offer.suspect,true);assert.equal(offer.offsite_offer,true);assert.deepEqual(offer.other_stores,['mrporter.com']);
 // A marketplace naming a third-party seller but selling on its own page is not an off-site offer.
 assert.equal(aggregatorSignals(html(''),url,[{url,seller:{'@type':'Organization',name:'Balardi'}}]).offsite_offer,false);
 // A store address percent-encoded in a data attribute counts like the base64 one.
 assert.equal(aggregatorSignals(html('<button data-href="https%3A%2F%2Fwww.matchesfashion.com%2Fproducts%2F1">Buy</button>'),url).suspect,true);
 // A same-site click-through only counts when it opens elsewhere, as a buy button to another store does.
 assert.equal(aggregatorSignals(html('<a href="/go/size-guide">Size guide</a>'),url).suspect,false);
});

test('log-only: a suspect page still verifies, carries the signals and is logged; a listed store is exempt',async t=>{
 const logs=[];t.mock.method(console,'log',line=>logs.push(line));
 // The captured Lyst page, as if served by an unlisted site.
 const page=fixture('aggregators/lyst').replaceAll('www.lyst.com','www.denimfinds.example');
 const url='https://www.denimfinds.example/clothing/our-legacy-third-cut-jeans-414/';
 const check=await verifyListing(url,'Third Cut Jeans',async()=>new Response(page,{headers:{'content-type':'text/html'}}));
 assert.equal(check.status,'verified');assert.equal(check.price_snapshot.amount,444);
 assert.equal(check.aggregator_signals.suspect,true);
 const event=logs.map(l=>{try{return JSON.parse(l);}catch{return null;}}).find(e=>e?.event==='aggregator_suspect');
 assert.equal(event.site,'denimfinds.example');assert.equal(event.url,url);
 // The same markup on a store the registry lists is never checked.
 const listed=await verifyListing('https://www.ssense.com/en-us/men/product/our-legacy/x/1','Third Cut Jeans',async()=>new Response(page,{headers:{'content-type':'text/html'}}));
 assert.equal(listed.status,'verified');assert.equal(listed.aggregator_signals,undefined);
});

test('search diagnostics list the flagged pages for review without changing what is shown',()=>{
 const signals={suspect:true,own_checkout:false,outbound_redirects:1,embedded_store_link:false,offsite_offer:false,other_stores:[]};
 const result={status:'found',products:[
  {url:'https://www.denimfinds.example/x',sourcing_status:'store_found',match:'likely_match',listing_check:{status:'verified',url:'https://www.denimfinds.example/x',aggregator_signals:signals},merchant_options:[{url:'https://www.ssense.com/x',listing_check:{status:'verified',url:'https://www.ssense.com/x'}}]},
 ]};
 const {sourcing,products}=withSourcing(result,{answered_by:'web_search',started:Date.now()});
 assert.deepEqual(sourcing.aggregator_suspects,[{url:'https://www.denimfinds.example/x',host:'denimfinds.example',signals}]);
 assert.equal(products.length,1);assert.equal(products[0].sourcing_status,'store_found');
});
