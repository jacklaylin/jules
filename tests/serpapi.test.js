import test from 'node:test';
import assert from 'node:assert/strict';
import {serpApiJSON} from '../lib/serpapi.js';
import {lookupIndexedProduct} from '../lib/indexed-product.js';
import {lensSearch} from '../lib/lens.js';
test('quota exhaustion pauses subsequent enrichment and Lens uploads without affecting another account',async()=>{
 const env={SERPAPI_API_KEY:'quota-fixture'};let calls=0;
 const fetcher=async()=>{calls++;return new Response(JSON.stringify({error:'Your account has run out of searches.'}),{status:429});};
 await assert.rejects(serpApiJSON('https://serpapi.com/search',{},env,fetcher));
 assert.equal(await lookupIndexedProduct('https://shop.example/products/shirt','Shirt',{env,fetcher}),null);
 await assert.rejects(lensSearch({data:'',mime_type:'image/jpeg'},'',env,fetcher));
 await assert.rejects(serpApiJSON('https://serpapi.com/search',{},env,fetcher));assert.equal(calls,1);
 const data=await serpApiJSON('https://serpapi.com/search',{}, {SERPAPI_API_KEY:'other-fixture'},async()=>new Response(JSON.stringify({organic_results:[]})));assert.deepEqual(data.organic_results,[]);
});
test('ordinary provider errors do not permanently pause an account',async()=>{
 const env={SERPAPI_API_KEY:'transient-fixture'};
 await assert.rejects(serpApiJSON('https://serpapi.com/search',{},env,async()=>new Response('{}',{status:503})));
 assert.deepEqual(await serpApiJSON('https://serpapi.com/search',{},env,async()=>new Response('{"ok":true}')),{ok:true});
});
