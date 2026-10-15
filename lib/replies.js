import { composeReply, recentTurns } from './compose.js';
// body is the factual draft; the model rewrites it in Jules's voice before sending (lib/compose.js).
// facts say what this message may report as done; purpose labels the message for the composer.
export async function deliverReply({ store, send, conversation, operation, body, source, env, facts = {}, purpose = 'notification', compose = composeReply }) {
  const reserved = await store.reserve(conversation.id, operation, body, source);
  if (!reserved) {
    // A retry of the same operation. Its stored text may be the composed version of this draft.
    const existing = await store.operation(operation);
    if (!existing || existing.conversation_id !== conversation.id) {
      const error = new Error('Operation conflict'); error.status = 409; throw error;
    }
    return { status: existing.status, duplicate: true };
  }
  let recent = [];
  try { recent = store.recent ? recentTurns(await store.recent(conversation.id)) : []; } catch { /* Context is optional. */ }
  const composed = await compose({ draft: body, facts, conversation: recent, purpose, env });
  if (composed.composed) await store.prepareAI(operation, composed.body, source);
  body = composed.body;
  let sent;
  try {
    sent = await send({ space: { phone: conversation.line }, message: { sender: { id: conversation.sender_id } } }, body, env);
  } catch {
    // A network error cannot prove whether Photon sent the message. Never retry automatically.
    await store.finish(operation, 'uncertain');
    return { status: 'uncertain' };
  }
  if (sent?.id && store.recordDelivery) {
    try { await store.recordDelivery(operation,sent.id); }
    catch { console.log(JSON.stringify({event:'imessage_delivery_reference_failed',operation})); }
  }
  await store.finish(operation, 'sent');
  return { status: 'sent' };
}
