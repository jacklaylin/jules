import { composeReply, recentTurns } from './compose.js';
import { trackLinks } from './adoption-events.js';
// body is the factual draft; the model rewrites it in Jules's voice before sending (lib/compose.js).
// facts say what this message may report as done; purpose labels the message for the composer.
// result (optional) is stored with the message, and its links in the final text become tracked /go/ links
// (lib/adoption-events.js), so a tap on, for example, an alert's store link is counted against this text.
export async function deliverReply({ store, send, conversation, operation, body, source, env, facts = {}, purpose = 'notification', compose = composeReply, result = null }) {
  const reserved = await store.reserve(conversation.id, operation, body, source);
  if (!reserved) {
    // A retry of the same operation. Its stored text may be the composed version of this draft.
    const existing = await store.operation(operation);
    if (!existing || existing.conversation_id !== conversation.id) {
      const error = new Error('Operation conflict'); error.status = 409; throw error;
    }
    // The ledger refused the send because the person texted STOP; nothing was sent.
    if (existing.status === 'blocked') return { status: 'blocked' };
    return { status: existing.status, duplicate: true };
  }
  let recent = [];
  try { recent = store.recent ? recentTurns(await store.recent(conversation.id)) : []; } catch { /* Context is optional. */ }
  const composed = await compose({ draft: body, facts, conversation: recent, purpose, env });
  body = composed.body;
  // Best effort: without the stored result the links stay as written and the text still goes out.
  let tracked = body;
  if (result && store.searchResult) {
    try { await store.searchResult(operation, result); tracked = trackLinks(body, result, operation, env); }
    catch { console.log(JSON.stringify({ event: 'reply_result_save_failed', operation, purpose })); }
  }
  if (composed.composed || tracked !== body) await store.prepareAI(operation, tracked, source);
  body = tracked;
  let sent;
  try {
    sent = await send({ space: { phone: conversation.line }, message: { sender: { id: conversation.sender_id } } }, body, env);
  } catch (error) {
    // A network error cannot prove whether Photon sent the message. Never retry automatically.
    // The log names the failure only: never the message, error text, phone numbers or credentials.
    console.log(JSON.stringify({ event: 'imessage_send_failed', operation, purpose, ...sendFailure(error) }));
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

// What kind of error a Photon send threw, for the log. Error messages can carry recipients or tokens, so
// only the class name and short machine codes are kept.
const code = value => (typeof value === 'string' && /^[\w.:-]{1,40}$/.test(value)) || Number.isInteger(value) ? value : undefined;
export const sendFailure = error => ({ name: code(error?.name) ?? 'unknown', code: code(error?.code), status: code(error?.status ?? error?.statusCode ?? error?.response?.status) });
