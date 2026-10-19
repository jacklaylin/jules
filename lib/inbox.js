import {onboardingAction,onboardingAvailable,signInLinks} from './onboarding.js';
import {keepOutfitPhotos,outfitSourceId,OUTFIT_TARGET} from './outfit-photos.js';
import {readAfterOutfits} from './style-report.js';
import {profileAfterOutfits} from './receipt-notifications.js';
import {updatePurchaseHistory,continuePurchaseQuestions,importOrderScreenshots} from './receipt-chat.js';
import { wishlistProducts,groupWishlist } from './wishlist.js';
import { textWishlistAction, finishTextWishlist, settleTextWishlist, settledReply } from './text-wishlist.js';
import { rankDiscoveryProducts } from './discovery-ranking.js';
import { withUsage, labelUsage } from './usage.js';
import { sizeKey, ONE_SIZE } from './price-alerts.js';
import { createStore } from './store.js';
import { deliverReply } from './replies.js';
import { updateProfile } from './memory.js';
import { generateReply, searchFollowup } from './ai.js';
import { checkoutLink, checkoutReply } from './checkout.js';
import { marketEnvironment } from './shopping-market.js';
import { beginProgress, fetchImages, sendGreeting } from './photon.js';
import { IMAGE_PLACEHOLDER } from './images.js';
import { imageReferences, referencedImage, replyProviderId, threadTarget } from './message-context.js';
import { handleComplianceKeyword } from './sms-compliance.js';
import { composeReply, recentTurns } from './compose.js';
import { developerReport, FEEDBACK_ACK } from './developer-feedback.js';
import { turnTrace, failureReason, fallbackReply, alertFounder, reportInboundFailure, safeError } from './reply-failures.js';
import { recordAdoptionEvent, shownProducts, trackLinks } from './adoption-events.js';

// Bounds for parts of a turn that talk to other services, so a hung connection ends in a reply
// (or a recorded failure) instead of a message left generating until the function is killed.
const within = (ms, work, label) => { let timer; return Promise.race([work, new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error(label), { name: 'TimeoutError' })), ms); timer.unref?.(); })]).finally(() => clearTimeout(timer)); };

const money=(amount,currency)=>new Intl.NumberFormat('en-US',{style:'currency',currency}).format(amount);
const host=url=>{try{return new URL(url).hostname.replace(/^www\./,'');}catch{return 'a store';}};
// The persisted monitoring state, described without implying more than the last check established.
export function alertState(alert){
  const last=alert.last_result,stores=alert.links?.length??0,checked=alert.last_checked_at?` last checked ${new Date(alert.last_checked_at).toLocaleDateString('en-US',{month:'short',day:'numeric'})}.`:' not checked yet.';
  if(last?.status==='check_failed')return `i couldn’t read ${stores===1?'the store':`any of the ${stores} stores`} on the last ${last.failures===1?'check':`${last.failures} checks`}. the alert stays on, and i’ll keep trying and look for other stores.${checked}`;
  const reference=(alert.baselines??[]).filter(b=>Number.isFinite(b.amount)).sort((a,b)=>a.amount-b.amount)[0];
  if(!reference)return `waiting for a verified price in your size at ${stores===1?'the store':`${stores} stores`}.${checked}`;
  const stock=last?.stock==='in_stock'?' your size was in stock.':last?.stock==='sold_out'?' your size was sold out.':'';
  const unconfirmed=(last?.unconfirmed_savings??[])[0];
  const search=last?.discovery?.status==='unavailable'?' i couldn’t search for other stores on the last check; i’ll try again.':'';
  return `watching ${stores} ${stores===1?'store':'stores'}; reference price ${money(reference.amount,reference.currency)} at ${host(reference.url)}.${stock}${unconfirmed?` ${host(unconfirmed.url)} listed it for ${money(unconfirmed.amount,unconfirmed.currency)}, but i couldn’t confirm its shipping cost, so i haven’t counted it as a saving.`:''}${search}${checked}`;
}
// Alert status and cancellation for saved items. Item IDs must belong to this user's wishlist.
export async function manageAlerts(operation,ids,{store,conversationId,items,alerts,outcome={}}){
  const targets=ids.length?items.filter(i=>ids.includes(i.id)):items;
  if(ids.length&&!targets.length)return 'i couldn’t find that item in your wishlist. which one do you mean?';
  const active=targets.flatMap(i=>alerts.filter(a=>a.group_id===i.id&&a.active).map(a=>({item:i,alert:a})));
  const names=active.map(({item,alert})=>item.name+(alert.size&&sizeKey(alert.size)!==sizeKey(ONE_SIZE)?` (size ${alert.size})`:'')).join('; ');
  if(operation==='status')return active.length?`price alerts are on for ${names}. i check every three days and text you when the price drops or your size comes back in stock.\n`+active.map(({item,alert})=>`${item.name}: ${alertState(alert)}`).join('\n'):`you don’t have any price alerts on${ids.length?' for that item':''}.`;
  if(!active.length)return 'there isn’t an active price alert to turn off.';
  try{for(const {item} of active)await store.disablePriceAlert(conversationId,item.id);}
  catch{
    // Turning an alert off is the same write when repeated. After a failure, report what persisted.
    console.log(JSON.stringify({event:'alert_cancel_failed'}));
    let still=null;
    try{const current=await store.priceAlerts(conversationId);still=active.filter(({item})=>current.some(a=>a.group_id===item.id&&a.active));}catch{/* unknown */}
    if(!still)return 'i couldn’t confirm the price alerts were turned off. please try again.';
    if(still.length)return `i couldn’t turn off the price alerts for ${still.map(({item})=>item.name).join('; ')}. they’re still on. please try again.`;
  }
  outcome.alerts_turned_off=true;
  return `price alerts are off for ${names}. the items stay in your wishlist.`;
}
// Messages sent while a search runs: the acknowledgment the agent wrote with its search, and one
// model-written follow-up if the search passes the deadline. Testers said they would rather wait than
// get the follow-up (October 16), so it waits until 90 s, past most finished searches (p90 ~82–99 s). Neither may arrive after the result:
// the result waits for an update already being sent, and an update not yet started is dropped.
export const SEARCH_FOLLOWUP_MS = 90000;
export function searchUpdates({ deliver, writeFollowup, followupAfterMs, now = Date.now, onStart = () => {} }) {
  const started = now();
  let begun = false, replying = false, timer = null, queue = Promise.resolve();
  const timing = { acknowledged: false, followup_sent: false, first_message_ms: null };
  const post = (kind, body) => {
    queue = queue.then(async () => {
      if (replying) return;
      const outcome = await deliver(kind, body);
      if (outcome?.status !== 'sent') return;
      timing.first_message_ms ??= now() - started;
      if (kind === 'ack') timing.acknowledged = true; else timing.followup_sent = true;
    }).catch(() => console.log(JSON.stringify({ event: 'search_update_failed', kind })));
    return queue;
  };
  return {
    timing, started,
    // Called once the agent has committed to a search, before it runs. Later calls (a retry) are ignored.
    async begin({ acknowledgment = null, brief = null } = {}) {
      if (begun || replying) return;
      begun = true;
      if (acknowledgment) await post('ack', acknowledgment);
      timer = setTimeout(async () => {
        let body = null;
        try { body = await writeFollowup({ brief, acknowledgment }); } catch { /* No model text, no follow-up. */ }
        console.log(JSON.stringify({ event: 'search_deadline_passed', followup_written: Boolean(body) }));
        if (body) await post('followup', body);
      }, followupAfterMs);
      timer.unref?.();
      onStart();
    },
    // The result is about to be sent: stop the follow-up and let any update in flight land first.
    async finish() { replying = true; clearTimeout(timer); await queue; },
  };
}

// The #dev acknowledgment stays fixed (founder decision): instant, and never dependent on a model call.
const asWritten = async ({ draft }) => ({ body:draft, captions:[], composed:false });
// Saves the report (with any attached screenshots) and sends one fixed acknowledgment. The report and
// its acknowledgment are excluded from the agent's context, so they never change shopping state.
async function receiveDeveloperReport(delivery, report, conversationId, env, { store, send, loadImages }) {
  if (delivery.message.attachments?.length) {
    try { await store.saveImages(delivery.message.id, await loadImages(delivery, env)); }
    catch { console.log(JSON.stringify({event:'developer_feedback_images_failed'})); }
  }
  try { await store.saveFeedback(delivery.message.id, report.note); }
  catch { console.log(JSON.stringify({event:'developer_feedback_save_failed',channel:report.channel})); throw new Error('Feedback not saved'); }
  console.log(JSON.stringify({event:'developer_feedback_saved',channel:report.channel,targets_message:report.channel==='reaction'||Boolean(replyProviderId(delivery.message))}));
  if (env.AI_ENABLED !== 'true') return 'developer_feedback_saved';
  await deliverReply({ store, send, conversation:{id:conversationId,sender_id:delivery.message.sender.id,line:delivery.space.phone},
    operation:`feedback:${delivery.message.id}`, body:FEEDBACK_ACK, source:'operator', env, compose:asWritten });
  return 'developer_feedback_saved';
}
// Tools whose reply text the agent writes itself; everything else is drafted by code and composed.
// agent_reply is the agent loop's own checked message (lib/ai.js), or its plain factual fallback.
// agent_plain is its plain factual fallback (sent as drafted, not rewritten).
const MODEL_WRITTEN = ['agent_reply', 'conversation_reply', 'profile_status', 'wishlist_status', 'update_profile'];
const SENT_AS_IS = [...MODEL_WRITTEN, 'agent_plain'];
export async function receiveInInbox(delivery, env, { store = createStore(env), send = sendGreeting, generate = generateReply, loadImages = fetchImages, progress = beginProgress, compose = composeReply,
  defer = null, followupAfterMs = SEARCH_FOLLOWUP_MS, writeFollowup = brief => searchFollowup(brief, env), now = Date.now,
  turnDeadlineMs = 105000, progressTimeoutMs = 5000, sendTimeoutMs = 30000, alert = alertFounder, historyUpdate = updatePurchaseHistory, screenshotImport = importOrderScreenshots } = {}) {
  // Each step before the agent runs. A failure here means the tester gets no reply at all, so it is
  // logged by class and step (never message text) and texted to the founder once per incident.
  let conversationId = null;
  const before = async (step, work) => {
    try { return await work(); } catch (error) {
      if (error && typeof error === 'object') error.inbox_step = step;
      await reportInboundFailure(env, { error, step, line: delivery.space?.phone, conversationId }, { send, alert });
      throw error;
    }
  };
  conversationId = await before('receive', () => store.receive(delivery));
  // Carrier STOP/HELP/START run before the agent and regardless of AI settings.
  const optedOut = await before('opt_out_check', async () => await store.smsOptedOut?.(conversationId) ?? false);
  const compliance = await before('compliance', () => handleComplianceKeyword(delivery, conversationId, { store, send, env, optedOut }));
  if (compliance) return compliance;
  // After STOP, messages are still stored but nothing is sent back until START.
  if (optedOut) return 'imessage_opted_out_received';
  // Developer feedback is declared by the tester (#dev or a 👎 tapback), so it is saved before the
  // agent runs and never reaches it. Every other message goes to the one agent.
  const report = developerReport(delivery.message);
  if (report) return before('developer_feedback', () => receiveDeveloperReport(delivery, report, conversationId, env, { store, send, loadImages }));
  if (env.AI_ENABLED === 'true') {
    const operation = `ai:${delivery.message.id}`;
    if (!await before('claim', () => store.claimAI(conversationId, operation))) return 'imessage_ai_duplicate';
    // A search turn is acknowledged and then finished after the webhook responds (defer is Vercel's
    // waitUntil in production). Other turns, and callers without defer, complete before returning.
    let release = () => {};
    const released = new Promise(resolve => { release = resolve; });
    const updates = searchUpdates({ now, followupAfterMs, onStart: release,
      writeFollowup: brief => withUsage({ store, env, conversation: conversationId, operation: `followup:${delivery.message.id}`, feature: 'chat' }, () => writeFollowup(brief)),
      deliver: (kind, body) => deliverReply({ store, send, conversation: { id: conversationId, sender_id: delivery.message.sender.id, line: delivery.space.phone }, operation: `${kind}:${delivery.message.id}`, body, source: 'ai', env, compose: asWritten }) });
    const turn = answer();
    if (!defer) return turn;
    const first = await Promise.race([turn, released.then(() => 'imessage_ai_search_acknowledged')]);
    if (first === 'imessage_ai_search_acknowledged') {
      defer(turn.then(event => console.log(JSON.stringify({ event, message_id: delivery.message.id, deferred: true })),
        error => console.log(JSON.stringify({ event: 'imessage_reply_failed', message_id: delivery.message.id, deferred: true, ...safeError(error) }))));
    }
    return first;
    async function answer() {
    // The step this turn reached and the model's last status, persisted as it goes (reply_diagnostics).
    const trace = turnTrace({ now, persist: data => store.replyDiagnostics?.(operation, data) });
    let stopProgress = async () => {};
    trace.mark('progress', { persist: false });
    try { stopProgress = await within(progressTimeoutMs, progress(delivery, env), 'Progress start timed out'); }
    catch { console.log(JSON.stringify({ event: 'imessage_progress_skipped' })); /* Optional feedback must not block the answer. */ }
    try {
    let agentFallback = null, searchResult = null, sourceImages = [], historyUpdated = false, outfitsReady = false, readPhotoIds = null, compactRetry = false, recent = [], chosenTool = null, diagnostics = null;
    // What this turn actually did, for the composer's claim checks (lib/compose.js).
    const outcome = { saved_now:false, alerts_turned_on:false, alerts_turned_off:false };
    // Saves a confirmed selection (and its alerts) before the reply is sent, and returns the factual
    // confirmation. The agent loop calls it as soon as a save or alert request is approved, so the
    // model's message reports what actually happened; otherwise it runs after the agent returns.
    let committed = false, confirmedBeforeSend = false;
    const recordFailedSave=async()=>{
      const pending=searchResult?.text_wishlist_state;
      searchResult={...searchResult,user_confirmed:false,text_wishlist_state:pending?{...pending,already_saved:false,offered_action:null,confirmed_consent:null}:null};
      await store.searchResult(operation,searchResult);
    };
    const commitConfirmed = async () => {
      committed = true; confirmedBeforeSend = true;
      let confirmation = null;
      try {
        const payload = searchResult?.existing_saved_groups?.length?[]:await wishlistProducts(searchResult, '', sourceImages, store,undefined,{env});
        if (payload.length) await store.wishlistPayload(operation, payload);
      } catch {
        console.log(JSON.stringify({event:'wishlist_prepare_failed',operation}));
        await recordFailedSave();
        return 'i couldn’t save those items just now. please try again.';
      }
      let saved=false;
      try {
        if(!searchResult.existing_saved_groups?.length)await store.saveConfirmedWishlist(operation); saved=true;
        confirmation=await finishTextWishlist({store,operation,conversationId,result:searchResult,env,outcome});
        // A save is completed work: if the rest of the turn fails (a search past the deadline), the
        // fallback still tells the user what was saved instead of only asking them to try again.
        trace.done('wishlist',confirmation);
      } catch {
        console.log(JSON.stringify({event:'wishlist_confirmed_action_failed',operation,saved}));
        const settled=await settleTextWishlist({store,operation,conversationId,result:searchResult,env,save:saved?null:store.saveConfirmedWishlist,outcome});
        console.log(JSON.stringify({event:'wishlist_save_settled',operation,saved:settled.saved,alerts:settled.alerts}));
        confirmation=settledReply(settled,env);
        if(settled.saved===true)trace.done('wishlist',confirmation);
        if(settled.saved!==true)await recordFailedSave();
      }
      return confirmation;
    };
    // What the turn answered and which photo messages it read decide the reply's thread (after the agent runs).
    let body, source = 'ai', products = [], replyTarget = null, threading = { answered: [], used: [] };
    const answering = ({ answered = [], used = [] }) => { if (!trace.abandoned) threading = { answered: [...threading.answered, ...answered], used: [...threading.used, ...used] }; };
    try {
      let images = [];
      trace.mark('context', { persist: false });
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
      recent = context;
      sourceImages = [...(referencedImage(context)?.message_images ?? [])].sort((a,b) => (a.position ?? 0) - (b.position ?? 0));
      // The agent and search see a compact purchase summary; per-item detail goes only to discovery ranking.
      const summaryFact = history?.summary ? [{ field:'shopping_history', key:'summary', value:JSON.stringify(history.summary), basis:'inferred' }] : [];
      const memory = { facts: [...(profile?.facts ?? []), ...summaryFact] };
      const purchaseHistory = (history?.items ?? 0) > 0;
      const current = context.filter(m => m.direction === 'inbound').at(-1);
      const wishlistItems=groupWishlist(entries??[]).map(({id,name,links})=>({id,name,links:links.map(({url,verification_status})=>({url,verification_status})),
        price_alert:(alerts??[]).find(a=>a.group_id===id&&a.active)?{active:true,size:alerts.find(a=>a.group_id===id&&a.active).size??null}:null}));
      const initialImages = sourceImages;
      // Recent messages with images, so the agent can read several screenshots together.
      const recentImageMessages = context.filter(m => m.direction === 'inbound' && (m.message_images?.length || (m.provider_id === delivery.message.id && images.length)))
        .slice(-6).map(m => ({ id: m.id ?? null, caption: m.body === IMAGE_PLACEHOLDER ? '' : (m.body ?? '').slice(0, 200), created_at: m.created_at ?? null }));
      const reply = compact => withUsage({ store, env, conversation: conversationId, operation, feature: 'chat' }, () => generate(context, env, trace.fetch(fetch), { ...memory, images,wishlistItems,imageReferences:imageReferences(context),executionContext:store.executionContext??{mode:'production'},
        ...(compact?{compact:true}:{}), searchStarting: search => updates.begin(search),
        onReply: name => { chosenTool = name; }, onFallback: info => { agentFallback = info; }, answering,
        outcome,
        // The loop reads the shopping state each wishlist action recorded, and commits approved saves.
        shoppingState: () => searchResult && 'text_wishlist_state' in searchResult ? searchResult.text_wishlist_state : undefined,
        shoppingConfirmed: () => searchResult?.user_confirmed === true,
        ...(env.WISHLIST_ENABLED === 'true' ? { commitWishlist: commitConfirmed } : {}),
        acknowledge: async intent => {
          if(intent.action==='selection'&&!searchResult?.user_confirmed&&!searchResult?.text_wishlist_state?.selected_set?.length)return;
          try { await stopProgress.react?.(intent); } catch { /* Best effort acknowledgment. */ }
        },
        ...(env.WISHLIST_ENABLED==='true'&&env.SEARCH_ENABLED==='true'&&!images.length?{
          wishlistState,
          wishlistAction: (args,resolvedState=wishlistState)=>(trace.mark('tool:wishlist_'+args.action),textWishlistAction(args,{state:resolvedState,env,facts:memory.facts,
            rank:async(products,input)=>rankDiscoveryProducts(products,{...input,facts:[...input.facts.filter(f=>f.field!=='shopping_history'),...(history?await history.detail():[])]}),
            record:async result=>{if(trace.abandoned)return;await store.searchResult(operation,result);searchResult=result;sourceImages=[];},
          })),
        }:{}),
        ...(env.MEMORY_ENABLED==='true'&&current?{
          profileAction:async args=>{const result=await updateProfile(store,conversationId,current,args);if(result.saved){await store.memoryStatus(delivery.message.id,'saved');trace.done('profile',typeof args.acknowledgment==='string'&&!/https?:\/\//i.test(args.acknowledgment)?args.acknowledgment.trim().slice(0,300):null);}return result;},
          profileFailed:()=>store.memoryStatus(delivery.message.id,'failed'),
        }:{}),
        ...(onboardingAvailable(session,env)?{onboarding:{state:session?.state??null,style_reading_available:env.STYLE_ENABLED==='true',gmail_import:env.GMAIL_IMPORT_ENABLED==='true'},
          onboardingAction:action=>(trace.mark('tool:onboarding'),onboardingAction(action,{conversationId,session,store,env}))}:{}),
        ...(env.CHECKOUT_LINKS_ENABLED==='true'&&env.WISHLIST_ENABLED==='true'&&env.SEARCH_ENABLED==='true'&&!images.length?{checkoutAction:async targets=>{
          trace.mark('tool:prepare_checkout');
          const links=await Promise.all(targets.map(target=>checkoutLink(target,{env:marketEnvironment(memory.facts,env)})));
          // PRD §18: a purchase request returns a link and records the intent; nothing is bought.
          console.log(JSON.stringify({event:'purchase_intent',items:links.map(l=>({status:l.status,provider:l.provider??null,store:l.store}))}));
          await recordAdoptionEvent(store,{conversation_id:conversationId,kind:'purchase_intent',ref:operation,quantity:links.length});
          searchResult={identification_policy:'checkout_link',purchase_intent:true,checkout_links:links.map(({url,status,provider,store:merchant,size,variant_id,checkout_url})=>({url,status,provider:provider??null,store:merchant,size:size??null,variant_id:variant_id??null,checkout_url:checkout_url??null})),
            products:[],text_wishlist_state:wishlistState,checked_at:new Date().toISOString()};
          await store.searchResult(operation,searchResult);
          return checkoutReply(links);
        }}:{}),
        // Outfit photos are kept by message, so a replayed delivery or a later reference keeps each once.
        ...(env.STYLE_ENABLED==='true'&&store.writeStyle?{outfitPhotosAction:async(found,requestedId)=>{
          trace.mark('tool:add_outfit_photos');
          const messageId=requestedId??(images.length?delivery.message.id:referencedImage(context)?.id);
          if(!messageId)return 'There were no photos to keep. Ask the user to send their outfit photos again.';
          answering({used:[messageId]});
          const kept=await keepOutfitPhotos({store,owner:conversationId,messageId,images:found});
          outfitsReady=kept.added>0&&kept.total>=OUTFIT_TARGET;
          // New photos are also read for the style report's Read card, after this reply.
          if(kept.added>0)readPhotoIds=found.map((_,position)=>outfitSourceId(conversationId,messageId,position));
          return kept.body;
        }}:{}),
        ...(store.saveQualitySignal?{qualitySignal:signal=>store.saveQualitySignal(delivery.message.id,{...signal,at:new Date().toISOString()})}:{}),
        ...(alerts&&store.disablePriceAlert&&env.PRICE_ALERTS_ENABLED==='true'?{alertsAction:(operation,ids)=>(trace.mark('tool:manage_price_alerts'),manageAlerts(operation,ids,{store,conversationId,items:wishlistItems,alerts,outcome}))}:{}),
        // Order screenshots join the purchase history. Several screenshot messages can be read together
        // (the scrolled parts of one order); each read is recorded by its messages, so a replay imports once.
        ...(env.GMAIL_IMPORT_ENABLED==='true'&&store.claimGmailImport?{recentImageMessages,orderScreenshotAction:async(ids,storeName)=>{
          trace.mark('tool:add_order_screenshot');
          const own=context.find(m=>m.provider_id===delivery.message.id),shots=context.filter(m=>m.direction==='inbound'&&(m.message_images?.length||(m===own&&images.length)));
          const chosen=(ids.length?ids.map(id=>shots.find(m=>m.id===id)):[own&&images.length?own:referencedImage(context)]).filter(Boolean)
            .filter((m,i,all)=>all.indexOf(m)===i).sort((a,b)=>String(a.created_at??'').localeCompare(String(b.created_at??'')));
          const found=[];
          answering({used:chosen.map(m=>m.id??delivery.message.id)});
          for(const m of chosen)found.push(...(m===own&&images.length?images:await store.imagesForMessage(m.id)));
          const result=await screenshotImport({store,owner:conversationId,messageIds:chosen.map(m=>m.id??delivery.message.id),storeName,images:found,env,fetcher:trace.fetch(fetch),
            caption:chosen.map(m=>m.body).filter(b=>b&&b!==IMAGE_PLACEHOLDER).join('\n')});
          if(result.user)trace.done('purchase_history',result.user);
          if(result.failure)console.log(JSON.stringify({event:'agent_tool_degraded',tool:'add_order_screenshot',failure:result.failure}));
          return result;
        }}:{}),
        ...(purchaseHistory&&!images.length?{purchaseHistoryAction:async()=>{
          trace.mark('tool:update_purchase_history');
          const result=await historyUpdate(delivery,conversationId,store,env);historyUpdated=result.updated;
          if(result.updated||result.queued)trace.done('purchase_history',result.body);
          if(result.failure)console.log(JSON.stringify({event:'agent_tool_degraded',tool:'update_purchase_history',failure:result.failure}));
          return result.body;
        }}:{}),
        loadImages: async requestedId => {
          const reference=referencedImage(context,requestedId);
          if (!reference) return [];
          const loaded = await store.imagesForMessage(reference.id);
          console.log(JSON.stringify({event:'image_reference_loaded',source_message_id:reference.id,
            explicitly_referenced:Boolean(reference.explicit_reply),count:loaded.length}));
          sourceImages = [...reference.message_images].sort((a,b)=>(a.position??0)-(b.position??0));
          if (loaded.length) answering({ used: [reference.id] });
          return loaded;
        },
        recordSearch: async result => {
          if (trace.abandoned) return;
          const referenced={...result,products:(result.products??[]).map(p=>({...p,...(sourceImages[p.source_image_index??0]?.id?{source_image_id:sourceImages[p.source_image_index??0].id}:{})}))};
          await store.searchResult(operation,referenced);
          searchResult = referenced;
          products = result.identification_policy === 'visual_comparison' ? result.products ?? [] : [];
        },
      }));
      // The whole turn has one deadline, leaving time to send a reply before the function limit. Work
      // still running past it is abandoned: its late outcome is not recorded against this reply.
      let deadlineTimer;
      const deadline = new Promise((_, reject) => { deadlineTimer = setTimeout(() => { trace.abandoned = true; reject(new Error('Turn deadline')); }, Math.max(0, turnDeadlineMs - trace.elapsed())); deadlineTimer.unref?.(); });
      deadline.catch(() => {});
      try {
        trace.mark('agent');
        try { body = await Promise.race([reply(false), deadline]); }
        catch (error) {
          // One retry with a smaller context before the fallback, when there is time for it. A partial
          // outcome from the failed attempt is discarded so it cannot attach to a different reply.
          // A save already committed this turn is never repeated by a retry.
          if (committed || trace.abandoned || turnDeadlineMs - trace.elapsed() < 45000) throw error;
          console.log(JSON.stringify({ event: 'agent_reply_retry', context: 'compact', error_class: failureReason(error, trace).error_class }));
          compactRetry = true;
          trace.mark('retry');
          if (searchResult) { searchResult = null; await store.searchResult(operation, null); }
          agentFallback = null; products = []; sourceImages = initialImages; historyUpdated = false; outfitsReady = false; readPhotoIds = null; chosenTool = null; threading = { answered: [], used: [] };
          body = await Promise.race([reply(true), deadline]);
        }
      } finally { clearTimeout(deadlineTimer); }
    }
    catch (error) {
      // Record why the reply failed (error class and code only, never message text) so a fallback is diagnosable.
      diagnostics = { outcome: 'fallback', ...failureReason(error, trace, { compact_retry: compactRetry, images: delivery.message.attachments?.length ?? 0, completed: trace.completed.map(c => c.kind) }) };
      console.log(JSON.stringify({event:'ai_reply_failed',operation,error:error?.name??null,reason:String(error?.message??'').slice(0,80),
        database_status:error?.database_status??null,database_code:error?.database_code??null,images:delivery.message.attachments?.length??0,
        step:diagnostics.step,error_class:diagnostics.error_class,model_status:diagnostics.model_status,model_error_code:diagnostics.model_error_code,model_limit:diagnostics.model_limit,elapsed_ms:diagnostics.elapsed_ms}));
      trace.abandoned = true;
      source = 'ai_fallback';
      products = [];
      if (searchResult) { searchResult = null; try { await store.searchResult(operation, null); } catch { /* the fallback row then keeps it */ } }
      body = delivery.message.attachments?.length && diagnostics.error_class === 'image' ? 'i couldn’t read that image. please try a JPG, PNG, WebP, or HEIC image under 3 MB (up to three at a time).' : fallbackReply(trace);
    }
    if (env.WISHLIST_ENABLED === 'true' && source === 'ai' && searchResult?.user_confirmed === true && !committed) body = await commitConfirmed();
    // The model writes every reply that code drafted (search results, saves, alerts, questions),
    // from the outcome and in Jules's voice. Replies the agent already wrote itself are sent as is.
    let captions = [];
    // Who wrote the sent text, for chat metrics: the model, code's draft (template), or both.
    let composedBy = source !== 'ai' || chosenTool === 'agent_plain' ? 'template' : 'model', composeFallback = null;
    if (source === 'ai' && !['agent_reply', 'agent_plain'].includes(chosenTool) && (confirmedBeforeSend || !SENT_AS_IS.includes(chosenTool))) {
      trace.mark('compose');
      const photos = products.slice(0, 3);
      const composed = await withUsage({ store, env, conversation: conversationId, operation, feature: 'chat' }, () => { labelUsage('compose'); return compose({ draft: body, facts: outcome, photos, conversation: recentTurns(recent), purpose: chosenTool ?? 'reply', env }); });
      body = composed.body; captions = composed.captions; composedBy = composed.composed ? 'model' : 'template'; composeFallback = composed.fallback ?? null;
    }
    if (captions.length) products = products.map((p, i) => captions[i] ? { ...p, caption: captions[i] } : p);
    // A fallback answers nothing in particular, except an unreadable photo, which it is about.
    replyTarget = source === 'ai' ? threadTarget(delivery.message, recent, threading)
      : replyProviderId(delivery.message) || (diagnostics?.error_class === 'image' && delivery.message.attachments?.length) ? delivery.message : null;
    console.log(JSON.stringify({ event: 'reply_thread', operation, threaded: Boolean(replyTarget), tester_thread: Boolean(replyProviderId(delivery.message)),
      under_newest: replyTarget?.id === delivery.message.id, answered: new Set(threading.answered).size, photos_read: new Set(threading.used).size }));
    await updates.finish();
    trace.mark('prepare');
    // A reply that follows an acknowledgment is dated when it is sent, so history keeps send order.
    await store.prepareAI(operation, body, source, { resequence: updates.timing.first_message_ms !== null });
    let sent;
    trace.mark('send');
    // A send that never answers may still have been delivered, so it is recorded as uncertain, never resent.
    // History keeps the store links; the sent text carries tracked links when LINK_CLICK_TRACKING is on.
    const outgoing = env.LINK_CLICK_TRACKING === 'true' && searchResult ? trackLinks(body, searchResult, operation, env) : body;
    try { sent = await within(sendTimeoutMs, (async () => send(delivery, await signInLinks(outgoing,{store,conversationId,env}), env, { replyTarget, products }))(), 'Send timed out'); }
    catch (error) {
      await store.finish(operation, 'uncertain');
      await trace.write({ ...(diagnostics ?? {}), outcome: diagnostics ? 'fallback' : 'uncertain', delivery: 'uncertain', send_error: error?.name ?? null, elapsed_ms: trace.elapsed() });
      return 'imessage_ai_reply_uncertain';
    }
    const resultMs = now() - updates.started;
    const timing = { ...updates.timing, first_message_ms: updates.timing.first_message_ms ?? resultMs, result_ms: resultMs, compact_retry: compactRetry };
    console.log(JSON.stringify({ event: 'turn_timing', operation, ...timing }));
    if (sent?.id && store.recordDelivery) {
      try { await store.recordDelivery(operation, sent.id, replyTarget?.id ?? null); }
      catch { console.log(JSON.stringify({event:'imessage_delivery_reference_failed',operation})); }
    }
    await store.finish(operation, 'sent');
    const shown = searchResult ? shownProducts(body, searchResult) : 0;
    if (shown) await recordAdoptionEvent(store, { conversation_id: conversationId, kind: 'results_shown', ref: operation, quantity: shown });
    // Every fallback is persisted with its reason and texted to the founder, after the tester has the reply.
    if (diagnostics) {
      diagnostics.founder_alerted = await alert(env, { line: delivery.space?.phone, kind: 'fallback', conversationId, diagnostics }, { send });
      await trace.write(diagnostics);
    } else await trace.write({ outcome: 'sent', step: trace.step, elapsed_ms: trace.elapsed(), model_status: trace.model?.status ?? null, compact_retry: compactRetry, steps: trace.steps, composed_by: composedBy, ...(composeFallback ? { compose_fallback: composeFallback } : {}), ...(agentFallback ? { agent_fallback: agentFallback } : {}) });
    // Timing is kept with a search outcome for feedback triage. Turns without one keep no result,
    // because an outcome row would replace the pending shopping state.
    if (searchResult) {
      searchResult = { ...searchResult, timing_diagnostics: timing, composed_by: composedBy };
      try { await store.searchResult(operation, searchResult); }
      catch { console.log(JSON.stringify({ event: 'turn_timing_record_failed', operation })); }
    }
    if(historyUpdated)await continuePurchaseQuestions(store,conversationId,env,send);
    // Enough outfit photos: the style summary that was waiting for them follows this reply.
    if(outfitsReady&&env.GMAIL_IMPORT_ENABLED==='true')await profileAfterOutfits(store,conversationId,env,send);
    // The Read takes a vision call; it finishes after the webhook responds where it can.
    if(readPhotoIds&&env.GMAIL_IMPORT_ENABLED==='true'){const reading=readAfterOutfits(store,conversationId,env,{photoIds:readPhotoIds,send});if(defer)defer(reading);else await reading;}
    if (env.WISHLIST_ENABLED === 'true'&&!confirmedBeforeSend&&searchResult?.user_confirmed===true) {
      let confirmation=null,saveDone=false;
      try {
        await store.saveWishlist(operation);saveDone=true;
        confirmation=await finishTextWishlist({store,operation,conversationId,result:searchResult,env,outcome});
      }
      catch {
        console.log(JSON.stringify({event:'wishlist_save_failed',operation}));
        if(searchResult?.user_confirmed){
          const settled=await settleTextWishlist({store,operation,conversationId,result:searchResult,env,save:saveDone?null:store.saveWishlist,outcome});
          console.log(JSON.stringify({event:'wishlist_save_settled',operation,saved:settled.saved,alerts:settled.alerts}));
          confirmation=settledReply(settled,env);
        }
      }
      if(confirmation){
        await deliverReply({store,send,conversation:{id:conversationId,sender_id:delivery.message.sender.id,line:delivery.space.phone},operation:`wishlist-confirm:${delivery.message.id}`,body:confirmation,source:'operator',env,facts:outcome,purpose:'save_confirmation',compose});
      }
    }
    return source === 'ai' ? 'imessage_ai_reply_sent' : 'imessage_ai_fallback_sent';
    } catch (error) {
      // The step this turn reached, for the failure log line (lib/imessage.js or the deferred catch).
      if (error && typeof error === 'object') error.inbox_step ??= trace.step;
      throw error;
    } finally { try { await updates.finish(); await stopProgress(); } catch { /* Best effort cleanup. */ } }
    }
  }
  // With the agent off, messages are stored for the operator; no wording triggers a reply.
  return 'imessage_received';
}
