import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseSizeOffers,inspectAlertLinks,baselineOffers,priceDrop,readSizeOffers,lowestAvailable} from '../lib/price-alerts.js';
import {createWishlistHandler} from '../api/wishlist.js';
import {createPriceChecksHandler} from '../api/price-checks.js';
import {groupWishlist} from '../lib/wishlist.js';
const url='https://www.barbour.com/jacket';
const html=value=>`<script type="application/ld+json">${JSON.stringify(value)}</script>`;
const offer=(amount=100,size='M',available=true)=>({size,key:size.toUpperCase(),url,name:'Waxed jacket',amount,currency:'USD',available,checked_at:'2026-10-06T00:00:00Z'});
const product={ '@type':'ProductGroup',name:'Waxed jacket',hasVariant:[{'@type':'Product',name:'Waxed jacket medium',size:'M',offers:{price:'100',priceCurrency:'USD',availability:'https://schema.org/InStock'}},{'@type':'Product',name:'Waxed jacket large',size:'L',offers:{price:'120',priceCurrency:'USD',availability:'https://schema.org/OutOfStock'}}]};
test('actual Barbour selectors expose all sizes and prove individual stock separately from price',async()=>{
 const source=await readFile(new URL('./fixtures/barbour-sizes.html',import.meta.url),'utf8');
 const rows=parseSizeOffers(source,'Transport Windowpane Waxed Jacket','https://www.barbour.com/us/paul-smith-loves-barbour-transport-windowpane-waxed-jacket-MWX2611BR71.html');
 assert.deepEqual(rows.map(r=>r.size),['XS','S','M','L','XL','XXL']);assert.deepEqual(rows.filter(r=>r.available).map(r=>r.size),['XS','L','XL','XXL']);assert.ok(rows.every(r=>r.amount===700&&r.currency==='USD'));
 const sold=await readFile(new URL('./fixtures/barbour-sold-out-sizes.html',import.meta.url),'utf8');
 const unavailable=parseSizeOffers(sold,'Key Transport Waxed Jacket','https://www.barbour.com/us/paul-smith-loves-barbour-key-transport-waxed-jacket-MWX2610BR71S.html');assert.ok(unavailable.length>0);assert.ok(unavailable.every(r=>!r.available));
 assert.ok(parseSizeOffers(source,'Transport Windowpane Waxed Jacket','https://www.barbour.com/us/other-MWX1111.html').every(r=>!r.available));
});
test('reads size-specific product variants and keeps sold-out sizes selectable',()=>{
 const rows=parseSizeOffers(html(product),'Waxed jacket',url);assert.deepEqual(rows.map(r=>r.size),['M','L']);assert.equal(rows[0].available,true);assert.equal(rows[1].available,false);
 assert.deepEqual(parseSizeOffers(html(product),'Leather boots',url),[]);
});
test('actual Natalino Shopify data binds native sizes to stock and a verified same-currency price',async()=>{
 const source=await readFile(new URL('./fixtures/natalino-sizes.html',import.meta.url),'utf8');
 const rows=parseSizeOffers(source,'Sport Jacket Beige Brown Glen Check Wool Linen','https://natalino.co/en-us/products/sport-jacket-beige-brown-glen-check-wool-linen');
 assert.deepEqual(rows.map(r=>r.size),['44','46','48','50R','50L','52R','52L','54R','54L']);assert.deepEqual(rows.filter(r=>r.available).map(r=>r.size),['44','46']);assert.ok(rows.every(r=>r.amount===558&&r.currency==='USD'));
 const mismatched=parseSizeOffers(source.replaceAll('"price":55800','"price":70000'),'Sport Jacket Beige Brown Glen Check Wool Linen','https://natalino.co/en-us/products/sport-jacket-beige-brown-glen-check-wool-linen');assert.ok(mismatched.every(r=>r.amount===undefined));
});
test('generic stock and aggregate prices never prove size-specific eligibility',()=>{
 const shared={ '@type':'Product',name:'Waxed jacket',size:['S','M'],offers:{price:100,priceCurrency:'USD',availability:'https://schema.org/InStock'}};
 assert.ok(parseSizeOffers(html(shared),'Waxed jacket',url).every(r=>r.available===false));
 shared.offers={ '@type':'AggregateOffer',lowPrice:50,highPrice:100,priceCurrency:'USD'};
 assert.equal(baselineOffers([{offers:parseSizeOffers(html(shared),'Waxed jacket',url)}],'M').length,0);
});
test('deduplicates sizes across links without guessing conversions',async()=>{
 const result=await inspectAlertLinks([{url},{url:url+'/2'}],async link=>({offers:[offer(100,' M '),offer(100,'M'),offer(100,'EU 48'),offer(100,'48')]}));
 assert.deepEqual(result.sizes,['48','EU 48','M']);
});
test('strict drop threshold requires matching size, currency and stock across merchants',()=>{
 const baseline=offer();assert.equal(priceDrop(baseline,offer(90)),false);assert.equal(priceDrop(baseline,offer(89.99)),true);
 for(const change of [{available:false},{key:'L'},{currency:'EUR'},{amount:null},{amount:0}])assert.equal(priceDrop(baseline,{...offer(80),...change}),false);
 assert.equal(priceDrop(baseline,{...offer(80),url:url+'/2'}),true);
});
test('higher merchant dropping still above the original lowest never triggers; sold-out cheap offers do not set the floor',()=>{
 const baseline=lowestAvailable([offer(100),{...offer(150),url:url+'/2'},offer(50,'M',false)])[0];
 const current=lowestAvailable([offer(100),{...offer(120),url:url+'/2'}])[0];
 assert.equal(baseline.amount,100);assert.equal(priceDrop(baseline,current),false);
 assert.equal(priceDrop(baseline,lowestAvailable([offer(100),{...offer(89),url:url+'/2'}])[0]),true);
 assert.equal(lowestAvailable([offer(80),{...offer(70),currency:'EUR'}]).length,2);
});
test('ambiguous same-size prices are excluded rather than choosing a minimum',()=>{
 assert.deepEqual(baselineOffers([{offers:[offer(100),offer(120)]}],'M'),[]);
});
test('untrusted URLs are rejected without fetching',async()=>{
 const value=await readSizeOffers({url:'https://127.0.0.1/private',name:'Jacket'},()=>assert.fail());assert.equal(value.status,'unsupported');
});
const id='00000000-0000-4000-8000-000000000001';
const response=()=>({setHeader(){},end(body){this.body=JSON.parse(body);}});
const request=input=>({method:'POST',url:'/api/wishlist',headers:{'content-type':'application/json'},async *[Symbol.asyncIterator](){yield Buffer.from(JSON.stringify(input));}});
test('alert writes require consumer auth and an owned group',async()=>{
 const env={WISHLIST_ENABLED:'true',PRICE_ALERTS_ENABLED:'true'};
 let touched=false;
 const handler=createWishlistHandler({env,storeFactory:()=>({wishlistEntries:async()=>{touched=true;return [];}}),auth:async()=>({status:401})});
 const denied=response();await handler(request({action:'alert-enable',group:id,size:'M'}),denied);assert.equal(denied.statusCode,401);assert.equal(touched,false);
 const owned=createWishlistHandler({env,storeFactory:()=>({wishlistEntries:async()=>[]}),auth:async()=>({status:200,conversation:id})});
 const missing=response();await owned(request({action:'alert-disable',group:id}),missing);assert.equal(missing.statusCode,404);
});
function cronStore(){const operations=new Map();return {operations,claimPriceAlerts:async()=>[{id,revision:id,conversation_id:id,name:'Jacket',size:'M',links:[{url}],baselines:[offer()],notified:false}],priceAlertCurrent:async()=>true,conversation:async()=>({id,line:'test',sender_id:'tester'}),operation:async op=>operations.get(op),reserve:async(conversation_id,op,body)=>{if(operations.has(op))return false;operations.set(op,{conversation_id,body,status:'sending'});return true;},finish:async(op,status)=>{operations.get(op).status=status;},recordPriceCheck:async()=>{}};}
test('activation rejects missing/unlisted sizes and persists only the lowest available baseline',async()=>{
 const rows=[{reply_id:id,item_id:id,target:'jacket',name:'Waxed jacket',links:[{url}]}];
 const group=groupWishlist(rows)[0].id;let saved;
 const handler=createWishlistHandler({env:{WISHLIST_ENABLED:'true',PRICE_ALERTS_ENABLED:'true'},auth:async()=>({status:200,conversation:id}),storeFactory:()=>({wishlistEntries:async()=>rows,enablePriceAlert:async input=>{saved=input;return {active:true,size:input.p_size};}}),inspect:async()=>({sizes:['M','L'],checks:[{offers:[offer(150),{...offer(100),url:url+'/2'},offer(50,'M',false)]}]})});
 for(const size of [undefined,'XXL']){const res=response();await handler(request({action:'alert-enable',group,size}),res);assert.equal(res.statusCode,400);assert.equal(saved,undefined);}
 const res=response();await handler(request({action:'alert-enable',group,size:'M'}),res);assert.equal(res.statusCode,200);assert.equal(saved.p_baselines[0].amount,100);assert.equal(saved.p_baselines.length,1);
});
const cronReq={method:'GET',headers:{authorization:'Bearer test-cron-secret'}};
test('scheduler authentication prevents all database access',async()=>{
 const handler=createPriceChecksHandler({env:{CRON_SECRET:'test-cron-secret'},storeFactory:()=>assert.fail()});const res=response();await handler({...cronReq,headers:{}},res);assert.equal(res.statusCode,401);
});
test('accepted notification followed by failed persistence recovers without resending or changed-body conflicts',async()=>{
 const store=cronStore();let sends=0,amount=80;
 store.recordPriceCheck=async()=>{throw new Error('offline');};
 const handler=createPriceChecksHandler({env:{CRON_SECRET:'test-cron-secret',PRICE_ALERTS_ENABLED:'true'},storeFactory:()=>store,inspect:async()=>({checks:[{offers:[offer(amount)]}]}),send:async(_delivery,body)=>{sends++;assert.match(body,/size M is available/);assert.ok(body.includes(url));}});
 await handler(cronReq,response());amount=75;await handler(cronReq,response());assert.equal(sends,1);
});
test('uncertain sends are not resent; cancelled alerts do not send',async()=>{
 const store=cronStore();let sends=0;
 const handler=createPriceChecksHandler({env:{CRON_SECRET:'test-cron-secret',PRICE_ALERTS_ENABLED:'true'},storeFactory:()=>store,inspect:async()=>({checks:[{offers:[offer(80)]}]}),send:async()=>{sends++;throw new Error('timeout');}});
 await handler(cronReq,response());await handler(cronReq,response());assert.equal(sends,1);
 store.operations.clear();store.priceAlertCurrent=async()=>false;await handler(cronReq,response());assert.equal(sends,1);
});

test('pending watch establishes a verified baseline then detects drops without notifying about unknown stock',async()=>{
 const store=cronStore();const alert=(await store.claimPriceAlerts())[0];alert.baselines=[];
 alert.links=[{url,requested_sizes:['M','UK M']}];
 store.claimPriceAlerts=async()=>[alert];let offers=[],sends=0,statuses=[];
 store.recordPriceCheck=async(_id,_revision,result,_notified,baselines)=>{statuses.push(result.status);if(baselines)alert.baselines=baselines;};
 const handler=createPriceChecksHandler({env:{CRON_SECRET:'test-cron-secret',PRICE_ALERTS_ENABLED:'true'},storeFactory:()=>store,inspect:async()=>({checks:[{offers}]}),send:async()=>{sends++;}});
 await handler(cronReq,response());assert.equal(sends,0);assert.equal(statuses.at(-1),'awaiting_availability');
 offers=[offer(100)];await handler(cronReq,response());assert.equal(sends,0);assert.equal(statuses.at(-1),'baseline_established');assert.equal(alert.baselines[0].amount,100);
 offers=[offer(95)];await handler(cronReq,response());assert.equal(sends,1);assert.equal(alert.baselines[0].amount,95);
});
