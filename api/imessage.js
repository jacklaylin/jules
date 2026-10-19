// Loads first so the cost meter wraps fetch before any handler below keeps a reference to it.
import '../lib/usage.js';
import { createProcessor, MAX_BYTES } from '../lib/imessage.js';
import { waitUntil } from '@vercel/functions';
import { receiveInInbox } from '../lib/inbox.js';
import { handleReplyWatchdog } from '../lib/reply-watchdog.js';
import { recordReaction } from '../lib/adoption-events.js';
import { createStore } from '../lib/store.js';

export const config = { api: { bodyParser: false }, maxDuration: 120 };
// A search turn responds to the webhook once it is acknowledged; the search finishes in waitUntil,
// still within this function's maxDuration.
const process = createProcessor({ handle: (delivery, env) => receiveInInbox(delivery, env, { defer: waitUntil }),
  react: (reaction, env) => recordReaction(createStore(env), reaction) });

export default async function handler(req, res) {
  // The Supabase scheduler (db/028_reply_reliability.sql) calls this while a reply is stuck.
  if (req.method === 'GET' && new URL(req.url, 'https://jules.invalid').searchParams.get('watchdog') === 'replies') return handleReplyWatchdog(req, res, globalThis.process.env);
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.statusCode = 405;
    return res.end('Use POST');
  }
  try {
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > MAX_BYTES) { res.statusCode = 413; return res.end('Too large'); }
      chunks.push(bytes);
    }
    res.statusCode = await process(Buffer.concat(chunks), req.headers, globalThis.process.env);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end(res.statusCode === 200 ? 'ok' : 'Webhook could not be processed');
  } catch {
    console.error(JSON.stringify({ event: 'webhook_failed' }));
    res.statusCode = 500;
    res.end('Webhook could not be processed');
  }
}
