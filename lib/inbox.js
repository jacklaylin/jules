import {onboardingAction,onboardingAvailable} from './onboarding.js';
import {updatePurchaseHistory,continuePurchaseQuestions} from './receipt-chat.js';
import { wishlistProducts,groupWishlist } from './wishlist.js';
import { textWishlistAction, finishTextWishlist } from './text-wishlist.js';
import { createStore } from './store.js';
import { deliverReply } from './replies.js';
import { updateProfile } from './memory.js';
import { generateReply } from './ai.js';
import { beginProgress, fetchImages, sendGreeting } from './photon.js';
import { imageReferences, referencedImage, replyProviderId } from './message-context.js';

// Alert status and cancellation for saved items. Item IDs must belong to this user's wishlist.
export async function manageAlerts(operation,ids,{store,conversationId,items,alerts}){
  const targets=ids.length?items.filter(i=>ids.includes(i.id)):items;
  if(ids.length&&!targets.length)return 'I couldn’t find that item in your wishlist. Which one do you mean?';
  const active=targets.flatMap(i=>alerts.filter(a=>a.group_id===i.id&&a.active).map(a=>({item:i,alert:a})));
  const names=active.map(({item,alert})=>item.name+(alert.size?` (size ${alert.size})`:'')).join('; ');
  if(operation==='status')return active.length?`Price-drop reminders are on for ${names}. I check every three days.`:`You don’t have any price alerts on${ids.length?' for that item':''}.`;
  if(!active.length)return 'There isn’t an active price alert to turn off.';
  for(const {item} of active)await store.disablePriceAlert(conversationId,item.id);
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
      const context = await store.context(conversationId, delivery.message.id);
      sourceImages = [...(referencedImage(context)?.message_images ?? [])].sort((a,b) => (a.position ?? 0) - (b.position ?? 0));
      const memory = { facts: env.MEMORY_ENABLED === 'true' ? (await store.profile(conversationId)).facts : [] };
      const current = context.filter(m => m.direction === 'inbound').at(-1);
      let purchaseHistory=false;
      if(env.GMAIL_IMPORT_ENABLED==='true'){
        try{const history=await store.receiptFacts(conversationId,{withHistory:true});memory.facts=[...memory.facts,...history.facts];purchaseHistory=history.items>0;}
        catch{console.log(JSON.stringify({event:'receipt_learning_unavailable'}));}
      }
      const wishlistState=env.WISHLIST_ENABLED==='true'&&env.SEARCH_ENABLED==='true'&&store.textWishlistState&&!images.length ? await store.textWishlistState(conversationId) : null;
      const alerts=env.WISHLIST_ENABLED==='true'&&env.PRICE_ALERTS_ENABLED==='true'&&store.priceAlerts?await store.priceAlerts(conversationId):[];
      const wishlistItems=env.WISHLIST_ENABLED==='true'&&store.wishlistEntries?groupWishlist(await store.wishlistEntries(conversationId)).map(({id,name,links})=>({id,name,links:links.map(({url,verification_status})=>({url,verification_status})),
        price_alert:alerts.find(a=>a.group_id===id&&a.active)?{active:true,size:alerts.find(a=>a.group_id===id&&a.active).size??null}:null})):[];
      const session=env.ONBOARDING_ENABLED==='true'?await store.onboardingSession(conversationId):null;
      body = await generate(context, env, fetch, { ...memory, images,wishlistItems,imageReferences:imageReferences(context),executionContext:store.executionContext??{mode:'production'},
        acknowledge: async intent => {
          if(intent.action==='selection'&&!searchResult?.user_confirmed&&!searchResult?.text_wishlist_state?.selected_set?.length)return;
          try { await stopProgress.react?.(intent); } catch { /* Best effort acknowledgment. */ }
        },
        ...(env.WISHLIST_ENABLED==='true'&&env.SEARCH_ENABLED==='true'&&!images.length?{
          wishlistState,
          wishlistAction: (args,resolvedState=wishlistState)=>textWishlistAction(args,{state:resolvedState,env,facts:memory.facts,
            record:async result=>{await store.searchResult(operation,result);searchResult=result;sourceImages=[];},
          }),
        }:{}),
        ...(env.MEMORY_ENABLED==='true'&&current?{
          profileAction:async args=>{const result=await updateProfile(store,conversationId,current,args);if(result.saved)await store.memoryStatus(delivery.message.id,'saved');return result;},
          profileFailed:()=>store.memoryStatus(delivery.message.id,'failed'),
        }:{}),
        ...(onboardingAvailable(session,env)?{onboarding:{state:session?.state??null,style_reading_available:env.STYLE_ENABLED==='true',gmail_import:env.GMAIL_IMPORT_ENABLED==='true'},
          onboardingAction:action=>onboardingAction(action,{conversationId,session,store,env})}:{}),
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
      });
    }
    catch {
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
          body=saved?'Saved to your wishlist. I couldn’t finish setting up the price alerts.':'I couldn’t save those items just now. Please try again.';
          if(!saved)await recordFailedSave();
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
      let confirmation=null;
      try {
        await store.saveWishlist(operation);
        confirmation=await finishTextWishlist({store,operation,conversationId,result:searchResult,env});
      }
      catch {
        console.log(JSON.stringify({event:'wishlist_save_failed',operation}));
        if(searchResult?.user_confirmed)confirmation='I couldn’t confirm that the wishlist save and alert setup finished. Please try again; I haven’t confirmed an active alert.';
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
