import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseSizeOffers,shopifyStockCounts,pageProduct,readSizeOffers} from '../lib/price-alerts.js';
import {decideLowStock,lowStockRecord,lowStockMessage,lowStockSummary,stockCounts,LOW_STOCK_MAX} from '../lib/low-stock.js';
import {createPriceChecksHandler} from '../api/price-checks.js';

const id='00000000-0000-4000-8000-000000000001';
const ssense='https://www.ssense.com/en-us/men/product/our-legacy/blue-third-cut-jeans/1234';
const kith='https://kith.com/products/third-cut-jean?variant=45145556222111';
const ld=value=>`<script type="application/ld+json">${JSON.stringify(value)}</script>`;
const ssensePage=(note32='Only 1 remaining')=>ld({'@type':'Product',name:'Blue Third Cut Jeans',brand:{name:'OUR LEGACY'},offers:{price:290,priceCurrency:'USD',availability:'https://schema.org/InStock',url:ssense}})
 +'<select id="size-dropdown"><option value="" disabled>SELECT A SIZE</option>'
 +`<option value="31">31 - Only 2 remaining</option><option value="32">32${note32?` - ${note32}`:''}</option><option value="33" disabled>33 - Sold Out</option><option value="34">34 - Only 9 remaining</option></select>`;
const row=(quantity,{size='32',url=ssense,available=quantity>0}={})=>({size,key:size,url,amount:290,currency:'USD',available,quantity,quantity_source:'ssense_size_menu',checked_at:'2026-10-21T13:00:00Z'});
const alertWith=(extra={})=>({id,revision:id,conversation_id:id,active:true,name:'Third Cut Jeans · Blue',size:'32',links:[{url:ssense},{url:kith}],baselines:[{url:ssense,size:'32',key:'32',amount:290,currency:'USD',available:true}],...extra});
const checksOf=(...rows)=>[{url:ssense,status:'checked',offers:rows}];
const decide=(alert,checks,readable=true)=>decideLowStock(alert,checks,{sizes:['32'],urls:alert.links.map(l=>l.url),readable,now:'2026-10-21T13:00:00Z'});

// Shopify variant data as Kith and Bodega embed it, plus a related product's variants on the same page.
const shopifyVariant=(id,options,quantity,{available=quantity>0,managed=true,policy='deny'}={})=>({id,title:options.join(' / '),option1:options[0],option2:options[1]??null,option3:null,options,available,price:29000,inventory_quantity:quantity,inventory_management:managed?'shopify':null,inventory_policy:policy});
const shopifyPage=(variants,{related=[],offers=variants}={})=>ld({'@type':'Product',name:'Third Cut Jean',offers:offers.map(v=>({'@type':'Offer',url:`https://kith.com/products/third-cut-jean?variant=${v.id}`,price:'290.00',priceCurrency:'USD',availability:'https://schema.org/InStock'}))})
 +`<script>window.productVariants=${JSON.stringify(variants)};</script><script>window.related=${JSON.stringify(related)};</script>`;
const shopifyCounts=(html,options={})=>shopifyStockCounts(html,kith,pageProduct(html,'Third Cut Jean',kith),{sizes:['32'],...options});

test('SSENSE’s own “Only N remaining” note is the stated count for that exact size',()=>{
 const rows=parseSizeOffers(ssensePage(),'Blue Third Cut Jeans',ssense,'t');
 assert.equal(rows.find(r=>r.size==='32').quantity,1);assert.equal(rows.find(r=>r.size==='31').quantity,2);assert.equal(rows.find(r=>r.size==='34').quantity,9);
 assert.equal(rows.find(r=>r.size==='33').quantity,undefined,'a sold-out size states no count');
 assert.equal(parseSizeOffers(ssensePage(null),'Blue Third Cut Jeans',ssense,'t').find(r=>r.size==='32').quantity,undefined,'no note, no count');
});

test('Shopify counts bind to this product’s own variants, the watched size and the watched color',()=>{
 const black32=shopifyVariant(45145556222111,['Black','32'],2),blue32=shopifyVariant(45145556222112,['Blue','32'],7),black30=shopifyVariant(45145556222113,['Black','30'],1);
 const html=shopifyPage([black32,blue32,black30],{related:[shopifyVariant(45145556222999,['Black','32'],1)]});
 assert.deepEqual(shopifyCounts(html,{color:'black'}).map(c=>[c.size,c.quantity,c.retailer_variant_id]),[['32',2,'45145556222111']]);
 assert.deepEqual(shopifyCounts(html,{color:'Blue'}).map(c=>c.quantity),[7]);
 // No watched color: the variant pinned in the watched link decides; without one, two colors are ambiguous.
 assert.deepEqual(shopifyCounts(html).map(c=>c.quantity),[2]);
 assert.deepEqual(shopifyStockCounts(html,'https://kith.com/products/third-cut-jean',pageProduct(html,'Third Cut Jean',kith),{sizes:['32']}),[]);
 // Variants the page's product data doesn't link (another product's) never count.
 assert.deepEqual(shopifyCounts(shopifyPage([black32],{related:[shopifyVariant(45145556222999,['Black','32'],1)],offers:[]}),{color:'Black'}),[]);
 // Another size's count is never this size's count.
 assert.deepEqual(shopifyCounts(shopifyPage([black30]),{color:'Black'}),[]);
});

test('untracked, oversellable or contradictory Shopify counts are unknown, not low',()=>{
 for(const variant of [shopifyVariant(45145556222111,['Black','32'],2,{managed:false}),shopifyVariant(45145556222111,['Black','32'],2,{policy:'continue'}),shopifyVariant(45145556222111,['Black','32'],2,{available:false})])
  assert.deepEqual(shopifyCounts(shopifyPage([variant]),{color:'Black'}),[]);
 const html=shopifyPage([shopifyVariant(45145556222111,['Black','32'],2)])+`<script>var copy=${JSON.stringify(shopifyVariant(45145556222111,['Black','32'],5))};</script>`;
 assert.deepEqual(shopifyCounts(html,{color:'Black'}),[],'two copies that disagree');
});

test('a watched store page is read with its Shopify counts for the watched sizes',async()=>{
 const html=shopifyPage([shopifyVariant(45145556222111,['Black','32'],1)]);
 const fetcher=async()=>new Response(html,{status:200,headers:{'content-type':'text/html'}});
 const check=await readSizeOffers({url:kith,name:'Third Cut Jean',watched_sizes:['32']},fetcher);
 assert.equal(check.status,'checked');assert.deepEqual(check.counts.map(c=>[c.size,c.quantity,c.url]),[['32',1,kith]]);
 assert.equal((await readSizeOffers({url:kith,name:'Third Cut Jean'},fetcher)).counts,undefined,'no watched size, no counts');
});

test('low means the store states 1–3 left for the watched size at a watched store',()=>{
 const alert=alertWith();
 const low=decide(alert,checksOf(row(1)));
 assert.equal(low.state,'low');assert.equal(low.reason,'verified_low_stock');assert.equal(low.would_send,true);assert.equal(low.lowest.quantity,1);
 assert.equal(decide(alert,checksOf(row(LOW_STOCK_MAX))).would_send,true);
 assert.deepEqual([decide(alert,checksOf(row(LOW_STOCK_MAX+1))).state,decide(alert,checksOf(row(4))).reason],['not_low','above_threshold']);
 assert.deepEqual([decide(alert,checksOf(row(0))).state,decide(alert,checksOf(row(0))).would_send],['sold_out',false]);
});

test('low stock is never inferred from other sizes, unreadable sizes or stores, or unwatched stores',()=>{
 const alert=alertWith();
 const other=decide(alert,checksOf(row(1,{size:'31'}),{...row(0,{size:'33'})},row(undefined)));
 assert.deepEqual([other.state,other.reason,other.would_send],['unknown','no_stated_quantity',false],'only other sizes are low or gone');
 const noCount={...row(1)};delete noCount.quantity;
 assert.equal(decide(alert,checksOf(noCount)).reason,'no_stated_quantity','in stock with no stated count');
 assert.deepEqual([decide(alert,[{url:ssense,status:'unavailable',offers:[]}],false).reason,decide(alert,[],false).would_send],['check_failed',false]);
 assert.equal(decide(alert,checksOf(row(1,{url:'https://www.farfetch.com/shopping/x.aspx'}))).would_send,false,'a store the user isn’t watching');
 assert.equal(decide(alert,checksOf({...row(2),available:false})).would_send,false,'a count on a size the store won’t sell');
 assert.equal(decide(alert,checksOf(row(1),{...row(2),quantity_source:'other'})).reason,'no_stated_quantity','two counts that disagree');
});

test('one text per low-stock episode; it ends only on a verified restock above 3 or a sellout',()=>{
 let alert=alertWith();
 const step=(checks,readable=true)=>{const decision=decide(alert,checks,readable);alert={...alert,last_result:{low_stock:lowStockRecord(decision,{now:'2026-10-21T13:00:00Z'})}};return decision;};
 assert.equal(step(checksOf(row(2))).would_send,true);
 assert.equal(alert.last_result.low_stock.episode.dry_run,true,'opened while texts are off');
 assert.deepEqual([step(checksOf(row(1))).would_send,step(checksOf(row(1))).reason],[false,'episode_already_open'],'still low: no repeat');
 assert.equal(step([],false).episode.url,ssense,'a failed check keeps the episode');
 const noCount={...row(1)};delete noCount.quantity;
 assert.equal(step(checksOf(noCount)).reason,'episode_open_low_store_unconfirmed','an unreadable count keeps the episode');
 assert.equal(step(checksOf(row(1))).would_send,false);
 assert.deepEqual([step(checksOf(row(6))).reason,alert.last_result.low_stock.episode],['episode_ended_restocked',null]);
 assert.equal(step(checksOf(row(2))).would_send,true,'restocked and dropped again: a new episode');
 const soldOut={...row(1),available:false};delete soldOut.quantity;
 assert.deepEqual([step(checksOf(soldOut)).reason,step(checksOf(row(1))).would_send],['episode_ended_sold_out',true]);
});

test('a low reading in the same check as a price drop or restock is marked to go out with it',()=>{
 const record=lowStockRecord(decide(alertWith(),checksOf(row(1))),{event:'price_drop'});
 assert.equal(record.combine_with,'price_drop');assert.equal(record.dry_run,true);
 assert.deepEqual(record.evidence,[{url:ssense,size:'32',quantity:1,source:'ssense_size_menu'}]);
});

test('the text names the store and quotes its count for the watched size',()=>{
 const message=lowStockMessage(alertWith(),{url:ssense,size:'32',quantity:1});
 assert.equal(message,`heads up: SSENSE shows only 1 left of your saved Third Cut Jeans in Blue, size 32.\n${ssense}`);
 assert.doesNotMatch(message,/\bAI\b|agent/i);
});

test('the wishlist shows a verified low reading with its store and check date, and old readings as history',()=>{
 const alert=alertWith({last_result:{low_stock:lowStockRecord(decide(alertWith(),checksOf(row(2))),{now:'2026-10-21T13:00:00Z'})}});
 assert.deepEqual(lowStockSummary(alert,Date.parse('2026-10-22T00:00:00Z')),{quantity:2,size:'32',store:'SSENSE',checked_at:'2026-10-21T13:00:00Z',fresh:true});
 assert.equal(lowStockSummary(alert,Date.parse('2026-10-25T00:00:00Z')).fresh,false);
 assert.equal(lowStockSummary({...alert,active:false}),null,'an alert that is off shows nothing');
 assert.equal(lowStockSummary(alertWith({last_result:{low_stock:{state:'unknown',evidence:[]}}})),null);
});

function cronStore(alert){
 const records=[];
 return {records,claimPriceAlerts:async()=>[alert],priceAlertCurrent:async()=>true,conversation:async()=>({id,line:'test',sender_id:'tester'}),operation:async()=>null,
  reserve:async()=>true,finish:async()=>{},
  recordPriceCheck:async(_id,_revision,result)=>{records.push(result);alert.last_result=result;}};
}
const cronReq={method:'GET',headers:{authorization:'Bearer test-cron-secret'}};
const response=()=>({setHeader(){},end(body){this.body=JSON.parse(body);}});

test('scheduled checks record and log low stock but send no text in step 1',async()=>{
 const alert=alertWith();const store=cronStore(alert),sent=[],logs=[];
 const handler=createPriceChecksHandler({env:{CRON_SECRET:'test-cron-secret',PRICE_ALERTS_ENABLED:'true',PRICE_ALERT_DISCOVERY:'false'},storeFactory:()=>store,
  inspect:async links=>{assert.deepEqual(links.map(l=>l.watched_sizes),[['32'],['32']]);return {checks:checksOf(row(1))};},discover:async()=>({status:'unavailable',links:[],checks:[]}),send:async(_d,body)=>{sent.push(body);}});
 const log=console.log;console.log=line=>{logs.push(line);};
 try{await handler(cronReq,response());await handler(cronReq,response());}finally{console.log=log;}
 assert.equal(sent.length,0);
 assert.deepEqual(store.records.map(r=>[r.low_stock.state,r.low_stock.reason,r.low_stock.would_send]),[['low','verified_low_stock',true],['low','episode_already_open',false]]);
 const entries=logs.map(l=>{try{return JSON.parse(l);}catch{return null;}}).filter(l=>l?.event==='low_stock_check');
 assert.equal(entries.length,2);assert.deepEqual(entries[0].evidence,[{store:'SSENSE',size:'32',quantity:1,source:'ssense_size_menu'}]);assert.equal(entries[0].dry_run,true);
});

test('the owner rehearsal previews a low-stock decision with a typed count and never sends it',async()=>{
 const alert=alertWith();const sent=[];
 const store={priceAlert:async()=>alert,conversation:async()=>({id,line:'test',sender_id:'tester'})};
 const handler=createPriceChecksHandler({env:{PRICE_ALERT_TEST_CONVERSATION_ID:id},storeFactory:()=>store,admin:async()=>200,send:async(_d,body)=>{sent.push(body);}});
 const post=async body=>{const req={method:'POST',headers:{'content-type':'application/json'},async *[Symbol.asyncIterator](){yield Buffer.from(JSON.stringify(body));}};const res=response();await handler(req,res);return res.body;};
 const offer={url:ssense,size:'32',amount:290,currency:'USD',available:true,quantity:1};
 const preview=await post({alert_id:id,deliver:true,offers:[offer]});
 assert.equal(preview.low_stock.would_send,true);assert.match(preview.low_stock.message,/^heads up: SSENSE shows only 1 left/);assert.equal(sent.length,0);
 assert.equal((await post({alert_id:id,offers:[offer],low_stock_episode:'open'})).low_stock.reason,'episode_already_open');
 assert.equal((await post({alert_id:id,offers:[{...offer,quantity:-1}]})).error!==undefined,true);
});

test('stock counts accept only watched stores and sizes',()=>{
 assert.deepEqual(stockCounts(checksOf(row(1),row(1,{size:'31'})),['32'],[ssense]).map(c=>c.size),['32']);
});
