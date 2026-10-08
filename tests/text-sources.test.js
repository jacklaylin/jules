import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recoverTextSources} from '../lib/text-sources.js';
test('direct recovery only returns page-verified model and brand matches in the requested department',async()=>{
 const links=['https://www.prada.com/us/en/mens/c/1','https://www.prada.com/us/en/p/black/men','https://www.prada.com/us/en/p/black/women','https://www.prada.com/us/en/p/black/unreadable','https://www.prada.com/us/en/p/black/wrongbrand'];let checked=0;
 const result=await recoverTextSources("Men's department: Prada Speedrock sneakers",{SERPAPI_API_KEY:'fake'},async url=>{
  const params=new URL(url).searchParams;assert.equal(params.get('engine'),'google');assert.match(params.get('q'),/men's/);
  return {ok:true,json:async()=>({organic_results:links.map(link=>({link,title:'Untrusted search title',snippet:'In stock $1'}))})};
 },{range:'men'},async url=>{
  checked++;return url.endsWith('unreadable')?{status:'unavailable'}:{status:'verified',url,product_name:'Speedrock sneakers',product_brand:url.endsWith('wrongbrand')?'Other':'Prada',shopping_range:url.endsWith('women')?'women':'men'};
 });
 assert.equal(checked,4);assert.equal(result.products.length,1);assert.equal(result.products[0].url,links[1]);assert.equal(result.products[0].price_snapshot,undefined);assert.equal(result.relevance_rejections[0].reason,'range_mismatch');
});
test('direct recovery rejects provider errors and empty brand evidence',async()=>{
 await assert.rejects(recoverTextSources('Prada Speedrock',{SERPAPI_API_KEY:'fake'},async()=>({ok:true,json:async()=>({error:'Quota'})}),{}));
 const result=await recoverTextSources('Prada Speedrock',{SERPAPI_API_KEY:'fake'},async()=>({ok:true,json:async()=>({organic_results:[{link:'https://www.prada.com/us/en/p/model/sku'}]})}),{},async url=>({status:'verified',url,product_name:'Speedrock'}));
 assert.equal(result.products.length,0);
});
import {collectionProductLinks} from '../lib/text-sources.js';
test('collection recovery follows matching same-origin product links and rejects invented or unsafe destinations',async()=>{
 const page='https://mfpen.com/collections/footwear',product='https://mfpen.com/products/scout-deck-shoe-scratched-black';
 const html='<a href="/products/scout-deck-shoe-scratched-black">Scout Deck Shoe Scratched Black</a><a href="https://mfpen.com.evil.example/products/scout-deck">Scout Deck</a><a href="/collections/scout-deck">Scout Deck</a><a href="/products/another-shirt">Shirt</a>';
 const found=await collectionProductLinks(page,'mfpen Scout Deck Shoe Scratched Black',async()=>new Response(html,{headers:{'content-type':'text/html'}}));
 assert.deepEqual(found,[product]);
 assert.deepEqual(await collectionProductLinks('https://unknown.example/collections/all','Scout Deck',()=>assert.fail()),[]);
});
test('known product identity scopes recovery to its registered official store, not a guessed domain',async()=>{
 let query;
 const page='https://mfpen.com/collections/footwear',product='https://mfpen.com/products/scout-deck-shoe-scratched-black';
 const result=await recoverTextSources('mfpen Scout Deck Shoe',{SERPAPI_API_KEY:'fake'},async url=>{
  if(url.startsWith('https://serpapi.com/')){query=new URL(url).searchParams.get('q');return {ok:true,json:async()=>({organic_results:[{link:page}]})};}
  return new Response('<a href="/products/scout-deck-shoe-scratched-black">Scout Deck Shoe</a>',{headers:{'content-type':'text/html'}});
 },{},async url=>url===product?{status:'verified',url,product_brand:'mfpen',product_name:'Scout Deck Shoe'}:{status:'not_product'},{brand:'mfpen',name:'Scout Deck Shoe'});
 assert.ok(query.startsWith('site:mfpen.com '));assert.equal(result.products[0].url,product);
});
import {recoverCollectionSources} from '../lib/text-sources.js';
test('retrieved collection recovery works independently of a search provider and preserves verification failures',async()=>{
 const candidate={url:'https://mfpen.com/collections/footwear',brand:'mfpen',name:'Scout Deck Shoe',match:'likely_match'};
 const fetcher=async()=>new Response('<a href="/products/scout-deck-shoe-scratched-black">Scout Deck Shoe</a>',{headers:{'content-type':'text/html'}});
 const success=await recoverCollectionSources([candidate],fetcher,{},async url=>({status:'verified',url,product_brand:'mfpen',product_name:'Scout Deck Shoe'}));
 assert.equal(success.products.length,1);assert.equal(success.products[0].sourcing_status,'store_found');
 const failed=await recoverCollectionSources([candidate],fetcher,{},async()=>({status:'check_failed'}));
 assert.equal(failed.products.length,0);assert.equal(failed.collection_checks[0].check.status,'check_failed');
 const wrongBrand=await recoverCollectionSources([candidate],fetcher,{},async url=>({status:'verified',url,product_brand:'Other',product_name:'Scout Deck Shoe'}));
 assert.equal(wrongBrand.products.length,0);
});
