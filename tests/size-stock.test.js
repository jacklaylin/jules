import {test} from 'node:test';
import assert from 'node:assert/strict';
import {shopifyCommerce,sizeFor,withSizes,sizeKeysFor,priceText,sizeText} from '../lib/size-stock.js';
import {verifyListing} from '../lib/listings.js';
import {formatSearch} from '../lib/search.js';
import {textWishlistAction} from '../lib/text-wishlist.js';
import {optionFacts} from '../lib/ai.js';

// Shapes follow real store data seen in the October 19 accuracy audit (design/accuracy-audit.md).
const page='https://phipps.example/products/long-sleeve-base-layer';
const variant=(id,size,available,price,extra={})=>({id,title:size,option1:size,option2:'WHITE',available,price,compare_at_price:null,...extra});
const phipps={options:[{name:'Size',values:['S','M','L','XL']},{name:'Color',values:['WHITE']}],variants:[variant(1,'S',false,13000),variant(2,'M',false,13000),variant(3,'L',false,13000),variant(4,'XL',true,13000)]};
const usd={currency:'USD',wanted:'USD'};

test('the store’s variant data gives stock per size, so "in stock" no longer hides sold-out sizes',()=>{
 const read=shopifyCommerce(phipps,page,usd);
 assert.deepEqual(read.size_options.map(o=>[o.size,o.available]),[['S',false],['M',false],['L',false],['XL',true]]);
 assert.equal(read.availability,'InStock');assert.deepEqual(read.prices,[130]);assert.equal(read.size_options[0].amount,130);
});

test('sizes across several colors stay unknown unless one color is pinned by the page',()=>{
 const two={options:[{name:'Color'},{name:'Size'}],variants:[{id:1,option1:'Black',option2:'M',available:false,price:9000},{id:2,option1:'Agar',option2:'M',available:true,price:9000}]};
 assert.deepEqual(shopifyCommerce(two,page,usd).size_options,[],'an unpinned color makes size stock ambiguous');
 assert.deepEqual(shopifyCommerce(two,page,{...usd,color:'black'}).size_options.map(o=>o.available),[false]);
 const chosen=shopifyCommerce(two,page+'?variant=1',usd);
 assert.equal(chosen.availability,'OutOfStock','the selected color sold out in every size is a sold-out listing');
});

test('a sale’s former price comes only from a consistent compare-at price; other currencies give no USD price',()=>{
 const sale={options:[{name:'Size'}],variants:[{id:1,option1:'S',available:true,price:22100,compare_at_price:26000},{id:2,option1:'M',available:true,price:22100,compare_at_price:26000}]};
 assert.deepEqual(shopifyCommerce(sale,page,usd).was,{amount:260,currency:'USD'});
 const mixed={...sale,variants:[sale.variants[0],{...sale.variants[1],compare_at_price:null}]};
 assert.equal(shopifyCommerce(mixed,page,usd).was,null,'a former price on only some sizes is not a sale of this price');
 const euro=shopifyCommerce(sale,page,{currency:'EUR',wanted:'USD'});
 assert.deepEqual(euro.prices,[]);assert.equal(euro.size_options[0].amount,undefined);assert.equal(euro.size_options[0].available,true);
});

const facts=[{field:'size',key:'shoes/us_men',value:'12'},{field:'size',key:'shoes/eu',value:'45'},{field:'size',key:'bottoms/waist',value:'32'}];
const listing=(sizes,extra={})=>({brand:'Thursday',name:'Desperado',url:page,listing_check:{status:'verified',url:page,size_options:sizes,...extra},price_snapshot:{amount:249,currency:'USD'}});

test('the user’s size is matched by the store’s own label, never converted',()=>{
 const keys=['shoes/us_men','shoes/eu'];
 assert.deepEqual(sizeFor(listing([{size:'11',available:true},{size:'12',available:true}]),facts,keys),{sizes:['US men 12','EU 45'],store_size:'12',status:'in_stock'});
 assert.equal(sizeFor(listing([{size:'EU 45',available:false}]),facts,keys).status,'sold_out');
 assert.equal(sizeFor(listing([{size:'UK 12',available:true}]),facts,keys).status,'not_listed','another system’s 12 is not the user’s US 12');
 assert.equal(sizeFor(listing([]),facts,keys).status,'unknown');
 assert.equal(sizeFor(listing([{size:'12',available:true}]),facts,[]),null,'no saved size named for this item');
 assert.equal(sizeFor(listing([{size:'12',available:true}]),facts,keys,{forSomeoneElse:true}),null,'someone else’s item never uses the user’s sizes');
 assert.equal(sizeFor(listing([{size:'32',available:true}]),facts,['bottoms/waist']).store_size,'32');
 // A store's own spelling of the same label (Dover Street Market "Size 32", Found "Medium").
 assert.equal(sizeFor(listing([{size:'Size 30',available:true},{size:'Size 32',available:false}]),facts,['bottoms/waist']).status,'sold_out');
 const letters=[{field:'size',key:'tops/letter',value:'M'}];
 assert.equal(sizeFor(listing([{size:'Small',available:true},{size:'Medium',available:true}]),letters,['tops/letter']).store_size,'Medium');
 assert.equal(sizeFor(listing([{size:'X-Large',available:true}]),[{field:'size',key:'tops/letter',value:'XL'}],['tops/letter']).status,'in_stock');
 assert.equal(sizeFor(listing([{size:'X-Large',available:true}]),letters,['tops/letter']).status,'not_listed');
});

test('a price shared by every color is kept even when size stock across colors is unknown',()=>{
 const colors={options:[{name:'Size'},{name:'Color'}],variants:[{id:1,option1:'S',option2:'Black',available:true,price:11800},{id:2,option1:'S',option2:'White',available:false,price:11800},{id:3,option1:'S',option2:'Sample',available:true,price:0}]};
 const read=shopifyCommerce(colors,page,usd);
 assert.deepEqual(read.size_options,[]);assert.equal(read.availability,null);assert.deepEqual(read.prices,[118],'a zero-priced variant is not a price');
});

test('options sold out in the user’s size go last and say so; a sized price and a sale are shown',()=>{
 const sold=listing([{size:'12',available:false}]),open={...listing([{size:'12',available:true}]),url:page+'-2'},unknown={...listing([]),url:page+'-3'};
 const ranked=withSizes([sold,unknown,open],facts,[['shoes/us_men'],['shoes/us_men'],['shoes/us_men']]);
 assert.deepEqual(ranked.map(p=>p.your_size.status),['in_stock','unknown','sold_out']);
 assert.equal(sizeText(ranked[0]),'size 12 in stock');assert.equal(sizeText(ranked[2]),'size 12 sold out');assert.equal(sizeText(ranked[1]),null);
 assert.equal(priceText({listing_check:{price_was:{amount:260,currency:'USD'}},price_snapshot:{amount:221,currency:'USD'}}),'$221.00 (on sale, was $260.00)');
 assert.equal(priceText({listing_check:{},your_size:{amount:182,currency:'USD'}}),'$182.00 in your size');
 assert.equal(priceText({listing_check:{},price_snapshot:{amount:190,currency:'USD',evidence_level:'indexed'}}),'$190.00 · stock not confirmed','a search-result price keeps its caveat without internal wording');
 assert.equal(priceText({listing_check:{price_range:{min:176,max:182,currency:'USD'}}}),'$176.00–$182.00 depending on size or color');
 assert.equal(priceText({listing_check:{foreign_price:{amount:320,currency:'EUR'},market_match:true}}),'€320.00 (the store charges in EUR)');
 assert.equal(priceText({listing_check:{foreign_price:{amount:320,currency:'EUR'},market_match:false}}),null,'a foreign store’s price is already in its market label');
});

// A Shopify page whose offers omit their currency (lillap), with variant data on a sale.
const shopifyPage=(currency,offers=[{'@type':'Offer',price:'221.00',availability:'https://schema.org/InStock'}])=>`<script>Shopify.country = "US";Shopify.currency = {"active":"${currency}","rate":"1.0"};</script><script type="application/ld+json">${JSON.stringify({'@type':'Product',name:'Arena Stripe Track Jacket',brand:'FOUND',offers})}</script>`;
const store=(html,data)=>async url=>new URL(url).pathname.endsWith('.js')?new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}}):new Response(html,{headers:{'content-type':'text/html'}});
const jacket={options:[{name:'Size'}],variants:[{id:1,option1:'M',available:false,price:22100,compare_at_price:26000},{id:2,option1:'L',available:true,price:22100,compare_at_price:26000}]};

test('the page check reads sizes, a missing offer currency and the sale price from the store’s data',async()=>{
 const check=await verifyListing('https://found.example/products/black-tracksuit-jacket','Arena Stripe Track Jacket',store(shopifyPage('USD'),jacket),async()=>{throw Error('no browser');},{SHOPPING_COUNTRY:'US',SHOPPING_CURRENCY:'USD'});
 assert.equal(check.status,'verified');assert.deepEqual(check.price_snapshot&&[check.price_snapshot.amount,check.price_snapshot.currency],[221,'USD']);
 assert.deepEqual(check.price_was,{amount:260,currency:'USD'});
 assert.deepEqual(check.size_options.map(o=>[o.size,o.available]),[['M',false],['L',true]]);
});

// The October 19 production miss: the search named Thursday's own page "Men's Desperado Square Toe
// Cowboy Boots Black Matte", the page title is "Desperado | Black Matte", and the page was rejected.
test('a short store title is read with its own page path; a different product still fails',async()=>{
 const page='https://thursday.example/products/mens-desperado-square-toe-cowboy-boots-black-matte';
 const html=title=>`<script>Shopify.country = "US";Shopify.currency = {"active":"USD","rate":"1.0"};</script><script type="application/ld+json">${JSON.stringify({'@type':'Product',name:title,brand:'Thursday',offers:{'@type':'Offer',price:'249.00',priceCurrency:'USD'}})}</script>`;
 const boots={options:[{name:'Size'}],variants:[{id:1,option1:'12',available:true,price:24900},{id:2,option1:'13',available:false,price:24900}]};
 const env={SHOPPING_COUNTRY:'US',SHOPPING_CURRENCY:'USD'},noBrowser=async()=>{throw Error('no browser');};
 const check=(title,name,url=page+'?ymal=mens-maverick-cowboy-western-boots-brandy')=>verifyListing(url,name,store(html(title),boots),noBrowser,env);
 const found=await check('Desperado | Black Matte',"Men's Desperado Square Toe Cowboy Boots Black Matte");
 assert.equal(found.status,'verified');assert.deepEqual(found.size_options.map(o=>[o.size,o.available]),[['12',true],['13',false]]);
 assert.equal((await check('Maverick | Brandy',"Men's Desperado Square Toe Cowboy Boots Black Matte")).status,'not_product','a title that disagrees with the request is not rescued by a path');
 assert.equal((await check('Desperado | Black Matte',"Men's Desperado Square Toe Cowboy Boots Black Matte",'https://thursday.example/products/desperado-bm')).status,'not_product','a path that doesn’t describe it adds nothing');
});

// October 19 again: the same page was rejected under another of the search's names for it, and a
// shop.app copy was shown instead of the brand's own store. The brand's real page data says "Thursday
// Boots - Men's", and the requested names vary in brand form, plurals, category words and filler.
test('the brand’s own page matches the varied names a search gives it; another colour or model still fails',async()=>{
 const page='https://thursday.example/products/mens-desperado-square-toe-cowboy-boots-black-matte';
 const html=title=>`<script>Shopify.country = "US";Shopify.currency = {"active":"USD","rate":"1.0"};</script><script type="application/ld+json">${JSON.stringify({'@type':'Product',name:title,brand:{'@type':'Thing',name:"Thursday Boots - Men's"},offers:{'@type':'Offer',price:'249.00',priceCurrency:'USD'}})}</script>`;
 const boots={options:[{name:'Size'}],variants:[{id:1,option1:'12',available:true,price:24900}]};
 const env={SHOPPING_COUNTRY:'US',SHOPPING_CURRENCY:'USD'},noBrowser=async()=>{throw Error('no browser');};
 const check=(name,title='Desperado | Black Matte')=>verifyListing(page+'?ymal=mens-maverick-cowboy-western-boots-brandy',name,store(html(title),boots),noBrowser,env);
 for(const name of ['Desperado Cowboy Boot Black','Thursday Boot Company Desperado Boot Black','Thursday Boot Co. Desperado Western Boot in Black',
   'Desperado Black Matte boots by Thursday Boot Company','Thursday Desperado boots black',"Men's Desperado Square Toe Cowboy Boots Black Matte"])
  assert.equal((await check(name)).status,'verified',name);
 for(const name of ['Desperado Tobacco Brown','Desperado Boot Brown','Maverick Brandy','Thursday Captain Boot Black']){
  const rejected=await check(name);
  assert.equal(rejected.status,'not_product',name);assert.equal(rejected.reason,'name_mismatch','a page with a different product says so');
 }
 assert.equal((await check('Desperado Cowboy Boot Black','Desperado | Tobacco Brown')).status,'not_product','a page path never covers for a title in another colour');
 const empty=await verifyListing(page,'Desperado Black',store('<html><title>Boots</title></html>',boots),noBrowser,env);
 assert.equal(empty.status,'not_product');assert.equal(empty.reason,undefined,'a page without a product has no name to disagree with');
});

test('a store that charges in euros shows its own price, labelled, and never as dollars',async()=>{
 const check=await verifyListing('https://trevise.example/products/printed-mesh-top','Arena Stripe Track Jacket',store(shopifyPage('EUR',[{'@type':'Offer',price:'320.00',priceCurrency:'EUR'}]),jacket),async()=>{throw Error('no browser');},{SHOPPING_COUNTRY:'US',SHOPPING_CURRENCY:'USD'});
 assert.equal(check.price_snapshot,null);assert.deepEqual(check.foreign_price,{amount:320,currency:'EUR'});
 assert.ok(check.size_options.every(o=>o.amount===undefined),'euro size prices are not shown as dollars');
 const shown=formatSearch({status:'found',products:[{brand:'FOUND',name:'Arena Stripe Track Jacket',url:check.url,sourcing_status:'store_found',match:'likely_match',reason:'',listing_check:check,price_snapshot:null}]});
 assert.match(shown,/€320\.00 \(the store charges in EUR\)/);assert.doesNotMatch(shown,/\$320/);
});

test('a search for the user’s own item leads with the option in stock in their size and tells the agent each size',async()=>{
 const option=(slug,sizes)=>({brand:'Thursday',name:'Desperado Boot',url:'https://thursday.example/products/'+slug,match:'likely_match',sourcing_status:'store_found',price_snapshot:{amount:249,currency:'USD'},
  listing_check:{status:'verified',url:'https://thursday.example/products/'+slug,product_brand:'Thursday',product_name:'Desperado Boot '+slug,availability:'InStock',size_options:sizes}});
 const found=[option('black',[{size:'12',available:false},{size:'13',available:true}]),option('brown',[{size:'12',available:true,amount:249,currency:'USD'}])];
 let recorded;
 const run=keys=>textWishlistAction({action:'start',query:'Thursday Desperado boots',search_plan:null},{state:null,facts,env:{},record:async r=>{recorded=r;},search:async()=>({products:found,refinement_attempted:true}),sizeKeys:async products=>products.map(()=>keys)});
 const body=await run(['shoes/us_men']);
 assert.ok(body.indexOf('/brown')<body.indexOf('/black'),'the option in stock in the user’s size comes first');
 assert.match(body,/size 12 in stock/);assert.match(body,/size 12 sold out/);
 const facts0=optionFacts(recorded.text_wishlist_state);
 assert.equal(facts0[0].your_size.stock,'in_stock');assert.deepEqual(facts0[1].sizes_seen,['12: sold out','13: in stock']);
 const other=await run([]);
 assert.doesNotMatch(other,/size 12/,'without a saved size for this item nothing is claimed about the user’s size');
 assert.equal(optionFacts(recorded.text_wishlist_state)[0].your_size,'no saved size applied');
});

// The October 19 production miss: the agent's own search call left the size keys empty whenever the
// conversation already had pending options. The keys now come from a separate, enum-bound reading.
const boot={brand:'Thursday',name:'Desperado Boot',url:'https://thursday.example/products/desperado',match:'likely_match',sourcing_status:'store_found',price_snapshot:{amount:249,currency:'USD'},
 listing_check:{status:'verified',url:'https://thursday.example/products/desperado',product_brand:'Thursday',product_name:'Desperado Boot',availability:'InStock',size_options:[{size:'12',available:true},{size:'13',available:false}]}};
const reading=(output,status=200)=>{const calls=[];const fetcher=async(_url,options)=>{calls.push(JSON.parse(options.body));return new Response(JSON.stringify({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(output)}]}]}),{status});};return {fetcher,calls};};
test('the size reading only says what kind of item a product is; code picks the saved sizes of that category',async()=>{
 const withStoreKey=[...facts,{field:'size',key:'mfpen retail aps',value:'31'},{field:'size',key:'women/shoes/us',value:'9'}];
 const {fetcher,calls}=reading({products:[{index:0,category:'shoes'}]});
 // Every shoe size saved under the fixed categories; a key without one (a store name, a department) is never used.
 assert.deepEqual(await sizeKeysFor([boot],withStoreKey,{OPENAI_API_KEY:'test'},fetcher),[['shoes/us_men','shoes/eu']]);
 assert.deepEqual(calls[0].text.format.schema.properties.products.items.properties.category.enum,['tops','bottoms','outerwear','suits','dresses','shoes','activewear','swimwear','underwear','accessories','none']);
 // October 22: a shirt whose collar sizes read like shoe sizes gets the shirt's category, so no shoe size applies.
 assert.deepEqual(await sizeKeysFor([boot],facts,{OPENAI_API_KEY:'test'},reading({products:[{index:0,category:'tops'}]}).fetcher),[[]]);
 assert.deepEqual(await sizeKeysFor([boot],facts,{OPENAI_API_KEY:'test'},reading({products:[{index:0,category:'none'}]}).fetcher),[[]]);
 assert.deepEqual(await sizeKeysFor([boot],withStoreKey,{OPENAI_API_KEY:'test'},reading({},500).fetcher),[[]],'a failed reading claims no size');
 assert.deepEqual(await sizeKeysFor([{...boot,listing_check:{...boot.listing_check,size_options:[]}}],facts,{OPENAI_API_KEY:'test'},()=>assert.fail('no sizes, no call')),[[]]);
 assert.deepEqual(await sizeKeysFor([boot],[],{OPENAI_API_KEY:'test'},()=>assert.fail('no saved sizes, no call')),[[]]);
});

test('a search with options already pending still shows stock in the user’s size; the next round sees it',async()=>{
 const {generateReply}=await import('../lib/ai.js');
 const {agentTurn,tool,toolOutputs,isAgentRequest,isConsentCheck,consentResponse}=await import('./helpers/agent.js');
 let recorded,told,n=0;
 const rounds=[
  ()=>[tool('find_products',{query:'Thursday Desperado boots'})],
  options=>{told=toolOutputs(options)[0];return [tool('conversation_reply',{response:'found it, and your 12 is in stock: $249.00.\n'+boot.url})];}];
 const fetcher=async(_url,options)=>{
  if(isConsentCheck(options))return consentResponse(true);
  if(!isAgentRequest(options))throw Error('Unexpected request');
  return agentTurn(...rounds[n++](options));
 };
 const pending={stage:'offer_set',options:[{brand:'enfants riches déprimés',name:'ERD Ripped Tee Red',url:'https://erd.example/product/tee',listing_check:{status:'verified'}}],selected_set:[],offered_urls:[]};
 const {fetcher:sizeFetcher}=reading({products:[{index:0,category:'shoes'}]});
 const memory={facts,wishlistState:pending,outcome:{saved_now:false,alerts_turned_on:false,alerts_turned_off:false},
  wishlistAction:(args,state)=>textWishlistAction(args,{state,facts,env:{OPENAI_API_KEY:'test'},record:async r=>{recorded=r;},search:async()=>({products:[boot],refinement_attempted:true}),
   sizeKeys:(products,f,e)=>sizeKeysFor(products,f,e,sizeFetcher)}),
  shoppingState:()=>recorded?.text_wishlist_state};
 await generateReply([{direction:'inbound',status:'received',body:'find me the thursday desperado boots'}],{OPENAI_API_KEY:'test',SEARCH_ENABLED:'true'},fetcher,memory);
 assert.equal(recorded.text_wishlist_state.options[0].your_size.status,'in_stock');
 assert.equal(told.pending_shopping.options[0].your_size.stock,'in_stock');assert.equal(told.pending_shopping.options[0].your_size.store_label,'12');
});
