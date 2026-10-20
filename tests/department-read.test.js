import {test} from 'node:test';
import assert from 'node:assert/strict';
import {relevanceCheck,relevantProducts} from '../lib/relevance.js';
import {readDepartments} from '../lib/department-read.js';
import {shopifyRange} from '../lib/structured-product.js';
import {textWishlistAction} from '../lib/text-wishlist.js';

const plan={continuation:false,mode:'discover',hard_constraints:[],guidance:[],keep_option_indices:[],exclude_option_indices:[]};
// A store page's listing check: structured department (shopping_range) or none, and its own text.
const listing=(id,{range=null,read=null,description='A relaxed cotton shirt with a button-down front.',sizes=['S','M','L']}={})=>({brand:'Brand '+id,name:'Shirt '+id,url:`https://${id}.example/products/shirt`,match:'similar',sourcing_status:'store_found',
 listing_check:{status:'verified',product_name:'Shirt '+id,product_brand:'Brand '+id,shopping_range:range,description,size_options:sizes.map(size=>({size,available:true})),...(read?{department_read:{range:read,quote:'x',basis:'listing_text'}}:{})}});
const model=value=>{const calls=[];const fetcher=async(_url,options)=>{calls.push(JSON.parse(options.body));return {ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(value)}]}]})};};fetcher.calls=calls;return fetcher;};
const env={OPENAI_API_KEY:'test'};
// The MAYE listing from the October 20 replay: a women's label on Shopify with no department data.
const maye={...listing('mayethelabel',{description:'The Sadie Embroidered Shirt is a timeless blend of effortless style and feminine detail. Embroidered cotton fabric - best with nude bra.',sizes:['2XS','XS','S']}),brand:'M A Y E',name:'Sadie Embroidered Shirt – Ivory'};

test('department eligibility: men’s, women’s and unisex scopes against labelled, unlabelled and contradicting listings',()=>{
 const planned=range=>({range,allow_unknown_range:true});
 const cases=[
  // [scope, listing, eligible]
  ['men',listing('a',{range:'men'}),true],['men',listing('b',{range:'women'}),false],['men',listing('c',{range:'unisex'}),true],
  ['men',listing('d'),true],['men',listing('e',{read:'women'}),false],['men',listing('f',{read:'men'}),true],['men',listing('g',{read:'unisex'}),true],
  ['women',listing('a',{range:'women'}),true],['women',listing('b',{range:'men'}),false],['women',listing('c',{range:'unisex'}),true],
  ['women',listing('d'),true],['women',listing('e',{read:'men'}),false],['women',listing('f',{read:'women'}),true],
  ['unisex',listing('a',{range:'men'}),true],['unisex',listing('b',{range:'women'}),true],['unisex',listing('d'),true],['unisex',listing('e',{read:'women'}),true],
 ];
 for(const [range,product,eligible] of cases)assert.equal(relevanceCheck(product,planned(range)).eligible,eligible,`${range} scope, ${product.url}`);
 // Structured department data outranks a text read of the same listing.
 assert.equal(relevanceCheck(listing('h',{range:'men',read:'women'}),planned('men')).eligible,true);
 const filtered=relevantProducts({products:[listing('a',{range:'men'}),listing('d'),listing('e',{read:'women'})]},planned('men'));
 assert.deepEqual(filtered.products.map(p=>p.url),[listing('a').url,listing('d').url]);
 assert.equal(filtered.relevance_rejections[0].reason,'range_contradicted');
});

test('Shopify product type and tags are structured department data; mixed or missing labels say nothing',()=>{
 assert.equal(shopifyRange({type:'Mens Shirts',tags:['Linen']}),'men');
 assert.equal(shopifyRange({type:'Tops',tags:'womens, new in'}),'women');
 assert.equal(shopifyRange({type:'Shirt',tags:['Unisex']}),'unisex');
 assert.equal(shopifyRange({type:'Shirt',tags:['men','women']}),null);
 // MAYE's own product data has no department.
 assert.equal(shopifyRange({type:'SHIRT',tags:['bestsellers','Full price','LACE','MAYE Signatures','SHIRT','SHOP ALL']}),null);
});

test('a listing’s own quoted words decide its department; unquoted or invented evidence is ignored',async()=>{
 const products=[maye,listing('plain'),listing('labelled',{range:'men'}),listing('everyone',{description:'Made for everyone: a unisex boxy shirt.'})];
 const fetcher=model({listings:[{index:0,department:'women',quote:'feminine detail'},{index:1,department:'women',quote:'designed for her'},{index:2,department:'unisex',quote:'Made for everyone'}]});
 const read=await readDepartments(products,'men',{env,fetcher});
 // Only unlabelled verified listings are sent, in one call.
 assert.equal(fetcher.calls.length,1);
 const sent=JSON.parse(fetcher.calls[0].input[0].content);
 assert.deepEqual(sent.map(s=>s.store),['mayethelabel.example','plain.example','everyone.example']);
 assert.deepEqual(read[0].listing_check.department_read,{range:'women',quote:'feminine detail',basis:'listing_text'});
 // "designed for her" is not in that listing's text, so it stays unknown and eligible.
 assert.equal(read[1].listing_check.department_read,undefined);
 assert.equal(read[2],products[2]);
 assert.equal(read[3].listing_check.department_read.range,'unisex');
 assert.deepEqual(relevantProducts({products:read},{range:'men',allow_unknown_range:true}).products.map(p=>p.url),[listing('plain').url,listing('labelled').url,listing('everyone').url]);
});

test('department read is skipped without a gendered scope and fails open to today’s behaviour',async()=>{
 for(const range of [null,'unisex']){const fetcher=model({listings:[]}),list=[maye];assert.equal(await readDepartments(list,range,{env,fetcher}),list);assert.equal(fetcher.calls.length,0);}
 const products=[maye];
 assert.equal(await readDepartments(products,'men',{env,fetcher:async()=>{throw Error('offline');}}),products);
 assert.equal(await readDepartments(products,'men',{env:{},fetcher:model({listings:[]})}),products);
 // Malformed answers (unknown index, bad department, duplicate) are dropped, not guessed.
 const read=await readDepartments(products,'men',{env,fetcher:model({listings:[{index:5,department:'women',quote:'feminine detail'},{index:0,department:'girls',quote:'feminine detail'}]})});
 assert.equal(read[0].listing_check.department_read,undefined);
});

test('a men’s discovery leaves out a listing whose own text is women’s and keeps unlabelled men’s options',async()=>{
 let result;
 const products=[maye,listing('plain'),listing('mens',{range:'men'}),listing('another')];
 const fetcher=model({listings:[{index:0,department:'women',quote:'best with nude bra'},{index:1,department:'unknown',quote:''},{index:2,department:'unknown',quote:''}]});
 await textWishlistAction({action:'start',query:'a few casual shirts',department:'men',search_plan:plan},{env:{},text:'find me a few casual shirts',record:async r=>{result=r;},
  search:async()=>({products,refinement_attempted:true}),rank:async x=>x,departments:(list,range,options)=>readDepartments(list,range,{...options,env,fetcher})});
 const shown=result.text_wishlist_state.options.map(o=>o.url);
 assert.equal(shown.length,3);assert.ok(!shown.includes(maye.url));
 assert.ok(shown.includes(listing('plain').url)&&shown.includes(listing('another').url));
 assert.equal(fetcher.calls.length,1);
 // A women's request reads the same listing as a match.
 await textWishlistAction({action:'start',query:'a few casual shirts',department:'women',search_plan:plan},{env:{},text:'find me a few casual shirts',record:async r=>{result=r;},
  search:async()=>({products:[maye],refinement_attempted:true}),rank:async x=>x,departments:(list,range,options)=>readDepartments(list,range,{...options,env,fetcher:model({listings:[{index:0,department:'women',quote:'feminine detail'}]})})});
 assert.deepEqual(result.text_wishlist_state.options.map(o=>o.url),[maye.url]);
});
