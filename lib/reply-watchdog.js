import { timingSafeEqual } from 'node:crypto';
import { createStore } from './store.js';
import { sendGreeting } from './photon.js';
import { json } from './http.js';
import { sweepStalledReplies } from './reply-failures.js';
import { recordJobRun } from './jobs.js';

// Authorized with the scheduler secret kept in Supabase Vault (the same one the Gmail sweep uses),
// read once per warm instance through the service-role connection. Nobody copies it.
let secret = null;
export async function handleReplyWatchdog(req, res, env, { storeFactory = createStore, send = sendGreeting } = {}) {
  let store;
  try { store = storeFactory(env); secret ??= await store.gmailSweepSecret(); } catch { return json(res, 503, { error: 'Watchdog not configured.' }); }
  const expected = typeof secret === 'string' && secret.length >= 32 ? Buffer.from('Bearer ' + secret) : null, received = Buffer.from(req.headers.authorization ?? '');
  if (!expected || received.length !== expected.length || !timingSafeEqual(received, expected)) return json(res, 401, { error: 'Unauthorized.' });
  const started = Date.now();
  try {
    const result = await sweepStalledReplies(env, { store, send });
    console.log(JSON.stringify({ event: 'reply_watchdog', ...result }));
    await recordJobRun(store, 'reply_watchdog', started, 'ok', result);
    return json(res, 200, result);
  } catch { console.log(JSON.stringify({ event: 'reply_watchdog_failed' })); await recordJobRun(store, 'reply_watchdog', started, 'failed'); return json(res, 503, { error: 'Watchdog failed.' }); }
}
export const resetWatchdogSecret = () => { secret = null; };
