import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseSizeOffers,shopifyStockCounts,pageProduct,readSizeOffers} from '../lib/price-alerts.js';
import {decideLowStock,lowStockRecord,lowStockMessage,lowStockSummary,stockCounts,withLowStock,LOW_STOCK_MAX} from '../lib/low-stock.js';
import {manageAlerts,alertState} from '../lib/inbox.js';
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
 const step=(checks,readable=true)=>{const decision=decide(alert,checks,readable);alert={...alert,last_result:{low_stock:lowStockRecord(decision,{delivery:'sent',now:'2026-10-21T13:00:00Z'})}};return decision;};
 assert.equal(step(checksOf(row(2))).would_send,true);
 assert.equal(alert.last_result.low_stock.episode.notified_at,'2026-10-21T13:00:00Z');
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

test('an episode opened by step 1’s read-only release, or a text that wasn’t delivered, doesn’t hold back the next text',()=>{
 const dryRun=alertWith({last_result:{low_stock:{state:'low',episode:{started_at:'2026-10-20T13:00:00Z',url:ssense,key:'32',size:'32',quantity:1,dry_run:true}}}});
 assert.equal(decide(dryRun,checksOf(row(1))).would_send,true);
 for(const delivery of ['failed','blocked',null]){
  const record=lowStockRecord(decide(alertWith(),checksOf(row(1))),{delivery});
  assert.deepEqual([record.episode,record.sent,record.reason],[null,null,`not_delivered_${delivery??'skipped'}`]);
  assert.equal(decide(alertWith({last_result:{low_stock:record}}),checksOf(row(1))).would_send,true,'tried again on the next check');
 }
});

test('turning off only the low-stock texts keeps the episode, so turning them back on mid-episode sends nothing',()=>{
 const record=lowStockRecord(decide(alertWith(),checksOf(row(1))),{turned_off:true});
 assert.deepEqual([record.reason,record.sent,record.episode.skipped],['turned_off',null,'turned_off']);
 assert.equal(decide(alertWith({last_result:{low_stock:record}}),checksOf(row(1))).would_send,false);
});

test('a low reading in the same check as a price drop or restock goes out in that text',()=>{
 const record=lowStockRecord(decide(alertWith(),checksOf(row(1))),{event:'price_drop',delivery:'sent'});
 assert.equal(record.combine_with,'price_drop');assert.equal(record.episode.with,'price_drop');
 assert.equal(withLowStock(`🚨 price drop on your saved Third Cut Jeans. your size is available now for $250.\n${ssense}`,{url:ssense,size:'32',quantity:1}),
  `🚨 price drop on your saved Third Cut Jeans. your size is available now for $250. SSENSE shows only 1 left in 32.\n${ssense}`);
 assert.deepEqual(record.evidence,[{url:ssense,size:'32',quantity:1,source:'ssense_size_menu'}]);
});

test('the text names the store and quotes its count for the watched size',()=>{
 const message=lowStockMessage(alertWith(),{url:ssense,size:'32',quantity:1});
 assert.equal(message,`heads up: SSENSE shows only 1 left of your saved Third Cut Jeans in Blue, size 32.\n${ssense}`);
 assert.doesNotMatch(message,/\bAI\b|agent/i);
});

test('the wishlist shows a verified low reading with its store and check date, and old readings as history',()=>{
 const alert=alertWith({last_result:{low_stock:lowStockRecord(decide(alertWith(),checksOf(row(2))),{delivery:'sent',now:'2026-10-21T13:00:00Z'})}});
 assert.deepEqual(lowStockSummary(alert,Date.parse('2026-10-22T00:00:00Z')),{quantity:2,size:'32',store:'SSENSE',checked_at:'2026-10-21T13:00:00Z',fresh:true});
 assert.equal(lowStockSummary(alert,Date.parse('2026-10-25T00:00:00Z')).fresh,false);
 assert.equal(lowStockSummary({...alert,active:false}),null,'an alert that is off shows nothing');
 assert.equal(lowStockSummary(alertWith({last_result:{low_stock:{state:'unknown',evidence:[]}}})),null);
});

function cronStore(alert,{current=true}={}){
 const records=[],operations=new Map();
 return {records,operations,claimPriceAlerts:async()=>[alert],priceAlertCurrent:async()=>current,conversation:async()=>({id,line:'test',sender_id:'tester'}),operation:async op=>operations.get(op),
  reserve:async(conversation_id,op,body)=>{if(operations.has(op))return false;operations.set(op,{conversation_id,body,status:'sending'});return true;},finish:async(op,status)=>{operations.get(op).status=status;},
  recordPriceCheck:async(_id,_revision,result,notified)=>{records.push({...result,notified});alert.last_result=result;}};
}
const cronReq={method:'GET',headers:{authorization:'Bearer test-cron-secret'}};
const response=()=>({setHeader(){},end(body){this.body=JSON.parse(body);}});
const cronEnv={CRON_SECRET:'test-cron-secret',PRICE_ALERTS_ENABLED:'true',PRICE_ALERT_DISCOVERY:'false'};
const cron=(alert,offers,{store=cronStore(alert),sent=[]}={})=>({store,sent,handler:createPriceChecksHandler({env:cronEnv,storeFactory:()=>store,
 inspect:async links=>{assert.deepEqual(links.map(l=>l.watched_sizes),links.map(()=>['32']));return {checks:checksOf(...offers())};},discover:async()=>({status:'unavailable',links:[],checks:[]}),send:async(_d,body)=>{sent.push(body);}})});
const quiet=async work=>{const log=console.log,lines=[];console.log=line=>{lines.push(line);};try{await work();}finally{console.log=log;}return lines.map(l=>{try{return JSON.parse(l);}catch{return null;}}).filter(l=>l?.event==='low_stock_check');};

test('scheduled checks text once per episode as a price alert, and again only after it restocks and drops again',async()=>{
 const alert=alertWith();let offers=[row(1)];const {store,sent,handler}=cron(alert,()=>offers);
 const logs=await quiet(async()=>{await handler(cronReq,response());await handler(cronReq,response());});
 assert.equal(sent.length,1);assert.equal(sent[0],`heads up: SSENSE shows only 1 left of your saved Third Cut Jeans in Blue, size 32.\n${ssense}`);
 assert.ok([...store.operations.keys()].every(op=>op.startsWith('price-alert:')),'counts as a price alert under the shared send rules');
 assert.deepEqual(store.records.map(r=>[r.event,r.low_stock.reason,r.low_stock.sent,r.notified]),[['low_stock','verified_low_stock','sent',true],[null,'episode_already_open',null,false]]);
 assert.deepEqual(logs.map(l=>[l.reason,l.sent]),[['verified_low_stock','sent'],['episode_already_open',null]]);
 assert.deepEqual(logs[0].evidence,[{store:'SSENSE',size:'32',quantity:1,source:'ssense_size_menu'}]);
 offers=[row(8)];await quiet(()=>handler(cronReq,response()));assert.equal(sent.length,1);
 offers=[row(2)];await quiet(()=>handler(cronReq,response()));assert.equal(sent.length,2,'a new episode');assert.match(sent[1],/only 2 left/);
});

test('nothing is sent when the count is unknown, the alert changed, or low-stock texts are off',async()=>{
 const noCount={...row(1)};delete noCount.quantity;
 let {sent,handler}=cron(alertWith(),()=>[noCount]);await quiet(()=>handler(cronReq,response()));assert.equal(sent.length,0);
 ({sent,handler}=cron(alertWith(),()=>[row(1,{size:'31'})]));await quiet(()=>handler(cronReq,response()));assert.equal(sent.length,0,'another size');
 const changed=alertWith();({sent,handler}=cron(changed,()=>[row(1)],{store:cronStore(changed,{current:false})}));await quiet(()=>handler(cronReq,response()));
 assert.equal(sent.length,0,'a cancelled or changed alert');assert.equal(changed.last_result.low_stock.episode,null);
 const off=alertWith({low_stock_alerts:false});({sent,handler}=cron(off,()=>[row(1)]));
 const logs=await quiet(()=>handler(cronReq,response()));assert.equal(sent.length,0);assert.equal(logs[0].reason,'turned_off');
});

test('a low reading joins a price drop from the same check in one text',async()=>{
 const alert=alertWith({baselines:[{url:ssense,size:'32',key:'32',amount:290,currency:'USD',available:true,drop_percent:0}]});
 const {sent,store,handler}=cron(alert,()=>[{...row(1),amount:250}]);await quiet(()=>handler(cronReq,response()));
 assert.equal(sent.length,1);assert.match(sent[0],/price drop/);assert.match(sent[0],/SSENSE shows only 1 left in 32\./);
 assert.deepEqual([store.records[0].event,store.records[0].low_stock.combine_with,store.records[0].low_stock.sent],['price_drop','price_drop','sent']);
});

test('the owner rehearsal previews a low-stock text and sends a labelled test only to the test conversation',async()=>{
 const alert=alertWith();const sent=[];let conversation=id;
 const store={priceAlert:async()=>({...alert,conversation_id:conversation}),conversation:async()=>({id:conversation,line:'test',sender_id:'tester'}),operation:async()=>null,reserve:async()=>true,finish:async()=>{},prepareAI:async()=>{}};
 const handler=createPriceChecksHandler({env:{PRICE_ALERT_TEST_CONVERSATION_ID:id},storeFactory:()=>store,admin:async()=>200,send:async(_d,body)=>{sent.push(body);}});
 const post=async body=>{const req={method:'POST',headers:{'content-type':'application/json'},async *[Symbol.asyncIterator](){yield Buffer.from(JSON.stringify(body));}};const res=response();await handler(req,res);return res.body;};
 const offer={url:ssense,size:'32',amount:290,currency:'USD',available:true,quantity:1};
 const preview=await post({alert_id:id,offers:[offer]});
 assert.deepEqual([preview.event,preview.low_stock.would_send],['low_stock',true]);assert.match(preview.message,/^heads up: SSENSE shows only 1 left/);assert.equal(sent.length,0);
 assert.equal((await post({alert_id:id,offers:[offer],low_stock_episode:'open'})).low_stock.reason,'episode_already_open');
 assert.ok((await post({alert_id:id,offers:[{...offer,quantity:-1}]})).error);
 const test=await post({alert_id:id,deliver:true,offers:[offer]});
 assert.equal(test.delivery,'sent');assert.equal(sent.length,1);assert.match(sent[0],/^\[test alert — not real stock\]\nheads up: SSENSE/);
 conversation='00000000-0000-4000-8000-000000000002';
 assert.match((await post({alert_id:id,deliver:true,offers:[offer]})).error,/designated test conversation/);assert.equal(sent.length,1);
});

// Chat: the model picks the operation and items; code only acts on this user's own active alerts.
const chatItems=[{id:'item-jeans',name:'Third Cut Jeans'},{id:'item-boots',name:'Camion Boots'}];
const chatAlerts=()=>[{group_id:'item-jeans',active:true,size:'32',links:[{url:ssense}],baselines:[{amount:290,currency:'USD',url:ssense}],low_stock_alerts:true},
 {group_id:'item-boots',active:true,size:'43',links:[{url:ssense}],baselines:[{amount:600,currency:'USD',url:ssense}],low_stock_alerts:true}];
const chatStore=alerts=>({calls:[],async setLowStockAlerts(_c,group,on){this.calls.push(['low',group,on]);alerts.find(a=>a.group_id===group).low_stock_alerts=on;},
 async disablePriceAlert(_c,group){this.calls.push(['off',group]);alerts.find(a=>a.group_id===group).active=false;},async priceAlerts(){return alerts;}});

test('chat turns off only the low-stock texts on the chosen item; its price alert and other items stay as they were',async()=>{
 const alerts=chatAlerts(),store=chatStore(alerts),outcome={};
 const reply=await manageAlerts('low_stock_off',['item-jeans'],{store,conversationId:id,items:chatItems,alerts,outcome});
 assert.deepEqual(store.calls,[['low','item-jeans',false]]);assert.match(reply,/off for Third Cut Jeans.*price-drop and back-in-stock alerts stay on/);
 assert.deepEqual(alerts.map(a=>[a.active,a.low_stock_alerts]),[[true,false],[true,true]]);assert.equal(outcome.alerts_turned_off,undefined,'the alert itself is still on');
 assert.match(await manageAlerts('status',['item-jeans'],{store,conversationId:id,items:chatItems,alerts}),/nearly-sold-out texts are off for this item/);
 await manageAlerts('low_stock_on',['item-jeans'],{store,conversationId:id,items:chatItems,alerts});assert.equal(alerts[0].low_stock_alerts,true);
 assert.match(await manageAlerts('low_stock_off',['someone-elses-item'],{store,conversationId:id,items:chatItems,alerts}),/couldn’t find that item/);
 assert.match(await manageAlerts('rename',[],{store,conversationId:id,items:chatItems,alerts}),/isn’t available/);assert.ok(alerts.every(a=>a.active),'an unknown operation never cancels');
});

test('chat status reports the last verified low reading and whether it was already texted',async()=>{
 const alert={...chatAlerts()[0],last_checked_at:'2026-10-21T13:00:00Z',last_result:{low_stock:lowStockRecord(decide(alertWith(),checksOf(row(1))),{delivery:'sent'})}};
 assert.match(alertState(alert),/SSENSE showed only 1 left in 32\. i already texted you about that\./);
 const status=await manageAlerts('status',[],{store:chatStore([alert]),conversationId:id,items:chatItems,alerts:[alert]});
 assert.match(status,/3 or fewer left in your size/);
 assert.match(await manageAlerts('low_stock_off',['item-boots'],{store:chatStore([alert]),conversationId:id,items:chatItems,alerts:[alert]}),/isn’t an active price alert on that item/,'consent stays with the items that have alerts');
});

test('stock counts accept only watched stores and sizes',()=>{
 assert.deepEqual(stockCounts(checksOf(row(1),row(1,{size:'31'})),['32'],[ssense]).map(c=>c.size),['32']);
});
