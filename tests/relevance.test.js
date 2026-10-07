import {test} from 'node:test';
import assert from 'node:assert/strict';
import {shoppingConstraints,relevanceCheck,relevantProducts} from '../lib/relevance.js';
import {productShoppingRange} from '../lib/structured-product.js';
import {textWishlistAction} from '../lib/text-wishlist.js';
const facts=[{field:'gender',key:'identity',value:'man'},{field:'size',key:'shoes/eu',value:'45'}];
const men={name:'Speedrock sneakers',url:'https://www.prada.com/us/en/p/sneaker/model-code',match:'likely_match',sourcing_status:'store_found',listing_check:{status:'verified',color:'Black',shopping_range:'men'}};
test('failed product pages remain sourcing failures rather than being mislabeled as range mismatches',()=>{
 const failed={...men,sourcing_status:'store_not_found',listing_check:undefined,listing_checks:[{status:'not_product',reason:'category_page'}]};
 const result=relevantProducts({products:[failed]},shoppingConstraints(facts,'Sneakers'));
 assert.equal(result.products.length,1);assert.equal(result.relevance_rejections.length,0);assert.equal(result.products[0].listing_checks[0].reason,'category_page');
});
test('saved shopping range precedes identity; explicit requests and gifts override self defaults',()=>{
  assert.equal(shoppingConstraints(facts,'I want Prada sneakers').range,'men');
  assert.equal(shoppingConstraints([...facts,{field:'shopping_range',value:'womenswear'}],'I want Prada sneakers').range,'women');
  assert.equal(shoppingConstraints(facts,"Find women's sneakers").range,'women');
  assert.equal(shoppingConstraints(facts,'A gift for my wife').range,null);
  assert.deepEqual(shoppingConstraints(facts,'A gift for my wife').size_facts,[]);
  assert.equal(shoppingConstraints([{field:'gender',key:'identity',value:'nonbinary'}],'Sneakers').range,null);
});
test('known opposite range and unknown wearable range are withheld; verified unisex remains eligible',()=>{
  const c=shoppingConstraints(facts,'Sneakers');
  assert.equal(relevanceCheck(men,c).eligible,true);
  assert.equal(relevanceCheck({...men,listing_check:{shopping_range:'women'}},c).reason,'range_mismatch');
  assert.equal(relevanceCheck({...men,listing_check:{}},c).reason,'range_unverified');
  assert.equal(relevanceCheck({...men,listing_check:{shopping_range:'unisex'}},c).eligible,true);
  assert.equal(relevanceCheck({...men,name:'Leather shoulder bag',listing_check:{}},c).eligible,true);
  const result=relevantProducts({products:[{...men,merchant_options:[{url:'https://www.prada.com/other',listing_check:{shopping_range:'women'}}]}]},c);
  assert.equal(result.products[0].merchant_options.length,0);
});
test('range evidence comes from product-bound breadcrumbs, not global men/women navigation or SKU guesses',()=>{
  const url=men.url;
  const crumbs=range=>'<script type="application/ld+json">'+JSON.stringify({'@type':'BreadcrumbList',itemListElement:[{item:{name:range,'@id':'https://www.prada.com/'+range+'/c/1'}},{item:{name:'Sneakers','@id':url}}]})+'</script>';
  assert.equal(productShoppingRange(crumbs('womens'),url,{}),'women');
  assert.equal(productShoppingRange(crumbs('mens')+'<nav>Women Men</nav>',url,{}),'men');
  assert.equal(productShoppingRange(crumbs('mens').replace(url,'https://www.prada.com/other'),url,{}),null);
  assert.equal(productShoppingRange('',url,{sku:'1E490O'}),null);
  assert.equal(productShoppingRange('',url,{audience:{suggestedGender:'unisex'}}),'unisex');
});
test('text queries receive profile constraints and color expansion independently rejects women’s variants',async()=>{
  let recorded,searchConstraints;
  const primary={...men,listing_check:{...men.listing_check,color_options:[{url:'https://www.prada.com/us/en/p/other-model',color:'White'}]}};
  const body=await textWishlistAction({action:'start',query:'Prada Speedrock sneakers'},{facts,text:'I want Prada Speedrock sneakers',env:{},record:async r=>{recorded=r;},search:async(q,images,env,fetcher,c)=>{searchConstraints=c;return {products:[primary,{...men,url:'https://www.prada.com/wrong',listing_check:{...men.listing_check,shopping_range:'women'}}]};},verify:async url=>({status:'verified',url,color:'White',shopping_range:'women'})});
  assert.equal(searchConstraints.range,'men');assert.equal(recorded.text_wishlist_state.options.length,1);
  assert.ok(!body.includes('other-model'));assert.ok(!body.includes('/wrong'));
});
test('old pending women’s results are resourced before selection and cannot be saved',async()=>{
  let searched=false,recorded;
  const wrong={...men,listing_check:{...men.listing_check,shopping_range:'women'}};
  await textWishlistAction({action:'select',choice:'black'},{state:{stage:'choice',query:'Prada sneakers',options:[wrong]},facts,text:'black',env:{},record:async r=>{recorded=r;},search:async()=>{searched=true;return {products:[men]};}});
  assert.equal(searched,true);assert.equal(recorded.text_wishlist_state.options[0].listing_check.shopping_range,'men');assert.equal(recorded.user_confirmed,undefined);
});
test('complaints and negative mentions cannot switch the saved clothing range',()=>{
 for(const text of ["not women's shoes", "those are women’s shoes, I am a man", "you sent me women's shoes again", "she sent womens shoes again", "I don't want women's sneakers"]){
  assert.equal(shoppingConstraints(facts,text).range,'men');
 }
 assert.equal(shoppingConstraints(facts,"Not women's, find men's sneakers").range,'men');
 assert.equal(shoppingConstraints(facts,"Find women's sneakers for my wife").range,'women');
});

test('verified opposite range cannot bypass the check through a localized or abbreviated name',()=>{
 for(const name of ['Speedrock','Sneakers in tessuto','Scarpe sportive'])assert.equal(relevanceCheck({...men,name,listing_check:{shopping_range:'women'}},{range:'men'}).eligible,false);
});
