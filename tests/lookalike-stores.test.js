import {test} from 'node:test';
import assert from 'node:assert/strict';
import {verifyListing} from '../lib/listings.js';
import {isLookalikeStore,BRANDS,TRUSTED_RETAILERS,RESALE_MARKETPLACES} from '../lib/retailers.js';
import {exactSearch} from '../lib/text-sources.js';

// A copycat store imitates a brand's own site with a name one typo away (a letter added, dropped,
// changed or swapped). It sells counterfeits, so it is never a place to buy, on any sourcing path.
const page=product=>new Response('<script type="application/ld+json">'+JSON.stringify(product)+'</script>',{headers:{'content-type':'text/html'}});
const tee={'@type':'Product',name:'Ripped Tee Red',brand:'Enfants Riches Déprimés',offers:{'@type':'Offer',price:'190.00',priceCurrency:'USD',availability:'https://schema.org/InStock'}};

test('a store one typo from the brand it sells, or from a listed store, is a lookalike',()=>{
 // From the brand the page says it sells (not in the curated list): a dropped, added, changed or swapped letter.
 for(const url of ['https://enfantsrichesdeprime.com/product/erd-ripped-tee-red/','https://www.enfantsrichesdeprimess.com/p','https://enfantsrichesdeprimas.shop/p','https://enfantsrichesdeprmies.com/p'])
  assert.equal(isLookalikeStore(url,'Enfants Riches Déprimés'),true,url);
 // From a listed brand's or store's own name, with no brand given (search results): any country domain.
 for(const url of ['https://www.ourlegasy.com/x','https://www.ourlegaci.co.uk/x','https://www.satisfyrunnin.com/x','https://www.farfetc.com/x'])
  assert.equal(isLookalikeStore(url),true,url);
});

test('real stores are never lookalikes: own sites, listed sites, other stores and short names',()=>{
 for(const url of ['https://www.enfantsrichesdeprimes.com/','https://shop.enfantsrichesdeprimes.com/p'])assert.equal(isLookalikeStore(url,'Enfants Riches Déprimés'),false,url);
 // Every listed site, with the brands it sells.
 for(const r of BRANDS)for(const brand of [null,...r.brands])assert.equal(isLookalikeStore(`https://www.${r.domain}/p`,brand),false,r.domain);
 for(const r of [...TRUSTED_RETAILERS.map(t=>t.domain),...RESALE_MARKETPLACES])assert.equal(isLookalikeStore(`https://${r}/p`,'Our Legacy'),false,r);
 // Own domains written differently from the brand: hyphens, possessives, a dropped possessive s, a country domain.
 for(const [url,brand] of [['https://www.carhartt-wip.com/p','Carhartt WIP'],['https://trickers.com/p','Tricker’s'],['https://www.barkershoes.co.uk/p',"Barker's"],['https://www.wellingtons.com/p',"Wellington's"],['https://www.wellington.com/p',"Wellington's"],['https://www.margarethowell.co.uk/p','Margaret Howell']])
  assert.equal(isLookalikeStore(url,brand),false,url);
 // Other stores and names under seven letters are not compared.
 for(const [url,brand] of [['https://www.hollisterco.com/p','Hollister'],['https://www.levi.com/p','Levi’s'],['https://www.gapp.com/p','Gap'],['https://www.storefront.example/p','Our Legacy'],['not a url',null]])
  assert.equal(isLookalikeStore(url,brand),false,url);
});

test('a lookalike page fails the listing check even with a perfect product record; the brand’s own site verifies',async()=>{
 const copy=await verifyListing('https://enfantsrichesdeprime.com/product/erd-ripped-tee-red/','Ripped Tee Red',async()=>page(tee));
 assert.equal(copy.status,'not_product');assert.equal(copy.reason,'lookalike_store');
 // Reached by a redirect from an ordinary link: still the copycat's page.
 let calls=0;
 const redirected=await verifyListing('https://go.example/r/1','Ripped Tee Red',async()=>++calls===1?new Response(null,{status:302,headers:{location:'https://enfantsrichesdeprime.com/product/erd-ripped-tee-red/'}}):page(tee));
 assert.equal(redirected.reason,'lookalike_store');
 assert.equal((await verifyListing('https://www.enfantsrichesdeprimes.com/products/ripped-tee-red','Ripped Tee Red',async()=>page(tee))).status,'verified');
});

test('search results on a lookalike of a listed store are set aside unread',async()=>{
 const env={SERPAPI_API_KEY:'lookalike-fixture',SHOPPING_COUNTRY:'US',SHOPPING_CURRENCY:'USD'};
 const urls={copy:'https://www.ourlegasy.com/products/still-chino',store:'https://www.ourlegacy.com/still-chino-beige'};
 const serp=async url=>new Response(JSON.stringify(new URL(url).searchParams.get('engine')==='google_shopping'?{shopping_results:[]}:{organic_results:Object.values(urls).map(link=>({link,title:'Our Legacy Still Chino Trousers'}))}));
 const read=[];
 const result=await exactSearch('Our Legacy Still Chino Trousers',env,serp,{},async url=>{read.push(url);return {status:'verified',url,product_name:'Still Chino Trousers',product_brand:'Our Legacy',availability:'InStock'};},{judge:async(b,c)=>c.map(()=>({match:'exact',brand:'Our Legacy'}))});
 assert.deepEqual(read,[urls.store]);
 assert.deepEqual(result.products.map(p=>p.url),[urls.store]);
 assert.ok(result.rejections.some(r=>r.url===urls.copy&&r.reason==='lookalike_store'));
});

test('a domain spelled with look-alike letters from another alphabet is always blocked',async()=>{
 // A Cyrillic о or а inside an otherwise Latin name, imitating a listed store or any other name.
 for(const url of ['https://www.оurlegacy.com/x','https://ourlegаcy.com/x','https://www.shоp-deals.com/x','https://brаnd-outlet.example/x'])assert.equal(isLookalikeStore(url),true,url);
 const copy=await verifyListing('https://www.оurlegacy.com/still-chino','Still Chino',()=>assert.fail('never fetched'));
 assert.equal(copy.status,'not_product');assert.equal(copy.reason,'lookalike_store');
 assert.equal((await verifyListing('https://www.ourlegasy.com/still-chino','Still Chino',()=>assert.fail('never fetched'))).reason,'lookalike_store');
 // Real domains in one alphabet, or with accents, are not.
 for(const url of ['https://магазин.рф/x','https://www.müller.de/x','https://www.ourlegacy.com/x'])assert.equal(isLookalikeStore(url),false,url);
});
