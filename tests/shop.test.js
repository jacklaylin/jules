import {test} from 'node:test';
import assert from 'node:assert/strict';
import {shopCall,searchShop,shopVariant,shopifyStoreFor,ignoredFilters,startShopSignIn,pollShopSignIn,listShopOrders} from '../lib/shop.js';
import {shopCandidates,nameOverlap} from '../lib/text-sources.js';
import {mergeSources} from '../lib/text-wishlist.js';
import {checkoutLink,checkoutReply,minorMoney} from '../lib/checkout.js';

const env={SHOPPING_COUNTRY:'US',SHOPPING_CURRENCY:'USD'};
const rpc=content=>({ok:true,status:200,json:async()=>({jsonrpc:'2.0',id:1,result:{structuredContent:content}})});
const variant=(id,size,{available=true,amount=6800,seller='Kith',domain='kith.com'}={})=>({id:'gid://shopify/ProductVariant/'+id,url:`https://${domain}/products/tee?variant=${id}&utm_source=shopify`,
  price:{amount,currency:'USD'},availability:{available},options:[{name:'Color',label:'White'},...(size?[{name:'Size',label:size}]:[])],
  seller:{name:seller,domain:'kithnyc.myshopify.com',url:'https://'+domain},checkout_url:`https://${domain}/cart/${id}:1?payment=shop_pay`});
const product=(variants,{title='Kith LAX Tee - White'}={})=>({id:'gid://shopify/p/1',title,options:[{name:'Color',values:[{label:'White'}]},{name:'Size',values:[...new Set(variants.map(v=>v.options[1]?.label).filter(Boolean))].map(label=>({label}))}],variants});

test('Shop calls send the protocol headers and separate sign-in, tool errors and results',async()=>{
  let headers;
  assert.deepEqual(await shopCall('search_catalog',{},{fetcher:async(_url,options)=>{headers=options.headers;return rpc({products:[]});}}),{products:[]});
  assert.equal(headers['Mcp-Name'],'search_catalog');assert.equal(headers['MCP-Protocol-Version'],'2026-07-28');assert.equal(headers.Authorization,undefined);
  await assert.rejects(shopCall('search_orders',{},{fetcher:async()=>({ok:false,status:401})}),e=>e.code==='auth_required');
  await assert.rejects(shopCall('search_orders',{},{fetcher:async()=>({ok:true,json:async()=>({result:{isError:true,structuredContent:{messages:[]}}})})}),e=>e.code==='tool');
  await assert.rejects(shopCall('search_orders',{},{fetcher:async()=>({ok:false,status:403})}),e=>e.code==='http');
});

test('catalog search reports filters Shop ignored instead of treating them as applied',async()=>{
  let sent;
  const found=await searchShop('tee',{env,shops:['kith.com'],fetcher:async(_u,o)=>{sent=JSON.parse(o.body).params.arguments;return rpc({products:[product([variant(1,'Medium (M)')])],
    messages:[{type:'info',code:'not_found',path:'$.filters.shops[0]',content:'Shop not found and was ignored.'}],next:['Suggestion']});}});
  assert.deepEqual(sent.catalog.filters.shops,['kith.com']);assert.equal(sent.catalog.context.currency,'USD');
  assert.equal(found.offers[0].variant_id,'gid://shopify/ProductVariant/1');assert.equal(found.offers[0].price.amount,6800);
  assert.equal(found.ignored_filters.length,1);assert.equal(found.next[0],'Suggestion');
  assert.deepEqual(ignoredFilters([{code:'not_found',path:'$.ids[0]'}]),[]);
});

test('a brand whose own store is on Shopify maps to that store; other brands do not',()=>{
  const stores={'kith.com':{tier:'preferred',brands:[]},'aimeleondore.com':{tier:'official',brands:['Aimé Leon Dore']}};
  assert.equal(shopifyStoreFor('aime leon dore',stores),'aimeleondore.com');
  assert.equal(shopifyStoreFor('Kith',stores),null);assert.equal(shopifyStoreFor('Prada',stores),null);assert.equal(shopifyStoreFor('',stores),null);
});

test('variant choice matches the store’s own size label exactly and never converts',()=>{
  const p=product([variant(1,'Small (S)'),variant(2,'Medium (M)',{available:false}),variant(3,'Large (L)')]);
  assert.equal(shopVariant(p,'medium (m)').variant.id.endsWith('/2'),true);
  const unmatched=shopVariant(p,'M');assert.equal(unmatched.variant,null);assert.equal(unmatched.unmatched,'M');assert.deepEqual(unmatched.sizes,['Small (S)','Medium (M)','Large (L)']);
  assert.equal(shopVariant(p,null).needs_size,true);
  // Shop may return only some variants; the store's own size list still comes from its options.
  const partial={...p,variants:[p.variants[0]],options:[{name:'Color',values:[{label:'White'}]},{name:'Size',values:['Small (S)','Medium (M)','Large (L)'].map(label=>({label}))}]};
  assert.deepEqual(shopVariant(partial,'Large (L)','white').select,[{name:'Size',label:'Large (L)'},{name:'Color',label:'White'}]);
  const oneSize={...product([variant(9,null)]),options:[{name:'Color',values:[{label:'White'}]}]};
  assert.equal(shopVariant(oneSize,null).variant.id.endsWith('/9'),true);
  assert.equal(shopVariant(oneSize,null,'Black').variant,null);
  // A returned product listing only one size never stands in for a different requested size.
  const dropped={...p,options:[{name:'Color',values:[{label:'White'}]},{name:'Size',values:[{label:'Small (S)'}]}],variants:[p.variants[0]]};
  assert.equal(shopVariant({...dropped,options:[dropped.options[0],{name:'Size',values:[{label:'Extra small (XS)'}]}]},'Small (S)').variant,null);
  assert.equal(shopVariant(dropped,null).variant.id.endsWith('/1'),true,'a single listed size needs no question');
});

test('Shop candidates pass the normal listing check, cap each seller and need the item named for identification',async()=>{
  const offers=[1,2,3].map(n=>({...variant(n,'S'),url:`https://kith.com/products/tee-${n}`}));
  const search=async(query,{shops})=>({offers:[...offers,{...variant(4,'S',{domain:'other.com',seller:'Other'}),url:'https://other.com/products/x'}].map((v,i)=>({product_id:'p'+i,variant_id:v.id,url:v.url,title:i===3?'Other Thing':'Kith LAX Tee - White',seller:{name:v.seller.name,domain:v.seller.url,url:v.seller.url},price:v.price,available:true,options:[]})),ignored_filters:[],next:[],shops});
  const checked=[];
  const verify=async url=>{checked.push(url);return url.includes('tee-2')?{status:'check_failed'}:{status:'verified',url,product_brand:url.includes('other')?'Other':'Kith',product_name:url.includes('other')?'Other Thing':'Kith LAX Tee - White'};};
  const identify=await shopCandidates('Kith LAX tee in white',{env,search,verify,requiredBrands:['Kith']});
  assert.equal(checked.filter(u=>u.includes('kith.com')).length,2,'at most two listings per seller');
  assert.deepEqual(identify.products.map(p=>p.url),['https://kith.com/products/tee-1']);
  assert.equal(identify.products[0].match,'likely_match');assert.equal(identify.products[0].source_provider,'shop_catalog');
  const discover=await shopCandidates('white tee',{env,search,verify,mode:'discover'});
  assert.ok(discover.products.every(p=>p.match==='similar'));
  assert.ok(nameOverlap('Kith Dolce Far Niente Tee','Kith','Kith LAX tee')<0.5);
});

test('merged sources alternate, drop duplicate pages despite tracking parameters and keep department checks',()=>{
  const web={source_provider:'web',status:'found',products:['a','b'].map(n=>({url:`https://store-${n}.com/p`,match:'likely_match',listing_check:{status:'verified'}}))};
  const extra={diagnostics:{shops:[]},products:[{url:'https://store-a.com/p?utm_source=shopify',source_provider:'shop_catalog',listing_check:{status:'verified'}},{url:'https://kith.com/p',source_provider:'shop_catalog',listing_check:{status:'verified'}},{url:'https://kith.com/w',name:'Dress',source_provider:'shop_catalog',listing_check:{status:'verified',shopping_range:'women'}}]};
  const merged=mergeSources(web,extra,{range:'men'});
  assert.deepEqual(merged.products.map(p=>p.url),['https://store-a.com/p','https://kith.com/p','https://store-b.com/p']);
  assert.deepEqual(merged.products.map(p=>p.source_provider),['web','shop_catalog','web']);
  assert.equal(mergeSources(web,null,{}),web);
});

test('checkout links put the exact size in the cart, ask for the store’s label, report sold out and fall back to the product page',async()=>{
  const p=product([variant(1,'Small (S)'),variant(2,'Medium (M)'),variant(3,'Large (L)',{available:false})]);
  const providers=[{name:'shop',resolve:async url=>url.includes('kith.com')?p:null}];
  const cart=await checkoutLink({name:'LAX Tee',url:'https://kith.com/products/tee',size:'Medium (M)',color:null},{env,providers});
  assert.equal(cart.status,'cart');assert.equal(cart.checkout_url,'https://kith.com/cart/2:1?payment=shop_pay');assert.equal(cart.size,'Medium (M)');
  assert.equal((await checkoutLink({name:'LAX Tee',url:'https://kith.com/products/tee',size:'US M',color:null},{env,providers})).status,'needs_size');
  assert.equal((await checkoutLink({name:'LAX Tee',url:'https://kith.com/products/tee',size:'Large (L)',color:null},{env,providers})).status,'sold_out');
  const page=await checkoutLink({name:'Coat',url:'https://www.ssense.com/en-us/men/product/x',size:'50',color:null},{env,providers});
  assert.equal(page.status,'product_page');assert.equal(page.store,'ssense.com');
  const partial={...p,variants:[p.variants[0]]};
  const selecting=[{name:'shop',resolve:async()=>partial,select:async(_p,selected)=>selected[0].label==='Medium (M)'?{...p,variants:[p.variants[1]]}:{...p,variants:[p.variants[0]]}}];
  assert.equal((await checkoutLink({name:'LAX Tee',url:'https://kith.com/products/tee',size:'Medium (M)',color:null},{env,providers:selecting})).checkout_url,'https://kith.com/cart/2:1?payment=shop_pay');
  // The same product from another seller is never put in the cart in place of the chosen store.
  const elsewhere=[{name:'shop',resolve:async()=>partial,select:async()=>({...p,variants:[variant(5,'Medium (M)',{domain:'reseller.example',seller:'Reseller'})]})}];
  const other=await checkoutLink({name:'LAX Tee',url:'https://kith.com/products/tee',size:'Medium (M)',color:null},{env,providers:elsewhere});
  assert.equal(other.status,'unavailable');assert.equal(other.checkout_url,undefined);assert.equal(other.store,'Kith');
  const dropped=await checkoutLink({name:'LAX Tee',url:'https://kith.com/products/tee',size:'Large (L)',color:null},{env,providers:selecting});
  assert.equal(dropped.status,'unavailable','a size Shop drops is not claimed sold out or missing');
  assert.match(checkoutReply([dropped]),/isn’t showing as available at Kith/);
  const failed=await checkoutLink({name:'LAX Tee',url:'https://kith.com/products/tee',size:'Medium (M)'},{env,providers:[{name:'shop',resolve:async()=>{throw Error('down');}}]});
  assert.equal(failed.status,'product_page');
  const reply=checkoutReply([cart,page,{name:'LAX Tee',status:'needs_size',store:'Kith',size:'US M',sizes:['Small (S)','Medium (M)']}]);
  assert.match(reply,/\$68\.00 before tax and shipping/);assert.match(reply,/nothing is ordered until you pay/);assert.match(reply,/couldn’t match “US M” exactly to Kith’s sizes/);
  assert.doesNotMatch(reply,/ordered it|purchased|bought/i);
  assert.equal(minorMoney({amount:6800,currency:'USD'}),'$68.00');assert.equal(minorMoney({amount:6800,currency:'JPY'}),'¥6,800');
});

test('Shop sign-in returns only the public code and keeps waiting, approval and denial distinct',async()=>{
  const started=await startShopSignIn(async(url,o)=>{assert.match(url,/oauth\/device$/);assert.match(String(o.body),/device_name=Jules/);return {ok:true,json:async()=>({device_code:'private',user_code:'ABCD-EFGH',verification_uri_complete:'https://shop.app/device?code=ABCD',interval:5,expires_in:600})};});
  assert.equal(started.user_code,'ABCD-EFGH');assert.equal(started.interval,5);
  const answer=body=>async()=>({ok:true,json:async()=>body});
  assert.equal((await pollShopSignIn('private',answer({error:'authorization_pending'}))).status,'pending');
  assert.equal((await pollShopSignIn('private',answer({error:'slow_down'}))).status,'slow_down');
  assert.equal((await pollShopSignIn('private',answer({error:'access_denied'}))).status,'denied');
  assert.deepEqual(await pollShopSignIn('private',answer({access_token:'token'})),{status:'approved',access_token:'token'});
});

test('order listing reads every record list on a page, follows any cursor name and reports why it stopped',async()=>{
  const pages=[
    {orders:Array.from({length:20},(_,i)=>({id:'o'+i})),standalone_shipments:[{id:'s1'}],pagination:{has_next_page:true,next_cursor:'two'}},
    {orders:[{id:'o20'}],pagination:{has_next_page:false}}];
  let calls=0;const sent=[];
  const result=await listShopOrders('token',{from:'2021-10-14',fetcher:async(_u,o)=>{assert.equal(o.headers.Authorization,'Bearer token');sent.push(JSON.parse(o.body).params.arguments);return rpc({...pages[calls++],messages:[]});}});
  assert.equal(calls,2);assert.equal(sent[1].pagination.cursor,'two');assert.equal(sent[0].date_from,'2021-10-14');
  assert.equal(result.records.length,22);assert.deepEqual([...new Set(result.records.map(r=>r.kind))],['orders','standalone_shipments']);
  assert.equal(result.listing.stop,'no_more_pages');assert.deepEqual(result.listing.pages[0].lists,{orders:20,standalone_shipments:1});
  // A page that says more exist but gives no cursor is reported, not silently treated as the end.
  const stuck=await listShopOrders('token',{fetcher:async()=>rpc({orders:[{id:'x'}],pagination:{has_next_page:true,page_token:'?'}})});
  assert.equal(stuck.listing.stop,'next_page_without_cursor');assert.deepEqual(stuck.listing.pages[0].pagination_keys,['has_next_page','page_token']);
});

test('history is listed in passes: recent, earlier windows while they find more, then stores Shop already returned',async()=>{
  const order=(id,date,seller='Amazon')=>({id,placed_at:date+'T10:00:00Z',seller:{name:seller}});
  const sent=[];
  const fetcher=async(_u,o)=>{
    const a=JSON.parse(o.body).params.arguments;sent.push({date_to:a.date_to??null,query:a.query??null});
    if(a.query==='Farfetch')return {ok:false,status:429};
    if(a.query)return rpc({orders:[order('o1','2026-09-20')],pagination:{has_next_page:false}});
    if(!a.date_to)return rpc({orders:[order('o1','2026-09-20'),order('o2','2026-09-15','Farfetch')],pagination:{has_next_page:false}});
    if(a.date_to==='2026-09-14')return rpc({orders:[order('o3','2026-06-01'),order('o2','2026-09-15','Farfetch')],pagination:{has_next_page:false}});
    return rpc({orders:[],pagination:{has_next_page:false}});
  };
  const result=await listShopOrders('token',{from:'2021-10-14',fetcher});
  assert.deepEqual(result.records.map(r=>r.record.id),['o1','o2','o3'],'duplicates across passes appear once');
  assert.deepEqual(result.listing.passes.map(p=>[p.name,p.new]),[['recent',2],['earlier',1],['earlier',0],['store',0],['store',0]]);
  assert.deepEqual(sent.map(s=>s.date_to).filter(Boolean),['2026-09-14','2026-05-31']);
  assert.deepEqual(sent.map(s=>s.query).filter(Boolean),['Amazon','Farfetch'],'only sellers Shop returned are searched');
  assert.equal(result.listing.stop,'throttled','a throttled search ends listing and keeps what was found');
});
