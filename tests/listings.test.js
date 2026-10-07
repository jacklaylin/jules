import {test} from 'node:test';
import assert from 'node:assert/strict';
import {verifyListing,verifySearchMerchants,verifyWishlistRows} from '../lib/listings.js';
const url='https://www.barbour.com/us/jacket.html';
const name='Transport Windowpane Waxed Jacket';
const html=product=>new Response('<script type="application/ld+json">'+JSON.stringify(product)+'</script>',{headers:{'content-type':'text/html'}});
const product={'@type':'Product',name,offers:{'@type':'Offer',price:'700.00',priceCurrency:'USD',availability:'https://schema.org/OutOfStock'}};
test('live sold-out listings retain sourced prices and availability',async()=>{
 const value=await verifyListing(url,name,async()=>html(product));assert.equal(value.status,'verified');assert.equal(value.price_snapshot.amount,700);assert.equal(value.price_snapshot.source_url,url);assert.equal(value.availability,'OutOfStock');assert.ok(value.checked_at);
});
test('redirects are checked at the destination; category, missing, wrong product, unsafe and blocked pages cannot be shopping links',async()=>{
 let calls=0;
 const category=await verifyListing(url,name,async()=>++calls===1?new Response(null,{status:302,headers:{location:'/us/jackets'}}):html({'@type':'CollectionPage',name:'Jackets'}));assert.equal(category.status,'not_product');assert.equal(calls,2);
 for(const response of [new Response('missing',{status:404}),html({...product,name:'Other Coat'}),html([product,{...product,name:'Recommendation'}]),html([{'@type':'CollectionPage'},product])])assert.notEqual((await verifyListing(url,name,async()=>response)).status,'verified');
 const unsafe=await verifyListing(url,name,async()=>new Response(null,{status:302,headers:{location:'https://127.0.0.1/private'}}));assert.equal(unsafe.status,'invalid_redirect');
 assert.equal((await verifyListing('https://unknown.example/item',name,()=>assert.fail())).status,'unsupported');assert.equal((await verifyListing(url,name,async()=>{throw new Error('blocked');})).status,'check_failed');
});
test('missing, ambiguous and malformed retailer prices are checked but never invented',async()=>{
 for(const offers of [{},{price:'1,510',priceCurrency:'USD'},{price:-1,priceCurrency:'USD'},{price:'10',priceCurrency:'usd'},[{price:10,priceCurrency:'USD'},{price:20,priceCurrency:'USD'}]]){
  const value=await verifyListing(url,name,async()=>html({...product,offers}));assert.equal(value.status,'verified');assert.equal(value.price_snapshot,null);assert.notEqual(value.price_status,'found');
 }
});
test('a failed primary link is replaced only by a verified same-product merchant and all failures retain identity without shopping links',async()=>{
 const base={status:'found',products:[{name,url,merchant_options:[{url:'https://www.mytheresa.com/item'}]}]};
 const verify=async url=>url.includes('barbour')?{status:'not_product'}:{status:'verified',url,price_snapshot:{amount:1510,currency:'USD',source_url:url}};
 const result=await verifySearchMerchants(base,null,verify);assert.equal(result.products[0].url,'https://www.mytheresa.com/item');assert.equal(result.products[0].price_snapshot.amount,1510);assert.deepEqual(result.products[0].merchant_options,[]);
 const failed=await verifySearchMerchants(base,null,async()=>({status:'check_failed'}));assert.equal(failed.status,'identified_no_store');assert.equal(failed.products[0].sourcing_status,'store_not_found');assert.deepEqual(failed.products[0].merchant_options,[]);
});

test('saved rows refresh prices and remove stale links before returning wishlist metadata',async()=>{
 const rows=[{name,url,price_snapshot:{amount:1,currency:'USD'},links:[{url},{url:'https://www.barbour.com/missing'}]}];
 const verified=await verifyWishlistRows(rows,null,async value=>value===url?{status:'verified',url,price_snapshot:{amount:700,currency:'USD',source_url:url},availability:'OutOfStock'}:{status:'unavailable'});
 assert.equal(verified[0].links.length,1);assert.equal(verified[0].links[0].price_snapshot.amount,700);assert.equal(verified[0].price_snapshot,null);assert.equal(verified[0].links[0].availability,'OutOfStock');
 const failed=await verifyWishlistRows(rows,null,async()=>({status:'check_failed'}));assert.deepEqual(failed[0].links,[]);assert.equal(failed[0].sourcing_status,'store_not_found');
});

test('an HTTP 200 bot failover is a failed check and no-store replies expose no unverified URLs',async()=>{
 const checked=await verifyListing(url,name,async()=>new Response('<script>window.isBotPage = true</script>',{headers:{'content-type':'text/html'}}));assert.equal(checked.status,'check_failed');
 const {formatSearch}=await import('../lib/search.js');assert.ok(!formatSearch({intro:'Possible match',products:[{brand:'Barbour',name,url,sourcing_status:'store_not_found'}]}).includes('https://'));
});

test('page-bound primary product survives recommendation JSON while ambiguous unbound products remain rejected',async()=>{
 const bound={...product,url},recommended={...product,name:'Other coat',url:'https://www.barbour.com/us/other.html'};
 const value=await verifyListing(url,name,async()=>html([bound,recommended,{'@type':'ItemList',itemListElement:[recommended]}]));
 assert.equal(value.status,'verified');assert.equal(value.price_snapshot.amount,700);
 assert.equal((await verifyListing(url,'Other coat',async()=>html([bound,recommended]))).status,'not_product');
});
test('explicit canonical product metadata supports a link without fabricating commerce facts',async()=>{
 const page=`<link rel="canonical" href="${url}"><meta property="og:type" content="product"><meta property="og:title" content="${name}"><meta property="product:gender" content="male">`;
 const value=await verifyListing(url,name,async()=>new Response(page,{headers:{'content-type':'text/html'}}));
 assert.equal(value.status,'verified');assert.equal(value.shopping_range,'men');assert.equal(value.price_snapshot,null);assert.equal(value.availability,null);
 for(const bad of [page.replace('content="product"','content="website"'),page.replace(url,'https://www.barbour.com/another'),page.replace(name,'Unrelated shoes')])assert.equal((await verifyListing(url,name,async()=>new Response(bad,{headers:{'content-type':'text/html'}}))).status,'not_product');
});
test('retailer brand and department words in a title do not hide the matching product',async()=>{
 const value=await verifyListing(url,'Barbour Men’s Transport Windowpane Waxed Jacket',async()=>html({...product,brand:{name:'Barbour'}}));
 assert.equal(value.status,'verified');
});
test('ProductGroup size variants establish one page without assuming stock or converting sizes',async()=>{
 const nike='https://www.nike.com/t/air-max-90-mens-shoes/CN8490-002';
 const group={'@type':'ProductGroup',name:'Nike Air Max 90 Men’s Shoes',brand:{name:'Nike'},audience:{suggestedGender:'https://schema.org/Male'},hasVariant:[6,7].map(size=>({'@type':'Product',name:'Air Max 90',size:String(size),color:'Black',offers:{url:nike,price:'150',priceCurrency:'USD'}}))};
 const value=await verifyListing(nike,'Nike Air Max 90',async()=>html(group));assert.equal(value.status,'verified');assert.equal(value.shopping_range,'men');assert.equal(value.price_snapshot.amount,150);assert.equal(value.availability,null);
 const mixed=await verifyListing(nike,'Nike Air Max 90',async()=>html({...group,hasVariant:[...group.hasVariant,{...group.hasVariant[0],color:'White'}]}));assert.equal(mixed.status,'not_product');
 const wrong=await verifyListing(nike,'Nike Air Max 95',async()=>html(group));assert.equal(wrong.status,'not_product');
});
test('short model names and product-bound unisex subtitles remain verifiable',async()=>{
 const salomon='https://www.salomon.com/en-us/product/xt-6/L47445300';
 const group={'@type':'ProductGroup',name:'XT-6',brand:{name:'Salomon'},hasVariant:[{'@type':'Product',name:'XT-6 Black',color:'Black',offers:{url:salomon,price:185,priceCurrency:'USD'}}]};
 const page='<h1>XT-6</h1><h2>Sneakers · Unisex</h2><script type="application/ld+json">'+JSON.stringify(group)+'</script>';
 const value=await verifyListing(salomon,'Salomon XT-6',async()=>new Response(page,{headers:{'content-type':'text/html'}}));assert.equal(value.status,'verified');assert.equal(value.shopping_range,'unisex');
 assert.equal((await verifyListing(salomon,'Salomon XT-4',async()=>new Response(page,{headers:{'content-type':'text/html'}}))).status,'not_product');
});
