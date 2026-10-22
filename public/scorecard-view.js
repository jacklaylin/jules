// Admin › Scorecard (RECOMMENDATION-SCORECARD.md, PR 4): weekly recommendation quality from sourcing turns
// (lib/turn-outcomes.js labels, lib/judge.js verdicts). Pure functions shared by the page and tests:
// turn rows in, figures out. No message text: rows carry ids, counts, labels and the judge's paraphrased reasons.
const DAY = 86400000, WEEKS = 8, MIN_SAMPLE = 5;
export const TYPES = [{ key: 'all', label: 'All' }, { key: 'text', label: 'Text' }, { key: 'photo', label: 'Photo' }, { key: 'link', label: 'Link' }];
// Failed searches worth reading: something broke, or nothing was found. BROKE is the first part alone.
const FAILED = new Set(['failed', 'unreadable', 'nothing_found']), BROKE = new Set(['failed', 'unreadable']);
const ms = at => Date.parse(at);
const quantile = (values, q) => { const s = values.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : null; };
const rate = (n, d) => d ? n / d : null;
const engaged = t => t.products_shown > 0 && t.headline !== 'waiting' && !(t.labels?.length === 1 && t.labels[0] === 'not_recorded');

// Monday 00:00 UTC of the week containing at.
export function weekStart(at) {
  const d = new Date(typeof at === 'number' ? at : ms(at)); d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7); return d.getTime();
}

// Each metric: how it is computed from a set of turns, its sample, its format and which way is better.
// minChange: the smallest move that counts as better or worse rather than about the same.
const pct = v => `${Math.round(v * 100)}%`, sec = v => `${Math.round(v / 100) / 10}s`, usd = v => `$${v.toFixed(3)}`;
export const METRICS = [
  { key: 'verified_rate', label: 'Verified result', format: pct, higher: true, minChange: 0.05, noun: ['search', 'searches'],
    compute: ts => { const s = ts.filter(t => t.result !== 'question'); return { value: rate(s.filter(t => t.result === 'verified').length, s.length), n: s.length }; },
    explain: 'Searches that showed at least one product page Jules checked and verified. Shopping questions (Jules asking before searching) are left out.' },
  { key: 'positive_rate', label: 'Positive next step', format: pct, higher: true, minChange: 0.05, noun: ['result', 'results'],
    compute: ts => { const s = ts.filter(engaged); return { value: rate(s.filter(t => t.headline === 'positive').length, s.length), n: s.length }; },
    explain: 'Of searches that showed products and whose follow-up is known: the tester saved, set an alert, picked or liked options, asked to buy, tapped a link or tapped ❤️ 👍 😂 ‼️.' },
  { key: 'judge_pass_rate', label: 'Judge pass', format: pct, higher: true, minChange: 0.05, noun: ['judged turn', 'judged turns'],
    compute: ts => { const s = ts.filter(t => t.verdict); return { value: rate(s.filter(t => t.verdict === 'pass').length, s.length), n: s.length }; },
    explain: 'Searches the nightly judge passed on every criterion. It is lenient on taste and fit and can’t see photos, so read the failures rather than trusting the rate alone.' },
  { key: 'first_p50', label: 'First reply (typical)', format: sec, higher: false, minRatio: 0.1, noun: ['search', 'searches'],
    compute: ts => { const v = ts.map(t => t.first_message_ms).filter(Number.isFinite); return { value: quantile(v, 0.5), n: v.length }; },
    explain: 'Time from the tester’s message to Jules’s first text back (usually the “looking now” line). Half were faster.' },
  { key: 'result_p50', label: 'Results (typical)', format: sec, higher: false, minRatio: 0.1, noun: ['search', 'searches'],
    compute: ts => { const v = ts.map(t => t.result_ms).filter(Number.isFinite); return { value: quantile(v, 0.5), n: v.length }; },
    explain: 'Time until the results arrived. Half were faster.' },
  { key: 'result_p90', label: 'Results (slowest 10%)', format: sec, higher: false, minRatio: 0.1, noun: ['search', 'searches'],
    compute: ts => { const v = ts.map(t => t.result_ms).filter(Number.isFinite); return { value: quantile(v, 0.9), n: v.length }; },
    explain: '1 in 10 searches took at least this long.' },
  { key: 'failed_rate', label: 'Failed', format: pct, higher: false, minChange: 0.05, noun: ['search', 'searches'],
    compute: ts => ({ value: rate(ts.filter(t => BROKE.has(t.result)).length, ts.length), n: ts.length }),
    explain: 'Searches where something broke: the reply fell back to the plain message, stalled, or couldn’t read the photo.' },
  { key: 'nothing_found_rate', label: 'Nothing found', format: pct, higher: false, minChange: 0.05, noun: ['search', 'searches'],
    compute: ts => ({ value: rate(ts.filter(t => t.result === 'nothing_found').length, ts.length), n: ts.length }),
    explain: 'Searches that worked but showed no products: Jules said it couldn’t find the item rather than sending a guess.' },
  { key: 'cost_per_search', label: 'Cost per search', format: usd, higher: false, minRatio: 0.1, noun: ['search', 'searches'],
    compute: ts => { const v = ts.map(t => Number(t.cost_usd)).filter(Number.isFinite); return { value: v.length ? v.reduce((a, b) => a + b, 0) / v.length : null, n: v.length }; },
    explain: 'Estimated OpenAI and SerpApi spend for the search and its acknowledgment and follow-up texts, at list prices. The judge’s own cost is not included.' },
];

// Who the figures cover: testers only (the founder's own conversation left out) or everyone.
export const WHO = [{ key: 'testers', label: 'Testers only' }, { key: 'all', label: 'Include mine' }];
export function forWho(turns, who, own = []) { const mine = new Set(own); return who === 'all' ? turns : turns.filter(t => !mine.has(t.conversation_id)); }

const ofType = (turns, type) => type === 'all' ? turns : turns.filter(t => t.request_type === type);
export function figures(turns) { return Object.fromEntries(METRICS.map(m => [m.key, m.compute(turns)])); }

// This week against last week, judged on each metric's own sample, like the People chat-quality strip.
export function verdict(metric, now, before) {
  if (now.value === null) return 'no data';
  if (now.n < MIN_SAMPLE || (before.value !== null && before.n < MIN_SAMPLE)) return 'too few to tell';
  if (before.value === null) return 'no earlier data';
  const delta = now.value - before.value;
  const small = metric.minRatio !== undefined ? Math.abs(delta) < metric.minRatio * Math.max(Math.abs(before.value), 1e-9) : Math.abs(delta) < metric.minChange;
  if (small) return 'about the same';
  return (delta > 0) === metric.higher ? 'better' : 'worse';
}
const TONE = { better: 'ok', worse: 'fail' };
const count = (n, [one, many]) => `${n} ${n === 1 ? one : many}`;

// The Compare choices (the same windows as lib/compare.js): this week (Monday, UTC) against last week, or the
// last 28 days against the 28 before.
export const PERIODS = [{ key: 'week', label: 'This week vs last week', before: 'last week' }, { key: 'month', label: 'Last 4 weeks vs the 4 before', before: 'the 4 weeks before' }];
export function periodRanges(period, now = Date.now()) {
  if (period === 'month') return { current: [now - 28 * DAY, now + 1], previous: [now - 56 * DAY, now - 28 * DAY] };
  const from = weekStart(now); return { current: [from, now + 1], previous: [from - 7 * DAY, from] };
}
export function metricCells(turns, { type = 'all', now = Date.now(), period = 'week' } = {}) {
  const scoped = ofType(turns, type), { current, previous } = periodRanges(period, now), before = (PERIODS.find(p => p.key === period) ?? PERIODS[0]).before;
  const within = ([from, to]) => scoped.filter(t => ms(t.at) >= from && ms(t.at) < to);
  const thisPeriod = figures(within(current)), lastPeriod = figures(within(previous));
  return METRICS.map(m => {
    const a = thisPeriod[m.key], b = lastPeriod[m.key], v = verdict(m, a, b);
    return { key: m.key, label: m.label, value: a.value === null ? '—' : m.format(a.value), verdict: v[0].toUpperCase() + v.slice(1), tone: TONE[v] ?? 'plain',
      was: b.value === null ? `nothing ${before}` : `vs ${m.format(b.value)}`, sample: a.value === null ? `no ${m.noun[1]}` : count(a.n, m.noun), explain: m.explain, better: m.higher ? 'Higher is better.' : 'Lower is better.' };
  });
}

// Up to eight weeks, newest first, each with every metric and its sample.
export function weekRows(turns, { type = 'all', now = Date.now() } = {}) {
  const scoped = ofType(turns, type), current = weekStart(now);
  if (!scoped.length) return [];
  const first = Math.max(weekStart(Math.min(...scoped.map(t => ms(t.at)))), current - (WEEKS - 1) * 7 * DAY), rows = [];
  for (let from = current; from >= first; from -= 7 * DAY) {
    const week = scoped.filter(t => ms(t.at) >= from && ms(t.at) < from + 7 * DAY), f = figures(week);
    rows.push({ week_of: new Date(from).toISOString().slice(0, 10), current: from === current, searches: week.length,
      cells: METRICS.map(m => ({ key: m.key, label: m.label, value: f[m.key].value === null ? '—' : m.format(f[m.key].value), n: f[m.key].n })) });
  }
  return rows;
}

// The turns most worth reading: judge failures first (most criteria failed), then negative outcomes, then
// failed searches; newest first within each. Turns with nothing wrong are left out.
export function worstTurns(turns, { limit = 30 } = {}) {
  const score = t => (t.failed?.length ?? 0) * 10 + (t.headline === 'negative' ? 5 : 0) + (FAILED.has(t.result) ? 3 : 0) + (t.labels?.includes('flagged') ? 2 : 0);
  return turns.filter(t => score(t) > 0).sort((a, b) => score(b) - score(a) || ms(b.at) - ms(a.at)).slice(0, limit);
}

// How often the founder agreed with the judge, from the "judge was right / wrong" marks.
export function agreement(turns) {
  const marked = turns.filter(t => t.founder_verdict), agree = marked.filter(t => t.founder_verdict === 'agree').length;
  return { marked: marked.length, agree, rate: rate(agree, marked.length) };
}

export const LABEL_TEXT = { saved: 'Saved', alert_on: 'Alert on', picked: 'Picked', purchase_intent: 'Asked to buy', clicked: 'Tapped link', reacted: 'Reacted', rejected: 'Rejected',
  missed: 'Missed', flagged: 'Flagged', confused: 'Tapped ❓', refined: 'Refined', clarified: 'Clarified', replied: 'Replied', moved_on: 'Moved on', not_recorded: 'Not recorded', silent: 'Silent', waiting: 'Waiting' };
export const RESULT_TEXT = { verified: 'Verified', unverified_only: 'Unverified only', nothing_found: 'Nothing found', question: 'Asked first', failed: 'Failed', unreadable: 'Photo unreadable' };
export const CRITERIA_TEXT = { identity: 'Wrong product or variant', links_verified: 'Unverified link', commerce_facts: 'Unsupported price, stock or shipping', clarification: 'Unneeded question', repetition: 'Repeated itself', consent: 'Consent' };

// One worst-turn row as display strings.
export function turnRow(t, { senders = {} } = {}) {
  return {
    date: new Date(t.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
    tester: senders[t.conversation_id] ?? 'Unknown tester',
    href: t.message_id ? `/admin/people/${t.conversation_id}?tab=conversation&message=${t.message_id}` : `/admin/people/${t.conversation_id}?tab=conversation`,
    type: t.request_type ?? '—', result: RESULT_TEXT[t.result] ?? t.result ?? '—',
    labels: (t.labels ?? []).map(l => LABEL_TEXT[l] ?? l).join(', '),
    judge: t.verdict ? (t.verdict === 'pass' ? 'Passed' : (t.failed ?? []).map(k => CRITERIA_TEXT[k] ?? k).join(', ')) : 'Not judged yet',
    reasons: (t.failed ?? []).map(k => ({ label: CRITERIA_TEXT[k] ?? k, reason: t.criteria?.[k]?.reason ?? '' })),
    tone: t.verdict === 'fail' || t.headline === 'negative' ? 'fail' : FAILED.has(t.result) ? 'warn' : 'plain',
  };
}
