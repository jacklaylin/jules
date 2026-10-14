import { authorize } from '../lib/auth.js';
import { createStore } from '../lib/store.js';
import { json, readJson, uuid } from '../lib/http.js';
import { purchaseReview, reviewPurchase, reportMissedPurchase } from '../lib/purchase-review.js';

export const config = { api: { bodyParser: false }, maxDuration: 30 };
// Owner view. Conversations are read-only (Jules replies automatically); the owner can review and
// correct imported purchase history.
export function createAdminHandler({ auth = authorize, storeFactory = createStore, env = process.env } = {}) {
  return async (req, res) => {
    try {
      const access = await auth(req.headers, env);
      if (access !== 200) return json(res, access, { error: access === 503 ? 'Admin is not configured yet.' : 'Please sign in with the owner account.' });
      if (!['GET','POST'].includes(req.method)) { res.setHeader('Allow', 'GET, POST'); return json(res, 405, { error: 'Method not allowed.' }); }
      if (req.method === 'POST') {
        // The only writes are purchase-history reviews; manual replies stay retired.
        const input = await readJson(req);
        if (!['review', 'missed'].includes(input.action)) return json(res, 400, { error: 'Unknown purchase action.' });
        const store = storeFactory(env);
        if (!uuid(input.conversation) || !await store.conversation(input.conversation)) return json(res, 404, { error: 'Conversation not found.' });
        if (input.action === 'review') await reviewPurchase(store, input.conversation, input);
        else await reportMissedPurchase(store, input.conversation, input);
        return json(res, 200, await purchaseReview(store, input.conversation));
      }
      const query = new URL(req.url, 'https://local.invalid').searchParams;
      if (query.get('view') === 'access') return json(res, 200, { owner: true });
      const store = storeFactory(env);
      if (query.get('view') === 'feedback') return json(res, 200, { feedback: await store.feedback() });
      const id = query.get('conversation');
      if (!id) return json(res, 200, { conversations: await store.list() });
      if (!uuid(id)) return json(res, 400, { error: 'Invalid conversation.' });
      const conversation = await store.conversation(id);
      if (!conversation) return json(res, 404, { error: 'Conversation not found.' });
      if (query.get('view') === 'purchases') return json(res, 200, await purchaseReview(store, id));
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
export default createAdminHandler();
