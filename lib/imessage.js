import { createHmac, timingSafeEqual } from 'node:crypto';
import { incomingContent } from './images.js';

export const GREETING = 'Hello from your personal shopper.';
export const MAX_BYTES = 65536;

export function verifySignature(body, headers, secret, now = Date.now()) {
  const timestamp = headers['x-spectrum-timestamp'];
  const signature = headers['x-spectrum-signature'];
  if (typeof timestamp !== 'string' || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
  if (typeof signature !== 'string' || !/^v0=[a-f0-9]{64}$/.test(signature)) return false;
  const expected = 'v0=' + createHmac('sha256', secret)
    .update(`v0:${timestamp}:`).update(body).digest('hex');
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

// Warm dedupe saves work; the inbox also reserves replies durably in Postgres.
export function createProcessor({ send, handle, log = console.log, now = Date.now }) {
  const deliveries = new Map();
  return async function process(body, headers, env) {
    if (!['SPECTRUM_PROJECT_ID', 'SPECTRUM_PROJECT_SECRET', 'SPECTRUM_WEBHOOK_SECRET']
      .every(key => env[key] && !env[key].startsWith('replace-with'))) {
      log(JSON.stringify({ event: 'configuration_error' }));
      return 503;
    }
    if (body.length > MAX_BYTES) return 413;
    if (!verifySignature(body, headers, env.SPECTRUM_WEBHOOK_SECRET, now())) return 401;
    if (!(headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) return 415;
    let payload;
    try { payload = JSON.parse(body.toString('utf8')); } catch { return 400; }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return 400;
    if (payload.event !== 'messages') {
      log(JSON.stringify({ event: 'webhook_ignored', reason: 'event', has_event: typeof payload.event === 'string' }));
      return 200;
    }
    const { message, space } = payload;
    if (!message || !space) return 400;
    // Ignore our own messages, reactions, receipts, and group chats.
    const contentType=message.content?.type==='reply'?message.content.content?.type:message.content?.type;
    if (message.direction !== 'inbound' || !['text', ...(env.IMAGES_ENABLED === 'true' ? ['attachment', 'group'] : [])].includes(contentType) ||
        !['imessage', 'iMessage'].includes(space.platform) || space.type !== 'dm') {
      // Record only fixed labels/booleans; never message text or phone numbers.
      log(JSON.stringify({ event: 'webhook_ignored', reason: 'message_filter',
        inbound: message.direction === 'inbound', text: message.content?.type === 'text',
        imessage: ['imessage', 'iMessage'].includes(space.platform), dm: space.type === 'dm',
        has_direction: typeof message.direction === 'string',
        has_content_type: typeof message.content?.type === 'string',
        has_platform: typeof space.platform === 'string', has_space_type: typeof space.type === 'string',
        direction: ['incoming', 'outgoing', 'inbound', 'outbound'].includes(message.direction) ? message.direction : 'unknown',
        space_type: ['dm', 'direct', 'group'].includes(space.type) ? space.type : 'unknown',
        platform: ['iMessage', 'imessage', 'SMS', 'RCS'].includes(space.platform) ? space.platform : 'unknown' }));
      return 200;
    }
    let content;
    try { content = incomingContent(message.content); } catch { return 400; }
    if (!content) return 200;
    if (typeof message.id !== 'string' || !message.id ||
        typeof message.sender?.id !== 'string' || !message.sender.id ||
        typeof space.id !== 'string' || !space.id || typeof space.phone !== 'string' ||
        typeof content.text !== 'string' || !content.text.length || content.text.length > 10000) return 400;
    message.content = { ...message.content, text: content.text };
    message.attachments = content.attachments;
    const key = JSON.stringify([headers['x-spectrum-webhook-id'], message.id]);
    for (const [id, record] of deliveries) {
      if (record.finished && now() - record.at > 300000) deliveries.delete(id);
    }
    const previous = deliveries.get(key);
    if (previous) return previous.task;
    if (deliveries.size >= 1000) return 503;
    const record = { at: now(), finished: false };
    // Schedule after inserting to prevent two concurrent deliveries from sending twice.
    record.task = Promise.resolve().then(async () => {
      try {
        const event = handle ? await handle({ space, message }, env) :
          (await send({ space, message }, GREETING, env), 'imessage_reply_sent');
        record.finished = true;
        log(JSON.stringify({ event, message_id: message.id }));
        return 200;
      } catch {
        deliveries.delete(key);
        // Never log SDK errors: they can include phone numbers or credentials.
        log(JSON.stringify({ event: 'imessage_reply_failed', message_id: message.id }));
        return 502;
      }
    });
    deliveries.set(key, record);
    return record.task;
  };
}
