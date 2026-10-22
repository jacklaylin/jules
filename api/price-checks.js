// Loads first so the cost meter wraps fetch before any handler below keeps a reference to it.
import '../lib/usage.js';
import { composeReply } from '../lib/compose.js';
const TEST_LABEL='[test alert — not a real price]\n',LOW_STOCK_TEST_LABEL='[test alert — not real stock]\n';
import { timingSafeEqual, randomUUID } from 'node:crypto';
import { createStore } from '../lib/store.js';
import { inspectAlertLinks, sizeKey } from '../lib/price-alerts.js';
import { uniqueAlertLinks } from '../lib/alert-links.js';
import { decidePriceCheck, alertSizes } from '../lib/alert-decision.js';
import { discoverAlertLinks, discoveryDue } from '../lib/alert-discovery.js';
import { decideLowStock, lowStockRecord, lowStockMessage, withLowStock, storeName } from '../lib/low-stock.js';
import { marketEnvironment } from '../lib/shopping-market.js';
import { withUsage } from '../lib/usage.js';
import { tagWishlist } from '../lib/wishlist-tags.js';
import { recordJobRun } from '../lib/jobs.js';
import { checkCaps, logCapReached } from '../lib/cost-caps.js';
import { deliverReply } from '../lib/replies.js';
import { sendGreeting } from '../lib/photon.js';
import { authorize } from '../lib/auth.js';
import { json, readJson, uuid } from '../lib/http.js';
export const config={maxDuration:120};
// Store discovery spends paid searches, so each run bounds how many alerts may search.
const DISCOVERIES_PER_RUN=10;
const persisted=({market_country,market_currency,watched_sizes,...link})=>link;

// Stored with each alert text (messages.search_result): which alert and kind it was, for Admin › Adoption's
// alert numbers, and the store links it carried, which become tracked /go/ links so a tap is counted.
export function alertResult(alert,kind,body){
  const urls=[...new Set((String(body).match(/https:\/\/\S+/g)??[]).map(u=>u.replace(/[).,!?;:’”"']+$/,'')))];
  return {alert:{id:alert.id,item_id:alert.item_id??null,kind},products:urls.map(url=>({url,name:alert.name,retailer:storeName(url)}))};
}
export async function checkAlert(alert,{store,env,inspect,discover,send,discoveries}){
  const market=marketEnvironment((await store.profile?.(alert.conversation_id))?.facts??[],env),country=market.SHOPPING_COUNTRY;
  const withMarket=link=>({...link,market_country:country,market_currency:market.SHOPPING_CURRENCY,watched_sizes:link.requested_sizes??[alert.size]});
  const unique=uniqueAlertLinks(alert.links);let links=unique.length<alert.links.length?unique:undefined,discovery;
  if(links)alert={...alert,links};
  let {checks}=await withUsage({store,env,conversation:alert.conversation_id,operation:`price-check:${alert.id}:${new Date().toISOString().slice(0,10)}`,feature:'price_alerts',quiet:true},()=>inspect(alert.links.map(withMarket)));
  let decision=decidePriceCheck(alert,checks,{country});
  // Look for other stores weekly, and sooner when every watched store keeps failing.
  if(env.PRICE_ALERT_DISCOVERY!=='false'&&discoveries.remaining>0&&discoveryDue(alert,{recovery:decision.needs_recovery})){
    discoveries.remaining--;
    discovery=await withUsage({store,env,conversation:alert.conversation_id,operation:`price-discovery:${alert.id}:${new Date().toISOString().slice(0,10)}`,feature:'price_alerts'},
      ()=>discover(alert,checks,{env:market,sizes:alertSizes(alert)}));
    if(discovery.links.length){
      links=[...alert.links,...discovery.links];checks=[...checks,...discovery.checks];
      decision=decidePriceCheck({...alert,links},checks,{country});
    }
  }
  // Low stock (lib/low-stock.js): verified 1–3 left, once per episode. It joins a price-drop or restock
  // text from the same check, or goes out on its own as a price alert (operation prefix price-alert:).
  const watched=links??alert.links,low=decideLowStock(alert,checks,{sizes:alertSizes(alert),urls:watched.map(l=>l.url),readable:checks.some(c=>c.status==='checked')});
  const lowOn=alert.low_stock_alerts!==false,lowSend=low.would_send&&lowOn;
  let status=decision.status,baselines=decision.establish??undefined,delivery=null,duplicate=false,lowDelivery=null;
  const deliver=async(operation,body,kind)=>{
    const conversation=await store.conversation(alert.conversation_id);
    const existing=await store.operation(operation);
    return existing?{status:existing.status,duplicate:true}:await deliverReply({store,send,conversation,operation,body,source:'operator',env,purpose:'price_alert',result:alertResult(alert,kind,body)});
  };
  if(decision.event&&await store.priceAlertCurrent(alert.id,alert.revision)){
    const result=await deliver(`price-alert:${alert.id}:${alert.revision}:${decision.event.fingerprint}`,lowSend?withLowStock(decision.event.body,low.lowest):decision.event.body,decision.event.kind+(lowSend?'+low_stock':''));
    delivery=result.status;duplicate=Boolean(result.duplicate);if(lowSend)lowDelivery=delivery;
    if(result.status==='sent'&&decision.after_send)baselines=decision.after_send;
  }else if(lowSend&&!decision.event&&await store.priceAlertCurrent(alert.id,alert.revision)){
    const result=await deliver(`price-alert:${alert.id}:${alert.revision}:low-stock:${low.episode.id}`,lowStockMessage(alert,low.lowest),'low_stock');
    lowDelivery=delivery=result.status;duplicate=Boolean(result.duplicate);
  }
  const lowStock=lowStockRecord(low,{event:decision.event?.kind,delivery:lowDelivery,turned_off:low.would_send&&!lowOn});
  console.log(JSON.stringify({event:'low_stock_check',alert_id:alert.id,state:lowStock.state,reason:lowStock.reason,would_send:lowStock.would_send,sent:lowStock.sent,
    ...(lowStock.combine_with?{combine_with:lowStock.combine_with}:{}),evidence:lowStock.evidence.map(e=>({store:storeName(e.url),size:e.size,quantity:e.quantity,source:e.source})),episode_started_at:lowStock.episode?.started_at??null}));
  const result={status,event:decision.event?.kind??(lowStock.sent?'low_stock':null),delivery,checks,...decision.record,low_stock:lowStock,
    discovered_at:discovery?.status==='completed'?new Date().toISOString():alert.last_result?.discovered_at,
    discovery:!discovery?alert.last_result?.discovery:discovery.status==='completed'
      ?{status:'completed',attempted_at:new Date().toISOString(),candidates:discovery.candidates,added:discovery.links.length,searches:discovery.searches}
      :{status:'unavailable',reason:discovery.reason??'unknown',attempted_at:new Date().toISOString()}};
  await store.recordPriceCheck(alert.id,alert.revision,result,['sent','uncertain','sending'].includes(delivery),baselines,links?.map(persisted));
  return {status,delivery,duplicate};
}

// Owner-only rehearsal: run the real decision on supplied offers without touching the alert.
// Delivery is limited to the designated test conversation and always labelled as a test.
// The designated test conversation's alerts, for the owner's rehearsal form.
async function testAlerts(res,{env,store}){
  if(!env.PRICE_ALERT_TEST_CONVERSATION_ID)return json(res,503,{error:'Set PRICE_ALERT_TEST_CONVERSATION_ID to rehearse alerts.'});
  const alerts=await store.priceAlerts(env.PRICE_ALERT_TEST_CONVERSATION_ID);
  return json(res,200,{alerts:alerts.map(a=>({id:a.id,name:a.name,size:a.size,active:a.active,links:(a.links??[]).map(l=>l.url),
    baselines:(a.baselines??[]).map(({amount,currency,url,available})=>({amount,currency,url,available})),stock:a.last_result?.stock??null}))});
}
async function simulate(req,res,{env,store,send}){
  const input=await readJson(req);
  if(input.action==='list')return testAlerts(res,{env,store});
  if(!uuid(input.alert_id))return json(res,400,{error:'Invalid alert.'});
  const alert=await store.priceAlert(input.alert_id);
  if(!alert)return json(res,404,{error:'Alert not found.'});
  const urls=alert.links.map(l=>l.url);
  if(!Array.isArray(input.offers)||input.offers.length>50)return json(res,400,{error:'Provide up to 50 offers.'});
  const market=marketEnvironment((await store.profile?.(alert.conversation_id))?.facts??[],env),country=market.SHOPPING_COUNTRY;
  const offers=[];
  for(const o of input.offers){
    if(!o||!urls.includes(o.url)||typeof o.size!=='string'||!o.size.trim()||o.size.length>80||!(Number(o.amount)>0)||!/^[A-Z]{3}$/.test(o.currency??'')||typeof o.available!=='boolean'||o.shipping!==undefined&&!(Number(o.shipping)>=0)||o.quantity!==undefined&&!(Number.isInteger(o.quantity)&&o.quantity>=0&&o.quantity<=999))
      return json(res,400,{error:'Each offer needs a watched url, size, amount, currency and available.'});
    offers.push({url:o.url,size:o.size,key:sizeKey(o.size),name:alert.name,amount:Number(o.amount),currency:o.currency,available:o.available,checked_at:new Date().toISOString(),simulated:true,
      ...(o.quantity!==undefined?{quantity:o.quantity,quantity_source:'rehearsal'}:{}),
      ...(o.shipping!==undefined?{shipping:[{countries:[country],amount:Number(o.shipping),currency:o.currency}]}:{})});
  }
  const previous=['sold_out','in_stock','unknown'].includes(input.previous_stock)?{...alert,last_result:{...alert.last_result,stock:input.previous_stock}}:alert;
  const decision=decidePriceCheck(previous,[{url:'simulation',status:'checked',offers}],{country});
  // Low stock is rehearsed with the same decision: a typed count, and the episode as recorded or as chosen.
  const episode=input.low_stock_episode==='open'?{started_at:new Date().toISOString(),url:urls[0],size:alert.size,key:sizeKey(alert.size),quantity:1}:input.low_stock_episode==='none'?null:undefined;
  const lowAlert=episode===undefined?alert:{...alert,last_result:{...alert.last_result,low_stock:{...alert.last_result?.low_stock,episode}}};
  const low=decideLowStock(lowAlert,[{url:'simulation',status:'checked',offers}],{sizes:alertSizes(alert),urls,readable:true});
  const lowSend=low.would_send&&alert.low_stock_alerts!==false;
  const body=decision.event?(lowSend?withLowStock(decision.event.body,low.lowest):decision.event.body):lowSend?lowStockMessage(alert,low.lowest):null;
  const low_stock={state:low.state,reason:low.would_send&&!lowSend?'turned_off':low.reason,would_send:lowSend,combined:Boolean(lowSend&&decision.event)};
  let delivery=null;
  if(input.deliver===true&&body){
    if(!env.PRICE_ALERT_TEST_CONVERSATION_ID||alert.conversation_id!==env.PRICE_ALERT_TEST_CONVERSATION_ID)return json(res,403,{error:'Test delivery is limited to the designated test conversation.'});
    const conversation=await store.conversation(alert.conversation_id),label=decision.event?TEST_LABEL:LOW_STOCK_TEST_LABEL;
    delivery=(await deliverReply({store,send,conversation,operation:`price-alert-test:${alert.id}:${randomUUID()}`,body:label+body,source:'operator',env,purpose:'price_alert',result:alertResult(alert,decision.event?.kind??'low_stock',body),
      // The label is re-added after composing, so the test shows the exact message a user would get.
      compose:async args=>{const c=await composeReply({...args,draft:body});return c.composed?{...c,body:label+c.body}:{...c,body:args.draft};}})).status;
  }
  return json(res,200,{status:decision.status,event:decision.event?.kind??(lowSend?'low_stock':null),message:body,next_baselines:decision.after_send??decision.establish??null,record:decision.record,delivery,low_stock});
}

export function createPriceChecksHandler({env=process.env,storeFactory=createStore,inspect=inspectAlertLinks,discover=discoverAlertLinks,send=sendGreeting,admin=authorize}={}){
  return async(req,res)=>{
    if(req.method==='POST'){
      const access=await admin(req.headers,env);
      if(access!==200)return json(res,access,{error:'Owner access required.'});
      try{return await simulate(req,res,{env,store:storeFactory(env),send});}
      catch(error){return json(res,error.status??503,{error:error.status?error.message:'Simulation failed.'});}
    }
    const expected=env.CRON_SECRET&&Buffer.from(`Bearer ${env.CRON_SECRET}`),received=Buffer.from(req.headers.authorization??'');
    if(!expected||received.length!==expected.length||!timingSafeEqual(received,expected))return json(res,401,{error:'Unauthorized.'});
    if(req.method!=='GET')return json(res,405,{error:'Method not allowed.'});
    const started=Date.now();
    if(env.PRICE_ALERTS_ENABLED!=='true'){await recordJobRun((()=>{try{return storeFactory(env);}catch{return null;}})(),'price_checks',started,'skipped',{reason:'disabled'});return json(res,503,{error:'Price alerts disabled.'});}
    let store;
    try{
      store=storeFactory(env);const alerts=await store.claimPriceAlerts();let sent=0,failed=0,capped=0;const discoveries={remaining:DISCOVERIES_PER_RUN},statuses={};
      // Each alert's calls (the text it composes, any store search) are metered to the user and to this job.
      // A person over a spending cap (lib/cost-caps.js) is skipped; the alert stays on and is checked on a later run.
      for(let offset=0;offset<alerts.length;offset+=5)await Promise.all(alerts.slice(offset,offset+5).map(async alert=>{try{
        const cap=await checkCaps(store,alert.conversation_id,env);
        if(cap.capped){capped++;logCapReached(cap,'price_checks');return;}
        const result=await withUsage({store,env,conversation:alert.conversation_id,operation:`price-check:${alert.id}:${new Date().toISOString().slice(0,10)}`,feature:'price_alerts',job:'price_checks',quiet:true},
          ()=>checkAlert(alert,{store,env,inspect,discover,send,discoveries}));
        statuses[result.status]=(statuses[result.status]??0)+1;
        if(result.delivery==='sent'&&!result.duplicate)sent++;
      }catch{failed++;console.log(JSON.stringify({event:'price_alert_check_failed',alert_id:alert.id}));}}));
      console.log(JSON.stringify({event:'price_alert_checks',checked:alerts.length-capped,sent,failed,capped,statuses,discoveries:DISCOVERIES_PER_RUN-discoveries.remaining}));
      // Once a day, tag wishlist saves not tagged yet (lib/wishlist-tags.js), so brand taste knows what kind of
      // item each was. Best effort and capped per person; it never fails the job.
      let tagged=0;
      if(store.untaggedWishlistOwners)for(const owner of await store.untaggedWishlistOwners().catch(()=>[])){
        if((await checkCaps(store,owner,env).catch(()=>({capped:true}))).capped)continue;
        tagged+=(await tagWishlist(store,owner,env)).tagged;
      }
      await recordJobRun(store,'price_checks',started,failed?'failed':'ok',{checked:alerts.length-capped,sent,failed,capped,discoveries:DISCOVERIES_PER_RUN-discoveries.remaining,wishlist_tagged:tagged});
      return json(res,failed?503:200,{checked:alerts.length-capped,sent,failed,capped});
    }catch{await recordJobRun(store,'price_checks',started,'failed');return json(res,503,{error:'Price checks failed.'});}
  };
}
export default createPriceChecksHandler();
