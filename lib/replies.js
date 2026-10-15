export async function deliverReply({ store, send, conversation, operation, body, source, env }) {
  const reserved = await store.reserve(conversation.id, operation, body, source);
  if (!reserved) {
    const existing = await store.operation(operation);
    if (!existing || existing.conversation_id !== conversation.id || existing.body !== body) {
      const error = new Error('Operation conflict'); error.status = 409; throw error;
    }
    // The ledger refused the send because the person texted STOP; nothing was sent.
    if (existing.status === 'blocked') return { status: 'blocked' };
    return { status: existing.status, duplicate: true };
  }
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
