import {onboardingAction,onboardingAvailable,onboardingContext,signInLinks} from './onboarding.js';
import {keepOutfitPhotos,outfitSourceId,OUTFIT_TARGET} from './outfit-photos.js';
import {addLikedItems,forgetLikedItems,likedOptionEvidence} from './liked-items.js';
import {readScreenshotProducts} from './screenshot-products.js';
import {readUserContext} from './user-context.js';
import {readAfterOutfits} from './style-report.js';
import {profileAfterOutfits} from './receipt-notifications.js';
import {updatePurchaseHistory,continuePurchaseQuestions,importOrderScreenshots} from './receipt-chat.js';
import {interviewEnabled,interviewContext,recordAnswer,continueInterview,startInterview,questionsLeft,INTERVIEW_LEAD_IN} from './interview.js';
import {managePurchaseTexts} from './purchase-texts.js';
import { wishlistProducts,groupWishlist } from './wishlist.js';
import { wishlistPurchaseChat } from './wishlist-purchases.js';
import { textWishlistAction, finishTextWishlist, settleTextWishlist, settledReply, withEarlierActions } from './text-wishlist.js';
import { rankDiscoveryProducts } from './discovery-ranking.js';
import { withUsage, labelUsage } from './usage.js';
import { sizeKey, ONE_SIZE } from './price-alerts.js';
import { lowStockSummary } from './low-stock.js';
import { createStore } from './store.js';
import { deliverReply } from './replies.js';
import { updateProfile } from './memory.js';
import { generateReply, searchFollowup } from './ai.js';
import { turnActions } from './turn-actions.js';
import { routeCoverage } from './skills/router.js';
import { checkoutLink, checkoutReply } from './checkout.js';
import { marketEnvironment } from './shopping-market.js';
import { beginProgress, fetchImages, sendGreeting } from './photon.js';
import { IMAGE_PLACEHOLDER } from './images.js';
import { imageReferences, referencedImage, replyProviderId, threadTarget } from './message-context.js';
import { handleComplianceKeyword } from './sms-compliance.js';
import { composeReply, recentTurns } from './compose.js';
import { developerReport, FEEDBACK_ACK, CONTINUATION_NOTE, CONTINUATION_ACK, reportToContinue, continuesReport } from './developer-feedback.js';
import { turnTrace, failureReason, fallbackReply, alertFounder, reportInboundFailure, safeError, STALL_MS } from './reply-failures.js';
import { productPreviews, recordAdoptionEvent, shownProducts, trackLinks } from './adoption-events.js';
import { shopperWords } from './stylist.js';
import { WAITLIST_NOTICE, waitlistContext, waitlistTurn } from './waitlist.js';
import { checkCaps, capNotice, logCapReached, NOTICE_EVERY_MS } from './cost-caps.js';
import { scanSavedItems } from './store-scan.js';
import { loadOpenOffer, acceptedBrief, declinedBrief, settleOffer, readOfferReply } from './goes-with.js';

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
  const search=last?.discovery?.status==='unavailable'?' i couldn’t search for other stores on the last check; i’ll try again.':'';
  return `watching ${stores} ${stores===1?'store':'stores'}; reference price ${money(reference.amount,reference.currency)} at ${host(reference.url)}.${stock}${lowStockState(alert)}${search}${checked}`;
}
// The low-stock part of an alert: off, or the last verified low reading (lib/low-stock.js).
function lowStockState(alert){
  if(alert.low_stock_alerts===false)return ' nearly-sold-out texts are off for this item.';
  const low=lowStockSummary(alert);
  return low?` ${low.store} showed only ${low.quantity} left${sizeKey(low.size)!==sizeKey(ONE_SIZE)?` in ${low.size}`:''}.${alert.last_result?.low_stock?.episode?.notified_at?' i already texted you about that.':''}`:'';
}
// Alert status and cancellation for saved items. Item IDs must belong to this user's wishlist.
export async function manageAlerts(operation,ids,{store,conversationId,items,alerts,outcome={}}){
  const targets=ids.length?items.filter(i=>ids.includes(i.id)):items;
  if(ids.length&&!targets.length)return 'i couldn’t find that item in your wishlist. which one do you mean?';
  const active=targets.flatMap(i=>alerts.filter(a=>a.group_id===i.id&&a.active).map(a=>({item:i,alert:a})));
  const names=active.map(({item,alert})=>item.name+(alert.size&&sizeKey(alert.size)!==sizeKey(ONE_SIZE)?` (size ${alert.size})`:'')).join('; ');
  if(operation==='status')return active.length?`price alerts are on for ${names}. i check every three days and text you when the price drops, your size comes back in stock, or the store shows 3 or fewer left in your size.\n`+active.map(({item,alert})=>`${item.name}: ${alertState(alert)}`).join('\n'):`you don’t have any price alerts on${ids.length?' for that item':''}.`;
  if(operation==='low_stock_off'||operation==='low_stock_on')return lowStockTexts(operation==='low_stock_on',active,ids,{store,conversationId});
  if(operation!=='cancel')return 'that alert change isn’t available.';
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
// Only the nearly-sold-out texts on the chosen items' alerts; price-drop and restock texts stay on.
async function lowStockTexts(on,active,ids,{store,conversationId}){
  if(!active.length)return `there isn’t an active price alert${ids.length?' on that item':''}, so there are no nearly-sold-out texts to turn ${on?'on':'off'}. want me to set a price alert?`;
  const names=active.map(({item})=>item.name).join('; ');
  try{for(const {item} of active)await store.setLowStockAlerts(conversationId,item.id,on);}
  catch{
    console.log(JSON.stringify({event:'low_stock_toggle_failed',on}));
    let changed=null;
    try{const current=await store.priceAlerts(conversationId);changed=active.filter(({item})=>current.some(a=>a.group_id===item.id&&(a.low_stock_alerts!==false)===on));}catch{/* unknown */}
    if(!changed)return `i couldn’t confirm the nearly-sold-out texts were turned ${on?'on':'off'}. please try again.`;
    if(changed.length<active.length)return `i couldn’t turn ${on?'on':'off'} the nearly-sold-out texts for ${active.filter(a=>!changed.includes(a)).map(({item})=>item.name).join('; ')}. please try again.`;
  }
  console.log(JSON.stringify({event:'low_stock_toggled',on,items:active.length}));
  return on?`nearly-sold-out texts are back on for ${names}: i’ll text you once when the store shows 3 or fewer left in your size.`
    :`nearly-sold-out texts are off for ${names}. price-drop and back-in-stock alerts stay on.`;
}
// Messages sent while a search runs: the acknowledgment the agent wrote with its search, and one
// model-written follow-up if the search passes the deadline. Testers said they would rather wait than
// get the follow-up (October 16), so it waits until 90 s, past most finished searches (p90 ~82–99 s).
// The 90 s count from the start of the turn, not of the search: counted from a search that began
// 13 s in, the follow-up landed a second before the 105 s deadline's failure text (October 19). Neither may arrive after the result:
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
      // A search that begins after the follow-up time is near the turn deadline: its acknowledgment is the update.
      const wait = followupAfterMs - (now() - started);
      if (wait <= 0) { onStart(); return; }
      timer = setTimeout(async () => {
        let body = null;
        try { body = await writeFollowup({ brief, acknowledgment }); } catch { /* No model text, no follow-up. */ }
        console.log(JSON.stringify({ event: 'search_deadline_passed', followup_written: Boolean(body) }));
        if (body) await post('followup', body);
      }, wait);
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
// A message soon after a report may finish it (a link or screenshot the note led into). A model reads
// it with the report; when it adds to the report it is appended there and acknowledged, and never
// reaches the agent. A failed check leaves the message to the agent as usual.
async function continueDeveloperReport(delivery, conversationId, env, { store, send, loadImages, now, check }) {
  if (env.AI_ENABLED !== 'true' || !store.inboundBefore) return null;
  const text = typeof delivery.message.content?.text === 'string' ? delivery.message.content.text.trim() : '';
  const images = delivery.message.attachments?.length ?? 0;
  let report;
  try {
    report = reportToContinue(await store.inboundBefore(conversationId, delivery.message.id), now());
    if (!report || !text && !images) return null;
    const secondsAfter = Math.round((now() - Date.parse(report.created_at)) / 1000);
    // Jules's latest message before the report (feedback acknowledgments are not in recent), so an
    // answer to its question is told apart from the rest of the report. Optional context.
    const julesLast = await Promise.resolve(store.recent?.(conversationId, 6)).then(rows => (rows ?? []).filter(m => m.direction === 'outbound' && m.status === 'sent' && Date.parse(m.created_at) <= Date.parse(report.created_at)).at(-1)?.body ?? null).catch(() => null);
    // Metered to the tester like any other turn; over a spending cap it throws and the message goes on as usual.
    const reading = () => check({ report:report.developer_feedback, message:text, images, secondsAfter, julesLast }, env);
    if (!await withUsage({ store, env, conversation:conversationId, operation:`feedback-check:${delivery.message.id}`, feature:'developer_feedback', quiet:true }, reading)) {
      console.log(JSON.stringify({ event:'developer_feedback_not_continued', seconds_after:secondsAfter }));
      return null;
    }
  } catch { console.log(JSON.stringify({ event:'developer_feedback_continuation_failed' })); return null; }
  if (images) {
    try { await store.saveImages(delivery.message.id, await loadImages(delivery, env)); }
    catch { console.log(JSON.stringify({ event:'developer_feedback_images_failed' })); }
  }
  await store.saveFeedback(delivery.message.id, CONTINUATION_NOTE);
  if (text) await store.saveFeedback(report.provider_id, `${report.developer_feedback}\n${text}`);
  console.log(JSON.stringify({ event:'developer_feedback_continued', images }));
  await deliverReply({ store, send, conversation:{id:conversationId,sender_id:delivery.message.sender.id,line:delivery.space.phone},
    operation:`feedback:${delivery.message.id}`, body:CONTINUATION_ACK, source:'operator', env, compose:asWritten });
  return 'developer_feedback_continued';
}
// The answer's extra messages (product cards, their captions and photos, a wishlist card) by provider
// id, kept with its diagnostics so a reply threaded under one resolves to this answer (store.context).
const sentParts = sent => Array.isArray(sent?.parts) && sent.parts.length ? { sent_parts: sent.parts.slice(0, 12) } : {};
// Tools whose reply text the agent writes itself; everything else is drafted by code and composed.
// agent_reply is the agent loop's own checked message (lib/ai.js), or its plain factual fallback.
// agent_plain is its plain factual fallback (sent as drafted, not rewritten).
const MODEL_WRITTEN = ['agent_reply', 'conversation_reply', 'profile_status', 'wishlist_status', 'update_profile'];
export const SENT_AS_IS = [...MODEL_WRITTEN, 'agent_plain'];
// Newest message wins (October 20: a search's results arrived after the shopper had already added
// detail). A turn whose conversation has a newer message with its own reply in progress sets its
// work aside instead of sending it, unless it already saved or changed something; the newer turn
// waits briefly for it, then answers the open request and the new message together.
export const SUPERSEDE_POLL_MS = 2500;
const OLDER_TURN_WAIT_MS = 12000;
export async function receiveInInbox(delivery, env, { store = createStore(env), send = sendGreeting, generate = generateReply, loadImages = fetchImages, progress = beginProgress, compose = composeReply,
  defer = null, scanStores = scanSavedItems, followupAfterMs = SEARCH_FOLLOWUP_MS, writeFollowup = brief => searchFollowup(brief, env), now = Date.now,
  turnDeadlineMs = 105000, progressTimeoutMs = 5000, supersedePollMs = SUPERSEDE_POLL_MS, pause = ms => new Promise(resolve => setTimeout(resolve, ms)), sendTimeoutMs = 30000, alert = alertFounder, historyUpdate = updatePurchaseHistory, screenshotImport = importOrderScreenshots, continuationCheck = continuesReport } = {}) {
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
  const continued = await before('developer_feedback', () => continueDeveloperReport(delivery, conversationId, env, { store, send, loadImages, now, check:continuationCheck }));
  if (continued) return continued;
  if (env.AI_ENABLED === 'true') {
    const operation = `ai:${delivery.message.id}`;
    // Over a spending cap (lib/cost-caps.js): no paid work. The message is already stored, so the next one
    // picks it up; a fixed notice says so, at most every few hours, and never claims results. Checked before
    // the AI claim so no reply is left 'generating' for the stalled-reply watchdog; the notice's own
    // operation id keeps a redelivered webhook from texting twice.
    const capped = await before('cost_cap', () => checkCaps(store, conversationId, env, { now: new Date(now()), fresh: true }));
    if (capped.capped) {
      logCapReached(capped, 'chat');
      const noticed = await Promise.resolve(store.noticeSince?.(conversationId, 'cost-cap:', new Date(now() - NOTICE_EVERY_MS).toISOString())).catch(() => false);
      if (noticed && !await store.operation?.(`cost-cap:${delivery.message.id}`)) return 'imessage_cost_cap_quiet';
      await deliverReply({ store, send, conversation:{id:conversationId,sender_id:delivery.message.sender.id,line:delivery.space.phone},
        operation:`cost-cap:${delivery.message.id}`, body:capNotice(capped, new Date(now())), source:'operator', env, compose:asWritten });
      return 'imessage_cost_cap_notice';
    }
    if (!await before('claim', () => store.claimAI(conversationId, operation))) return 'imessage_ai_duplicate';
    // Waitlisted numbers get a few real replies, then the fixed notice at most once a day (lib/waitlist.js).
    const waitlistedTurn = env.WAITLIST_ENABLED === 'true' ? await before('waitlist', () => waitlistTurn(store, conversationId)) : null;
    // The claim above stays first so a redelivered webhook never uses a waitlist turn. A notice or quiet
    // turn closes it as 'blocked' (recorded, never sent), so the stalled-reply watchdog does not text a
    // recovery or alert the founder about a reply that was never meant to go.
    if (['notice', 'quiet'].includes(waitlistedTurn?.outcome)) {
      await before('waitlist', async () => {
        await store.replyDiagnostics?.(operation, { outcome: `waitlist_${waitlistedTurn.outcome}`, replies_used: waitlistedTurn.replies_used });
        await store.finish(operation, 'blocked');
      });
    }
    if (waitlistedTurn?.outcome === 'quiet') return 'imessage_waitlist_quiet';
    if (waitlistedTurn?.outcome === 'notice') {
      await deliverReply({ store, send, conversation:{id:conversationId,sender_id:delivery.message.sender.id,line:delivery.space.phone},
        operation:`waitlist:${delivery.message.id}`, body:WAITLIST_NOTICE, source:'operator', env, compose:asWritten });
      return 'imessage_waitlist_notice';
    }
    const waitlist = waitlistContext(waitlistedTurn);
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
    const turnActionList = [];
    // The shadow router's reading (lib/skills/router.js), kept with the turn after the reply is out.
    let routing = null;
    const skillRoute = async () => { const route = routeCoverage(await routing?.catch(() => null) ?? null, turnActionList); return route ? { skill_route: route } : {}; };
    let agentFallback = null, replyRejections = [], consentChecks = [], stateWriteFailures = [], searchResult = null, sourceImages = [], historyUpdated = false, outfitsReady = false, readPhotoIds = null, interviewNext = null, compactRetry = false, recent = [], chosenTool = null, diagnostics = null, imageInfo = [], goesWithOffer = null, offerOutcome = null, offerStopped = false;
    // What this turn actually did, for the composer's claim checks (lib/compose.js).
    const outcome = { saved_now:false, alerts_turned_on:false, alerts_turned_off:false };
    // Saves a confirmed selection (and its alerts) before the reply is sent, and returns the factual
    // confirmation. The agent loop calls it as soon as a save or alert request is approved, so the
    // model's message reports what actually happened; otherwise it runs after the agent returns.
    let committed = false, confirmedBeforeSend = false;
    // A turn set aside for a newer message: nothing is sent, the row is closed as recorded-not-sent
    // (so the watchdog never recovers it) and why is kept with it. Its search state is not used by
    // later turns, which read only sent replies.
    const setAside = async () => {
      trace.abandoned = true;
      await updates.finish();
      console.log(JSON.stringify({ event: 'ai_reply_superseded', operation, step: trace.step, elapsed_ms: trace.elapsed() }));
      await store.finish(operation, 'blocked');
      await trace.write({ ...turnActions(turnActionList, outcome, chosenTool), outcome: 'superseded', step: trace.step, elapsed_ms: trace.elapsed(), steps: trace.steps,
        ...(stateWriteFailures.length ? { state_write_failures: stateWriteFailures.slice(0, 4) } : {}) });
      return 'imessage_ai_superseded';
    };
    const recordFailedSave=async()=>{
      const pending=searchResult?.text_wishlist_state;
      searchResult={...searchResult,user_confirmed:false,text_wishlist_state:pending?{...pending,already_saved:false,offered_action:null,confirmed_consent:null}:null};
      await store.searchResult(operation,searchResult);
    };
    // After a save, other trusted stores are checked for a lower price in the background (lib/store-scan.js);
    // the confirmation never waits for it. Metered to the shopper and skipped over a spending cap.
    const scanAfterSave = () => {
      if (!defer || env.STORE_SCAN_ENABLED === 'false') return;
      defer((async () => {
        const cap = await checkCaps(store, conversationId, env);
        if (cap.capped) { logCapReached(cap, 'store_scan'); return; }
        await withUsage({ store, env, conversation: conversationId, operation: `store-scan:${operation}`, feature: 'store_scan', quiet: true }, () => scanStores({ store, operation, env }));
      })().catch(() => console.log(JSON.stringify({ event: 'store_scan_failed', operation }))));
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
        if(!searchResult.existing_saved_groups?.length){await store.saveConfirmedWishlist(operation);scanAfterSave();} saved=true;
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
      // An earlier reply still being prepared sets itself aside once it sees this message (above);
      // waiting for it means this turn reads the conversation as the shopper left it.
      if (store.olderTurnRunning) {
        const since = new Date(now() - STALL_MS).toISOString();
        for (let waited = 0; waited < OLDER_TURN_WAIT_MS && await store.olderTurnRunning(conversationId, operation, since).catch(() => false); waited += 1000) {
          if (!waited) trace.note('wait:older_turn');
          await pause(1000);
        }
      }
      if (delivery.message.attachments?.length) {
        let stage = 'download';
        try {
          images = await loadImages(delivery, env);
          imageInfo = images.map(image => image.info ?? null);
          console.log(JSON.stringify({event:'image_downloaded',count:images.length}));
          stage = 'save';
          await store.saveImages(delivery.message.id, images);
          console.log(JSON.stringify({event:'image_saved',count:images.length}));
        } catch (error) {
          await store.imageStatus(delivery.message.id, 'failed');
          // Which step failed and the attachment's sizes, so a failed photo is diagnosable from reply_diagnostics.
          throw Object.assign(new Error('Image could not be read'), { image_failure: { stage,
            reason: stage === 'save' ? 'image_save_failed' : error?.image_reason ?? 'image_load_failed', ...(error?.image_info ? { info: error.image_info } : {}) } });
        }
      }
      // Independent reads run together. What Jules knows about the person comes from the user
      // context layer (lib/user-context.js), where each source degrades to empty on failure.
      const likesOn = env.MEMORY_ENABLED==='true'&&Boolean(store.evidence&&store.recordEvidence&&store.deleteEvidence);
      const [context, userContext, wishlistState, alerts, entries, session] = await Promise.all([
        store.context(conversationId, delivery.message.id),
        readUserContext(store, conversationId, env),
        env.WISHLIST_ENABLED==='true'&&env.SEARCH_ENABLED==='true'&&store.textWishlistState&&!images.length ? store.textWishlistState(conversationId) : null,
        env.WISHLIST_ENABLED==='true'&&env.PRICE_ALERTS_ENABLED==='true'&&store.priceAlerts ? store.priceAlerts(conversationId) : [],
        env.WISHLIST_ENABLED==='true'&&store.wishlistEntries ? store.wishlistEntries(conversationId) : [],
        env.ONBOARDING_ENABLED==='true' ? store.onboardingSession(conversationId) : null,
      ]);
      recent = context;
      // The onboarding state the agent reads, with the one chat re-offer's availability (lib/onboarding.js).
      const onboardingState = onboardingAvailable(session,env) ? await onboardingContext(session,env,store,conversationId) : null;
      sourceImages = [...(referencedImage(context)?.message_images ?? [])].sort((a,b) => (a.position ?? 0) - (b.position ?? 0));
      const memory = { facts: userContext.facts };
      // Taste interview (lib/interview.js): the questions Jules asked, so the agent can tell what a reply answers.
      const interviewOn = interviewEnabled(store, env);
      if (interviewOn) { const state = await store.interview(conversationId).then(r => r.state).catch(() => null); if (state) memory.interview = interviewContext(state); }
      const purchaseHistory = userContext.purchases > 0;
      // An open "goes with your new purchase" offer (lib/goes-with.js): the model reads whether this message answers it.
      if (env.PURCHASE_TEXTS_ENABLED==='true' && store.nudgeState && store.claimGmailImport) goesWithOffer = await loadOpenOffer(store, conversationId).catch(() => null);
      const current = context.filter(m => m.direction === 'inbound').at(-1);
      const wishlistItems=groupWishlist(entries??[]).map(({id,name,links,bought})=>({id,name,links:links.map(({url,verification_status})=>({url,verification_status})),
        price_alert:(alerts??[]).find(a=>a.group_id===id&&a.active)?{active:true,size:alerts.find(a=>a.group_id===id&&a.active).size??null,nearly_sold_out_texts:alerts.find(a=>a.group_id===id&&a.active).low_stock_alerts!==false}:null,
        // Marked "I bought this": in the Bought filter and the wardrobe (lib/wishlist-purchases.js).
        ...(bought?{bought:{at:bought.at,store:bought.store??null}}:{})}));
      const initialImages = sourceImages;
      // Recent messages with images, so the agent can read several screenshots together.
      const recentImageMessages = context.filter(m => m.direction === 'inbound' && (m.message_images?.length || (m.provider_id === delivery.message.id && images.length)))
        .slice(-6).map(m => ({ id: m.id ?? null, caption: m.body === IMAGE_PLACEHOLDER ? '' : (m.body ?? '').slice(0, 200), created_at: m.created_at ?? null }));
      const reply = compact => withUsage({ store, env, conversation: conversationId, operation, feature: 'chat' }, () => generate(context, env, trace.fetch(fetch), { ...memory, images,wishlistItems,imageReferences:imageReferences(context),executionContext:store.executionContext??{mode:'production'},
        ...(compact?{compact:true}:{}), searchStarting: search => updates.begin(search),
        onReply: name => { chosenTool = name; }, onAction: action => { turnActionList.push(action); }, onRoute: reading => { routing = reading; }, onFallback: info => { agentFallback = info; }, onRejected: ({ problem_kinds }) => { replyRejections.push(problem_kinds); },
        // The consent check's structured reading (no message text), kept so triage can see why a save ran or was blocked.
        onConsent: reading => { consentChecks.push(reading); }, answering,
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
          wishlistAction: (args,resolvedState=wishlistState)=>(trace.mark('tool:wishlist_'+args.action),textWishlistAction(args,{state:resolvedState,env,facts:memory.facts,turnLeft:()=>turnDeadlineMs-trace.elapsed(),step:trace.note,recent:shopperWords(context.filter(m=>m.body!==IMAGE_PLACEHOLDER)),
            rank:async(products,input)=>rankDiscoveryProducts(products,{...input,facts:await userContext.withPurchaseDetail(input.facts)}),
            // Owned pieces for closet-aware ranking (lib/closet-ranking.js), read only for a discovery the person shops for themself.
            owned:async()=>env.GMAIL_IMPORT_ENABLED==='true'&&store.gmailImport?(await import('./closet-summary.js')).readOwnedPieces(store,conversationId):[],
            // A completed search is never lost to a failed write: the reply still shows its results, and
            // the write's failure (status and code only) is kept with the turn's diagnostics.
            record:async result=>{if(trace.abandoned)return;
              // Earlier actions in this turn keep their diagnostics (withEarlierActions in lib/text-wishlist.js).
              result=withEarlierActions(searchResult,result);
              try{await store.searchResult(operation,result);}
              catch(error){stateWriteFailures.push(safeError(error,'search_result'));console.log(JSON.stringify({event:'search_result_write_failed',...safeError(error,'search_result')}));}
              searchResult=result;sourceImages=[];},
          })),
        }:{}),
        ...(env.MEMORY_ENABLED==='true'&&current?{
          profileAction:async args=>{const result=await updateProfile(store,conversationId,current,args);if(result.saved){await store.memoryStatus(delivery.message.id,'saved');trace.done('profile',typeof args.acknowledgment==='string'&&!/https?:\/\//i.test(args.acknowledgment)?args.acknowledgment.trim().slice(0,300):null);}return result;},
          profileFailed:()=>store.memoryStatus(delivery.message.id,'failed'),
        }:{}),
        ...(waitlist?{waitlist}:{}),
        ...(onboardingAvailable(session,env)?{onboarding:onboardingState,
          onboardingAction:action=>(trace.mark('tool:onboarding'),action==='decline'&&interviewOn&&(interviewNext='declined'),onboardingAction(action,{conversationId,session,store,env}))}:{}),
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
        // "I bought this" by text: the same path as the wishlist page, on the person's own saved items.
        ...(env.WISHLIST_ENABLED==='true'&&store.updateWishlistEntries&&store.claimGmailImport?{wishlistPurchaseAction:(operation,ids,details)=>(trace.mark('tool:record_wishlist_purchase'),wishlistPurchaseChat(store,conversationId,operation,ids,details))}:{}),
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
        // Screenshots of several named products the user wants saved: each is looked up as that exact
        // product and offered for saving; the offer is this reply's shopping state, so nothing saves until they answer.
        ...(env.WISHLIST_ENABLED==='true'&&env.SEARCH_ENABLED==='true'?{recentImageMessages,screenshotProductsAction:async ids=>{
          trace.mark('tool:read_screenshot_products');
          const own=context.find(m=>m.provider_id===delivery.message.id),shots=context.filter(m=>m.direction==='inbound'&&(m.message_images?.length||(m===own&&images.length)));
          const chosen=(ids.length?ids.map(id=>shots.find(m=>m.id===id)):[own&&images.length?own:referencedImage(context)]).filter(Boolean)
            .filter((m,i,all)=>all.indexOf(m)===i).sort((a,b)=>String(a.created_at??'').localeCompare(String(b.created_at??'')));
          const found=[];
          answering({used:chosen.map(m=>m.id??delivery.message.id)});
          for(const m of chosen)found.push(...(m===own&&images.length?images:await store.imagesForMessage(m.id)));
          const read=await readScreenshotProducts({images:found,env:marketEnvironment(memory.facts,env),fetcher:trace.fetch(fetch)});
          if(trace.abandoned)return read.body;
          const result={identification_policy:'text_wishlist',intent_action:'screenshot_products',checked_at:new Date().toISOString(),products:read.options??[],text_wishlist_state:read.state,
            text_wishlist_diagnostics:{mode:'screenshot_products',images:found.length,found:(read.options??[]).length,unmatched:(read.unmatched??[]).map(u=>u.reason),store:read.store??null}};
          try{await store.searchResult(operation,result);}
          catch(error){stateWriteFailures.push(safeError(error,'search_result'));console.log(JSON.stringify({event:'search_result_write_failed',...safeError(error,'search_result')}));}
          searchResult=result;
          return read.body;
        }}:{}),
        // Liked items are kept by the screenshots' messages, so a replayed delivery reads once.
        ...(likesOn?{recentImageMessages,likedItemsAction:async(operation,ids)=>{
          trace.mark('tool:add_liked_items');
          if(operation==='forget')return (await forgetLikedItems({store,owner:conversationId,messageIds:ids})).body;
          const own=context.find(m=>m.provider_id===delivery.message.id),shots=context.filter(m=>m.direction==='inbound'&&(m.message_images?.length||(m===own&&images.length)));
          const chosen=(ids.length?ids.map(id=>shots.find(m=>m.id===id)):[own&&images.length?own:referencedImage(context)]).filter(Boolean)
            .filter((m,i,all)=>all.indexOf(m)===i).sort((a,b)=>String(a.created_at??'').localeCompare(String(b.created_at??'')));
          const found=[];
          answering({used:chosen.map(m=>m.id??delivery.message.id)});
          for(const m of chosen)found.push(...(m===own&&images.length?images:await store.imagesForMessage(m.id)));
          return (await addLikedItems({store,owner:conversationId,messageIds:chosen.map(m=>m.id??delivery.message.id),images:found,env,fetcher:trace.fetch(fetch)})).body;
        },likedOptionsAction:async options=>{
          await store.recordEvidence(conversationId,likedOptionEvidence(delivery.message.id,options,{at:new Date().toISOString()}));
        }}:{}),
        // Texts Jules sends on her own about purchases found in email: the person turns them off or on here.
        ...(env.PURCHASE_TEXTS_ENABLED==='true'&&store.claimGmailImport&&purchaseHistory?{purchaseTextsAction:async action=>{
          trace.mark('tool:manage_purchase_texts');
          const body=await managePurchaseTexts(store,conversationId,action,{messageId:delivery.message.id,record:change=>{outcome.purchase_texts=change;}});
          if(action==='turn_off')offerStopped=true;
          if(action!=='status')trace.done('purchase_texts',body);
          return body;
        }}:{}),
        // The answer to the open offer. A yes returns the search brief; find_products then runs as usual.
        // The outcome is recorded once the turn's reply is ready (below), never by an abandoned attempt.
        ...(goesWithOffer?{goesWithOffer,goesWithAction:async answer=>{
          trace.mark('tool:answer_goes_with_offer');
          offerOutcome=answer;
          return answer==='accepted'?acceptedBrief(goesWithOffer):declinedBrief(answer);
        }}:{}),
        // Replies to Jules's style questions. The agent says which question and what kind of reply;
        // lasting facts are saved by update_profile in the same turn. The next question follows the reply.
        ...(interviewOn?{interviewAction:async({action,questionId,outcome,quote})=>{
          trace.mark('tool:style_interview');
          if(action==='start'){
            // Already answering a question this turn, or a round is open with nothing waiting: what comes
            // next in that round follows this message.
            if(interviewNext||memory.interview?.round_open&&!memory.interview?.waiting_for){interviewNext??='continue';return INTERVIEW_LEAD_IN;}
            if(!await questionsLeft(store,conversationId))return 'Jules has nothing left to ask right now: what it would ask is already known. Say so briefly and offer to help them find something.';
            interviewNext='request';
            return INTERVIEW_LEAD_IN;
          }
          const result=await recordAnswer(store,conversationId,{questionId,outcome,messageId:delivery.message.id,messageText:delivery.message.content?.text??'',quote});
          if(result.ok&&(result.next||outcome==='declined_interview'))interviewNext='continue';
          return result.body;
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
      // A newer message with its own reply in progress: this turn's work is set aside (see SUPERSEDE_POLL_MS).
      let watchTimer;
      const newer = new Promise((_, reject) => {
        if (!store.newerTurn) return;
        const check = async () => {
          if (!committed && !trace.completed.length && !trace.abandoned && await store.newerTurn(conversationId, operation).catch(() => false)) {
            trace.abandoned = true; return reject(Object.assign(new Error('Superseded'), { superseded: true }));
          }
          if (!trace.abandoned) { watchTimer = setTimeout(check, supersedePollMs); watchTimer.unref?.(); }
        };
        watchTimer = setTimeout(check, supersedePollMs); watchTimer.unref?.();
      });
      newer.catch(() => {});
      try {
        trace.mark('agent');
        try { body = await Promise.race([reply(false), deadline, newer]); }
        catch (error) {
          // One retry with a smaller context before the fallback, when there is time for it. A partial
          // outcome from the failed attempt is discarded so it cannot attach to a different reply.
          // A save already committed this turn is never repeated by a retry.
          // An account out of model credit fails every retry the same way (BILLING_CODES in lib/model-call.js).
          if (committed || trace.abandoned || error?.billing || turnDeadlineMs - trace.elapsed() < 45000) throw error;
          console.log(JSON.stringify({ event: 'agent_reply_retry', context: 'compact', error_class: failureReason(error, trace).error_class }));
          compactRetry = true;
          trace.mark('retry');
          if (searchResult) { searchResult = null; await store.searchResult(operation, null); }
          agentFallback = null; replyRejections = []; consentChecks = []; products = []; sourceImages = initialImages; historyUpdated = false; outfitsReady = false; readPhotoIds = null; interviewNext = null; chosenTool = null; offerOutcome = null; offerStopped = false; threading = { answered: [], used: [] };
          body = await Promise.race([reply(true), deadline, newer]);
        }
      } finally { clearTimeout(deadlineTimer); clearTimeout(watchTimer); }
    }
    catch (error) {
      if (error?.superseded) return setAside();
      // Record why the reply failed (error class and code only, never message text) so a fallback is diagnosable.
      diagnostics = { outcome: 'fallback', ...failureReason(error, trace, { compact_retry: compactRetry, images: delivery.message.attachments?.length ?? 0, completed: trace.completed.map(c => c.kind) }), ...(error?.image_failure ? { image_failure: error.image_failure } : {}), ...(consentChecks.length ? { consent_checks: consentChecks } : {}) };
      console.log(JSON.stringify({event:'ai_reply_failed',operation,error:error?.name??null,reason:String(error?.message??'').slice(0,80),
        database_status:error?.database_status??null,database_code:error?.database_code??null,images:delivery.message.attachments?.length??0,
        step:diagnostics.step,error_class:diagnostics.error_class,model_status:diagnostics.model_status,model_error_code:diagnostics.model_error_code,model_limit:diagnostics.model_limit,elapsed_ms:diagnostics.elapsed_ms}));
      trace.abandoned = true;
      source = 'ai_fallback';
      products = [];
      if (searchResult) { searchResult = null; try { await store.searchResult(operation, null); } catch { /* the fallback row then keeps it */ } }
      body = delivery.message.attachments?.length && diagnostics.error_class === 'image' ? 'i couldn’t read that image. please try a JPG, PNG, WebP, or HEIC image under 15 MB (up to three at a time).' : fallbackReply(trace);
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
    // Each product the answer links (up to 3) also goes out as its own preview card. iMessage never previews
    // links inside a multi-link text. Photo searches keep their captions, with the card in place of the photo.
    const previews = searchResult ? productPreviews(body, searchResult, operation, env).slice(0, 3) : [];
    if (previews.length) products = products.length
      ? products.map(p => { const card = previews.find(c => c.product.url === p.url); return card ? { ...p, preview_url: card.preview_url } : p; })
      : previews.map(c => ({ ...c.product, preview_url: c.preview_url }));
    // A fallback answers nothing in particular, except an unreadable photo, which it is about.
    replyTarget = source === 'ai' ? threadTarget(delivery.message, recent, threading)
      : replyProviderId(delivery.message) || (diagnostics?.error_class === 'image' && delivery.message.attachments?.length) ? delivery.message : null;
    console.log(JSON.stringify({ event: 'reply_thread', operation, threaded: Boolean(replyTarget), tester_thread: Boolean(replyProviderId(delivery.message)),
      under_newest: replyTarget?.id === delivery.message.id, answered: new Set(threading.answered).size, photos_read: new Set(threading.used).size }));
    // The last check before anything is sent: a newer message that arrived while this reply was written.
    if (source === 'ai' && !committed && !trace.completed.length && await store.newerTurn?.(conversationId, operation).catch(() => false)) return setAside();
    // A turn that only answered or asked for style questions sends the next question in its own text:
    // the agent's lead-in, then the question, with nothing in between. A close, or a turn that also
    // searched, keeps the separate message after the reply.
    if (interviewNext && source === 'ai' && !searchResult && !products.length) {
      const step = interviewNext === 'continue' ? continueInterview(store, conversationId, env, { send, deliver:false }) : startInterview(store, conversationId, env, interviewNext, { send, deliver:false });
      const joined = await step.catch(() => { console.log(JSON.stringify({ event:'interview_next_failed', step:interviewNext })); return null; });
      if (joined?.text) {
        // The question is reworded to fit the conversation, as when it was its own text; the written
        // question is the fallback. The composer sees the lead-in it follows.
        const lead = String(body ?? '').trim();
        const question = await withUsage({ store, env, conversation: conversationId, operation, feature: 'chat' }, () => { labelUsage('compose'); return compose({ draft: joined.text, facts: {}, conversation: recentTurns([...recent, ...(lead ? [{ direction: 'outbound', status: 'sent', body: lead }] : [])]), purpose: 'notification', env }); })
          .then(r => r?.body || joined.text).catch(() => joined.text);
        body = [lead, question].filter(Boolean).join('\n\n'); interviewNext = null;
      }
      else if (!joined?.deferred) interviewNext = null;
    }
    // The first reply after an offer settles it: the agent's answer, else stopped (purchase texts turned
    // off this turn), else an independent reading of the reply for the log. A fallback reply leaves it open.
    // Recorded after the reply when the runtime allows (defer), so the reading never delays it.
    if (goesWithOffer && source === 'ai') {
      const [offer, answered, stopped, reply] = [goesWithOffer, offerOutcome, offerStopped, delivery.message.content?.text];
      const settling = (async () => {
        const read = answered || stopped ? null : await withUsage({ store, env, conversation: conversationId, operation: `goes-with-read:${operation}`, feature: 'chat', quiet: true }, () => readOfferReply({ offer, reply, env }));
        const [answer, from] = answered ? [answered, 'agent'] : stopped ? ['stopped', 'agent'] : read ? [read, 'reader'] : ['unrelated', 'fallback'];
        await settleOffer(store, conversationId, offer, answer, { messageId: delivery.message.id, source: from });
      })().catch(() => console.log(JSON.stringify({ event: 'goes_with_settle_failed', operation })));
      if (defer) defer(settling); else await settling;
    }
    await updates.finish();
    trace.mark('prepare');
    // A reply that follows an acknowledgment is dated when it is sent, so history keeps send order.
    await store.prepareAI(operation, body, source, { resequence: updates.timing.first_message_ms !== null });
    let sent;
    trace.mark('send');
    // A send that never answers may still have been delivered, so it is recorded as uncertain, never resent.
    // History keeps the store links; the sent text carries /go/ links, which preview the product even when
    // a store blocks preview bots. LINK_CLICK_TRACKING only decides whether a tap is recorded.
    const outgoing = searchResult ? trackLinks(body, searchResult, operation, env) : body;
    try { sent = await within(sendTimeoutMs, (async () => send(delivery, await signInLinks(outgoing,{store,conversationId,env}), env, { replyTarget, products }))(), 'Send timed out'); }
    catch (error) {
      await store.finish(operation, 'uncertain');
      await trace.write({ ...(diagnostics ?? {}), ...turnActions(turnActionList, outcome, chosenTool), outcome: diagnostics ? 'fallback' : 'uncertain', delivery: 'uncertain', send_error: error?.name ?? null, elapsed_ms: trace.elapsed() });
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
      await trace.write({ ...diagnostics, ...turnActions(turnActionList, outcome, chosenTool), ...sentParts(sent), ...await skillRoute() });
    } else await trace.write({ ...turnActions(turnActionList, outcome, chosenTool), ...sentParts(sent), ...await skillRoute(), outcome: 'sent', step: trace.step, elapsed_ms: trace.elapsed(), model_status: trace.model?.status ?? null, compact_retry: compactRetry, steps: trace.steps, ...(imageInfo.length ? { image_info: imageInfo } : {}), composed_by: composedBy, ...(composeFallback ? { compose_fallback: composeFallback } : {}), ...(agentFallback ? { agent_fallback: agentFallback } : {}), ...(replyRejections.length ? { reply_rejections: replyRejections } : {}), ...(consentChecks.length ? { consent_checks: consentChecks } : {}), ...(stateWriteFailures.length ? { state_write_failures: stateWriteFailures.slice(0, 4) } : {}) });
    // Timing is kept with a search outcome for feedback triage. Turns without one keep no result,
    // because an outcome row would replace the pending shopping state.
    if (searchResult) {
      searchResult = { ...searchResult, timing_diagnostics: timing, composed_by: composedBy, ...(consentChecks.length ? { consent_diagnostics: { checks: consentChecks } } : {}) };
      try { await store.searchResult(operation, searchResult); }
      catch { console.log(JSON.stringify({ event: 'turn_timing_record_failed', operation })); }
    }
    if(historyUpdated)await continuePurchaseQuestions(store,conversationId,env,send);
    // The next style question (or the first, after a request or a Gmail decline) follows this reply.
    if(interviewNext){
      const step=interviewNext==='continue'?continueInterview(store,conversationId,env,{send}):startInterview(store,conversationId,env,interviewNext,{send});
      await step.catch(()=>console.log(JSON.stringify({event:'interview_next_failed',step:interviewNext})));
    }
    // Enough outfit photos: a summary the import could not send yet (too little to say) follows this reply.
    if(outfitsReady&&env.GMAIL_IMPORT_ENABLED==='true')await profileAfterOutfits(store,conversationId,env,send);
    // The Read takes a vision call; it finishes after the webhook responds where it can.
    if(readPhotoIds&&env.GMAIL_IMPORT_ENABLED==='true'){const reading=readAfterOutfits(store,conversationId,env,{photoIds:readPhotoIds,send});if(defer)defer(reading);else await reading;}
    if (env.WISHLIST_ENABLED === 'true'&&!confirmedBeforeSend&&searchResult?.user_confirmed===true) {
      let confirmation=null,saveDone=false;
      try {
        await store.saveWishlist(operation);saveDone=true;scanAfterSave();
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
