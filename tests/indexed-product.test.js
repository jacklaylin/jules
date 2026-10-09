import test from 'node:test';
import assert from 'node:assert/strict';
import {lookupIndexedProduct,sameProductURL} from '../lib/indexed-product.js';
import {verifyListing} from '../lib/listings.js';
const url='https://www.mrporter.com/en-us/mens/product/dries-van-noten/clothing/casual-trousers/straight-leg-cotton-trousers/46376663162930410';
const wrong=url.replace('46376663162930410','46376663163006245');
const env={SERPAPI_API_KEY:'fixture'};
const image='https://www.mrporter.com/variants/images/46376663162930410/in/w2000_q60.jpg';
function fixture(prices=[368,368]){return async value=>{
 const request=new URL(value),engine=request.searchParams.get('engine');
 const json=engine==='google'?{organic_results:[{link:url,title:'DRIES VAN NOTEN Straight-Leg Cotton Trousers',rich_snippet:{bottom:{detected_extensions:{price:prices[0],currency:'USD'}}}},{link:wrong,title:'Wrong sweatpants',rich_snippet:{bottom:{detected_extensions:{price:1,currency:'USD'}}}}]}:
 engine==='google_images'?{images_results:[{link:wrong,original:image+'wrong'},{link:url,original:image,title:'DRIES VAN NOTEN Straight-Leg Cotton Trousers',in_stock:true}]}:
 engine==='google_shopping'?{shopping_results:[{title:'Cotton Trousers',product_id:'123',source:'MR PORTER',extracted_price:1,price:'$1'}]}:
 {product_results:{title:'Cotton Trousers',brand:'Dries Van Noten',thumbnails:[image],stores:[{link:url,title:'DRIES VAN NOTEN Straight-Leg Cotton Trousers',extracted_price:prices[1],price:'$'+prices[1]},{link:wrong,extracted_price:1,price:'$1'}]}};
 return new Response(JSON.stringify(json));
};}
test('combines only exact product URLs across index, images and merchant offers',async()=>{
 const result=await lookupIndexedProduct(url,null,{env,fetcher:fixture()});
 assert.equal(result.product_brand,'Dries Van Noten');assert.equal(result.price_snapshot.amount,368);assert.equal(result.price_snapshot.evidence_level,'indexed');assert.deepEqual(result.product_images,[image]);assert.equal(result.sources.length,4);assert.ok(!result.observations.some(o=>o.name==='Wrong sweatpants'));assert.equal(result.availability,undefined);
});
test('conflicting merchant prices remain evidence and do not become a cheapest-price assertion',async()=>{
 const result=await lookupIndexedProduct(url,null,{env,fetcher:fixture([735,368])});assert.equal(result.price_snapshot,null);assert.deepEqual(result.price_conflicts.map(p=>p.amount),[735,368]);
});
test('matching preserves market and variant parameters while allowing tracking-only differences',()=>{
 assert.ok(sameProductURL(url,url+'?utm_source=test'));assert.ok(!sameProductURL(url,wrong));assert.ok(!sameProductURL(url,url.replace('/en-us/','/en-gb/')));assert.ok(!sameProductURL(url,url+'?color=other'));assert.ok(!sameProductURL(url,'https://www.mrporter.com.evil.example'+new URL(url).pathname));
});
test('named product mismatch, unsupported images and provider outages cannot fabricate facts',async()=>{
 const mismatch=await lookupIndexedProduct(url,'Dries Van Noten Wool Blazer',{env,fetcher:fixture()});assert.equal(mismatch.product_name,null);assert.equal(mismatch.price_snapshot,null);assert.deepEqual(mismatch.product_images,[]);
 const failed=await lookupIndexedProduct(url,null,{env,fetcher:async()=>{throw Error('private provider error');}});assert.equal(failed.product_name,null);assert.equal(failed.price_snapshot,null);assert.ok(failed.sources.every(s=>s.status==='unavailable'));
});
test('blocked merchant can recover an indexed reference without inventing current stock; a real 404 cannot',async()=>{
 const fetcher=async value=>String(value).startsWith('https://serpapi.com/')?fixture()(value):new Response('Access Denied',{status:403});
 const check=await verifyListing(url,null,fetcher,async()=>{throw Error('Blocked');},env);assert.equal(check.status,'verified');assert.equal(check.verification_basis,'search_index');assert.equal(check.price_snapshot.amount,368);assert.equal(check.availability,null);assert.equal(check.product_images[0],image);
 let calls=0;const missing=await verifyListing(url,null,async()=>{calls++;return new Response('Missing',{status:404});},async()=>assert.fail(),env);assert.equal(missing.status,'unavailable');assert.equal(calls,1);
});
test('live retailer price takes precedence while indexed disagreement remains traceable',async()=>{
 const fetcher=async value=>String(value).startsWith('https://serpapi.com/')?fixture([735,735])(value):new Response('<script type="application/ld+json">'+JSON.stringify({'@type':'Product',url,name:'Straight-Leg Cotton Trousers',offers:{price:368,priceCurrency:'USD'},image:[image]})+'</script>',{headers:{'content-type':'text/html'}});
 const check=await verifyListing(url,null,fetcher,async()=>assert.fail(),env);assert.equal(check.price_snapshot.amount,368);assert.equal(check.product_data.price_conflicts.length,2);assert.equal(check.retrieval,'http');
});
