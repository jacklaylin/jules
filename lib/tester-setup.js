import { approveAccess } from './waitlist.js';
import { rememberSignup, displayName } from './memory.js';

// Setting up a new tester from Admin › People (ONBOARDING.md). Enrolling their number in Photon stays
// manual: Photon's SDK (@spectrum-ts) has no call that enrolls a number or assigns a line. Everything
// after it is here: the conversation row for their phone, then the usual approval (account, invite, welcome).

// The line every message arrives on. This project uses one shared Photon token, so the SDK reports each
// inbound message's line as its "shared" sentinel (SHARED_PHONE in @spectrum-ts/imessage), and
// receive_message (db/015) keys the conversation on (sender, 'shared'). Setup must store the same value,
// or the tester's first text opens a second, waitlisted conversation.
export const SHARED_LINE = 'shared';

// "•••-0123": the only part of a signup phone the admin page ever gets.
export const maskedPhone = phone => `•••-${String(phone).slice(-4)}`;
const refuse = (status, message) => Object.assign(new Error(message), { status });

// Signups whose number has no conversation yet, newest first, one per number. No full phone leaves here.
export async function signupsToSetUp(store) {
  return (await store.signupsWithoutConversation()).map(row => ({
    signup: row.request_id, phone: maskedPhone(row.phone_number), signed_up_at: row.consent_at,
    name: [displayName(row.profile?.first_name), displayName(row.profile?.last_name)].filter(Boolean).join(' ') || null,
  }));
}

// Creates (or reuses) the conversation for one signup on the shared line, then approves it.
// Safe to repeat: the number's existing conversation is used, never a second one, and approving an
// approved person changes and sends nothing (the ledger also keeps the welcome to once per person).
// Refuses, changing nothing, when this deployment's conversations aren't on the shared line (Photon set
// up with dedicated lines), the number texted STOP, or it already talks to Jules on another line (or several).
// Returns { conversation, created, changed, text, account }.
export async function setUpTester(store, { signup }, env, send, fetcher) {
  const latest = await store.latestLine();
  if (latest && latest !== SHARED_LINE) throw refuse(409, 'Jules’s conversations aren’t on Photon’s shared line, so Set up can’t tell which line this tester will text from. Nothing was set up.');
  const row = await store.signupById(signup);
  if (!row) throw refuse(404, 'This signup is no longer there. Refresh and try again.');
  const existing = await store.conversationsForPhone(row.phone_number);
  if (existing.length > 1) throw refuse(409, 'This number already talks to Jules on more than one line. Approve them from Testers instead; nothing was changed.');
  if (existing[0]?.sms_opted_out_at) throw refuse(409, 'They texted STOP to Jules, so nothing was set up or sent. Only they can restart, by texting START.');
  if (existing[0] && existing[0].line !== SHARED_LINE) throw refuse(409, 'This number already has a conversation on a different line. Approve them from Testers instead; nothing was changed.');
  const conversation = existing[0] ?? await store.createConversation(row.phone_number, SHARED_LINE);
  const created = !existing[0];
  // Gender from the signup form seeds their shopping profile, as it would have if they had texted first.
  if (row.profile?.gender) try { await rememberSignup(store, conversation.id, row.profile.gender, row.request_id); } catch { console.log(JSON.stringify({ event: 'signup_profile_seed_failed' })); }
  const result = await approveAccess(store, conversation, env, send, fetcher);
  console.log(JSON.stringify({ event: 'admin_tester_set_up', created, changed: result.changed, text: result.text, account: result.account ?? null }));
  return { conversation: conversation.id, created, ...result };
}
