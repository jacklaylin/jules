import { displayName } from './memory.js';

// Admin › People › New signups: people who signed up but haven't texted Jules yet (ONBOARDING.md).
// Photon only lets Jules text someone after they have texted their Jules line once (October 21: the
// first welcome sent before a tester texted failed with AuthenticationError), so nobody is set up from
// here. The owner enrolls them in Photon and asks them to text; their first text creates their
// conversation, which then shows under Testers, where Approve sets up their account and texts the welcome.

// "•••-0123": the only part of a signup phone the admin page ever gets.
export const maskedPhone = phone => `•••-${String(phone).slice(-4)}`;

// Signups whose number has no conversation yet, newest first, one per number. No full phone leaves here.
export async function signupsWaiting(store) {
  return (await store.signupsWithoutConversation()).map(row => ({
    signup: row.request_id, phone: maskedPhone(row.phone_number), signed_up_at: row.consent_at,
    name: [displayName(row.profile?.first_name), displayName(row.profile?.last_name)].filter(Boolean).join(' ') || null,
  }));
}
