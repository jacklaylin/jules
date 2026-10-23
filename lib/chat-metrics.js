// Chat quality metrics from persisted message rows and diagnostics: how long a tester waits, how
// often a reply fails, how much reply text is fixed template versus model-written, and whether a
// named product is found on the first search. Computation is pure (rows in, numbers out) so the
// script, the admin page and feedback triage share it. No message text, phone numbers or names are
// read or returned; conversations are identified by a short id prefix.
//
// Rows are linked by the operation id convention: every reply sent for an inbound message has an
// operation_id ending in `:<inbound provider_id>` (ai:, ack:, followup:, wishlist-confirm:, …).

import { BILLING_CODES } from './model-call.js';

const STUCK_AFTER_MS = 10 * 60 * 1000;
// reply_diagnostics (db/028, fallback alerts) carries outcome and composed_by for every ai: row when present.
// Tools whose reply text the model writes itself. Every other tool's reply is assembled by code.
// An explicit search_result.composed_by always wins over this inference.
export const MODEL_WRITTEN_TOOLS = new Set(['agent_reply', 'conversation_reply', 'wishlist_status', 'profile_status', 'ask_shopping_question', 'update_profile']);
const COMPOSITIONS = new Set(['model', 'template', 'mixed']);
// Sends that happen while a search runs; the agent writes them, and they are never the final result.
const UPDATE_KINDS = new Set(['ack', 'followup']);

const ms = at => at ? Date.parse(at) : NaN;
const kindOf = operation => String(operation ?? '').split(':')[0];
const day = at => new Date(at).toISOString().slice(0, 10);
const shortId = id => String(id ?? '').slice(0, 8);
const normalUrl = url => { try { const u = new URL(url); return (u.origin + u.pathname).replace(/\/$/, '').toLowerCase(); } catch { return null; } };
const urlsOf = products => new Set((products ?? []).flatMap(p => [p?.url, ...(p?.merchant_options ?? []).map(m => m?.url)]).map(normalUrl).filter(Boolean));

// When a reply row was actually sent. created_at is the placeholder time for `ai:` rows, so it is used
// only when the row was re-dated at send time (after an acknowledgment) or for rows reserved right
// before sending (acknowledgments, follow-ups, confirmations). sent_at (migration 027) is exact.
function sentAt(row, inboundAt) {
  if (row.status !== 'sent') return null;
  if (row.sent_at) return { at: ms(row.sent_at), source: 'recorded' };
  if (kindOf(row.operation_id) !== 'ai') return { at: ms(row.created_at), source: 'estimated' };
  if (ms(row.created_at) - inboundAt > 1000) return { at: ms(row.created_at), source: 'estimated' };
  const checked = ms(row.search_result?.checked_at);
  return Number.isFinite(checked) ? { at: checked, source: 'estimated' } : null;
}

export function composedBy(main, actions = new Map()) {
  if (main.source === 'ai_fallback' || main.source === 'ai_recovery' || main.reply_diagnostics?.outcome === 'fallback') return 'template';
  const recorded = main.reply_diagnostics?.composed_by ?? main.search_result?.composed_by;
  if (COMPOSITIONS.has(recorded)) return recorded;
  if (main.search_result?.user_confirmed === true) return 'template'; // the save confirmation replaces the reply
  const tool = actions.get(main.operation_id);
  return tool ? (MODEL_WRITTEN_TOOLS.has(tool) ? 'model' : 'template') : 'unknown';
}

// One record per inbound tester message that the agent took on.
// own: the founder's conversation ids (lib/scorecard.js ownConversations); turns from them are marked own.
export function turnsFrom(rows, { actions = new Map(), now = Date.now(), own = new Set() } = {}) {
  const replies = new Map();
  for (const row of rows) {
    if (row.direction !== 'outbound' || !row.operation_id?.includes(':')) continue;
    const key = `${row.conversation_id}|${row.operation_id.slice(row.operation_id.indexOf(':') + 1)}`;
    replies.set(key, [...(replies.get(key) ?? []), row]);
  }
  const turns = [];
  for (const inbound of rows) {
    if (inbound.direction !== 'inbound' || !inbound.provider_id || inbound.provider_id.startsWith('identification-test:')) continue;
    const linked = replies.get(`${inbound.conversation_id}|${inbound.provider_id}`) ?? [];
    const main = linked.find(r => kindOf(r.operation_id) === 'ai');
    if (!main || main.status === 'blocked') continue; // opted out: nothing is sent by design
    const t0 = ms(inbound.created_at);
    const timing = main.search_result?.timing_diagnostics;
    const sends = linked.map(r => ({ kind: kindOf(r.operation_id), ...sentAt(r, t0) })).filter(s => Number.isFinite(s.at));
    const finals = sends.filter(s => !UPDATE_KINDS.has(s.kind));
    const first = sends.length ? sends.reduce((a, b) => a.at <= b.at ? a : b) : null;
    const final = finals.length ? finals.reduce((a, b) => a.at >= b.at ? a : b) : null;
    const recorded = Number.isFinite(timing?.result_ms);
    const pending = ['generating', 'sending'].includes(main.status);
    // reply_diagnostics (db/028) records the outcome directly; a watchdog-recovered reply is still a stall.
    const outcome = main.reply_diagnostics?.outcome;
    const stuck = main.status === 'uncertain' || outcome === 'stalled' || outcome === 'uncertain' || main.source === 'ai_recovery'
      || (pending && now - ms(main.created_at) > STUCK_AFTER_MS);
    turns.push({
      conversation: shortId(inbound.conversation_id), at: inbound.created_at, day: day(inbound.created_at),
      first_message_ms: recorded ? timing.first_message_ms ?? timing.result_ms : first ? Math.max(0, first.at - t0) : null,
      final_result_ms: recorded ? timing.result_ms : final ? Math.max(0, final.at - t0) : null,
      timing_source: recorded ? 'recorded' : final ? final.source : 'unknown',
      acknowledged: linked.some(r => UPDATE_KINDS.has(kindOf(r.operation_id)) && r.status === 'sent'),
      // iMessages this turn sent: each sent row linked to it, plus the reply's extra parts (product
      // cards, captions, photos, page cards; reply_diagnostics.sent_parts). Texts not keyed by the
      // inbound message (style or purchase questions sent after the reply) are not counted.
      messages: pending ? null : linked.filter(r => r.status === 'sent').length + (main.reply_diagnostics?.sent_parts?.length ?? 0),
      searched: Boolean(timing),
      fallback: main.source === 'ai_fallback' || outcome === 'fallback', stuck,
      // The OpenAI account was out of credit or over its spend limit (founder decision, October 22): an
      // outage of the account, not of chat quality, so it is counted apart from failed replies.
      billing_outage: BILLING_CODES.has(main.reply_diagnostics?.model_error_code),
      composed_by: pending ? 'unknown' : composedBy(main, actions),
      tool: actions.get(main.operation_id) ?? null,
      complained: false, own: own.has(inbound.conversation_id), conversation_id: inbound.conversation_id,
    });
  }
  // A complaint is a #dev note, a 👎 tapback or a quality signal (the model saw that an earlier turn missed).
  // It counts against the tester's newest turn before it in the same conversation; a signal sits on the
  // message after the turn it is about, and notes and tapbacks never become turns themselves.
  const byConversation = new Map();
  for (const turn of turns) byConversation.set(turn.conversation_id, [...(byConversation.get(turn.conversation_id) ?? []), turn]);
  for (const row of rows) {
    if (row.direction !== 'inbound' || !(row.developer_feedback || row.quality_signal?.kind) || row.provider_id?.startsWith('identification-test:')) continue;
    const at = ms(row.created_at);
    const target = (byConversation.get(row.conversation_id) ?? []).filter(t => ms(t.at) < at).reduce((a, b) => !a || ms(b.at) >= ms(a.at) ? b : a, null);
    if (target) target.complained = true;
  }
  return turns.map(({ conversation_id, ...turn }) => turn); // full conversation ids stay inside
}

// Search episodes that name a specific product. An episode starts with a new (non-continuation)
// sourcing turn whose plan names a model or identifies a particular item, and ends at the first
// selection or save, or when a new episode starts. Outcome: the accepted item was in the first result
// set, in a later set (a retry was needed), or in none (the user supplied it themselves).
const isNamed = plan => Boolean(plan && plan.continuation !== true && plan.mode !== 'discover' && (String(plan.named_model ?? '').trim() || plan.mode === 'identify'));
export function findEpisodes(rows, { own = new Set() } = {}) {
  const mains = rows.filter(r => r.direction === 'outbound' && kindOf(r.operation_id) === 'ai' && r.search_result && r.status === 'sent')
    .sort((a, b) => String(a.conversation_id).localeCompare(String(b.conversation_id)) || ms(a.created_at) - ms(b.created_at));
  const episodes = [];
  let open = null;
  const close = (outcome, extra = {}) => { if (open) episodes.push({ ...open.summary, searches: open.searches, outcome, ...extra }); open = null; };
  for (const row of mains) {
    const result = row.search_result, state = result.text_wishlist_state;
    if (open && open.conversation_id !== row.conversation_id) close('no_acceptance');
    const plan = state?.search_plan ?? null;
    const sourcing = result.identification_policy === 'text_wishlist' && result.intent_action === 'start';
    if (sourcing && plan?.continuation !== true) {
      close('no_acceptance');
      if (isNamed(plan)) {
        const shown = urlsOf(result.products);
        open = { conversation_id: row.conversation_id, first: shown, later: new Set(), searches: 1,
          summary: { conversation: shortId(row.conversation_id), at: row.created_at, day: day(row.created_at), found_on_first_search: shown.size > 0, own: own.has(row.conversation_id) } };
      }
      continue;
    }
    if (!open) continue;
    if (sourcing) { open.searches++; for (const url of urlsOf(result.products)) if (!open.first.has(url)) open.later.add(url); continue; }
    const saved = result.user_confirmed === true ? urlsOf(result.products?.length ? result.products : result.alert_requests) : new Set();
    const selected = result.intent_action === 'selection' && ['interest', 'confirm'].includes(result.intent_decision) ? urlsOf(state?.selected_set) : new Set();
    const accepted = saved.size ? saved : selected;
    if (!accepted.size) continue;
    const inFirst = [...accepted].some(u => open.first.has(u)), inLater = [...accepted].some(u => open.later.has(u));
    close(inFirst ? 'first_try' : inLater ? 'after_retry' : 'user_supplied', { saved: saved.size > 0 });
  }
  close('no_acceptance');
  return episodes;
}

const quantile = (values, q) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : null;
};
const seconds = value => value === null ? null : Math.round(value / 100) / 10;
const mean = values => { const known = values.filter(Number.isFinite); return known.length ? Math.round(100 * known.reduce((a, b) => a + b, 0) / known.length) / 100 : null; };
const rate = (part, whole) => whole ? Math.round(1000 * part / whole) / 1000 : null;

export function summarize(turns, episodes) {
  const first = turns.map(t => t.first_message_ms), final = turns.map(t => t.final_result_ms);
  // Turns refused by the OpenAI account (out of credit, over the spend limit) are left out of failed
  // replies and of who wrote the reply, and counted on their own as billing_outages.
  const counted = turns.filter(t => !t.billing_outage);
  const composed = { model: 0, template: 0, mixed: 0, unknown: 0 };
  for (const t of counted) composed[t.composed_by]++;
  const known = composed.model + composed.template + composed.mixed;
  const accepted = episodes.filter(e => e.outcome !== 'no_acceptance');
  const count = outcome => episodes.filter(e => e.outcome === outcome).length;
  return {
    turns: turns.length,
    timed_turns: final.filter(Number.isFinite).length,
    first_timed: first.filter(Number.isFinite).length,
    first_message_s: { median: seconds(quantile(first, 0.5)), p90: seconds(quantile(first, 0.9)) },
    final_result_s: { median: seconds(quantile(final, 0.5)), p90: seconds(quantile(final, 0.9)), max: seconds(quantile(final, 1)) },
    messages_per_turn: mean(turns.map(t => t.messages)),
    messages_turns: turns.filter(t => Number.isFinite(t.messages)).length,
    search_turns: turns.filter(t => t.searched).length,
    messages_per_search_turn: mean(turns.filter(t => t.searched).map(t => t.messages)),
    single_message_share: rate(turns.filter(t => t.messages === 1).length, turns.filter(t => Number.isFinite(t.messages)).length),
    fallbacks: counted.filter(t => t.fallback).length,
    stuck: counted.filter(t => t.stuck).length,
    billing_outages: turns.length - counted.length,
    failure_turns: counted.length,
    failure_rate: rate(counted.filter(t => t.fallback || t.stuck).length, counted.length),
    complaints: counted.filter(t => t.complained).length,
    complaint_rate: rate(counted.filter(t => t.complained).length, counted.length),
    composed_by: composed,
    composed_known: known,
    model_written_share: rate(composed.model + composed.mixed / 2, known),
    named_searches: episodes.length,
    named_accepted: accepted.length,
    first_try: count('first_try'), after_retry: count('after_retry'), user_supplied: count('user_supplied'),
    first_try_rate: rate(count('first_try'), accepted.length),
  };
}

const group = (items, key) => items.reduce((map, item) => map.set(item[key], [...(map.get(item[key]) ?? []), item]), new Map());
export function chatMetrics(rows, { actions = new Map(), now = Date.now(), since = null, until = null } = {}) {
  const inWindow = at => (!since || ms(at) >= ms(since)) && (!until || ms(at) < ms(until));
  const turns = turnsFrom(rows, { actions, now }).filter(t => inWindow(t.at));
  const episodes = findEpisodes(rows).filter(e => inWindow(e.at));
  const byDay = group(turns, 'day'), episodesByDay = group(episodes, 'day');
  const byConversation = group(turns, 'conversation'), episodesByConversation = group(episodes, 'conversation');
  const keys = (a, b) => [...new Set([...a.keys(), ...b.keys()])].sort();
  return {
    since, until, generated_at: new Date(now).toISOString(),
    summary: summarize(turns, episodes),
    by_day: keys(byDay, episodesByDay).map(d => ({ day: d, ...summarize(byDay.get(d) ?? [], episodesByDay.get(d) ?? []) })),
    by_conversation: keys(byConversation, episodesByConversation).map(c => ({ conversation: c, ...summarize(byConversation.get(c) ?? [], episodesByConversation.get(c) ?? []) })),
    timing_sources: Object.fromEntries([...group(turns, 'timing_source')].map(([k, v]) => [k, v.length])),
  };
}

// Which numbers moved between two periods, and whether that is better. Each metric is judged on its
// own sample (timed replies, replies with known authorship, named searches with a pick), and small
// samples are flagged rather than judged. A value with nothing before it is "no earlier data", never
// "no data".
const DIRECTIONS = { 'first_message_s.median': -1, 'final_result_s.median': -1, 'final_result_s.p90': -1, failure_rate: -1, complaint_rate: -1, messages_per_turn: -1, model_written_share: 1, first_try_rate: 1 };
const SAMPLES = { 'first_message_s.median': 'first_timed', 'final_result_s.median': 'timed_turns', 'final_result_s.p90': 'timed_turns',
  failure_rate: 'failure_turns', complaint_rate: 'failure_turns', messages_per_turn: 'messages_turns', model_written_share: 'composed_known', first_try_rate: 'named_accepted' };
const read = (summary, path) => path.split('.').reduce((v, k) => v?.[k], summary);
export function compareMetrics(before, after, { minimum = 5 } = {}) {
  return Object.entries(DIRECTIONS).map(([metric, direction]) => {
    const a = read(before, metric) ?? null, b = read(after, metric) ?? null;
    // Summaries written before first_timed (or failure_turns) existed fall back to the older counts.
    const size = summary => summary?.[SAMPLES[metric]] ?? (metric === 'failure_rate' ? summary?.turns : summary?.timed_turns) ?? 0;
    const beforeN = a === null ? 0 : size(before), afterN = b === null ? 0 : size(after);
    const change = a === null || b === null ? null : Math.round((b - a) * 1000) / 1000;
    const verdict = b === null ? 'no data' : afterN < minimum ? 'too few to tell' : a === null ? 'no earlier data'
      : beforeN < minimum ? 'too few to tell' : change === 0 ? 'unchanged' : Math.sign(change) === direction ? 'better' : 'worse';
    return { metric, before: a, after: b, change, verdict, before_n: beforeN, after_n: afterN, direction };
  });
}

// Reads what the metrics need through two plain store reads, then computes.
export async function loadChatMetrics(store, { since, until = null, now = Date.now() } = {}) {
  // Episodes and replies can start shortly before the window; read a day of lead-in.
  const from = new Date(ms(since) - 24 * 3600 * 1000).toISOString();
  const [rows, usage] = await Promise.all([store.metricRows(from, until), store.replyActions(from, until).catch(() => [])]);
  const actions = new Map(usage.filter(u => u.action).map(u => [u.operation, u.action]));
  return chatMetrics(rows, { actions, now, since, until });
}

// Every chat turn and named-product search of the last `days`, for Admin › Scorecard › All chat turns, where the
// page compares periods and leaves out the founder's own conversation (own) itself. Figures only: no ids or text.
export async function loadChatTurns(store, { days = 56, now = Date.now(), own = new Set() } = {}) {
  const since = new Date(now - days * 24 * 3600 * 1000).toISOString(), from = new Date(ms(since) - 24 * 3600 * 1000).toISOString();
  const [rows, usage] = await Promise.all([store.metricRows(from), store.replyActions(from).catch(() => [])]);
  const actions = new Map(usage.filter(u => u.action).map(u => [u.operation, u.action]));
  const turns = turnsFrom(rows, { actions, now, own }).filter(t => ms(t.at) >= ms(since)).map(t => ({ at: t.at, own: t.own,
    first_message_ms: t.first_message_ms, final_result_ms: t.final_result_ms, messages: t.messages, fallback: t.fallback, stuck: t.stuck,
    billing_outage: t.billing_outage, complained: t.complained, composed_by: t.composed_by }));
  const episodes = findEpisodes(rows, { own }).filter(e => ms(e.at) >= ms(since)).map(e => ({ at: e.at, own: e.own, outcome: e.outcome }));
  return { since, turns, episodes };
}

// Two consecutive periods of equal length ending now (or at `until`), for "did the numbers move".
export async function metricsTrend(store, { days = 7, until = null, now = Date.now() } = {}) {
  const end = until ? ms(until) : now, span = days * 24 * 3600 * 1000;
  const iso = t => new Date(t).toISOString();
  const [previous, current] = await Promise.all([
    loadChatMetrics(store, { since: iso(end - 2 * span), until: iso(end - span), now }),
    loadChatMetrics(store, { since: iso(end - span), until: iso(end), now }),
  ]);
  return { days, previous: { since: previous.since, until: previous.until, ...previous.summary },
    current: { since: current.since, until: current.until, ...current.summary }, moved: compareMetrics(previous.summary, current.summary) };
}
