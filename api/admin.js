// Loads first so the cost meter wraps fetch before any handler below keeps a reference to it.
import '../lib/usage.js';
import { lowStockSummary } from '../lib/low-stock.js';
import { readCoverage } from '../lib/coverage.js';
import { adminStartInterview } from '../lib/interview.js';
import { previewEarlyRead } from '../lib/early-read.js';
import { authorize } from '../lib/auth.js';
import { createStore } from '../lib/store.js';
import { json, readJson, uuid } from '../lib/http.js';
import { purchaseReview, reviewPurchase, reportMissedPurchase } from '../lib/purchase-review.js';
import { groupWishlist } from '../lib/wishlist.js';
import { marketEnvironment } from '../lib/shopping-market.js';
import { metricsTrend } from '../lib/chat-metrics.js';
import { loadTurnOutcomes } from '../lib/turn-outcomes.js';
import { loadScorecard, replayDraft } from '../lib/scorecard.js';
import { deleteImportedHistory } from '../lib/gmail-import.js';
import { tagPurchaseHistory } from '../lib/item-tags.js';
import { buildReport, sendReportLink, sendNewCardText, reportView, withReadPhoto } from '../lib/style-report.js';
import { referralRef } from '../lib/referral.js';
import { firstName } from '../lib/memory.js';
import { copyWeek } from '../lib/report-copy.js';
import { adoptionReport } from '../lib/adoption.js';
import { resendContactCard, resendWelcome, resendWelcomeText, contactCardEnabled } from '../lib/onboarding.js';
import { compareEmail, sampleSources, COMPARE_MODELS } from '../lib/extract-compare.js';
import { gmailReconnectNeeded } from '../lib/gmail-client.js';
import { rereadImage } from '../lib/image-reread.js';
import { approveAccess, approvalPreview, waitlistAgain, WAITLIST_REPLIES } from '../lib/waitlist.js';
import { profileFirstName, displayName } from '../lib/memory.js';
import { setUpTester, signupsToSetUp } from '../lib/tester-setup.js';
import { goesWithCandidates, sendTestNudge, nudgeTestConversation, purchaseTextsOn } from '../lib/purchase-texts.js';
import { nudgeTimezone, nudgeSummary } from '../lib/nudges.js';

export const config = { api: { bodyParser: false }, maxDuration: 30 };
// Owner view. Conversations are read-only (Jules replies automatically); the owner can review and
// correct imported purchase history.
export function createAdminHandler({ auth = authorize, storeFactory = createStore, env = process.env, fetcher = fetch, send } = {}) {
  return async (req, res) => {
    try {
      const access = await auth(req.headers, env);
      if (access !== 200) return json(res, access, { error: access === 503 ? 'Admin is not configured yet.' : 'Please sign in with the owner account.' });
      if (!['GET','POST'].includes(req.method)) { res.setHeader('Allow', 'GET, POST'); return json(res, 405, { error: 'Method not allowed.' }); }
      if (req.method === 'POST') {
        // The only writes are purchase-history reviews, tagging, the onboarding reset, waitlist approval, setting up a new tester and texting the contact card, re-reading a failed photo; manual replies stay retired.
        const input = await readJson(req);
        if (!['review', 'missed', 'tag', 'build-report', 'send-report', 'reset-onboarding', 'approve', 'waitlist', 'send-contact-card', 'start-interview', 'reread-image', 'judge-mark', 'replay-draft', 'extract-compare', 'set-up', 'send-test-nudge', 'resend-welcome'].includes(input.action)) return json(res, 400, { error: 'Unknown purchase action.' });
        if (input.action === 'judge-mark' && (!env.SITE_ORIGIN || req.headers.origin !== env.SITE_ORIGIN.replace(/\/$/, ''))) return json(res, 400, { error: 'Mark the judge from the Jules admin page.' });
        if (['approve', 'waitlist'].includes(input.action) && (!env.SITE_ORIGIN || req.headers.origin !== env.SITE_ORIGIN.replace(/\/$/, ''))) return json(res, 400, { error: 'Change waitlist status from the Jules admin page.' });
        if (input.action === 'extract-compare' && (!env.SITE_ORIGIN || req.headers.origin !== env.SITE_ORIGIN.replace(/\/$/, ''))) return json(res, 400, { error: 'Run the comparison from the Jules admin page.' });
        if (input.action === 'reset-onboarding' && (!env.SITE_ORIGIN || req.headers.origin !== env.SITE_ORIGIN.replace(/\/$/, ''))) return json(res, 400, { error: 'Reset onboarding from the Jules admin page.' });
        if (input.action === 'start-interview' && (!env.SITE_ORIGIN || req.headers.origin !== env.SITE_ORIGIN.replace(/\/$/, ''))) return json(res, 400, { error: 'Send style questions from the Jules admin page.' });
        if (input.action === 'resend-welcome' && (!env.SITE_ORIGIN || req.headers.origin !== env.SITE_ORIGIN.replace(/\/$/, ''))) return json(res, 400, { error: 'Resend the welcome from the Jules admin page.' });
        if (input.action === 'send-contact-card' && (!env.SITE_ORIGIN || req.headers.origin !== env.SITE_ORIGIN.replace(/\/$/, ''))) return json(res, 400, { error: 'Send the contact card from the Jules admin page.' });
        if (input.action === 'reread-image' && (!env.SITE_ORIGIN || req.headers.origin !== env.SITE_ORIGIN.replace(/\/$/, ''))) return json(res, 400, { error: 'Re-read photos from the Jules admin page.' });
        if (input.action === 'send-test-nudge' && (!env.SITE_ORIGIN || req.headers.origin !== env.SITE_ORIGIN.replace(/\/$/, ''))) return json(res, 400, { error: 'Send test nudges from the Jules admin page.' });
        if (input.action === 'set-up' && (!env.SITE_ORIGIN || req.headers.origin !== env.SITE_ORIGIN.replace(/\/$/, ''))) return json(res, 400, { error: 'Set up testers from the Jules admin page.' });
        const store = storeFactory(env);
        // A new signup has no conversation yet: this creates it on the shared line, then approves (lib/tester-setup.js).
        if (input.action === 'set-up') {
          if (input.confirm !== true) throw Object.assign(new Error('Confirm the setup first.'), { status: 400 });
          if (!uuid(input.signup)) return json(res, 404, { error: 'This signup is no longer there. Refresh and try again.' });
          try { return json(res, 200, await setUpTester(store, input, env, send, fetcher)); }
          catch (error) { if (error.status === 404) return json(res, 404, { error: error.message }); throw error; }
        }
        if (!uuid(input.conversation) || !await store.conversation(input.conversation)) return json(res, 404, { error: 'Conversation not found.' });
        if (input.action === 'reset-onboarding') return json(res, 200, await resetOnboarding(store, input, env, fetcher));
        // Model bake-off (MODEL-BAKEOFF.md): one sampled receipt email read by each candidate extract
        // model. Only the owner's own connected Gmail; nothing is saved and no email text is returned.
        if (input.action === 'extract-compare') {
          if (input.confirm !== true) throw Object.assign(new Error('Confirm the comparison first.'), { status: 400 });
          const row = await store.gmailImport(input.conversation);
          const own = env.ADMIN_EMAIL && JSON.stringify(row?.data?.account ?? '').toLowerCase().includes(env.ADMIN_EMAIL.toLowerCase());
          if (!row?.token_ciphertext || !own) return json(res, 403, { error: 'The comparison reads only the owner’s own connected Gmail.' });
          if (gmailReconnectNeeded(row.data)) return json(res, 409, { error: `Google refused the stored Gmail sign-in on ${row.data.gmail_auth.at.slice(0, 10)}. Connect Gmail again from your account page, then rerun.` });
          const sample = sampleSources(row, 40);
          if (!Number.isInteger(input.email) || input.email < 0 || input.email >= sample.length) return json(res, 400, { error: `Choose an email from 0 to ${sample.length - 1}.` });
          return json(res, 200, { total: sample.length, models: COMPARE_MODELS, result: await compareEmail({ store, row, owner: input.conversation, env, id: sample[input.email].id, fetcher }) });
        }
        // Scorecard (lib/scorecard.js): the owner's "judge was right / wrong" mark, and a draft replay case.
        if (['judge-mark', 'replay-draft'].includes(input.action)) {
          if (typeof input.operation !== 'string' || !/^ai:[A-Za-z0-9:_-]{1,200}$/.test(input.operation)) return json(res, 400, { error: 'Unknown turn.' });
          const turn = await store.sourcingTurn(input.operation);
          if (!turn || turn.conversation_id !== input.conversation) return json(res, 404, { error: 'This turn hasn’t been saved by the nightly judge yet.' });
          if (input.action === 'replay-draft') { const draft = await replayDraft(store, turn); return draft ? json(res, 200, { draft }) : json(res, 404, { error: 'The turn’s message is no longer in the conversation.' }); }
          if (![null, 'agree', 'disagree'].includes(input.verdict ?? null)) return json(res, 400, { error: 'Choose agree or disagree.' });
          await store.markJudgement(input.operation, input.verdict ?? null);
          return json(res, 200, { operation: input.operation, founder_verdict: input.verdict ?? null });
        }
        if (input.action === 'send-contact-card') {
          if (input.confirm !== true) throw Object.assign(new Error('Confirm sending the contact card first.'), { status: 400 });
          const status = await resendContactCard(store, await store.conversation(input.conversation), env, send);
          console.log(JSON.stringify({ event: 'admin_contact_card', status }));
          if (status === 'skipped') throw Object.assign(new Error('This person’s line isn’t a phone number; set JULES_PUBLIC_LINE in Vercel so the card has Jules’s number.'), { status: 409 });
          return json(res, 200, { contact_card: status });
        }
        // Texts the onboarding welcome again on purpose, as its own ledger entry (lib/onboarding.js).
        if (input.action === 'resend-welcome') {
          if (input.confirm !== true) throw Object.assign(new Error('Confirm resending the welcome first.'), { status: 400 });
          const result = await resendWelcome(store, await store.conversation(input.conversation), env, send);
          console.log(JSON.stringify({ event: 'admin_welcome_resent', welcome: result.welcome, contact_card: result.contact_card ?? null }));
          return json(res, 200, result);
        }
        // The "goes with" offer about one wardrobe item, to the designated test conversation only (lib/purchase-texts.js).
        if (input.action === 'send-test-nudge') {
          if (input.confirm !== true) throw Object.assign(new Error('Confirm sending the test nudge first.'), { status: 400 });
          try { return json(res, 200, { nudge: await sendTestNudge(store, input.conversation, String(input.item ?? ''), env, send ? { send } : {}), ...await nudgeView(store, input.conversation, env) }); }
          catch (error) { if (error.status === 403) throw Object.assign(new Error(error.message), { status: 409 }); throw error; }
        }
        // Texts the person the next style question (lib/interview.js), as if they had asked for it.
        if (input.action === 'start-interview') {
          if (input.confirm !== true) throw Object.assign(new Error('Confirm sending the style questions first.'), { status: 400 });
          const result = await adminStartInterview(store, input.conversation, env, send ? { send } : {});
          const refusal = { off: 'Style questions are off. Set INTERVIEW_ENABLED=true in Vercel and redeploy first.',
            declined: `They said no to more style questions on ${String(result.at ?? '').slice(0, 10)}. Only they can turn them back on, by asking Jules.`,
            waiting: 'A style question is already waiting for their reply. The next one goes out after they answer.',
            nothing_left: 'There is nothing left to ask them right now: what the questions cover is already known.' }[result.status];
          if (refusal) throw Object.assign(new Error(refusal), { status: 409 });
          return json(res, 200, { interview: result });
        }
        if (input.action === 'reread-image') {
          if (input.confirm !== true) throw Object.assign(new Error('Confirm re-reading the photo first.'), { status: 400 });
          if (!uuid(input.message)) return json(res, 400, { error: 'Unknown message.' });
          return json(res, 200, { image: await rereadImage(store, await store.conversation(input.conversation), input.message, env) });
        }
        if (['approve', 'waitlist'].includes(input.action)) {
          if (input.confirm !== true) throw Object.assign(new Error('Confirm the status change first.'), { status: 400 });
          const conversation = await store.conversation(input.conversation);
          const result = input.action === 'approve' ? await approveAccess(store, conversation, env, send, fetcher) : await waitlistAgain(store, conversation);
          console.log(JSON.stringify({ event: input.action === 'approve' ? 'admin_waitlist_approved' : 'admin_waitlist_returned', changed: result.changed, text: result.text, account: result.account ?? null }));
          return json(res, 200, { access: (await store.accessFor([input.conversation])).get(input.conversation) ?? null, ...result });
        }
        if (input.action === 'build-report') {
          const built = await buildReport(store, input.conversation, env);
          if (built.status === 'busy') throw Object.assign(new Error('Purchase history is busy (an import or another edit is running). Try again in a moment.'), { status: 409 });
          if (built.status !== 'built') throw Object.assign(new Error(built.status === 'no_history' ? 'This person has no imported purchase history yet.' : `Not enough data for a receipt yet (${built.lines} of 3 lines).`), { status: 409 });
          // A card this rebuild unlocked is texted once, as after an import.
          const newCard = await sendNewCardText(store, input.conversation, env, built.unlocked).catch(() => null);
          return json(res, 200, { ...await purchaseReview(store, input.conversation), report: reportView(built.report), new_card_text: newCard?.status ?? null });
        }
        if (input.action === 'send-report') {
          const sent = await sendReportLink(store, input.conversation, env);
          return json(res, 200, { ...await purchaseReview(store, input.conversation), report_sent: sent?.status ?? null });
        }
        if (input.action === 'tag') {
          // One click tags as many items as fit in this request; the page offers to continue.
          const run = await tagPurchaseHistory(store, input.conversation, env, { budgetMs: 20000 });
          if (run.busy && !run.tagged) throw Object.assign(new Error('Purchase history is busy (an import or another edit is running). Try again in a moment.'), { status: 409 });
          return json(res, 200, { ...await purchaseReview(store, input.conversation), tag_run: run });
        }
        if (input.action === 'review') await reviewPurchase(store, input.conversation, input);
        else await reportMissedPurchase(store, input.conversation, input);
        return json(res, 200, await purchaseReview(store, input.conversation));
      }
      const query = new URL(req.url, 'https://local.invalid').searchParams;
      if (query.get('view') === 'access') return json(res, 200, { owner: true });
      const store = storeFactory(env);
      if (query.get('view') === 'feedback') return json(res, 200, { feedback: await store.feedback() });
      // The style report jokes loop: this week's best and worst lines, and each prompt version's votes.
      if (query.get('view') === 'report-copy') return json(res, 200, copyWeek(await store.reportCopyRows()));
      // New signups with no conversation yet, to set up (lib/tester-setup.js). Phones are masked to the last four digits.
      if (query.get('view') === 'signups') return json(res, 200, { signups: await signupsToSetUp(store), approval_text: approvalPreview(env)?.text ?? null, approval_account: approvalPreview(env)?.account ?? false });
      if (query.get('view') === 'adoption') return json(res, 200, await adoptionReport(store));
      // Unprompted texts across testers (lib/nudges.js): sends, holds, replies. Loaded on its own so a failure leaves Adoption as it is.
      if (query.get('view') === 'nudges-summary') return json(res, 200, nudgeSummary(await store.nudgeLogs()));
      if (query.get('view') === 'metrics') return json(res, 200, await metricsTrend(store, { days: 7 }));
      // Per sourcing turn outcomes (lib/turn-outcomes.js): ids, counts and labels only, no message text.
      if (query.get('view') === 'scorecard') return json(res, 200, await loadScorecard(store));
      if (query.get('view') === 'turn-outcomes') return json(res, 200, await loadTurnOutcomes(store, { days: Math.min(56, Math.max(1, Number(query.get('days')) || 7)) }));
      const id = query.get('conversation');
      if (!id) {
        // Each tester's signup source (db/033). The list never depends on it: before the migration, sources are blank.
        // Waitlist status (db/035) is the same: unknown (null) when it cannot be read.
        // How they arrived (db/041: referring site and utm_ tags) is optional the same way.
        const [conversations, sources, arrivals] = await Promise.all([store.list(), store.signupSources?.().catch(() => new Map()) ?? new Map(),
          store.signupArrivals?.().catch(() => new Map()) ?? new Map()]);
        // Names come from the latest signup, else the first name told to Jules; a failed read only blanks them.
        const blank = () => new Map();
        const [statuses, signups, profiles] = await Promise.all([store.accessFor(conversations.map(c => c.id)).catch(blank),
          store.signupNames?.(conversations.map(c => c.sender_id)).catch(blank) ?? blank(), store.profilesFor?.(conversations.map(c => c.id)).catch(blank) ?? blank()]);
        const names = new Map(conversations.map(c => {
          const signup = signups.get(c.sender_id);
          return [c.id, (signup ? [displayName(signup.first_name), displayName(signup.last_name)].filter(Boolean).join(' ') : displayName(profileFirstName(profiles.get(c.id)))) || null];
        }));
        // A signup from someone's shared link (?ref=u-…) is credited to the person who shared it.
        const sharers = new Map(conversations.map(c => [referralRef(c.id, env), c.id]).filter(([ref]) => ref));
        return json(res, 200, { conversations: conversations.map(c => {
          const status = statuses.get(c.id), source = sources.get(c.sender_id) ?? null, sharer = source ? sharers.get(source) : null;
          return { ...c, name: names.get(c.id), source, arrival: arrivals.get(c.sender_id) ?? null, referred_by: sharer && sharer !== c.id ? { id: sharer, name: names.get(sharer) ?? null } : null, access: status?.access ?? null, waitlist_replies: status?.waitlist_replies ?? null };
        }), waitlist_enabled: env.WAITLIST_ENABLED === 'true', waitlist_replies: WAITLIST_REPLIES, approval_text: approvalPreview(env)?.text ?? null, approval_account: approvalPreview(env)?.account ?? false, contact_card_enabled: contactCardEnabled(env) });
      }
      if (!uuid(id)) return json(res, 400, { error: 'Invalid conversation.' });
      const conversation = await store.conversation(id);
      if (!conversation) return json(res, 404, { error: 'Conversation not found.' });
      if (query.get('view') === 'purchases') return json(res, 200, await purchaseReview(store, id));
      // Read-only view of a tester's style report for /report?person=<id>.
      if (query.get('view') === 'report') {
        const [row, name] = await Promise.all([store.gmailImport(id), firstName(store, id)]);
        return json(res, 200, { report: await withReadPhoto(reportView(row?.data?.style_report, name ?? null), row?.data?.style_report, store, id), status: row?.data?.style_report ? 'built' : 'not_built' });
      }
      if (query.get('view') === 'wishlist') return json(res, 200, await personWishlist(store, id, env));
      // Unprompted texts: the decision log, the setting, and (test conversation only) what a test nudge could be about.
      if (query.get('view') === 'nudges') return json(res, 200, await nudgeView(store, id, env));
      // How much of the taste profile is known, per dimension (lib/coverage.js). Read-only, computed fresh.
      if (query.get('view') === 'coverage') return json(res, 200, await readCoverage(store, id));
      // What the early read would text this person now (lib/early-read.js). Nothing is sent.
      if (query.get('view') === 'early-read') return json(res, 200, await previewEarlyRead(store, id));
      let before;
      if (query.has('before')) {
        try { before = JSON.parse(query.get('before')); } catch { return json(res, 400, { error: 'Invalid history cursor.' }); }
        if (!uuid(before?.id) || !/^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|\+00:00)$/.test(before.at ?? '')) return json(res, 400, { error: 'Invalid history cursor.' });
      }
      // Onboarding state, the "Not now" tap and the reminder (db/046); unknown (null) before that migration runs.
      // resend_welcome: the exact text Resend welcome would send, only while it's offered.
      const [history, waitlist, onboarding] = await Promise.all([store.messages(id, before), before ? null : store.accessFor([id]).then(m => m.get(id) ?? null).catch(() => null),
        before ? null : Promise.resolve(store.onboardingOverview?.(id)).catch(() => null)]);
      const resend = onboarding ? await resendWelcomeText(store, id, env, onboarding.state).catch(() => null) : null;
      return json(res, 200, { conversation, ...history, ...(before ? {} : { access: waitlist, onboarding: onboarding ?? null, resend_welcome: resend, contact_card_enabled: contactCardEnabled(env), approval_text: approvalPreview(env)?.text ?? null, approval_account: approvalPreview(env)?.account ?? false }) });
    } catch (error) {
      console.error(JSON.stringify({ event: 'admin_request_failed', status: error.status ?? null }));
      // Review validation and busy-lease messages are written for the owner; everything else is generic.
      if ([400, 409].includes(error.status) && req.method === 'POST' && error.message) return json(res, error.status, { error: error.message });
      return json(res, [400, 409, 413, 415].includes(error.status) ? error.status : 503, { error: 'Could not load this view. Refresh and try again.' });
    }
  };
}
// Lets the owner re-run onboarding with an existing tester number. Imported history goes first, the
// same way the person's own delete does, so a busy import stops the reset before anything changes.
// Taste profile, wishlist, alerts, signup and every other conversation stay as they are.
async function resetOnboarding(store, input, env, fetcher) {
  if (input.confirm !== true) throw Object.assign(new Error('Confirm the onboarding reset first.'), { status: 400 });
  if (!await store.onboardingSession(input.conversation)) throw Object.assign(new Error('This person has no onboarding to reset.'), { status: 409 });
  const history = await deleteImportedHistory(store, input.conversation, env, fetcher);
  if (history === 'busy') throw Object.assign(new Error('An import step is running for this person. Try again in two minutes; nothing was changed.'), { status: 409 });
  const { texts_removed } = await store.resetOnboarding(input.conversation);
  console.log(JSON.stringify({ event: 'admin_onboarding_reset', texts_removed, history }));
  return { state: 'invited', texts_removed, history };
}
// A person's saved items with each item's price alert, for the owner's Wishlist tab. Test texts
// stay limited to the designated test conversation; for everyone else the tab only previews.
async function personWishlist(store, id, env) {
  const alertsOn = env.PRICE_ALERTS_ENABLED === 'true';
  const [rows, alerts, profile] = await Promise.all([store.wishlistEntries(id), alertsOn ? store.priceAlerts(id) : [], store.profile(id)]);
  const market = marketEnvironment(profile?.facts ?? [], env);
  const items = groupWishlist(rows, { currency: market.SHOPPING_CURRENCY, country: market.SHOPPING_COUNTRY }).map(({ entries, ...item }) => {
    const alert = alerts.find(a => a.group_id === item.id);
    return { ...item, price_alert: alert ? { id: alert.id, active: alert.active, size: alert.size, last_checked_at: alert.last_checked_at, notified: alert.notified,
      links: (alert.links ?? []).map(l => l.url), baselines: (alert.baselines ?? []).map(({ amount, currency, url, available }) => ({ amount, currency, url, available })),
      stock: alert.last_result?.stock ?? null, low_stock: lowStockSummary(alert),
      low_stock_check: alert.last_result?.low_stock ? (({ state, reason, would_send, checked_at, episode }) => ({ state, reason, would_send, checked_at, episode_started_at: episode?.started_at ?? null }))(alert.last_result.low_stock) : null } : null };
  });
  return { items, alerts_enabled: alertsOn, test_delivery: Boolean(env.PRICE_ALERT_TEST_CONVERSATION_ID) && env.PRICE_ALERT_TEST_CONVERSATION_ID === id };
}
// Nudge decisions kept on the history row (lib/nudges.js), newest first. Test sends are offered only for
// the designated test conversation; for everyone else the dialog shows the log.
async function nudgeView(store, id, env) {
  const row = await store.gmailImport(id), test = Boolean(nudgeTestConversation(env)) && nudgeTestConversation(env) === id;
  return { log: [...(row?.data?.nudges?.log ?? [])].reverse(), texts_on: purchaseTextsOn(row?.data), timezone: nudgeTimezone(row?.data), test_delivery: test,
    candidates: test ? (await goesWithCandidates(store, id)).map(({ facts, raw, ...item }) => item) : [] };
}
export default createAdminHandler();
