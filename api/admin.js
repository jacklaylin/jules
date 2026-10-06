import { authorize } from '../lib/auth.js';
import { createStore } from '../lib/store.js';
import { sendGreeting } from '../lib/photon.js';
import { deliverReply } from '../lib/replies.js';
import { json, readJson, uuid } from '../lib/http.js';

export const config = { api: { bodyParser: false }, maxDuration: 30 };
export function createAdminHandler({ auth = authorize, storeFactory = createStore, send = sendGreeting, env = process.env } = {}) {
  return async (req, res) => {
    try {
      const access = await auth(req.headers, env);
      if (access !== 200) return json(res, access, { error: access === 503 ? 'Admin is not configured yet.' : 'Please sign in with the owner account.' });
      const store = storeFactory(env);
      if (req.method === 'GET') {
        const query = new URL(req.url, 'https://local.invalid').searchParams;
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
      }
      if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return json(res, 405, { error: 'Method not allowed.' }); }
      const input = await readJson(req);
      if (!uuid(input?.conversation) || !uuid(input?.operation) || typeof input?.body !== 'string' || !input.body.trim() || input.body.length > 4000) {
        return json(res, 400, { error: 'Choose a conversation and enter a reply of 1–4,000 characters.' });
      }
      const conversation = await store.conversation(input.conversation);
      if (!conversation) return json(res, 404, { error: 'Conversation not found.' });
      const result = await deliverReply({ store, send, conversation, operation: `operator:${input.operation}`, body: input.body.trim(), source: 'operator', env });
      console.log(JSON.stringify({ event: 'manual_reply', status: result.status, conversation_id: conversation.id }));
      return json(res, 200, result);
    } catch (error) {
      console.error(JSON.stringify({ event: 'admin_request_failed' }));
      return json(res, [400, 409, 413, 415].includes(error.status) ? error.status : 503, { error: 'Could not finish this request. Refresh the conversation before trying again.' });
    }
  };
}
export default createAdminHandler();
