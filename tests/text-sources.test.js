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
