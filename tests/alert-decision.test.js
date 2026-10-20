import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decidePriceCheck,sizeStock,FAILURES_BEFORE_RECOVERY} from '../lib/alert-decision.js';
import {discoverAlertLinks,discoveryDue,MAX_ALERT_LINKS} from '../lib/alert-discovery.js';
import {listedShipping,shippingTo,parseSizeOffers} from '../lib/price-alerts.js';
import {createPriceChecksHandler} from '../api/price-checks.js';

const id='00000000-0000-4000-8000-000000000001',testConversation='00000000-0000-4000-8000-000000000009';
const home='https://www.barbour.com/jacket',other='https://www.nordstrom.com/s/jacket/1';
const offer=(amount=100,{size='M',available=true,url=home,shipping}={})=>({size,key:size.toUpperCase(),url,name:'Waxed jacket',amount,currency:'USD',available,checked_at:'2026-10-06T00:00:00Z',...(shipping!==undefined?{shipping:[{countries:['US'],amount:shipping,currency:'USD'}]}:{})});
const alertWith=(extra={})=>({id,revision:id,conversation_id:id,name:'Waxed jacket',size:'M',links:[{url:home},{url:other}],baselines:[{...offer(100),drop_percent:0}],...extra});
const checks=(...offers)=>[{url:home,status:'checked',offers}];

test('a sold-out size coming back in stock is its own event, even at the same price',()=>{
 const alert=alertWith({baselines:[{...offer(100,{available:false}),drop_percent:0}],last_result:{stock:'sold_out'},last_checked_at:'2026-10-10T13:00:00Z'});
 const decision=decidePriceCheck(alert,checks(offer(100)));
 assert.equal(decision.status,'restock');assert.equal(decision.event.kind,'restock');
 assert.match(decision.event.body,/^🚨 back in stock: your saved Waxed jacket\. your size is available now for \$100\./);assert.ok(decision.event.body.includes(home));
 assert.equal(decidePriceCheck(alert,checks(offer(100))).event.fingerprint,decision.event.fingerprint,'a retry reuses the same delivery operation');
 // Still sold out, or an unreadable store, is not a restock.
 assert.equal(decidePriceCheck(alert,checks(offer(100,{available:false}))).event,null);
 assert.equal(decidePriceCheck({...alert,last_result:{stock:'unknown'}},checks(offer(100))).event,null);
});

test('a watch saved while sold out restocks from its saved reference before any recorded check',()=>{
 const alert=alertWith({baselines:[{...offer(120,{available:false}),drop_percent:0}]});
 assert.equal(decidePriceCheck(alert,checks(offer(120))).status,'restock');
 // Restocked below the reference price reports both facts in one message.
 const both=decidePriceCheck(alert,checks(offer(90)));
 assert.equal(both.event.kind,'price_drop');assert.match(both.event.body,/back in stock/);assert.equal(both.after_send[0].amount,90);
});

test('a pending watch establishes its reference silently unless the size was verified sold out',()=>{
 const pending=alertWith({baselines:[]});
 const quiet=decidePriceCheck(pending,checks(offer(100)));
 assert.equal(quiet.status,'baseline_established');assert.equal(quiet.event,null);assert.equal(quiet.establish[0].amount,100);
 const sold={...pending,last_result:{checks:checks(offer(100,{available:false}))}};
 const restock=decidePriceCheck(sold,checks(offer(100)));
 assert.equal(restock.status,'restock');assert.equal(restock.establish[0].amount,100);
 assert.equal(decidePriceCheck(pending,checks(offer(100,{available:false}))).status,'awaiting_availability');
});

test('another store’s lower item price counts only when its listed shipping keeps the total lower',()=>{
 const alert=alertWith();
 // $40 off with unknown shipping is recorded, not announced.
 const unknown=decidePriceCheck(alert,checks(offer(100),offer(60,{url:other})));
 assert.equal(unknown.event,null);assert.equal(unknown.record.unconfirmed_savings[0].amount,60);
 // $40 off with $60 shipping is not a saving.
 assert.equal(decidePriceCheck(alert,checks(offer(100),offer(60,{url:other,shipping:60}))).event,null);
 const free=decidePriceCheck(alert,checks(offer(100),offer(60,{url:other,shipping:0})));
 assert.equal(free.event.kind,'price_drop');assert.match(free.event.body,/now at nordstrom\.com for \$60 \(was \$100, 40% off\)\. free shipping per the store/);assert.ok(free.event.body.includes(other));
 // The same store keeps its own shipping terms, so its item price is comparable.
 const same=decidePriceCheck(alert,checks(offer(95)));
 assert.equal(same.event.kind,'price_drop');assert.match(same.event.body,/your size is available now for \$95 \(was \$100, 5% off\)\. shipping and other fees not included\.\n/);
});

test('the cheapest delivered total wins and stores that do not ship to the user are excluded',()=>{
 const alert=alertWith();
 const best=decidePriceCheck(alert,checks(offer(95),offer(80,{url:other,shipping:5})));
 assert.ok(best.event.body.includes(other));
 const blocked=[{...offer(50,{url:other}),shipping:[{countries:['US'],does_not_ship:true}]}];
 assert.equal(decidePriceCheck(alert,checks(offer(100),...blocked)).event,null);
});

test('consecutive unreadable checks keep the known stock state and ask for recovery',()=>{
 let alert=alertWith({last_result:{stock:'sold_out'}});
 for(let n=1;n<=FAILURES_BEFORE_RECOVERY;n++){
  const decision=decidePriceCheck(alert,[{url:home,status:'unavailable',offers:[]}]);
  assert.equal(decision.status,'check_failed');assert.equal(decision.record.failures,n);assert.equal(decision.record.stock,'sold_out');
  assert.equal(decision.needs_recovery,n>=FAILURES_BEFORE_RECOVERY);
  alert={...alert,last_result:decision.record};
 }
 assert.equal(decidePriceCheck(alert,checks(offer(100))).record.failures,0);
});

test('stock is unknown when no readable store lists the size',()=>{
 assert.equal(sizeStock(checks(offer(100,{size:'L'})),['M'],[home]),'unknown');
 assert.equal(sizeStock(checks(offer(100,{available:false}),offer(100,{url:other})),['M'],[home,other]),'in_stock');
});

test('listed shipping requires an unconditional rate to a named country in the item currency',()=>{
 const detail=(rate,extra={})=>({shippingDetails:{shippingRate:rate,shippingDestination:{addressCountry:'US'},...extra}});
 assert.deepEqual(listedShipping(detail({value:0,currency:'USD'})),[{countries:['US'],amount:0,currency:'USD'}]);
 assert.deepEqual(listedShipping(detail({value:10,currency:'USD'},{shippingConditions:{}})),[]);
 assert.deepEqual(listedShipping(detail({minValue:5,maxValue:20,currency:'USD'})),[]);
 assert.deepEqual(listedShipping({shippingDetails:{shippingRate:{value:5,currency:'USD'}}}),[]);
 const row={currency:'USD',shipping:[{countries:['US'],amount:12,currency:'USD'},{countries:['US'],amount:8,currency:'USD'},{countries:['CA'],amount:1,currency:'USD'}]};
 assert.deepEqual(shippingTo(row,'US'),{status:'listed',amount:8,currency:'USD'});
 assert.equal(shippingTo(row,'GB').status,'unknown');assert.equal(shippingTo({...row,currency:'EUR'},'US').status,'unknown');
 const page=`<script type="application/ld+json">${JSON.stringify({'@type':'Product',name:'Waxed jacket',size:'M',offers:{price:'100',priceCurrency:'USD',availability:'https://schema.org/InStock',...detail({value:'0',currency:'USD'})}})}</script>`;
 assert.equal(shippingTo(parseSizeOffers(page,'Waxed jacket',home)[0],'US').amount,0);
});

// Shopping rows as Google returns them since October 20, 2026: a seller name and a page token, no link.
const storeLinks={ModeSens:'https://modesens.com/product/waxed-jacket-1',Barbour:'https://www.barbour.com/other',SSENSE:'https://www.ssense.com/en-us/men/product/waxed-jacket/1','MR PORTER':'https://www.mrporter.com/jacket',Mytheresa:'https://www.mytheresa.com/jacket'};
const serp=(sellers,seen=[])=>async url=>{
 const p=new URL(url).searchParams,engine=p.get('engine');seen.push(engine==='google_shopping'?engine:p.get('page_token'));
 if(engine==='google_shopping')return new Response(JSON.stringify({shopping_results:sellers.map(source=>({title:'Waxed jacket',source,immersive_product_page_token:source,product_link:'https://www.google.com/search?ibp=oshop',extracted_price:90}))}));
 return new Response(JSON.stringify({product_results:{stores:[{name:p.get('page_token'),link:storeLinks[p.get('page_token')]}]}}));
};
const env={SERPAPI_API_KEY:'test-key',SHOPPING_COUNTRY:'US',SHOPPING_CURRENCY:'USD'};

test('discovery looks up only trusted stores not already watched, two at most, and adds those whose own page lists the size',async()=>{
 const alert={id,name:'Waxed jacket',size:'M',links:[{url:home,name:'Waxed jacket'}]};
 const read=async(link,_fetcher,options)=>{
  assert.equal(options.minimumMatch,1);assert.equal(link.market_country,'US');
  if(link.url.includes('ssense'))return {url:link.url,status:'checked',offers:[offer(80,{url:link.url})]};
  if(link.url.includes('mrporter'))return {url:link.url,status:'checked',offers:[offer(80,{url:link.url,size:'L'})]};
  return {url:link.url,status:'checked',offers:[offer(80,{url:link.url})],color:'Olive'};
 };
 const seen=[];
 const result=await discoverAlertLinks(alert,[],{env:{...env,SERPAPI_API_KEY:'discovery-1'},fetcher:serp(['ModeSens','Barbour','SSENSE','MR PORTER','Mytheresa'],seen),read,sizes:['M']});
 assert.deepEqual(seen,['google_shopping','SSENSE','MR PORTER'],'an untrusted seller and the watched store cost no lookup');
 assert.deepEqual(result.links.map(l=>l.url),[storeLinks.SSENSE],'the wrong-size store is rejected');
 assert.equal(result.searches,3);
 assert.ok(result.links[0].discovered_at);assert.equal(result.links[0].market_country,undefined);
 const coloured={...alert,links:[{...alert.links[0],color:'Olive'}]};
 const withColor=await discoverAlertLinks(coloured,[],{env:{...env,SERPAPI_API_KEY:'discovery-2'},fetcher:serp(['Mytheresa']),read,sizes:['M']});
 assert.ok(withColor.links.some(l=>l.url.includes('mytheresa')&&l.color==='Olive'));
 const unverifiedColor=await discoverAlertLinks({...alert,name:'Waxed field jacket',links:[{url:home,name:'Waxed field jacket'}]},[],{env:{...env,SERPAPI_API_KEY:'discovery-3'},fetcher:serp(['Mytheresa']),read,sizes:['M']});
 assert.equal(unverifiedColor.links.length,0,'a page that declares a colour is not bound to an alert with none');
 assert.equal((await discoverAlertLinks(alert,[],{env:{},read:()=>assert.fail(),sizes:['M']})).status,'unavailable');
});

test('discovery runs weekly, sooner after repeated failures, and stops at the link limit',()=>{
 const now=Date.parse('2026-10-13T00:00:00Z'),links=[{url:home}];
 assert.equal(discoveryDue({links},{now}),true);
 const recent={links,last_result:{discovered_at:'2026-10-11T00:00:00Z'}};
 assert.equal(discoveryDue(recent,{now}),false);assert.equal(discoveryDue(recent,{now,recovery:true}),true);
 assert.equal(discoveryDue({links:Array(MAX_ALERT_LINKS).fill({url:home})},{now}),false);
});

function cronStore(alert){
 const operations=new Map(),records=[];
 return {records,operations,claimPriceAlerts:async()=>[alert],priceAlertCurrent:async()=>true,priceAlert:async value=>value===alert.id?alert:null,
  conversation:async()=>({id:alert.conversation_id,line:'test',sender_id:'tester'}),operation:async op=>operations.get(op),
  reserve:async(conversation_id,op,body)=>{if(operations.has(op))return false;operations.set(op,{conversation_id,body,status:'sending'});return true;},finish:async(op,status)=>{operations.get(op).status=status;},
  recordPriceCheck:async(_id,_revision,result,notified,baselines,links)=>{records.push({result,notified,baselines,links});alert.last_result=result;alert.last_checked_at=new Date().toISOString();if(baselines)alert.baselines=baselines;if(links)alert.links=links;}};
}
const cronReq={method:'GET',headers:{authorization:'Bearer test-cron-secret'}};
const response=()=>({setHeader(){},end(body){this.body=JSON.parse(body);}});
const cronEnv={CRON_SECRET:'test-cron-secret',PRICE_ALERTS_ENABLED:'true'};

test('scheduled checks notify once on restock and keep the reference price',async()=>{
 const alert=alertWith({baselines:[{...offer(100,{available:false}),drop_percent:0}]});
 const store=cronStore(alert);let offers=[offer(100,{available:false})];const bodies=[];
 const handler=createPriceChecksHandler({env:cronEnv,storeFactory:()=>store,inspect:async()=>({checks:checks(...offers)}),discover:async()=>({status:'unavailable',links:[],checks:[]}),send:async(_d,body)=>{bodies.push(body);}});
 await handler(cronReq,response());assert.equal(bodies.length,0);assert.equal(store.records.at(-1).result.stock,'sold_out');
 offers=[offer(100)];await handler(cronReq,response());assert.equal(bodies.length,1);assert.match(bodies[0],/back in stock/i);
 assert.equal(store.records.at(-1).result.event,'restock');assert.equal(store.records.at(-1).notified,true);assert.equal(alert.baselines[0].amount,100);
 await handler(cronReq,response());assert.equal(bodies.length,1,'staying in stock is not another restock');
});

test('repeated failures trigger store discovery, and a found store can satisfy the watch',async()=>{
 const alert=alertWith({links:[{url:home}],baselines:[]});
 const found='https://www.nordstrom.com/s/jacket/1';const store=cronStore(alert);let discoveries=0,sends=0;
 const handler=createPriceChecksHandler({env:cronEnv,storeFactory:()=>store,
  inspect:async links=>({checks:links.map(l=>l.url===found?{url:found,status:'checked',offers:[offer(90,{url:found})]}:{url:l.url,status:'unavailable',offers:[]})}),
  discover:async(_alert,_checks,{env,sizes})=>{discoveries++;assert.equal(env.SHOPPING_COUNTRY,'US');assert.deepEqual(sizes,['M']);
   return discoveries<2?{status:'completed',links:[],checks:[],candidates:0,searches:1}:{status:'completed',links:[{url:found,discovered_at:'2026-10-13T00:00:00Z'}],checks:[{url:found,status:'checked',offers:[offer(90,{url:found})]}],candidates:1,searches:3};},
  send:async()=>{sends++;}});
 await handler(cronReq,response());assert.equal(discoveries,1,'first check searches once (weekly cadence)');
 await handler(cronReq,response());assert.equal(discoveries,1,'a recent search is not repeated before recovery is needed');assert.equal(store.records.at(-1).result.failures,2);
 alert.last_result.discovered_at=new Date(Date.now()-2*864e5).toISOString();
 await handler(cronReq,response());assert.equal(store.records.at(-1).result.failures,0,'a found store ends the failure streak');
 assert.equal(discoveries,2,'the third failure searches again');
 assert.equal(alert.links.length,2);assert.equal(store.records.at(-1).result.status,'baseline_established');assert.equal(alert.baselines[0].url,found);assert.equal(sends,0);
});

const post=(input,auth=200)=>({req:{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer owner'},async *[Symbol.asyncIterator](){yield Buffer.from(JSON.stringify(input));}},admin:async()=>auth});

test('owner simulation runs the real decision without changing the alert or sending by default',async()=>{
 const alert=alertWith();const store=cronStore(alert);let sends=0;
 const run=async(input,{auth=200,conversation}={})=>{const {req,admin}=post(input,auth);const res=response();
  await createPriceChecksHandler({env:{PRICE_ALERT_TEST_CONVERSATION_ID:conversation},storeFactory:()=>store,admin,send:async()=>{sends++;}})(req,res);return res;};
 assert.equal((await run({alert_id:id,offers:[]},{auth:403})).statusCode,403);
 const dry=await run({alert_id:id,offers:[{url:home,size:'M',amount:80,currency:'USD',available:true}]});
 assert.equal(dry.statusCode,200);assert.equal(dry.body.event,'price_drop');assert.match(dry.body.message,/\$80/);
 assert.equal(store.records.length,0);assert.equal(sends,0);
 const restock=await run({alert_id:id,previous_stock:'sold_out',offers:[{url:home,size:'M',amount:100,currency:'USD',available:true}]});
 assert.equal(restock.body.event,'restock');
 assert.equal((await run({alert_id:id,offers:[{url:'https://example.com/x',size:'M',amount:1,currency:'USD',available:true}]})).statusCode,400);
 assert.equal((await run({alert_id:id,deliver:true,offers:[{url:home,size:'M',amount:80,currency:'USD',available:true}]})).statusCode,403,'only the designated test conversation receives test sends');
 alert.conversation_id=testConversation;
 const sent=await run({alert_id:id,deliver:true,offers:[{url:home,size:'M',amount:80,currency:'USD',available:true}]},{conversation:testConversation});
 assert.equal(sent.body.delivery,'sent');assert.equal(sends,1);assert.match([...store.operations.values()][0].body,/^\[test alert/);
 assert.equal(store.records.length,0);
});

test('chat status reports the persisted monitoring state without overstating it',async()=>{
 const {alertState}=await import('../lib/inbox.js');
 const links=[{url:home},{url:other}];
 assert.match(alertState({links,baselines:[]}),/waiting for a verified price.*not checked yet/);
 assert.match(alertState({links,baselines:[offer(100)],last_result:{status:'check_failed',failures:3},last_checked_at:'2026-10-12T13:00:00Z'}),/couldn’t read any of the 2 stores on the last 3 checks/);
 const watching=alertState({links,baselines:[offer(100)],last_result:{status:'no_drop',stock:'sold_out',unconfirmed_savings:[{url:other,amount:60,currency:'USD'}]},last_checked_at:'2026-10-12T13:00:00Z'});
 assert.match(watching,/watching 2 stores; reference price \$100\.00 at barbour\.com\. your size was sold out\./);
 assert.match(watching,/nordstrom\.com listed it for \$60\.00, but i couldn’t confirm its shipping/);
});

test('a store search that cannot run records why and waits a day before retrying',async()=>{
 const alert={id,name:'Quilted vest',size:'M',links:[{url:home,name:'Quilted vest'}]};
 assert.equal((await discoverAlertLinks(alert,[],{env:{},sizes:['M']})).reason,'not_configured');
 const failing=async()=>new Response(JSON.stringify({error:'Invalid API key'}),{status:401});
 assert.equal((await discoverAlertLinks(alert,[],{env:{...env,SERPAPI_API_KEY:'discovery-fail'},fetcher:failing,sizes:['M']})).reason,'search_failed');
 const now=Date.parse('2026-10-13T12:00:00Z');
 const recent={links:[{url:home}],last_result:{discovery:{status:'unavailable',reason:'search_failed',attempted_at:'2026-10-13T00:00:00Z'}}};
 assert.equal(discoveryDue(recent,{now}),false);assert.equal(discoveryDue(recent,{now,recovery:true}),false);
 assert.equal(discoveryDue(recent,{now:now+864e5}),true);
});

test('scheduled checks persist the discovery outcome and chat status explains a failed search',async()=>{
 const alert=alertWith({links:[{url:home}]});const store=cronStore(alert);
 const handler=createPriceChecksHandler({env:cronEnv,storeFactory:()=>store,inspect:async()=>({checks:checks(offer(100))}),discover:async()=>({status:'unavailable',reason:'not_configured',links:[],checks:[]}),send:async()=>{}});
 await handler(cronReq,response());
 const result=store.records.at(-1).result;
 assert.equal(result.discovery.status,'unavailable');assert.equal(result.discovery.reason,'not_configured');assert.ok(result.discovery.attempted_at);assert.equal(result.discovered_at,undefined);
 const {alertState}=await import('../lib/inbox.js');
 assert.match(alertState({...alert,last_result:result,last_checked_at:new Date().toISOString()}),/couldn’t search for other stores/);
});

test('duplicate store links collapse to one page while keeping evidence and distinct variants',async()=>{
 const {uniqueAlertLinks}=await import('../lib/alert-links.js');
 const links=uniqueAlertLinks([
  {url:'https://www.barbour.com/us/jacket-MWX1.html',requested_sizes:['L']},
  {url:'https://barbour.com/jacket-MWX1.html?utm_source=x',requested_sizes:['UK L']},
  {url:'https://www.barbour.com/jacket-MWX1.html?color=olive'},
  {url:'https://deeceestyle.ch/jacket'},
 ]);
 assert.equal(links.length,3);assert.deepEqual(links[0].requested_sizes,['L','UK L']);assert.equal(links[0].url,'https://www.barbour.com/us/jacket-MWX1.html');
 // The scheduler saves the de-duplicated list.
 const alert=alertWith({links:[{url:home},{url:home+'?utm_campaign=sale'},{url:other}]});const store=cronStore(alert);
 await createPriceChecksHandler({env:cronEnv,storeFactory:()=>store,inspect:async links=>{assert.equal(links.length,2);return {checks:checks(offer(100))};},discover:async()=>({status:'unavailable',reason:'not_configured',links:[],checks:[]}),send:async()=>{}})(cronReq,response());
 assert.deepEqual(store.records.at(-1).links.map(l=>l.url),[home,other]);
});

test('the owner rehearsal form lists only the designated test conversation’s alerts',async()=>{
 const alert=alertWith({conversation_id:testConversation,last_result:{stock:'in_stock'}});const store=cronStore(alert);let asked;
 store.priceAlerts=async conversation=>{asked=conversation;return [alert];};
 const {req,admin}=post({action:'list'});const res=response();
 await createPriceChecksHandler({env:{PRICE_ALERT_TEST_CONVERSATION_ID:testConversation},storeFactory:()=>store,admin})(req,res);
 assert.equal(asked,testConversation);assert.equal(res.body.alerts[0].id,id);assert.deepEqual(res.body.alerts[0].links,[home,other]);assert.equal(res.body.alerts[0].stock,'in_stock');
 const missing=response();const second=post({action:'list'});
 await createPriceChecksHandler({env:{},storeFactory:()=>store,admin:second.admin})(second.req,missing);assert.equal(missing.statusCode,503);
});

test('alert texts read like a person: whole prices, color as "in", honest percent, link last',()=>{
 const prada='https://www.prada.com/us/en/p/speedrock/2EE469_D7C_F0304_F_G000';
 const alert={id,name:'Prada Speedrock Re-Nylon and suede sneakers · Ivory',size:'Prada 12',links:[{url:prada}],baselines:[{...offer(1170,{size:'Prada 12',url:prada}),drop_percent:10}]};
 const body=decidePriceCheck(alert,[{url:prada,status:'checked',offers:[offer(800,{size:'Prada 12',url:prada})]}]).event.body;
 assert.equal(body,'🚨 price drop on your saved Prada Speedrock Re-Nylon and suede sneakers in Ivory. your size is available now for $800 (was $1,170, 31% off). shipping and other fees not included.\n'+prada);
 // Cents stay when present, and a sub-1% drop gets no percent rather than "0% off".
 const small=decidePriceCheck({...alert,baselines:[{...alert.baselines[0],drop_percent:0}]},[{url:prada,status:'checked',offers:[offer(1165.5,{size:'Prada 12',url:prada})]}]).event.body;
 assert.match(small,/for \$1,165\.50 \(was \$1,170\)\./);
});
