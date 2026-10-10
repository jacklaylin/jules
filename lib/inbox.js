import { wishlistProducts,groupWishlist } from './wishlist.js';
import { textWishlistAction, finishTextWishlist } from './text-wishlist.js';
import { createStore } from './store.js';
import { deliverReply } from './replies.js';
import { GREETING } from './imessage.js';
import { remember } from './memory.js';
import { generateReply } from './ai.js';
import { beginProgress, fetchImages, sendGreeting } from './photon.js';

export async function receiveInInbox(delivery, env, { store = createStore(env), send = sendGreeting, generate = generateReply, updateMemory = remember, loadImages = fetchImages, progress = beginProgress } = {}) {
  const conversationId = await store.receive(delivery);
  if(env.STYLE_ENABLED==='true' && env.SITE_ORIGIN && /^\s*(?:(?:show|open)(?: me)? my style|(?:analy[sz]e|learn|get to know) my (?:personal )?style|(?:my )?(?:style analysis|starter pack))[.!?]?\s*$/i.test(delivery.message.content?.text??'')) {
    const conversation={id:conversationId,sender_id:delivery.message.sender.id,line:delivery.space.phone};
    const result=await deliverReply({store,send,conversation,operation:`style:${delivery.message.id}`,
      body:`Want me to get to know your style? Add a few outfits, inspiration screenshots, and any receipts you'd like to share. I'll give you a style read you can correct before I use it to shop for you.\n\n${env.SITE_ORIGIN.replace(/\/$/,'')}/style`,source:'operator',env});
    return result.status==='sent'?'imessage_style_invitation_sent':'imessage_style_invitation_uncertain';
  }
  const feedback = (delivery.message.content?.text ?? '').match(/^\s*DM(?:\s+|:\s*|$)([\s\S]*)$/i);
  if (feedback) {
    const body = feedback[1].trim();
    await store.saveFeedback(delivery.message.id, body);
    const conversation = { id: conversationId, sender_id: delivery.message.sender.id, line: delivery.space.phone };
    const result = await deliverReply({ store, send, conversation, operation: `feedback:${delivery.message.id}`,
      body: body ? 'Feedback saved for the developer. Thank you.' : 'Send DM followed by your feedback, for example: DM the replies are too long.', source: 'operator', env });
    return result.status === 'sent' ? 'imessage_feedback_saved' : 'imessage_feedback_reply_uncertain';
  }
  if (env.AI_ENABLED === 'true') {
    const operation = `ai:${delivery.message.id}`;
    if (!await store.claimAI(conversationId, operation)) return 'imessage_ai_duplicate';
    let stopProgress = async () => {};
    try { stopProgress = await progress(delivery, env); } catch { /* Optional feedback must not block the answer. */ }
    try {
    let searchResult = null, sourceImages = [];
    let body, source = 'ai', products = [], replyTarget = delivery.message.attachments?.length ? delivery.message : null;
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
      sourceImages = [...(context.findLast(m => m.direction === 'inbound' && m.message_images?.length)?.message_images ?? [])].sort((a,b) => (a.position ?? 0) - (b.position ?? 0));
      let memory = { enabled: env.MEMORY_ENABLED === 'true', saved: false, facts: [] };
      if (memory.enabled && !images.length) {
        try {
          const current = context.filter(m => m.direction === 'inbound').at(-1);
          if (!current) throw new Error('Missing inbound');
          const profile = await updateMemory(store, conversationId, [current], env);
          memory = { enabled: true, saved: true, facts: profile.facts };
          await store.memoryStatus(delivery.message.id, 'saved');
        } catch {
          await store.memoryStatus(delivery.message.id, 'failed');
          memory.facts = (await store.profile(conversationId)).facts;
          console.log(JSON.stringify({ event: 'memory_update_failed', message_id: delivery.message.id }));
        }
      }
      if (images.length && memory.enabled) memory.facts = (await store.profile(conversationId)).facts;
      const wishlistState=env.WISHLIST_ENABLED==='true'&&env.SEARCH_ENABLED==='true'&&store.textWishlistState&&!images.length ? await store.textWishlistState(conversationId) : null;
      const wishlistItems=env.WISHLIST_ENABLED==='true'&&store.wishlistEntries?groupWishlist(await store.wishlistEntries(conversationId)).map(({id,name,links})=>({id,name,links:links.map(({url,verification_status})=>({url,verification_status}))})):[];
      body = await generate(context, env, fetch, { ...memory, images,wishlistItems,executionContext:store.executionContext??{mode:'production'},
        acknowledge: async intent => {
          if(intent.action==='selection'&&!searchResult?.user_confirmed&&!searchResult?.text_wishlist_state?.selected_set?.length)return;
          try { await stopProgress.react?.(intent); } catch { /* Best effort acknowledgment. */ }
        },
        ...(env.WISHLIST_ENABLED==='true'&&env.SEARCH_ENABLED==='true'&&!images.length?{
          wishlistState,
          wishlistAction: (args,resolvedState=wishlistState)=>textWishlistAction(args,{state:resolvedState,text:delivery.message.content.text,env,facts:memory.facts,
            record:async result=>{await store.searchResult(operation,result);searchResult=result;sourceImages=[];},
          }),
        }:{}),
        loadImages: async () => {
          const reference=context.findLast(m=>m.direction==='inbound'&&m.message_images?.length);
          if (!reference) return [];
          const loaded = await store.imagesForMessage(reference.id);
          if (loaded.length && reference.provider_id) replyTarget = { id: reference.provider_id, content: { type: 'attachment' } };
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
    if (env.WISHLIST_ENABLED === 'true' && source === 'ai') {
      try {
        const payload = searchResult?.existing_saved_groups?.length?[]:await wishlistProducts(searchResult, body, sourceImages, store,undefined,{env});
        if (payload.length) {
          await store.wishlistPayload(operation, payload);
          if (!searchResult?.user_confirmed && env.SITE_ORIGIN && !await store.wishlistHasItems(conversationId)) body += `\n\nYour wishlist: ${env.SITE_ORIGIN.replace(/\/$/, '')}/wishlist`;
        } else if (/^\s*(?:show|open)(?: me)? my wishlist[.!?]?\s*$/i.test(delivery.message.content.text) && env.SITE_ORIGIN) {
          body = `Your wishlist: ${env.SITE_ORIGIN.replace(/\/$/, '')}/wishlist`;
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
    try { await send(delivery, body, env, { replyTarget, products }); }
    catch { await store.finish(operation, 'uncertain'); return 'imessage_ai_reply_uncertain'; }
    await store.finish(operation, 'sent');
    if (env.WISHLIST_ENABLED === 'true'&&!confirmedBeforeSend) {
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
  if (delivery.message.content.text.trim().toLowerCase() !== 'hello') return 'imessage_received';
  const conversation = { id: conversationId, sender_id: delivery.message.sender.id, line: delivery.space.phone };
  const result = await deliverReply({ store, send, conversation, operation: `greeting:${delivery.message.id}`, body: GREETING, source: 'greeting', env });
  return result.status === 'sent' ? 'imessage_reply_sent' : 'imessage_reply_uncertain';
}
