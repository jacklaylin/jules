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
export const METRICS = [
  ['first_message_s.median', 'First message', v => `${v}s`],
  ['final_result_s.median', 'Final result', v => `${v}s`],
  ['final_result_s.p90', 'Final result p90', v => `${v}s`],
  ['failure_rate', 'Failed replies', v => `${Math.round(v * 100)}%`],
  ['model_written_share', 'Model-written', v => `${Math.round(v * 100)}%`],
  ['first_try_rate', 'First-try find', v => `${Math.round(v * 100)}%`],
];
const TONE = { better: 'ok', worse: 'fail' };
const known = v => v !== null && v !== undefined;

// One cell per metric: this week's value, the verdict as a badge word, and last week's value for the tooltip.
export function metricCells(trend) {
  return METRICS.map(([key, label, format]) => {
    const moved = trend?.moved?.find(m => m.metric === key);
    const verdict = moved?.verdict ?? 'no data';
    return { key, label, value: known(moved?.after) ? format(moved.after) : '—', tone: TONE[verdict] ?? 'plain',
      verdict: verdict[0].toUpperCase() + verdict.slice(1), was: known(moved?.before) ? `Previous 7 days: ${format(moved.before)}` : 'No earlier data' };
  });
}

export function metricsNote(current) {
  if (!current) return '';
  return `${current.turns} turns (${current.timed_turns} timed), ${current.fallbacks} fallbacks, ${current.stuck} never delivered, ${current.named_accepted} named-product searches with a pick.`;
}
