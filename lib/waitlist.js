import { deliverReply } from './replies.js';
import { sendGreeting } from './photon.js';
import { setUpAccount } from './accounts.js';
import { approvedWelcomeText, welcomeConversation } from './onboarding.js';

// Waitlist access (db/035). With WAITLIST_ENABLED=true, a waitlisted number gets a few real Jules
// replies, then one fixed notice a day; approved numbers are never limited. Approval is an admin action.
export const WAITLIST_REPLIES = 3;
export const WAITLIST_NOTICE = 'you’re on the waitlist for now, so i can’t keep going here yet. you don’t need to do anything. i’ll text you right here when your spot opens.';

// The agent reads this from application context (lib/ai.js) to mention the waitlist in its own words.
export const WAITLIST_GUIDE = '\nWaitlist: application context waitlist means this user is on the waitlist and gets a few replies before their spot opens. Help with the newest message as usual. On their first waitlisted reply (replies_used 1), briefly say they are on the waitlist and Jules will text them here when their spot opens. When replies_left is 0, finish helping and say this is your last reply until their spot opens. Never promise a date or say how many people are ahead of them.';

// The outcome for one inbound message: { outcome:'approved'|'reply'|'notice'|'quiet', replies_used }.
export async function waitlistTurn(store, conversationId) {
  const turn = await store.claimWaitlistTurn(conversationId, WAITLIST_REPLIES);
  if (!turn || !['approved', 'reply', 'notice', 'quiet'].includes(turn.outcome)) throw new Error('Waitlist turn not recorded');
  return turn;
}

// The agent's view of a waitlisted reply; null when access is approved.
export const waitlistContext = turn => turn?.outcome === 'reply'
  ? { replies_used: turn.replies_used, replies_left: Math.max(0, WAITLIST_REPLIES - turn.replies_used) } : null;

// Texted once when the owner approves someone who was on the waitlist (Admin › People).
export const APPROVED_TEXT = 'good news: your spot just opened. i’m jules, your personal shopper. send me a photo, a link, or tell me what you’re looking for.';
const asWritten = async ({ draft }) => ({ body: draft, captions: [], composed: false });

// Self-serve onboarding has its own switch, and also needs the onboarding offer and the real Gmail
// import. Self-serve members have an internal email; Gmail connect binds any Google account to the
// signed-in person (lib/gmail-import.js), so their Gmail need not match it.
export const selfServeOnboarding = env => env.SELF_SERVE_ONBOARDING_ENABLED === 'true' && env.ONBOARDING_ENABLED === 'true' && env.GMAIL_IMPORT_ENABLED === 'true';

// What approving texts, for the owner's confirmation (one text, at most once per person).
export const approvalPreview = env => selfServeOnboarding(env)
  ? { text: approvedWelcomeText(env), account: true } : env.WAITLIST_ENABLED === 'true' ? { text: APPROVED_TEXT, account: false } : null;

// Approves a waitlisted conversation. Only a real change does anything else:
// - with self-serve onboarding on, it sets up their account (lib/accounts.js) and texts the onboarding
//   welcome instead of the plain text; someone already past onboarding gets the plain text;
// - otherwise, while the waitlist is on, it texts APPROVED_TEXT (with it off nobody was told to wait).
// A failed account setup still approves them and falls back to the plain text.
// Returns { changed, text: send status or null, account: 'created'|'existing'|'failed'|null }, plus
// onboarding and the contact card's send status when the onboarding welcome went out.
export async function approveAccess(store, conversation, env, send = sendGreeting, fetcher = fetch) {
  const changed = await store.approveAccess(conversation.id);
  if (!changed) return { changed, text: null, account: null };
  let account = null;
  if (selfServeOnboarding(env)) {
    try { account = await setUpAccount(store, conversation, env, fetcher); }
    catch (error) { account = 'failed'; console.log(JSON.stringify({ event: 'account_setup_failed', status: error.status ?? error.database_status ?? null, code: error.code ?? error.database_code ?? null })); }
  }
  if (account && account !== 'failed') {
    const welcome = await welcomeConversation(store, conversation, env, send, approvedWelcomeText(env));
    if (welcome.message_status) return { changed, text: welcome.duplicate ? 'already_sent' : welcome.message_status, account, onboarding: true, ...(welcome.contact_card && { contact_card: welcome.contact_card }) };
  }
  if (env.WAITLIST_ENABLED !== 'true') return { changed, text: null, account };
  const sent = await deliverReply({ store, send, conversation, operation: `approved:${conversation.id}`, body: APPROVED_TEXT, source: 'operator', env, compose: asWritten });
  // Someone moved back to the waitlist and approved again already has this text; it is never resent.
  return { changed, text: sent.duplicate ? 'already_sent' : sent.status, account };
}

// Moves an approved conversation back to the waitlist. Nothing is texted; their next message gets the
// remaining allowance replies (or the waitlist notice if those are used).
export async function waitlistAgain(store, conversation) {
  return { changed: await store.waitlistAccess(conversation.id), text: null };
}

// Whether a number that just signed up will start on the waitlist, for the signup screen: true unless
// its one conversation is approved. A number that has not texted yet starts waitlisted (db/035).
export async function signupWaitlisted(store, phone, env) {
  if (env.WAITLIST_ENABLED !== 'true') return false;
  const id = await store.conversationForPhone(phone);
  if (!id) return true;
  return (await store.accessFor([id])).get(id)?.access !== 'approved';
}
