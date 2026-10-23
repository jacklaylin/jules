// Admin › People data view: which testers a search shows and how long ago things happened (chat quality moved to Admin › Scorecard).
// Pure functions so the list logic is testable without a browser.

// Matches the identifier (a phone number or email) or the name; spaces are ignored on both sides so
// "+1 415" finds "+14155550142" and "janedoe" finds "Jane Doe".
export function filterPeople(people, query = '', access = '') {
  const q = query.replace(/\s/g, '').toLowerCase(), squash = v => (v ?? '').replace(/\s/g, '').toLowerCase();
  return people.filter(p => (!q || squash(p.sender_id).includes(q) || squash(p.name).includes(q)) && (!access || p.access === access));
}

// What a status change will do, in plain words for the confirmation dialog. allowance is the
// waitlist reply limit; approvalText is the text Jules sends on approval (null when nothing is sent);
// approvalAccount means approving also sets up their account (self-serve onboarding).
export function accessChange(person, to, { allowance, approvalText, approvalAccount = false }) {
  if (to === 'approved') return { title: 'Approve from the waitlist?', confirm: 'Approve', lines: approvalLines(approvalText, approvalAccount) };
  const used = Math.min(person.waitlist_replies ?? 0, allowance), left = allowance - used;
  return { title: 'Move back to the waitlist?', confirm: 'Move to waitlist',
    lines: [`They have used ${used} of ${allowance} waitlist replies, so their next message gets ${left ? `${left} more ${left === 1 ? 'reply' : 'replies'} from Jules` : 'the waitlist text instead of a reply'}.`, 'Nothing is sent now. Approving them again later does not resend the spot-opened text.'] };
}

export function approvalLines(approvalText, approvalAccount = false) {
  return ['They get full Jules from their next message, with no reply limit.',
    ...(approvalAccount ? ['Jules sets up their account, so they can sign in with their phone number and connect Gmail. Anyone you already set up keeps their account.'] : []),
    approvalText ? `Jules texts them once: “${approvalText}”${approvalAccount ? ' Someone who already finished onboarding gets the plain spot-opened text instead.' : ''}` : 'No text is sent, because the waitlist is turned off.'];
}

// The result of a status change for the status line.
export function accessResult(to, { changed, text, account = null }) {
  if (!changed) return 'Nothing changed: their status was already updated.';
  if (to === 'waitlisted') return 'Moved back to the waitlist. Nothing was sent.';
  const setup = { created: 'Account set up. ', failed: 'Their account could not be set up, so they got the plain text and can still chat; check the logs for account_setup_failed. ' }[account] ?? '';
  return `Approved. ${setup}${{ sent: 'Jules texted them that their spot opened.', already_sent: 'They already got this text earlier, so nothing new was sent.', blocked: 'No text sent: they replied STOP.', uncertain: 'The text may not have been delivered; check their Conversation tab before resending anything.' }[text] ?? 'No text was sent.'}`;
}

// The waitlist filter's segments with counts; none when no status could be read (db/035 not run).
export function accessSegments(people) {
  if (!people.some(p => p.access)) return [];
  const n = access => people.filter(p => p.access === access).length;
  return [['', 'All', people.length], ['waitlisted', 'Waitlisted', n('waitlisted')], ['approved', 'Approved', n('approved')]];
}

// "just now", "5 min ago", "3 hours ago", "yesterday", "4 days ago"; older than a fortnight shows the date.
export function ago(at, now = Date.now()) {
  const seconds = Math.max(0, (now - new Date(at).getTime()) / 1000);
  if (!Number.isFinite(seconds)) return '—';
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60); if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60); if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.floor(hours / 24); if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: new Date(at).getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric' });
}

// "10 people · refreshed 1 min ago", or "3 of 10 people · …" while a search narrows the list.
export function countLine(shown, total) {
  const people = `${total} ${total === 1 ? 'person' : 'people'}`;
  return shown === total ? people : `${shown} of ${people}`;
}

// ---------- New signups (lib/new-signups.js) ----------
// Signups with no conversation yet. Phones arrive masked ("•••-0123"), so a search matches the name or those digits.
export function filterSignups(signups, query = '') {
  const q = query.replace(/\s/g, '').toLowerCase(), digits = q.replace(/\D/g, '');
  return signups.filter(s => !q || (s.name ?? '').replace(/\s/g, '').toLowerCase().includes(q) || (digits && s.phone.slice(-4).includes(digits)));
}

// ---------- Resend welcome (Admin › person, lib/onboarding.js resendWelcome) ----------
export function welcomeResult({ welcome, contact_card }) {
  if (welcome === 'blocked') return 'Not sent: they texted STOP.';
  if (welcome !== 'sent') return 'The welcome may not have been delivered again; check imessage_send_failed in the Vercel logs before resending.';
  const card = { sent: ' and the contact card', uncertain: '; the contact card may not have been delivered', failed: '; the contact card could not be sent', skipped: '' }[contact_card] ?? '';
  return `Welcome sent again${card}.`;
}
