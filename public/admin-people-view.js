// Admin › People data view: which testers a search shows, how long ago things happened, and the chat quality strip.
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
export function countLine(shown, total, refreshedAt, now = Date.now()) {
  const people = `${total} ${total === 1 ? 'person' : 'people'}`;
  return `${shown === total ? people : `${shown} of ${people}`}${refreshedAt ? ` · refreshed ${ago(refreshedAt, now)}` : ''}`;
}

// Chat quality summary (lib/chat-metrics.js metricsTrend). Counts only; the full breakdown is scripts/chat-metrics.js.
// Each metric has a plain label, the noun for its sample, and a one-line explanation shown under the strip.
const sec = v => `${v}s`, pct = v => `${Math.round(v * 100)}%`;
export const METRICS = [
  { key: 'first_message_s.median', label: 'First reply', format: sec, noun: ['reply', 'replies'],
    explain: 'Typical wait from a tester’s message to Jules’s first text back, including a quick “looking now”. Half of waits were shorter.' },
  { key: 'final_result_s.median', label: 'Full answer', format: sec, noun: ['reply', 'replies'],
    explain: 'Typical wait until the complete answer (search results, saved item, or the reply itself). Half of waits were shorter.' },
  { key: 'final_result_s.p90', label: 'Slowest 10%', format: sec, noun: ['reply', 'replies'],
    explain: '1 in 10 full answers took at least this long. Shows the bad waits the typical number hides.' },
  { key: 'failure_rate', label: 'Failed replies', format: pct, noun: ['message', 'messages'],
    explain: 'Tester messages that got the generic “something went wrong” text or no reply at all.' },
  { key: 'model_written_share', label: 'Written by AI', format: pct, noun: ['reply', 'replies'], higher: true,
    explain: 'Replies the model wrote in Jules’s voice, rather than fixed text. Replies sent before this was recorded are left out.' },
  { key: 'first_try_rate', label: 'Found first try', format: pct, noun: ['pick', 'picks'], higher: true,
    explain: 'When a tester asked for a specific product and then picked or saved one, how often it was in the first set of results.' },
];
const TONE = { better: 'ok', worse: 'fail' };
const known = v => v !== null && v !== undefined;
const count = (n, [one, many]) => `${n} ${n === 1 ? one : many}`;

// One cell per metric: this week's value (a dash when there is none), the verdict as a badge word,
// the week before's value ("vs 15.5s") and the sample behind this week's number ("61 replies"), so the
// badge is never the only signal. Which direction is better matches DIRECTIONS in lib/chat-metrics.js.
export function metricCells(trend) {
  return METRICS.map(({ key, label, format, noun, explain, higher = false }) => {
    const moved = trend?.moved?.find(m => m.metric === key);
    const verdict = moved?.verdict ?? 'no data';
    const value = known(moved?.after) ? format(moved.after) : '—';
    const was = known(moved?.before) ? `vs ${format(moved.before)}` : 'nothing before';
    const sample = known(moved?.after) ? count(moved.after_n ?? 0, noun) : `no ${noun[1]}`;
    return { key, label, value, explain, better: higher ? 'Higher is better.' : 'Lower is better.',
      tone: TONE[verdict] ?? 'plain', verdict: verdict[0].toUpperCase() + verdict.slice(1), was, sample };
  });
}

// The status-line summary in plain words: how many messages the numbers come from.
export function metricsNote(current) {
  if (!current) return '';
  const failed = current.fallbacks + current.stuck;
  return `Last 7 days: ${count(current.turns, ['tester message', 'tester messages'])}, ${failed} failed (${current.fallbacks} generic, ${current.stuck} never sent)`
    + `${current.named_searches ? `, ${current.named_accepted} of ${current.named_searches} named-product searches ended in a pick` : ''}.`;
}

// ---------- New signups (lib/tester-setup.js) ----------
// Signups with no conversation yet. Phones arrive masked ("•••-0123"), so a search matches the name or those digits.
export function filterSignups(signups, query = '') {
  const q = query.replace(/\s/g, '').toLowerCase(), digits = q.replace(/\D/g, '');
  return signups.filter(s => !q || (s.name ?? '').replace(/\s/g, '').toLowerCase().includes(q) || (digits && s.phone.slice(-4).includes(digits)));
}

// What setting someone up does, for its confirmation: the conversation on their line, then the approval.
export function setupLines(approvalText, approvalAccount = false) {
  return ['Jules saves their conversation on the line you enter, so the welcome and every reply come from that line.', ...approvalLines(approvalText, approvalAccount),
    ...(approvalAccount && approvalText ? ['Right after the welcome, Jules texts its contact card with this line’s number, so they can save it.'] : [])];
}

// The result of a setup for the status line.
export function setupResult({ created, ...result }) {
  if (!result.changed) return `Nothing new was sent: they were already set up${created ? '' : ' on this line'}.`;
  if (result.onboarding && result.text === 'sent') {
    const card = { sent: ' and the contact card', blocked: '', uncertain: '; the contact card may not have been delivered', failed: '; the contact card could not be sent (try Send contact card on their page)' }[result.contact_card] ?? '';
    return `Set up on their line. ${result.account === 'created' ? 'Account set up. ' : ''}Jules texted them the welcome${card}.`;
  }
  return `Set up on their line. ${accessResult('approved', result).replace(/^Approved\. /, '')}`;
}
