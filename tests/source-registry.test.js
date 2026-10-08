import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BRANDS,TRUSTED_RETAILERS,sourceDomains,retailerFor} from '../lib/retailers.js';
import {merchantURL} from '../lib/product-photos.js';
import {searchProducts,validateSearch} from '../lib/search.js';
const reply=products=>({ok:true,json:async()=>({status:'completed',output:[{type:'web_search_call',status:'completed',action:{sources:products.map(p=>({url:p.url}))}},{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify({intro:'Results',products,needs_review:!products.length,requested_alternatives:false})}]}]})});
const candidate=url=>({url,brand:'Prada',name:'Speedrock sneakers',match:'likely_match',reason:'',role:'primary'});
const page=()=>new Response('<script type="application/ld+json">'+JSON.stringify({'@type':'Product',name:'Speedrock sneakers',brand:'Prada',offers:{'@type':'Offer',price:'100',priceCurrency:'USD',availability:'https://schema.org/InStock'}})+'</script>',{headers:{'content-type':'text/html'}});
test('starter registry contains 100 brands and 20 retailers with safe explicit domains and no fast fashion or big box entries',()=>{
 assert.equal(BRANDS.length,100);assert.equal(TRUSTED_RETAILERS.length,20);
 for(const scope of ['official','preferred']){assert.ok(sourceDomains(scope).length<=100);for(const domain of sourceDomains(scope)){assert.match(domain,/^[a-z0-9.-]+\.[a-z]+$/);assert.equal(merchantURL('https://'+domain+'/product/test'),'https://'+domain+'/product/test');}}
 for(const domain of ['walmart.com','target.com','zara.com','hm.com','shein.com','temu.com'])assert.equal(merchantURL('https://'+domain+'/item'),null);
 assert.equal(retailerFor('https://kith.com/products/nike','Nike').tier,'preferred');assert.equal(retailerFor('https://kith.com/products/kith','Kith').tier,'official');
 assert.equal(retailerFor('https://gucci.com.evil.example/item','Gucci').tier,'unreviewed');assert.equal(retailerFor('https://gucci.com/item','Not Gucci').tier,'unreviewed');
 assert.equal(retailerFor('https://ralphlauren.com/item','Polo Ralph Lauren').tier,'official');
});
test('a verified official product stops retrieval before retailers and the wider web',async()=>{
 let calls=0;const url='https://www.prada.com/us/en/p/speedrock/test';
 const result=await searchProducts('Prada Speedrock',[],{},async(endpoint,options)=>{
  if(endpoint===url)return page();calls++;const body=JSON.parse(options.body);assert.deepEqual(body.tools[0].filters.allowed_domains,sourceDomains('official'));return reply([candidate(url)]);
 });
 assert.equal(calls,1);assert.equal(result.source_scope,'official');assert.equal(result.products[0].sourcing_status,'store_found');
});
test('retailers are checked after an empty official pass and verified evidence stops the web fallback',async()=>{
 let calls=0;const url='https://www.nordstrom.com/s/speedrock/1';
 const result=await searchProducts('Prada Speedrock',[],{},async(endpoint,options)=>{
  if(endpoint===url)return page();const body=JSON.parse(options.body);calls++;assert.deepEqual(body.tools[0].filters.allowed_domains,sourceDomains(calls===1?'official':'preferred'));return reply(calls===1?[]:[candidate(url)]);
 });
 assert.equal(calls,2);assert.equal(result.source_scope,'preferred');assert.equal(result.products[0].sourcing_status,'store_found');
});
test('all empty passes broaden once in order and an off-registry result cannot bypass the first filter',async()=>{
 let calls=0;const result=await searchProducts('Prada Speedrock',[],{},async(endpoint,options)=>{
  assert.equal(endpoint,'https://api.openai.com/v1/responses');calls++;const body=JSON.parse(options.body);
  if(calls<3)assert.deepEqual(body.tools[0].filters.allowed_domains,sourceDomains(calls===1?'official':'preferred'));else assert.equal(body.tools[0].filters,undefined);
  return reply(calls===1?[candidate('https://unknown.example/products/speedrock')]:[]);
 });
 assert.equal(calls,3);assert.equal(result.products.length,0);assert.equal(result.registry_fallback_attempted,true);
});
test('model interpreted product scope rejects unrequested substitutes without scanning request wording',()=>{
 const url='https://www.prada.com/us/en/p/speedrock/test';
 const data={output:[{type:'web_search_call',status:'completed',action:{sources:[{url}]}}]};
 const value={intro:'Results',products:[{...candidate(url),match:'similar'}],needs_review:false};
 assert.equal(validateSearch(data,value,new Date(),{requestedAlternatives:false}).products.length,0);
 assert.equal(validateSearch(data,value,new Date(),{requestedAlternatives:true}).products.length,1);
});
test('a multi-brand retailer cannot masquerade as the requested brand’s official store',async()=>{
 let calls=0,pageReads=0;const url='https://kith.com/products/speedrock';
 const result=await searchProducts('Prada Speedrock',[],{},async(endpoint)=>{
  if(endpoint===url){pageReads++;return page();}calls++;return reply([candidate(url)]);
 });
 assert.equal(calls,2);assert.equal(pageReads,1);assert.equal(result.source_scope,'preferred');assert.equal(result.products[0].retailer.tier,'preferred');
});
