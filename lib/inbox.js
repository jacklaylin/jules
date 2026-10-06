import { createStore } from './store.js';
import { deliverReply } from './replies.js';
import { GREETING } from './imessage.js';
import { sendGreeting } from './photon.js';

export async function receiveInInbox(delivery, env, { store = createStore(env), send = sendGreeting } = {}) {
  const conversationId = await store.receive(delivery);
  if (delivery.message.content.text.trim().toLowerCase() !== 'hello') return 'imessage_received';
  const conversation = { id: conversationId, sender_id: delivery.message.sender.id, line: delivery.space.phone };
  const result = await deliverReply({ store, send, conversation, operation: `greeting:${delivery.message.id}`, body: GREETING, source: 'greeting', env });
  return result.status === 'sent' ? 'imessage_reply_sent' : 'imessage_reply_uncertain';
}
