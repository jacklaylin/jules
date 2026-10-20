import {test} from 'node:test';
import assert from 'node:assert/strict';
import {shoppingStoreRows,registryStore} from '../lib/shopping-links.js';
import {exactSearch} from '../lib/text-sources.js';
import {textImageCandidates} from '../lib/lens.js';

// Rows as Google Shopping returns them since October 20, 2026: a seller name and a page token, no link.
const row=(source,title,token,extra={})=>({source,title,immersive_product_page_token:token,product_link:'https://www.google.com/search?ibp=oshop&q=x',extracted_price:500,price:'$500.00',thumbnail:'https://encrypted-tbn0.gstatic.com/images?q='+token,...extra});
const immersive={
 t_nord:{product_results:{stores:[{name:'Nordstrom',link:'https://www.nordstrom.com/s/barbour-bedale/123?srsltid=x',extracted_price:479,price:'$479.00'}]}},
 t_ssense:{product_results:{stores:[{name:'SSENSE',link:'https://www.ssense.com/en-us/men/product/barbour/bedale/1'}]}},
 t_mrp:{product_results:{stores:[{name:'MR PORTER',link:'https://www.mrporter.com/en-us/mens/product/barbour/2'}]}},
 // Google names a trusted seller but links elsewhere: never followed.
 t_fake:{product_results:{stores:[{name:'Saks Fifth Avenue',link:'https://saks-outlet-deals.example/p/1'}]}},
};
const searcher=(calls=[])=>async params=>{calls.push(params);if(params.engine!=='google_immersive_product')throw Error('unexpected');const d=immersive[params.page_token];if(!d)throw Error('down');return d;};

test('seller names map to registry stores',()=>{
 assert.equal(registryStore('Nordstrom')?.domain,'nordstrom.com');
 assert.equal(registryStore('ssense.com')?.domain,'ssense.com');
 assert.equal(registryStore('trendxparc.com'),null);
 assert.equal(registryStore(undefined),null);
});

test('only trusted sellers are looked up, at most two and one per store, best-ranked first',async()=>{
 const calls=[];
 const rows=[row('trendxparc.com','Barbour Bedale','t_spam'),row('Nordstrom','Barbour Bedale Wax Jacket','t_nord'),row('Nordstrom','Barbour Bedale Wax Jacket again','t_nord2'),row('MR PORTER','Barbour jacket','t_mrp'),row('SSENSE','Barbour Bedale Waxed Cotton Jacket','t_ssense')];
 const {rows:out,stats}=await shoppingStoreRows(rows,searcher(calls),{rank:r=>r.title.includes('Bedale')?1:0});
 assert.deepEqual(calls.map(c=>c.page_token).sort(),['t_nord','t_ssense']);
 assert.deepEqual(out.map(r=>new URL(r.link).hostname),['www.nordstrom.com','www.ssense.com'],'original order kept');
 assert.equal(stats.resolved,2);assert.equal(stats.trusted,4);assert.equal(stats.unlinked,5);
 // The store's own listed price on Google's page, still only an index observation for callers.
 assert.equal(out[0].extracted_price,479);
 assert.equal(out[1].extracted_price,500,'no store price: the row keeps its own');
});

test('rows that still carry a link cost nothing; failed or off-store lookups are dropped',async()=>{
 const calls=[];
 const {rows:out,stats}=await shoppingStoreRows([{title:'Old shape',source:'Anywhere',link:'https://store.example/p/1'},row('Saks Fifth Avenue','Jacket','t_fake'),row('NET-A-PORTER','Jacket','t_missing')],searcher(calls));
 assert.deepEqual(out.map(r=>r.link),['https://store.example/p/1']);
 assert.equal(stats.linked,1);assert.equal(stats.untrusted_link,1);assert.equal(stats.failed,1);assert.equal(calls.length,2);
 assert.deepEqual((await shoppingStoreRows(undefined,searcher())).rows,[]);
});

const env={SERPAPI_API_KEY:'shopping-links-fixture',SHOPPING_COUNTRY:'US',SHOPPING_CURRENCY:'USD'};
const serp=({organic=[],shopping=[],images=[]},seen=[])=>async url=>{
 const p=new URL(url).searchParams,engine=p.get('engine');seen.push(engine);
 if(engine==='google_immersive_product')return new Response(JSON.stringify(immersive[p.get('page_token')]??{error:'Down'}),{status:immersive[p.get('page_token')]?200:500});
 return new Response(JSON.stringify(engine==='google_shopping'?{shopping_results:shopping}:engine==='google_images'?{images_results:images}:{organic_results:organic}));
};

test('exact search finds trusted stores from link-less Shopping rows and reads their pages',async()=>{
 const seen=[],read=[];
 const shopping=[row('trendxparc.com','Barbour Bedale Wax Jacket','t_spam'),row('Nordstrom','Barbour Bedale Wax Jacket','t_nord')];
 const result=await exactSearch('Barbour Bedale wax jacket',env,serp({shopping},seen),{},async url=>{read.push(url);return {status:'verified',url,product_name:'Bedale Wax Jacket',product_brand:'Barbour',price_snapshot:{amount:479,currency:'USD',source_url:url},availability:'InStock'};},{judge:async(b,c)=>c.map(()=>({match:'exact',brand:'Barbour'}))});
 assert.equal(seen.filter(e=>e==='google_immersive_product').length,1,'the untrusted seller is never looked up');
 assert.deepEqual(read.map(u=>new URL(u).hostname),['www.nordstrom.com']);
 assert.equal(result.products[0].sourcing_status,'store_found');
 assert.equal(result.products[0].price_snapshot.amount,479,'price comes from the page read');
 assert.equal(result.exact_search.shopping_links.resolved,1);
});

test('a store page that cannot be read keeps the store’s Shopping price only as an index observation',async()=>{
 const shopping=[row('Nordstrom','Barbour Bedale Wax Jacket','t_nord')];
 const result=await exactSearch('Barbour Bedale wax jacket',env,serp({shopping}),{},async()=>({status:'check_failed',checked_at:'x'}),{judge:async(b,c)=>c.map(()=>({match:'exact',brand:'Barbour'}))});
 const [p]=result.products;
 assert.equal(new URL(p.url).hostname,'www.nordstrom.com');
 assert.equal(p.listing_check.verification_basis,'search_index');assert.equal(p.listing_check.availability,null);
 assert.equal(p.price_snapshot.amount,479,'the store\'s own listed price, not another seller\'s');
 assert.equal(p.price_snapshot.evidence_level,'indexed');assert.equal(p.listing_check.price_status,'indexed');
});

test('photo text search gets Shopping candidates again from trusted sellers',async()=>{
 const seen=[];
 const items=await textImageCandidates('Barbour Bedale wax jacket',env,serp({shopping:[row('SSENSE','Barbour Bedale','t_ssense'),row('trendxparc.com','Barbour Bedale','t_spam')],images:[{link:'https://store.example/p/9',thumbnail:'https://encrypted-tbn0.gstatic.com/images?q=i',title:'Bedale'}]},seen));
 assert.deepEqual(items.map(i=>new URL(i.url).hostname),['www.ssense.com','store.example']);
 assert.equal(seen.filter(e=>e==='google_immersive_product').length,1);
});
