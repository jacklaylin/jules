import { timingSafeEqual, createHash } from 'node:crypto';
import { createStore } from '../lib/store.js';
import { inspectAlertLinks, baselineOffers, priceDrop, lowestAvailable } from '../lib/price-alerts.js';
import { deliverReply } from '../lib/replies.js';
import { sendGreeting } from '../lib/photon.js';
import { json } from '../lib/http.js';
export const config={maxDuration:120};
export function createPriceChecksHandler({env=process.env,storeFactory=createStore,inspect=inspectAlertLinks,send=sendGreeting}={}){
  return async(req,res)=>{
    const expected=env.CRON_SECRET&&Buffer.from(`Bearer ${env.CRON_SECRET}`),received=Buffer.from(req.headers.authorization??'');
    if(!expected||received.length!==expected.length||!timingSafeEqual(received,expected))return json(res,401,{error:'Unauthorized.'});
    if(req.method!=='GET')return json(res,405,{error:'Method not allowed.'});
    if(env.PRICE_ALERTS_ENABLED!=='true')return json(res,503,{error:'Price alerts disabled.'});
    try{
      const store=storeFactory(env),alerts=await store.claimPriceAlerts();let sent=0,failed=0;
      for(let offset=0;offset<alerts.length;offset+=5)await Promise.all(alerts.slice(offset,offset+5).map(async alert=>{try{
        const {checks}=await inspect(alert.links);
        const current=lowestAvailable(baselineOffers(checks,alert.size).filter(c=>alert.links.some(l=>l.url===c.url)));
        const match=current.find(c=>alert.baselines.some(b=>priceDrop(b,c)));
        let status='no_drop';
        if(!checks.some(c=>c.offers.length))status='needs_review';
        let nextBaselines;
        if(match&&await store.priceAlertCurrent(alert.id,alert.revision)){
          const conversation=await store.conversation(alert.conversation_id);
          const price=new Intl.NumberFormat('en-US',{style:'currency',currency:match.currency}).format(match.amount);
          const body=`${alert.name} is down more than 10% to ${price}, and size ${alert.size} is available.\n${match.url}\nPrice and size checked just now; shipping and taxes may be extra.`;
          const baseline=alert.baselines.find(b=>priceDrop(b,match));
          const fingerprint=createHash('sha256').update(JSON.stringify([baseline.key,baseline.currency,baseline.amount])).digest('hex').slice(0,24);
          const operation=`price-alert:${alert.id}:${alert.revision}:${fingerprint}`;
          const existing=await store.operation(operation);
          const result=existing?{status:existing.status,duplicate:true}:await deliverReply({store,send,conversation,operation,body,source:'operator',env});
          status=result.status;if(status==='sent'&&!result.duplicate)sent++;
          if(status==='sent')nextBaselines=alert.baselines.map(b=>b.currency===match.currency?match:b);
        }
        await store.recordPriceCheck(alert.id,alert.revision,{status,checks},['sent','uncertain','sending'].includes(status),nextBaselines);
      }catch{failed++;console.log(JSON.stringify({event:'price_alert_check_failed',alert_id:alert.id}));}}));
      console.log(JSON.stringify({event:'price_alert_checks',checked:alerts.length,sent,failed}));
      return json(res,failed?503:200,{checked:alerts.length,sent,failed});
    }catch{return json(res,503,{error:'Price checks failed.'});}
  };
}
export default createPriceChecksHandler();
