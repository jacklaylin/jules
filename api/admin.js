import { authorize } from '../lib/auth.js';
import { createStore } from '../lib/store.js';
import { json, uuid } from '../lib/http.js';

export const config = { api: { bodyParser: false }, maxDuration: 30 };
// Read-only owner view. Jules replies automatically; manual operator replies were retired with human fallback.
export function createAdminHandler({ auth = authorize, storeFactory = createStore, env = process.env } = {}) {
  return async (req, res) => {
    try {
      const access = await auth(req.headers, env);
      if (access !== 200) return json(res, access, { error: access === 503 ? 'Admin is not configured yet.' : 'Please sign in with the owner account.' });
      if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return json(res, 405, { error: 'Method not allowed.' }); }
      const query = new URL(req.url, 'https://local.invalid').searchParams;
      if (query.get('view') === 'access') return json(res, 200, { owner: true });
      const store = storeFactory(env);
      if (query.get('view') === 'feedback') return json(res, 200, { feedback: await store.feedback() });
      const id = query.get('conversation');
      if (!id) return json(res, 200, { conversations: await store.list() });
      if (!uuid(id)) return json(res, 400, { error: 'Invalid conversation.' });
      const conversation = await store.conversation(id);
      if (!conversation) return json(res, 404, { error: 'Conversation not found.' });
      let before;
      if (query.has('before')) {
        try { before = JSON.parse(query.get('before')); } catch { return json(res, 400, { error: 'Invalid history cursor.' }); }
        if (!uuid(before?.id) || !/^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|\+00:00)$/.test(before.at ?? '')) return json(res, 400, { error: 'Invalid history cursor.' });
      }
      return json(res, 200, { conversation, ...await store.messages(id, before) });
    } catch (error) {
      console.error(JSON.stringify({ event: 'admin_request_failed' }));
      return json(res, [400, 409, 413, 415].includes(error.status) ? error.status : 503, { error: 'Could not load this view. Refresh and try again.' });
    }
  };
}
export default createAdminHandler();
