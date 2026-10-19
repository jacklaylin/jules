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
