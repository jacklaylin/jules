import { createStore } from './store.js';
import { deliverReply } from './replies.js';
import { GREETING } from './imessage.js';
import { generateReply } from './ai.js';
import { sendGreeting } from './photon.js';

export async function receiveInInbox(delivery, env, { store = createStore(env), send = sendGreeting, generate = generateReply } = {}) {
  const conversationId = await store.receive(delivery);
  if (env.AI_ENABLED === 'true') {
    const operation = `ai:${delivery.message.id}`;
    if (!await store.claimAI(conversationId, operation)) return 'imessage_ai_duplicate';
    let body, source = 'ai';
    try { body = await generate(await store.context(conversationId, delivery.message.id), env); }
    catch {
      source = 'ai_fallback';
      body = 'I couldn’t prepare a reply just now. Your message is saved in the inbox for manual review.';
    }
    await store.prepareAI(operation, body, source);
    try { await send(delivery, body, env); }
    catch { await store.finish(operation, 'uncertain'); return 'imessage_ai_reply_uncertain'; }
    await store.finish(operation, 'sent');
    return source === 'ai' ? 'imessage_ai_reply_sent' : 'imessage_ai_fallback_sent';
  }
  if (delivery.message.content.text.trim().toLowerCase() !== 'hello') return 'imessage_received';
  const conversation = { id: conversationId, sender_id: delivery.message.sender.id, line: delivery.space.phone };
  const result = await deliverReply({ store, send, conversation, operation: `greeting:${delivery.message.id}`, body: GREETING, source: 'greeting', env });
  return result.status === 'sent' ? 'imessage_reply_sent' : 'imessage_reply_uncertain';
}
