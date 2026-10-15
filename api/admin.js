import { authorize } from '../lib/auth.js';
import { createStore } from '../lib/store.js';
import { json, readJson, uuid } from '../lib/http.js';
import { purchaseReview, reviewPurchase, reportMissedPurchase } from '../lib/purchase-review.js';
import { groupWishlist } from '../lib/wishlist.js';
import { marketEnvironment } from '../lib/shopping-market.js';
import { metricsTrend } from '../lib/chat-metrics.js';
import { deleteImportedHistory } from '../lib/gmail-import.js';
import { tagPurchaseHistory } from '../lib/item-tags.js';
import { buildReport, sendReportLink, reportView } from '../lib/style-report.js';
import { firstName } from '../lib/memory.js';

export const config = { api: { bodyParser: false }, maxDuration: 30 };
// Owner view. Conversations are read-only (Jules replies automatically); the owner can review and
// correct imported purchase history.
export function createAdminHandler({ auth = authorize, storeFactory = createStore, env = process.env, fetcher = fetch } = {}) {
  return async (req, res) => {
    try {
      const access = await auth(req.headers, env);
      if (access !== 200) return json(res, access, { error: access === 503 ? 'Admin is not configured yet.' : 'Please sign in with the owner account.' });
      if (!['GET','POST'].includes(req.method)) { res.setHeader('Allow', 'GET, POST'); return json(res, 405, { error: 'Method not allowed.' }); }
      if (req.method === 'POST') {
        // The only writes are purchase-history reviews, tagging and the onboarding reset; manual replies stay retired.
        const input = await readJson(req);
        if (!['review', 'missed', 'tag', 'build-report', 'send-report', 'reset-onboarding'].includes(input.action)) return json(res, 400, { error: 'Unknown purchase action.' });
        if (input.action === 'reset-onboarding' && (!env.SITE_ORIGIN || req.headers.origin !== env.SITE_ORIGIN.replace(/\/$/, ''))) return json(res, 400, { error: 'Reset onboarding from the Jules admin page.' });
        const store = storeFactory(env);
        if (!uuid(input.conversation) || !await store.conversation(input.conversation)) return json(res, 404, { error: 'Conversation not found.' });
        if (input.action === 'reset-onboarding') return json(res, 200, await resetOnboarding(store, input, env, fetcher));
        if (input.action === 'build-report') {
          const built = await buildReport(store, input.conversation, env);
          if (built.status === 'busy') throw Object.assign(new Error('Purchase history is busy (an import or another edit is running). Try again in a moment.'), { status: 409 });
          if (built.status !== 'built') throw Object.assign(new Error(built.status === 'no_history' ? 'This person has no imported purchase history yet.' : `Not enough data for a receipt yet (${built.lines} of 3 lines).`), { status: 409 });
          return json(res, 200, { ...await purchaseReview(store, input.conversation), report: reportView(built.report) });
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
      if (query.get('view') === 'metrics') return json(res, 200, await metricsTrend(store, { days: 7 }));
      const id = query.get('conversation');
      if (!id) return json(res, 200, { conversations: await store.list() });
      if (!uuid(id)) return json(res, 400, { error: 'Invalid conversation.' });
      const conversation = await store.conversation(id);
      if (!conversation) return json(res, 404, { error: 'Conversation not found.' });
      if (query.get('view') === 'purchases') return json(res, 200, await purchaseReview(store, id));
      // Read-only view of a tester's style report for /report?person=<id>.
      if (query.get('view') === 'report') {
        const [row, name] = await Promise.all([store.gmailImport(id), firstName(store, id)]);
        return json(res, 200, { report: reportView(row?.data?.style_report, name ?? null), status: row?.data?.style_report ? 'built' : 'not_built' });
      }
      if (query.get('view') === 'wishlist') return json(res, 200, await personWishlist(store, id, env));
      let before;
      if (query.has('before')) {
        try { before = JSON.parse(query.get('before')); } catch { return json(res, 400, { error: 'Invalid history cursor.' }); }
        if (!uuid(before?.id) || !/^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|\+00:00)$/.test(before.at ?? '')) return json(res, 400, { error: 'Invalid history cursor.' });
      }
      return json(res, 200, { conversation, ...await store.messages(id, before) });
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
      stock: alert.last_result?.stock ?? null } : null };
  });
  return { items, alerts_enabled: alertsOn, test_delivery: Boolean(env.PRICE_ALERT_TEST_CONVERSATION_ID) && env.PRICE_ALERT_TEST_CONVERSATION_ID === id };
}
export default createAdminHandler();
