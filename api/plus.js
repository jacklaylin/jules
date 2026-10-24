// Loads first so the cost meter wraps fetch before any handler below keeps a reference to it.
import '../lib/usage.js';
import { createStore } from '../lib/store.js';
import { wishlistUser } from '../lib/wishlist.js';
import { json, readJson } from '../lib/http.js';
import { recordPlusEvent, PLUS_EVENTS } from '../lib/plus-test.js';

// Jules+ fake-door counts (lib/plus-test.js). A signed-in tester is counted as themselves; anyone else anonymously.
// A failed or missing sign-in is never an error here: the visitor still sees the page and their tap still counts.
export const config = { api: { bodyParser: false } };
export function createPlusHandler({ env = process.env, storeFactory = createStore, auth = wishlistUser, fetcher = fetch } = {}) {
  return async (req, res) => {
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return json(res, 405, { error: 'Use POST.' }); }
    try {
      const input = await readJson(req, 512);
      if (!Object.hasOwn(PLUS_EVENTS, input?.event)) return json(res, 400, { error: 'Unknown event.' });
      const store = storeFactory(env);
      let owner = null;
      if (req.headers.authorization) { try { const access = await auth(req.headers, env, store, fetcher); if (access.status === 200) owner = access.conversation; } catch {} }
      await recordPlusEvent(store, { owner, event: input.event, agent: req.headers['user-agent'] ?? '' });
      return json(res, 200, { ok: true, signed_in: Boolean(owner) });
    } catch { return json(res, 400, { error: 'Could not read that.' }); }
  };
}
export default createPlusHandler();
