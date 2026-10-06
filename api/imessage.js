import { createProcessor, MAX_BYTES } from '../lib/imessage.js';
import { receiveInInbox } from '../lib/inbox.js';

export const config = { api: { bodyParser: false }, maxDuration: 30 };
const process = createProcessor({ handle: receiveInInbox });

export default async function handler(req, res) {
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
