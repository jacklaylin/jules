import { deliverReply } from './replies.js';

// Carrier opt-out keywords (CTIA messaging principles; TCPA revocation of consent).
// These are legally required compliance controls, not conversational intent routing: they are
// matched deterministically, only when the whole message is the keyword, and before the model
// sees anything. Any longer message ("cancel my price alert") still goes to the agent.
const KEYWORDS = {
  stop: ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'],
  start: ['START', 'UNSTOP'],
  help: ['HELP'],
};
export function complianceKeyword(text) {
  const word = String(text ?? '').trim().replace(/[.!]+$/, '').toUpperCase();
  return Object.keys(KEYWORDS).find(kind => KEYWORDS[kind].includes(word)) ?? null;
}

const site = env => (env.SITE_ORIGIN ?? '').replace(/\/$/, '');
export const STOP_REPLY = 'you’re unsubscribed from Jules texts and won’t get any more messages, including price alerts. text START anytime to turn them back on.';
export const START_REPLY = 'you’re back on. Jules texts are turned on again. reply STOP anytime to stop, or HELP for help.';
export const helpReply = env => `Jules is a personal shopper you text. i find clothes, save them to your wishlist and watch prices when you ask. reply STOP to stop all texts. msg & data rates may apply. msg frequency varies.${site(env) ? ` privacy and contact: ${site(env)}/privacy` : ''}`;

// Handles a carrier keyword. Returns the log event, or null when the message is not one.
// START only means re-subscribe for someone who opted out; otherwise it is an ordinary message.
export async function handleComplianceKeyword(delivery, conversationId, { store, send, env, optedOut }) {
  const kind = complianceKeyword(delivery.message.content?.text);
  if (!kind || (kind === 'start' && !optedOut)) return null;
  const conversation = { id: conversationId, sender_id: delivery.message.sender.id, line: delivery.space.phone };
  const reply = body => deliverReply({ store, send, conversation, operation: `compliance:${delivery.message.id}`, body, source: 'compliance', env });
  if (kind === 'help') { await reply(helpReply(env)); return 'sms_help_sent'; }
  // The state change commits before the confirmation, so a failed send never leaves texts on.
  const changed = await store.setSmsOptOut(conversationId, kind === 'stop');
  if (!changed) return kind === 'stop' ? 'sms_opt_out_repeated' : 'sms_opt_in_repeated';
  await reply(kind === 'stop' ? STOP_REPLY : START_REPLY);
  return kind === 'stop' ? 'sms_opted_out' : 'sms_opted_in';
}
