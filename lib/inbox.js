import {onboardingAction,onboardingAvailable} from './onboarding.js';
import {updatePurchaseHistory,continuePurchaseQuestions} from './receipt-chat.js';
import { wishlistProducts,groupWishlist } from './wishlist.js';
import { textWishlistAction, finishTextWishlist, settleTextWishlist, settledReply } from './text-wishlist.js';
import { rankDiscoveryProducts } from './discovery-ranking.js';
import { withUsage } from './usage.js';
import { createStore } from './store.js';
import { deliverReply } from './replies.js';
import { updateProfile } from './memory.js';
import { generateReply } from './ai.js';
import { checkoutLink, checkoutReply } from './checkout.js';
import { marketEnvironment } from './shopping-market.js';
import { beginProgress, fetchImages, sendGreeting } from './photon.js';
import { imageReferences, referencedImage, replyProviderId } from './message-context.js';

const money=(amount,currency)=>new Intl.NumberFormat('en-US',{style:'currency',currency}).format(amount);
const host=url=>{try{return new URL(url).hostname.replace(/^www\./,'');}catch{return 'a store';}};
// The persisted monitoring state, described without implying more than the last check established.
export function alertState(alert){
  const last=alert.last_result,stores=alert.links?.length??0,checked=alert.last_checked_at?` Last checked ${new Date(alert.last_checked_at).toLocaleDateString('en-US',{month:'short',day:'numeric'})}.`:' Not checked yet.';
  if(last?.status==='check_failed')return `I couldn’t read ${stores===1?'the store':`any of the ${stores} stores`} on the last ${last.failures===1?'check':`${last.failures} checks`}. The alert stays on, and I’ll keep trying and look for other stores.${checked}`;
  const reference=(alert.baselines??[]).filter(b=>Number.isFinite(b.amount)).sort((a,b)=>a.amount-b.amount)[0];
  if(!reference)return `Waiting for a verified price in your size at ${stores===1?'the store':`${stores} stores`}.${checked}`;
  const stock=last?.stock==='in_stock'?' Your size was in stock.':last?.stock==='sold_out'?' Your size was sold out.':'';
  const unconfirmed=(last?.unconfirmed_savings??[])[0];
  const search=last?.discovery?.status==='unavailable'?' I couldn’t search for other stores on the last check; I’ll try again.':'';
  return `Watching ${stores} ${stores===1?'store':'stores'}; reference price ${money(reference.amount,reference.currency)} at ${host(reference.url)}.${stock}${unconfirmed?` ${host(unconfirmed.url)} listed it for ${money(unconfirmed.amount,unconfirmed.currency)}, but I couldn’t confirm its shipping cost, so I haven’t counted it as a saving.`:''}${search}${checked}`;
}
// Alert status and cancellation for saved items. Item IDs must belong to this user's wishlist.
export async function manageAlerts(operation,ids,{store,conversationId,items,alerts}){
  const targets=ids.length?items.filter(i=>ids.includes(i.id)):items;
  if(ids.length&&!targets.length)return 'I couldn’t find that item in your wishlist. Which one do you mean?';
  const active=targets.flatMap(i=>alerts.filter(a=>a.group_id===i.id&&a.active).map(a=>({item:i,alert:a})));
  const names=active.map(({item,alert})=>item.name+(alert.size?` (size ${alert.size})`:'')).join('; ');
  if(operation==='status')return active.length?`Price alerts are on for ${names}. I check every three days and text you when the price drops or your size comes back in stock.\n`+active.map(({item,alert})=>`${item.name}: ${alertState(alert)}`).join('\n'):`You don’t have any price alerts on${ids.length?' for that item':''}.`;
  if(!active.length)return 'There isn’t an active price alert to turn off.';
  try{for(const {item} of active)await store.disablePriceAlert(conversationId,item.id);}
  catch{
    // Turning an alert off is the same write when repeated. After a failure, report what persisted.
    console.log(JSON.stringify({event:'alert_cancel_failed'}));
    let still=null;
    try{const current=await store.priceAlerts(conversationId);still=active.filter(({item})=>current.some(a=>a.group_id===item.id&&a.active));}catch{/* unknown */}
    if(!still)return 'I couldn’t confirm the price alerts were turned off. Please try again.';
    if(still.length)return `I couldn’t turn off the price alerts for ${still.map(({item})=>item.name).join('; ')}. They’re still on. Please try again.`;
  }
  return `Price alerts are off for ${names}. The items stay in your wishlist.`;
}
export async function receiveInInbox(delivery, env, { store = createStore(env), send = sendGreeting, generate = generateReply, loadImages = fetchImages, progress = beginProgress } = {}) {
  const conversationId = await store.receive(delivery);
  // Every message goes to the one agent. Onboarding, developer feedback and memory are its tools,
  // not pre-routers that inspect the message first.
  if (env.AI_ENABLED === 'true') {
    const operation = `ai:${delivery.message.id}`;
    if (!await store.claimAI(conversationId, operation)) return 'imessage_ai_duplicate';
    let stopProgress = async () => {};
    try { stopProgress = await progress(delivery, env); } catch { /* Optional feedback must not block the answer. */ }
    try {
    let searchResult = null, sourceImages = [], historyUpdated = false;
    let body, source = 'ai', products = [], replyTarget = delivery.message.attachments?.length || replyProviderId(delivery.message) ? delivery.message : null;
    try {
      let images = [];
      if (delivery.message.attachments?.length) {
        try {
          images = await loadImages(delivery, env);
          console.log(JSON.stringify({event:'image_downloaded',count:images.length}));
          await store.saveImages(delivery.message.id, images);
          console.log(JSON.stringify({event:'image_saved',count:images.length}));
        } catch {
          await store.imageStatus(delivery.message.id, 'failed');
          throw new Error('Image could not be read');
        }
      }
      // Independent reads run together; each optional source degrades to empty on failure.
      const optional = (label, read) => read().catch(() => { console.log(JSON.stringify({event:'context_read_failed',source:label})); return null; });
      const [context, profile, history, wishlistState, alerts, entries, session] = await Promise.all([
        store.context(conversationId, delivery.message.id),
        env.MEMORY_ENABLED === 'true' ? store.profile(conversationId) : null,
        env.GMAIL_IMPORT_ENABLED === 'true' && store.purchaseHistory ? optional('purchase_history', () => store.purchaseHistory(conversationId)) : null,
        env.WISHLIST_ENABLED==='true'&&env.SEARCH_ENABLED==='true'&&store.textWishlistState&&!images.length ? store.textWishlistState(conversationId) : null,
        env.WISHLIST_ENABLED==='true'&&env.PRICE_ALERTS_ENABLED==='true'&&store.priceAlerts ? store.priceAlerts(conversationId) : [],
        env.WISHLIST_ENABLED==='true'&&store.wishlistEntries ? store.wishlistEntries(conversationId) : [],
        env.ONBOARDING_ENABLED==='true' ? store.onboardingSession(conversationId) : null,
      ]);
      sourceImages = [...(referencedImage(context)?.message_images ?? [])].sort((a,b) => (a.position ?? 0) - (b.position ?? 0));
      // The agent and search see a compact purchase summary; per-item detail goes only to discovery ranking.
      const summaryFact = history?.summary ? [{ field:'shopping_history', key:'summary', value:JSON.stringify(history.summary), basis:'inferred' }] : [];
      const memory = { facts: [...(profile?.facts ?? []), ...summaryFact] };
      const purchaseHistory = (history?.items ?? 0) > 0;
      const current = context.filter(m => m.direction === 'inbound').at(-1);
      const wishlistItems=groupWishlist(entries??[]).map(({id,name,links})=>({id,name,links:links.map(({url,verification_status})=>({url,verification_status})),
        price_alert:(alerts??[]).find(a=>a.group_id===id&&a.active)?{active:true,size:alerts.find(a=>a.group_id===id&&a.active).size??null}:null}));
      body = await withUsage({ store, env, conversation: conversationId, operation, feature: 'chat' }, () => generate(context, env, fetch, { ...memory, images,wishlistItems,imageReferences:imageReferences(context),executionContext:store.executionContext??{mode:'production'},
        acknowledge: async intent => {
          if(intent.action==='selection'&&!searchResult?.user_confirmed&&!searchResult?.text_wishlist_state?.selected_set?.length)return;
          try { await stopProgress.react?.(intent); } catch { /* Best effort acknowledgment. */ }
        },
        ...(env.WISHLIST_ENABLED==='true'&&env.SEARCH_ENABLED==='true'&&!images.length?{
          wishlistState,
          wishlistAction: (args,resolvedState=wishlistState)=>textWishlistAction(args,{state:resolvedState,env,facts:memory.facts,
            rank:async(products,input)=>rankDiscoveryProducts(products,{...input,facts:[...input.facts.filter(f=>f.field!=='shopping_history'),...(history?await history.detail():[])]}),
            record:async result=>{await store.searchResult(operation,result);searchResult=result;sourceImages=[];},
          }),
        }:{}),
        ...(env.MEMORY_ENABLED==='true'&&current?{
          profileAction:async args=>{const result=await updateProfile(store,conversationId,current,args);if(result.saved)await store.memoryStatus(delivery.message.id,'saved');return result;},
          profileFailed:()=>store.memoryStatus(delivery.message.id,'failed'),
        }:{}),
        ...(onboardingAvailable(session,env)?{onboarding:{state:session?.state??null,style_reading_available:env.STYLE_ENABLED==='true',gmail_import:env.GMAIL_IMPORT_ENABLED==='true'},
          onboardingAction:action=>onboardingAction(action,{conversationId,session,store,env})}:{}),
        ...(env.CHECKOUT_LINKS_ENABLED==='true'&&env.WISHLIST_ENABLED==='true'&&env.SEARCH_ENABLED==='true'&&!images.length?{checkoutAction:async targets=>{
          const links=await Promise.all(targets.map(target=>checkoutLink(target,{env:marketEnvironment(memory.facts,env)})));
          // PRD §18: a purchase request returns a link and records the intent; nothing is bought.
          console.log(JSON.stringify({event:'purchase_intent',items:links.map(l=>({status:l.status,provider:l.provider??null,store:l.store}))}));
          searchResult={identification_policy:'checkout_link',purchase_intent:true,checkout_links:links.map(({url,status,provider,store:merchant,size,variant_id,checkout_url})=>({url,status,provider:provider??null,store:merchant,size:size??null,variant_id:variant_id??null,checkout_url:checkout_url??null})),
            products:[],text_wishlist_state:wishlistState,checked_at:new Date().toISOString()};
          await store.searchResult(operation,searchResult);
          return checkoutReply(links);
        }}:{}),
        feedbackAction:async feedback=>{await store.saveFeedback(delivery.message.id,feedback);return 'Feedback saved for the developer. Thank you.';},
        ...(alerts&&store.disablePriceAlert&&env.PRICE_ALERTS_ENABLED==='true'?{alertsAction:(operation,ids)=>manageAlerts(operation,ids,{store,conversationId,items:wishlistItems,alerts})}:{}),
        ...(purchaseHistory&&!images.length?{purchaseHistoryAction:async()=>{
          const result=await updatePurchaseHistory(delivery,conversationId,store,env);historyUpdated=result.updated;return result.body;
        }}:{}),
        loadImages: async requestedId => {
          const reference=referencedImage(context,requestedId);
          if (!reference) return [];
          const loaded = await store.imagesForMessage(reference.id);
          console.log(JSON.stringify({event:'image_reference_loaded',source_message_id:reference.id,
            explicitly_referenced:Boolean(reference.explicit_reply),count:loaded.length}));
          sourceImages = [...reference.message_images].sort((a,b)=>(a.position??0)-(b.position??0));
          if (loaded.length && reference.provider_id && !replyProviderId(delivery.message)) replyTarget = { id: reference.provider_id, content: { type: 'attachment' } };
          return loaded;
        },
        recordSearch: async result => {
          const referenced={...result,products:(result.products??[]).map(p=>({...p,...(sourceImages[p.source_image_index??0]?.id?{source_image_id:sourceImages[p.source_image_index??0].id}:{})}))};
          await store.searchResult(operation,referenced);
          searchResult = referenced;
          products = result.identification_policy === 'visual_comparison' ? result.products ?? [] : [];
        },
      }));
    }
    catch (error) {
      // Record why the reply failed (error class and code only, never message text) so a fallback is diagnosable.
      console.log(JSON.stringify({event:'ai_reply_failed',operation,error:error?.name??null,reason:String(error?.message??'').slice(0,80),
        database_status:error?.database_status??null,database_code:error?.database_code??null,images:delivery.message.attachments?.length??0}));
      source = 'ai_fallback';
      products = [];
      body = delivery.message.attachments?.length ? 'I couldn’t read that image. Please try a JPG, PNG, WebP, or HEIC image under 3 MB (up to three at a time).' : 'I couldn’t prepare a reply just now. Could you try again?';
    }
    let confirmedBeforeSend=false;
    const recordFailedSave=async()=>{
      const pending=searchResult?.text_wishlist_state;
      searchResult={...searchResult,user_confirmed:false,text_wishlist_state:pending?{...pending,already_saved:false,offered_action:null,confirmed_consent:null}:null};
      await store.searchResult(operation,searchResult);
    };
    if (env.WISHLIST_ENABLED === 'true' && source === 'ai' && searchResult?.user_confirmed === true) {
      try {
        const payload = searchResult?.existing_saved_groups?.length?[]:await wishlistProducts(searchResult, body, sourceImages, store,undefined,{env});
        if (payload.length) {
          await store.wishlistPayload(operation, payload);
          if (!searchResult?.user_confirmed && env.SITE_ORIGIN && !await store.wishlistHasItems(conversationId)) body += `\n\nYour wishlist: ${env.SITE_ORIGIN.replace(/\/$/, '')}/wishlist`;
        }
      } catch {
        console.log(JSON.stringify({event:'wishlist_prepare_failed',operation}));
        if(searchResult?.user_confirmed){body='I couldn’t save those items just now. Please try again.';confirmedBeforeSend=true;await recordFailedSave();}
      }
      if(searchResult?.user_confirmed&&!confirmedBeforeSend){
        let saved=false;
        confirmedBeforeSend=true;
        try {
          if(!searchResult.existing_saved_groups?.length)await store.saveConfirmedWishlist(operation); saved=true;
          body=await finishTextWishlist({store,operation,conversationId,result:searchResult,env});
        } catch {
          console.log(JSON.stringify({event:'wishlist_confirmed_action_failed',operation,saved}));
          const settled=await settleTextWishlist({store,operation,conversationId,result:searchResult,env,save:saved?null:store.saveConfirmedWishlist});
          console.log(JSON.stringify({event:'wishlist_save_settled',operation,saved:settled.saved,alerts:settled.alerts}));
          body=settledReply(settled,env);
          if(settled.saved!==true)await recordFailedSave();
        }
      }
    }
    await store.prepareAI(operation, body, source);
    let sent;
    try { sent = await send(delivery, body, env, { replyTarget, products }); }
    catch { await store.finish(operation, 'uncertain'); return 'imessage_ai_reply_uncertain'; }
    if (sent?.id && store.recordDelivery) {
      try { await store.recordDelivery(operation, sent.id, replyTarget?.id ?? null); }
      catch { console.log(JSON.stringify({event:'imessage_delivery_reference_failed',operation})); }
    }
    await store.finish(operation, 'sent');
    if(historyUpdated)await continuePurchaseQuestions(store,conversationId,env,send);
    if (env.WISHLIST_ENABLED === 'true'&&!confirmedBeforeSend&&searchResult?.user_confirmed===true) {
      let confirmation=null,saveDone=false;
      try {
        await store.saveWishlist(operation);saveDone=true;
        confirmation=await finishTextWishlist({store,operation,conversationId,result:searchResult,env});
      }
      catch {
        console.log(JSON.stringify({event:'wishlist_save_failed',operation}));
        if(searchResult?.user_confirmed){
          const settled=await settleTextWishlist({store,operation,conversationId,result:searchResult,env,save:saveDone?null:store.saveWishlist});
          console.log(JSON.stringify({event:'wishlist_save_settled',operation,saved:settled.saved,alerts:settled.alerts}));
          confirmation=settledReply(settled,env);
        }
      }
      if(confirmation){
        await deliverReply({store,send,conversation:{id:conversationId,sender_id:delivery.message.sender.id,line:delivery.space.phone},operation:`wishlist-confirm:${delivery.message.id}`,body:confirmation,source:'operator',env});
      }
    }
    return source === 'ai' ? 'imessage_ai_reply_sent' : 'imessage_ai_fallback_sent';
    } finally { try { await stopProgress(); } catch { /* Best effort cleanup. */ } }
  }
  // With the agent off, messages are stored for the operator; no wording triggers a reply.
  return 'imessage_received';
}
