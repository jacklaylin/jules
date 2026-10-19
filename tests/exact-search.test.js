import {test} from 'node:test';
import assert from 'node:assert/strict';
import {exactSearch,briefCoverage,cleanTitle,judgeCandidates} from '../lib/text-sources.js';
import {combineSources,withSourcing} from '../lib/search.js';
import {retailerFor} from '../lib/retailers.js';
import {storeSite,browserResourceURL} from '../lib/rendered-listing.js';
import {lookupIndexedProduct,urlWords} from '../lib/indexed-product.js';

const env={SERPAPI_API_KEY:'exact-fixture',SHOPPING_COUNTRY:'US',SHOPPING_CURRENCY:'USD'};
// SerpAPI stub: organic and shopping rows by engine, recording each query.
const serp=({organic=[],shopping=[]},seen=[])=>async url=>{
 const params=new URL(url).searchParams;seen.push({engine:params.get('engine'),q:params.get('q')});
 return new Response(JSON.stringify(params.get('engine')==='google_shopping'?{shopping_results:shopping}:{organic_results:organic}));
};
const page=(url,name,brand,extra={})=>({status:'verified',url,product_name:name,product_brand:brand,price_snapshot:{amount:795,currency:'USD'},availability:'InStock',...extra});
// Judge stub keyed by product name; the real judge is a model call.
const judgeBy=table=>async(brief,candidates)=>candidates.map(c=>table[c.check.product_name]??{match:'different',brand:''});

test('the brief is searched as typed on Google web and Shopping, department added from the profile',async()=>{
 const seen=[];
 await exactSearch('Dries Van Noten Peyter pants black',env,serp({},seen),{range:'men'},async()=>({status:'not_product'}),{judge:async()=>[]});
 assert.deepEqual(seen.map(s=>s.engine).sort(),['google','google_shopping']);
 for(const s of seen)assert.equal(s.q,"men's Dries Van Noten Peyter pants black");
});

test('a named model is found on the first search and ranked official store, then curated retailer, then others, resale last',async()=>{
 const urls={resale:'https://poshmark.com/listing/Dries-Peyter-1',other:'https://www.smallshop.example/products/peyter',retail:'https://shop-us.doverstreetmarket.com/products/dries-van-noten-peyter-4302-pants-black',official:'https://www.driesvannoten.com/products/peyter-pants-black'};
 const organic=[{link:urls.resale,title:'Dries Van Noten Peyter Pants Black'},{link:urls.other,title:'Dries Van Noten Peyter pants black'},{link:urls.retail,title:"Dries Van Noten - Men's Peyter Pants - (Black)"},{link:urls.official,title:'Peyter pants | Dries Van Noten'}];
 const result=await exactSearch('Dries Van Noten Peyter pants black',env,serp({organic}),{},async url=>page(url,'Peyter pants','Dries Van Noten'),{judge:async(b,c)=>c.map(()=>({match:'exact',brand:'Dries Van Noten'}))});
 assert.equal(result.products.length,1,'one product, other stores as merchant options');
 const [p]=result.products;
 assert.equal(p.match,'likely_match');assert.equal(p.sourcing_status,'store_found');
 assert.equal(p.url,urls.official);assert.equal(p.retailer.tier,'official');
 assert.deepEqual(p.merchant_options.map(m=>m.url),[urls.retail,urls.other]);
 assert.equal(retailerFor(urls.resale).tier,'resale');assert.equal(retailerFor(urls.resale).rank,3);
 assert.equal(result.exact_search.read,4);
});

test('resale listings are still offered when nothing else exists',async()=>{
 const url='https://www.grailed.com/listings/123-jacques-marie-mage-romi';
 const result=await exactSearch('Jacques Marie Mage Romi sunglasses',env,serp({organic:[{link:url,title:'Jacques Marie Mage Romi sunglasses'}]}),{},async u=>page(u,'Romi sunglasses','Jacques Marie Mage'),{judge:async(b,c)=>c.map(()=>({match:'exact',brand:''}))});
 assert.equal(result.products[0].url,url);assert.equal(result.products[0].retailer.tier,'resale');
});

test('a store that blocks our read keeps the provider’s indexed name, photo and price for that exact page, never stock',async()=>{
 const ssense='https://www.ssense.com/en-us/men/product/our-legacy/beige-still-chino-trousers/19426491';
 const shopping=[{link:ssense,title:'Our Legacy Beige Still Chino Trousers',extracted_price:395,price:'$395.00',thumbnail:'https://encrypted-tbn0.gstatic.com/shopping?q=tbn:abc'}];
 const result=await exactSearch('Our Legacy Still Chino trousers',env,serp({shopping}),{},async()=>({status:'check_failed',checked_at:'x'}),{judge:async(b,c)=>c.map(x=>({match:x.check.product_name.includes('Still Chino')?'exact':'different',brand:'Our Legacy'}))});
 const [p]=result.products;
 assert.equal(p.url,ssense);assert.equal(p.sourcing_status,'store_found');assert.equal(p.match,'likely_match');
 assert.equal(p.listing_check.verification_basis,'search_index');assert.equal(p.listing_check.availability,null);
 assert.equal(p.listing_check.price_status,'indexed');assert.equal(p.price_snapshot.amount,395);assert.equal(p.price_snapshot.evidence_level,'indexed');
 assert.equal(p.brand,'Our Legacy','the judged brand is kept because the listing title contains it');
 assert.equal(p.recovered_via,'search_index');assert.equal(result.direct_checks[0].check.status,'check_failed');
});

test('a judged brand absent from the listing’s own text is not attached',async()=>{
 const url='https://www.vitkac.com/us/p/trousers-123';
 const result=await exactSearch('Our Legacy wide leg pleated khakis',env,serp({organic:[{link:url,title:'Wide leg pleated trousers'}]}),{},async()=>({status:'check_failed'}),{judge:async(b,c)=>c.map(()=>({match:'similar',brand:'Our Legacy'}))});
 assert.equal(result.products[0].listing_check.product_brand,null);
});

test('a missing page (404) is not resurrected from the index; a strong unread result stays a candidate with price and stock unknown',async()=>{
 const gone='https://www.example-store.com/products/romi-gone',walled='https://www.walled.example/romi';
 const organic=[{link:gone,title:'Jacques Marie Mage Romi sunglasses'},{link:walled,title:'Jacques Marie Mage Romi'}];
 const result=await exactSearch('Jacques Marie Mage Romi sunglasses',env,serp({organic}),{},async url=>url===gone?{status:'unavailable',http_status:404}:{status:'not_product'},{judge:async()=>[]});
 assert.equal(result.products.length,1);
 const [p]=result.products;
 assert.equal(p.url,gone);assert.equal(p.sourcing_status,'store_not_found');assert.equal(p.price_snapshot,undefined);
 assert.deepEqual(p.identity_sources,[{url:gone,name:'Jacques Marie Mage Romi sunglasses'}]);
 assert.deepEqual(result.rejections.filter(r=>r.stage==='page_check').map(r=>r.reason).sort(),['not_product','unavailable']);
});

test('a listing or collection page leads to its matching product page instead of a dead end',async()=>{
 const collection='https://shop-us.doverstreetmarket.com/collections/menswear-trousers?page=2',product='https://shop-us.doverstreetmarket.com/products/dries-van-noten-peyter-4302-pants-black';
 const fetcher=async url=>String(url).startsWith('https://serpapi.com/')?serp({organic:[{link:collection,title:'Menswear trousers – Dover Street Market'}]})(url):new Response('<a href="/products/dries-van-noten-peyter-4302-pants-black">Dries Van Noten Peyter pants</a><a href="/products/other-shirt">Shirt</a>',{headers:{'content-type':'text/html'}});
 const result=await exactSearch('Dries Van Noten Peyter pants',env,fetcher,{},async url=>url===product?page(url,"Dries Van Noten - Men's Peyter Pants",'Dries Van Noten'):{status:'not_product'},{judge:judgeBy({"Dries Van Noten - Men's Peyter Pants":{match:'exact',brand:'Dries Van Noten'}})});
 assert.equal(result.products[0].url,product);assert.equal(result.products[0].recovered_from,collection);
 assert.equal(result.exact_search.followed_listing_pages,1);
});

test('a read page of a different product is set aside with its reason; similar items stay alternatives',async()=>{
 const urls=['https://www.driesvannoten.com/products/loose-leather-pants','https://www.driesvannoten.com/products/peyter','https://www.anotherstore.example/products/scarf'];
 const names={[urls[0]]:'Loose leather pants',[urls[1]]:'Peyter pants',[urls[2]]:'Silk scarf'};
 const result=await exactSearch('Dries Van Noten Peyter pants',env,serp({organic:urls.map(link=>({link,title:'Dries Van Noten '+names[link]}))}),{},async url=>page(url,names[url],'Dries Van Noten'),
  {judge:judgeBy({'Peyter pants':{match:'exact',brand:''},'Loose leather pants':{match:'similar',brand:''},'Silk scarf':{match:'different',brand:''}})});
 assert.deepEqual(result.products.map(p=>[p.name,p.match]),[['Peyter pants','likely_match'],['Loose leather pants','similar']]);
 assert.deepEqual(result.rejections.find(r=>r.stage==='identity'),{url:urls[2],stage:'identity',reason:'different_product',name:'Silk scarf'});
});

test('social, search and editorial hosts are not checked as stores',async()=>{
 let checks=0;
 const organic=[{link:'https://www.instagram.com/p/abc/',title:'Romi'},{link:'https://www.pinterest.com/pin/1',title:'Romi'},{link:'https://www.google.com/search?q=romi',title:'Romi'}];
 const result=await exactSearch('Jacques Marie Mage Romi',env,serp({organic}),{},async()=>{checks++;return {status:'not_product'};},{judge:async()=>[]});
 assert.equal(checks,0);assert.equal(result.products.length,0);
 assert.ok(result.rejections.every(r=>r.reason==='not_a_store_page'));
});

test('one provider failing leaves the other’s results; both failing is an error the caller handles',async()=>{
 const url='https://www.mrporter.com/en-us/mens/product/lemaire/clothing/wide-leg-organic-jeans/46376663162991182';
 const half=async u=>new URL(u).searchParams.get('engine')==='google'?new Response(JSON.stringify({error:'Down'}),{status:500}):new Response(JSON.stringify({shopping_results:[{link:url,title:'LEMAIRE Wide-Leg Organic Jeans',extracted_price:690,price:'$690.00'}]}));
 const result=await exactSearch('Lemaire wide leg organic jeans',env,half,{},async u=>page(u,'Wide-Leg Organic Jeans','LEMAIRE'),{judge:async(b,c)=>c.map(()=>({match:'exact',brand:'LEMAIRE'}))});
 assert.equal(result.products[0].url,url);assert.deepEqual(result.exact_search.providers,{google:'failed',google_shopping:'ok'});
 await assert.rejects(exactSearch('Lemaire jeans',{...env,SERPAPI_API_KEY:'exact-both-down'},async()=>new Response(JSON.stringify({error:'Down'}),{status:500}),{},async()=>({})));
});

test('without the model, identity falls back to the listing’s own brand and name words only',async()=>{
 const check=(name,brand)=>({check:{product_name:name,product_brand:brand},row:{title:name}});
 const verdicts=await judgeCandidates('Dries Van Noten Peyter pants in black',[check('Peyter pants','Dries Van Noten'),check('Loose leather pants','Dries Van Noten'),check('Peyter pants','Other Brand')],{});
 assert.deepEqual(verdicts.map(v=>v.match),['exact','similar','different']);
 assert.ok(verdicts.every(v=>v.fallback));
});

test('the model judge’s verdicts are used when it answers, and unjudged listings are not offered',async()=>{
 const reply={candidates:[{index:0,brand:'Our Legacy',match:'meets_brief'}]};
 const fetcher=async()=>new Response(JSON.stringify({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(reply)}]}]}));
 const verdicts=await judgeCandidates('Our Legacy wide leg pleated khakis',[{check:{product_name:'Borrowed Chino Khaki'},row:{}},{check:{product_name:'Other'},row:{}}],{OPENAI_API_KEY:'test'},fetcher);
 assert.deepEqual(verdicts.map(v=>v.match),['meets_brief','different']);assert.equal(verdicts[1].unjudged,true);
});

test('brief coverage tolerates the varied ways people and stores write a model name',()=>{
 const cases=[
  ['dries peyter pants','Dries Van Noten - Men\'s Peyter Pants - (Black)',1],
  ['Jacques Marie Mage Romi','JACQUES MARIE MAGE Romi Sunglasses',1],
  ['jacques marie mage romi sunglasses','Romi optical frame',0.2],
  ['Prada Speed Rock sneakers','Prada Speedrock Re-Nylon sneakers',1],
  ['salomon xt6','Salomon XT-6 sneakers',1],
  ['our legacy wide leg pleated khakis','Our Legacy Borrowed Chino Khaki',0.5],
 ];
 for(const [brief,title,min] of cases)assert.ok(briefCoverage(title,brief)>=min,brief+' vs '+title+' = '+briefCoverage(title,brief));
 assert.ok(briefCoverage('Nike Air Max 1','Nike Air Max 90')<1,'a different model number is not full coverage');
 assert.equal(cleanTitle('Peyter pants | Dries Van Noten'),'Peyter pants');
 assert.equal(cleanTitle("Dries Van Noten - Men's Peyter Pants - (Black)"),"Dries Van Noten - Men's Peyter Pants - (Black)");
});

test('combined sources put a verified match from either source first and keep unread candidates last',()=>{
 const web={status:'needs_review',products:[{url:'https://a.example/1',match:'similar',sourcing_status:'store_found'},{url:'https://b.example/2',match:'likely_match',sourcing_status:'store_not_found'}]};
 const direct={products:[{url:'https://c.example/3',match:'likely_match',sourcing_status:'store_found',source_provider:'exact_search'},{url:'https://a.example/1',match:'similar',sourcing_status:'store_found'}],direct_checks:[]};
 const combined=combineSources(web,direct);
 assert.deepEqual(combined.products.map(p=>p.url),['https://c.example/3','https://a.example/1','https://b.example/2']);
 assert.equal(combined.status,'found');assert.equal(combined.source_provider,'exact_search');
});

test('every search records whether the exact item was found first and why candidates were set aside',()=>{
 const direct={products:[],exact_search:{query:'q'},rejections:[{url:'https://www.ssense.com/x',stage:'page_check',reason:'check_failed'}]};
 const web={initial_checks:[{url:'https://www.vitkac.com/y',checks:[{status:'check_failed'}]}],products:[{url:'https://z.example/p',match:'likely_match',sourcing_status:'store_found'}],relevance_rejections:[{url:'https://w.example/q',reason:'range_mismatch'}],first_pass_exact:false};
 const {sourcing}=withSourcing({...web,refinement_attempted:true},{direct,web,answered_by:'web_search',brief:'q',started:Date.now()});
 assert.equal(sourcing.first_attempt,'exact_search');assert.equal(sourcing.exact_found_first_attempt,false);assert.equal(sourcing.exact_found,true);assert.equal(sourcing.refined,true);
 assert.deepEqual(sourcing.rejections.map(r=>[r.host,r.stage,r.reason,r.source]),[['ssense.com','page_check','check_failed','exact_search'],['vitkac.com','page_check','check_failed','web_search'],['w.example','relevance','range_mismatch','web_search']]);
});

test('the hosted browser may open any public store with only that store’s own assets',()=>{
 assert.equal(storeSite('https://shop-us.doverstreetmarket.com/products/x'),'doverstreetmarket.com');
 assert.equal(storeSite('https://www.vitkac.com/us/p/x'),'vitkac.com');
 assert.equal(storeSite('https://www.example.co.uk/p/x'),'example.co.uk');
 assert.equal(browserResourceURL('https://static.vitkac.com/app.js',['vitkac.com']),true);
 assert.equal(browserResourceURL('https://tracker.example/app.js',['vitkac.com']),false);
});

test('an unreadable page is found in the index by a site search for its name or URL words, matching only that exact page',async()=>{
 const url='https://www.mrporter.com/en-us/mens/product/lemaire/clothing/baggy-jeans/wide-leg-organic-jeans/46376663162991182';
 assert.equal(urlWords(url),'lemaire baggy jeans wide leg organic');
 const queries=[];
 const fetcher=async u=>{
  const p=new URL(u).searchParams;queries.push(p.get('engine')+':'+p.get('q'));
  if(p.get('engine')==='google'&&p.get('q').startsWith('site:'))return new Response(JSON.stringify({organic_results:[{link:'https://www.mrporter.com/en-us/mens/product/other/1',title:'Other'},{link:url,title:'LEMAIRE Wide-Leg Organic Jeans | MR PORTER',rich_snippet:{bottom:{detected_extensions:{price:690,currency:'USD'}}}}]}));
  return new Response(JSON.stringify({}));
 };
 const found=await lookupIndexedProduct(url,null,{env:{SERPAPI_API_KEY:'site-fixture'},fetcher,siteSearch:true});
 assert.ok(queries.includes('google:site:mrporter.com lemaire baggy jeans wide leg organic'));
 assert.equal(found.product_name,'LEMAIRE Wide-Leg Organic Jeans | MR PORTER');assert.equal(found.price_snapshot.amount,690);
 const none=[];await lookupIndexedProduct(url,null,{env:{SERPAPI_API_KEY:'site-fixture-2'},fetcher:async u=>{none.push(u);return new Response('{}');}});
 assert.ok(!none.some(u=>new URL(u).searchParams.get('q')?.startsWith('site:')),'site search only when the store page could not be read');
});

test('suppressed stores in search results are set aside unread; the real store is offered',async()=>{
 const urls={lyst:'https://www.lyst.com/clothing/our-legacy-still-chino-trousers-1/',temu:'https://www.temu.com/still-chino-g-1.html',rakuten:'https://www.rakuten.com/shop/our-legacy-still-chino',store:'https://www.ssense.com/en-us/men/product/our-legacy/beige-still-chino-trousers/19426491'};
 const organic=Object.values(urls).map(link=>({link,title:'Our Legacy Still Chino Trousers'})),read=[];
 const result=await exactSearch('Our Legacy Still Chino Trousers',env,serp({organic,shopping:[{link:urls.lyst,title:'Our Legacy Still Chino Trousers'}]}),{},async url=>{read.push(url);return page(url,'Still Chino Trousers','Our Legacy');},{judge:async(b,c)=>c.map(()=>({match:'exact',brand:'Our Legacy'}))});
 assert.deepEqual(read,[urls.store]);
 assert.deepEqual(result.products.map(p=>p.url),[urls.store]);
 assert.deepEqual(result.products[0].merchant_options,[]);
 const suppressed=result.rejections.filter(r=>r.reason==='suppressed_store').map(r=>r.url);
 for(const url of [urls.lyst,urls.temu,urls.rakuten])assert.ok(suppressed.includes(url),url);
});

test('chat search asks verification to skip paid re-lookups: the search result is the index evidence',async()=>{
 const options=[];const organic=[{link:'https://www.mrporter.com/en-us/mens/product/x/123',title:'Dries Van Noten Peyter pants black'}];
 await exactSearch('Dries Van Noten Peyter pants black',env,serp({organic}),{},async(url,name,fetcher,opts)=>{options.push(opts);return {status:'check_failed'};},{judge:async()=>[]});
 assert.ok(options.length>0);assert.ok(options.every(o=>o?.indexed===false));
});
