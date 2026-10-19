import { composeReply } from '../lib/compose.js';
const TEST_LABEL='[test alert — not a real price]\n';
import { timingSafeEqual, randomUUID } from 'node:crypto';
import { createStore } from '../lib/store.js';
import { inspectAlertLinks, sizeKey } from '../lib/price-alerts.js';
import { uniqueAlertLinks } from '../lib/alert-links.js';
import { decidePriceCheck, alertSizes } from '../lib/alert-decision.js';
import { discoverAlertLinks, discoveryDue } from '../lib/alert-discovery.js';
import { marketEnvironment } from '../lib/shopping-market.js';
import { withUsage } from '../lib/usage.js';
import { deliverReply } from '../lib/replies.js';
import { sendGreeting } from '../lib/photon.js';
import { authorize } from '../lib/auth.js';
import { json, readJson, uuid } from '../lib/http.js';
export const config={maxDuration:120};
// Store discovery spends paid searches, so each run bounds how many alerts may search.
const DISCOVERIES_PER_RUN=10;
const persisted=({market_country,market_currency,...link})=>link;

export async function checkAlert(alert,{store,env,inspect,discover,send,discoveries}){
  const market=marketEnvironment((await store.profile?.(alert.conversation_id))?.facts??[],env),country=market.SHOPPING_COUNTRY;
  const withMarket=link=>({...link,market_country:country,market_currency:market.SHOPPING_CURRENCY});
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
  let status=decision.status,baselines=decision.establish??undefined,delivery=null,duplicate=false;
  if(decision.event&&await store.priceAlertCurrent(alert.id,alert.revision)){
    const conversation=await store.conversation(alert.conversation_id);
    const operation=`price-alert:${alert.id}:${alert.revision}:${decision.event.fingerprint}`;
    const existing=await store.operation(operation);
    const result=existing?{status:existing.status,duplicate:true}:await deliverReply({store,send,conversation,operation,body:decision.event.body,source:'operator',env,purpose:'price_alert'});
    delivery=result.status;duplicate=Boolean(result.duplicate);
    if(result.status==='sent'&&decision.after_send)baselines=decision.after_send;
  }
  const result={status,event:decision.event?.kind??null,delivery,checks,...decision.record,
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
    if(!o||!urls.includes(o.url)||typeof o.size!=='string'||!o.size.trim()||o.size.length>80||!(Number(o.amount)>0)||!/^[A-Z]{3}$/.test(o.currency??'')||typeof o.available!=='boolean'||o.shipping!==undefined&&!(Number(o.shipping)>=0))
      return json(res,400,{error:'Each offer needs a watched url, size, amount, currency and available.'});
    offers.push({url:o.url,size:o.size,key:sizeKey(o.size),name:alert.name,amount:Number(o.amount),currency:o.currency,available:o.available,checked_at:new Date().toISOString(),simulated:true,
      ...(o.shipping!==undefined?{shipping:[{countries:[country],amount:Number(o.shipping),currency:o.currency}]}:{})});
  }
  const previous=['sold_out','in_stock','unknown'].includes(input.previous_stock)?{...alert,last_result:{...alert.last_result,stock:input.previous_stock}}:alert;
  const decision=decidePriceCheck(previous,[{url:'simulation',status:'checked',offers}],{country});
  let delivery=null;
  if(input.deliver===true&&decision.event){
    if(!env.PRICE_ALERT_TEST_CONVERSATION_ID||alert.conversation_id!==env.PRICE_ALERT_TEST_CONVERSATION_ID)return json(res,403,{error:'Test delivery is limited to the designated test conversation.'});
    const conversation=await store.conversation(alert.conversation_id);
    delivery=(await deliverReply({store,send,conversation,operation:`price-alert-test:${alert.id}:${randomUUID()}`,body:TEST_LABEL+decision.event.body,source:'operator',env,purpose:'price_alert',
      // The label is re-added after composing, so the test shows the exact message a user would get.
      compose:async args=>{const c=await composeReply({...args,draft:decision.event.body});return c.composed?{...c,body:TEST_LABEL+c.body}:{...c,body:args.draft};}})).status;
  }
  return json(res,200,{status:decision.status,event:decision.event?.kind??null,message:decision.event?.body??null,next_baselines:decision.after_send??decision.establish??null,record:decision.record,delivery});
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
    if(env.PRICE_ALERTS_ENABLED!=='true')return json(res,503,{error:'Price alerts disabled.'});
    try{
      const store=storeFactory(env),alerts=await store.claimPriceAlerts();let sent=0,failed=0;const discoveries={remaining:DISCOVERIES_PER_RUN},statuses={};
      for(let offset=0;offset<alerts.length;offset+=5)await Promise.all(alerts.slice(offset,offset+5).map(async alert=>{try{
        const result=await checkAlert(alert,{store,env,inspect,discover,send,discoveries});
        statuses[result.status]=(statuses[result.status]??0)+1;
        if(result.delivery==='sent'&&!result.duplicate)sent++;
      }catch{failed++;console.log(JSON.stringify({event:'price_alert_check_failed',alert_id:alert.id}));}}));
      console.log(JSON.stringify({event:'price_alert_checks',checked:alerts.length,sent,failed,statuses,discoveries:DISCOVERIES_PER_RUN-discoveries.remaining}));
      return json(res,failed?503:200,{checked:alerts.length,sent,failed});
    }catch{return json(res,503,{error:'Price checks failed.'});}
  };
}
export default createPriceChecksHandler();
