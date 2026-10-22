import {test} from 'node:test';
import assert from 'node:assert/strict';
import {alertSummary,alertKind,TAP_WINDOW} from '../lib/alert-metrics.js';
import {deliverReply} from '../lib/replies.js';
import {createGoHandler,readGoLink} from '../lib/adoption-events.js';
import {createPriceChecksHandler,alertResult} from '../api/price-checks.js';

const A='00000000-0000-4000-8000-00000000000a',B='00000000-0000-4000-8000-00000000000b',alertId='00000000-0000-4000-8000-000000000001',itemId='00000000-0000-4000-8000-0000000000c1';
const env={SITE_ORIGIN:'https://jules.example',SUPABASE_SERVICE_ROLE_KEY:'secret'};
const ssense='https://www.ssense.com/en-us/men/product/our-legacy/third-cut/1';
const now=Date.parse('2026-10-22T12:00:00Z'),at=hours=>new Date(now-hours*3600000).toISOString();
const text=(op,extra={})=>({conversation_id:A,operation_id:op,status:'sent',created_at:at(48),...extra});

test('alert numbers count each kind’s texts, deliveries, taps within 7 days, replies within a day and purchases within 14 days',()=>{
 const texts=[text(`price-alert:${alertId}:r:low-stock:e1`,{kind:'low_stock',item_id:itemId}),text(`price-alert:${alertId}:r:abc`,{kind:'price_drop',conversation_id:B,created_at:at(30)}),
  text(`price-alert:${alertId}:r:def`,{kind:'price_drop',status:'blocked'}),text(`price-alert:${alertId}:r:old`,{created_at:at(24*40)})];
 const summary=alertSummary({texts,
  clicks:[{conversation_id:A,ref:texts[0].operation_id,created_at:at(47)},{conversation_id:A,ref:texts[0].operation_id,created_at:at(46)},{conversation_id:B,ref:texts[1].operation_id,created_at:new Date(Date.parse(at(30))+TAP_WINDOW+1).toISOString()}],
  inbound:[{conversation_id:A,created_at:at(40)},{conversation_id:B,created_at:at(31)}],
  alerts:[{id:alertId,item_id:itemId}],bought:[{item_id:itemId,at:at(20)}]},{now,tracking:true});
 const low=summary.kinds.find(k=>k.kind==='low_stock'),drop=summary.kinds.find(k=>k.kind==='price_drop');
 assert.deepEqual([low.texts,low.sent,low.tapped,low.tap_rate,low.replied,low.bought],[1,1,1,1,1,1],'two taps on one text count once');
 assert.deepEqual([drop.texts,drop.sent,drop.blocked,drop.tapped,drop.replied],[2,1,1,0,0],'a tap after 7 days and a reply before the text don’t count; a STOP-blocked text is not delivered');
 assert.equal(summary.totals.texts,3,'texts older than 30 days are left out');
 assert.deepEqual(summary.recent.map(r=>r.kind),['price_drop','low_stock','price_drop']);
});

test('without link tracking the tap rate is unknown, not zero, and texts before kinds were stored are named honestly',()=>{
 const summary=alertSummary({texts:[text(`price-alert:${alertId}:r:abc`)]},{now,tracking:false});
 assert.equal(summary.totals.tap_rate,null);assert.equal(summary.kinds[0].kind,'earlier');
 assert.equal(alertKind({operation_id:`price-alert:${alertId}:r:low-stock:e1`}),'low_stock');
 assert.equal(alertSummary({texts:[text(`price-alert-test:${alertId}:x`)]},{now}).totals.texts,0,'admin test texts are left out');
});

test('an alert text stores which alert it was and sends its store link as a tracked Jules link that forwards to the store',async()=>{
 const results=new Map(),bodies=[],prepared=[],recorded=[];
 const store={reserve:async()=>true,searchResult:async(op,result)=>{results.set(op,result);},prepareAI:async(op,body)=>{prepared.push(body);},finish:async()=>{},
  replyResult:async op=>results.has(op)?{conversation_id:A,search_result:results.get(op)}:null,recordAdoptionEvent:async row=>{recorded.push(row);}};
 const alert={id:alertId,item_id:itemId,name:'Third Cut Jeans'},operation=`price-alert:${alertId}:r:low-stock:e1`;
 const body=`heads up: SSENSE shows only 1 left of your saved Third Cut Jeans, size 32.\n${ssense}`;
 const sent=await deliverReply({store,send:async(_d,b)=>{bodies.push(b);return {id:'p1'};},conversation:{id:A,line:'l',sender_id:'s'},operation,body,source:'operator',env,purpose:'price_alert',
  compose:async({draft})=>({body:draft,composed:false}),result:alertResult(alert,'low_stock',body)});
 assert.equal(sent.status,'sent');
 assert.deepEqual(results.get(operation).alert,{id:alertId,item_id:itemId,kind:'low_stock'});
 const link=bodies[0].split('\n')[1];
 assert.match(link,/^https:\/\/jules\.example\/go\//);assert.ok(!bodies[0].includes(ssense),'the store link is behind the tracked link');assert.equal(prepared.at(-1),bodies[0],'the stored text is what was sent');
 const res={headers:{},setHeader(k,v){this.headers[k]=v;},end(){}};
 await createGoHandler({env:{...env,LINK_CLICK_TRACKING:'true'},store})({method:'GET',url:`/api/image?go=${encodeURIComponent(link.split('/go/')[1])}`,headers:{'user-agent':'Mozilla/5.0 (iPhone)'}},res);
 assert.equal(res.statusCode,302);assert.equal(res.headers.Location,ssense);
 assert.deepEqual(recorded,[{quantity:1,conversation_id:A,kind:'link_click',ref:operation}]);
 assert.equal(readGoLink(link.split('/go/')[1],env).operation,operation);
});

test('without a stored result (or before tracking is configured) the alert keeps its plain store link',async()=>{
 const bodies=[];const body=`heads up: SSENSE shows only 1 left.\n${ssense}`;
 const store={reserve:async()=>true,searchResult:async()=>{throw new Error('down');},prepareAI:async()=>{},finish:async()=>{}};
 const log=console.log;console.log=()=>{};
 try{await deliverReply({store,send:async(_d,b)=>{bodies.push(b);},conversation:{id:A},operation:'price-alert:x',body,source:'operator',env,compose:async({draft})=>({body:draft}),result:alertResult({id:alertId,name:'Jeans'},'low_stock',body)});}finally{console.log=log;}
 assert.equal(bodies[0],body);
});

test('scheduled alert texts carry their kind, including a price drop that also reports low stock',async()=>{
 const results=new Map(),sent=[];
 const alert={id:alertId,revision:alertId,conversation_id:A,item_id:itemId,active:true,name:'Third Cut Jeans',size:'32',links:[{url:ssense}],baselines:[{url:ssense,size:'32',key:'32',amount:290,currency:'USD',available:true,drop_percent:0}]};
 const store={claimPriceAlerts:async()=>[alert],priceAlertCurrent:async()=>true,conversation:async()=>({id:A,line:'l',sender_id:'s'}),operation:async()=>null,reserve:async()=>true,finish:async()=>{},prepareAI:async()=>{},
  searchResult:async(op,r)=>{results.set(op,r);},recordPriceCheck:async(_i,_r,result)=>{alert.last_result=result;}};
 const handler=createPriceChecksHandler({env:{CRON_SECRET:'c',PRICE_ALERTS_ENABLED:'true',PRICE_ALERT_DISCOVERY:'false'},storeFactory:()=>store,
  inspect:async()=>({checks:[{url:ssense,status:'checked',offers:[{url:ssense,size:'32',key:'32',amount:250,currency:'USD',available:true,quantity:1,quantity_source:'ssense_size_menu'}]}]}),
  discover:async()=>({status:'unavailable',links:[],checks:[]}),send:async(_d,b)=>{sent.push(b);}});
 const log=console.log;console.log=()=>{};
 try{await handler({method:'GET',headers:{authorization:'Bearer c'}},{setHeader(){},end(){}});}finally{console.log=log;}
 assert.equal(sent.length,1);
 const [stored]=[...results.values()];assert.deepEqual(stored.alert,{id:alertId,item_id:itemId,kind:'price_drop+low_stock'});
 assert.deepEqual(stored.products.map(p=>[p.url,p.retailer]),[[ssense,'SSENSE']]);
});
