// Admin › People data view: which testers a search shows, how long ago things happened, and the chat quality strip.
// Pure functions so the list logic is testable without a browser.

// Identifiers are phone numbers or emails; spaces are ignored on both sides so "+1 415" finds "+14155550142".
export function filterPeople(people, query = '') {
  const q = query.replace(/\s/g, '').toLowerCase();
  return q ? people.filter(p => p.sender_id.replace(/\s/g, '').toLowerCase().includes(q)) : people;
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
