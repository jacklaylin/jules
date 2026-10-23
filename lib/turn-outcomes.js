// Per sourcing turn outcomes (RECOMMENDATION-SCORECARD.md, PR 2): for every reply that searched for products
// or asked a shopping question, what was shown, how fast, what it cost, and what the user did next.
// Pure (rows in, records out), like lib/chat-metrics.js. What the user did next comes only from structured
// data: the tools the agent chose for their later messages and the interpretation in those tools' arguments
// (reply_diagnostics.actions, lib/turn-actions.js), what code actually saved or turned on, tapback kinds,
// tracked link taps and 👎 flags. Message text is never read.
//
// Which turn a later message belongs to: a threaded reply or tapback attaches to the turn it points at;
// otherwise a message belongs to the newest sourcing turn whose results were sent before it. A turn's
// window closes once a message searched again and those new results were sent (that message's labels still
// count for the turn it continued; a message sent while the new search ran is still about the older results).
import { BILLING_CODES } from './model-call.js';

const DAY = 86400000;
const SILENT_AFTER_MS = DAY;
const SEARCH_TOOLS = new Set(['find_products', 'ask_shopping_question']);
export const POSITIVE = new Set(['saved', 'alert_on', 'picked', 'purchase_intent', 'clicked', 'reacted']);
export const NEGATIVE = new Set(['rejected', 'missed', 'flagged', 'confused']);
export const LABELS = [
  { key: 'saved', explain: 'Saved one or more options to their wishlist.' },
  { key: 'alert_on', explain: 'Turned on a price alert for an option.' },
  { key: 'picked', explain: 'Picked or liked specific options, or kept some while asking for more.' },
  { key: 'purchase_intent', explain: 'Asked to buy an option.' },
  { key: 'clicked', explain: 'Tapped a product link (only when link tracking is on).' },
  { key: 'reacted', explain: 'Tapped ❤️ 👍 😂 or ‼️ on the results.' },
  { key: 'rejected', explain: 'Turned down the options, or ruled some out while asking for more.' },
  { key: 'missed', explain: 'Their next message showed the results missed what they asked for (a quality signal).' },
  { key: 'flagged', explain: 'Flagged the results with 👎 or #dev.' },
  { key: 'confused', explain: 'Tapped ❓ on the results.' },
  { key: 'refined', explain: 'Searched again on the same request (more, other or narrower results).' },
  { key: 'clarified', explain: 'Their answer could mean more than one option, so Jules asked which.' },
  { key: 'replied', explain: 'Replied about something else while the options were pending.' },
  { key: 'moved_on', explain: 'Started a new request.' },
  { key: 'not_recorded', explain: 'They replied, but before Jules recorded what it did with replies (older turns).' },
  { key: 'silent', explain: 'No reply, tap or click within a day.' },
  { key: 'waiting', explain: 'Less than a day since the results; nothing yet.' },
];

const ms = at => at ? Date.parse(at) : NaN;
const kindOf = operation => String(operation ?? '').split(':')[0];
const inboundIdOf = operation => String(operation ?? '').slice(String(operation ?? '').indexOf(':') + 1);
const done = (actions, tool) => (actions ?? []).filter(a => a.tool === tool && a.status === 'done');

// A product shown as a checked product page: the page check verified it (text search) or the store page was found (photo search).
export const verifiedProduct = p => p?.listing_check?.status === 'verified' || p?.sourcing_status === 'store_found';

// Replies sent before actions were recorded: the same kind of model-interpreted data from older fields,
// the tool the turn chose (usage_events.action) and the stored intent (search_result.intent_action and
// intent_decision), and whether code confirmed a save (user_confirmed). null when none was recorded.
export function legacyActions(reply, tool) {
  const r = reply?.search_result ?? {}, actions = [];
  if (SEARCH_TOOLS.has(tool) || ['start', 'clarify_search'].includes(r.intent_action) || r.text_wishlist_diagnostics || Array.isArray(r.sources))
    actions.push({ tool: tool === 'ask_shopping_question' || r.intent_action === 'clarify_search' ? 'ask_shopping_question' : 'find_products', status: 'done' });
  else if (r.intent_action === 'selection' && ['interest', 'decline', 'clarify'].includes(r.intent_decision)) actions.push({ tool: 'respond_to_options', status: 'done', decision: r.intent_decision });
  else if (tool === 'prepare_checkout') actions.push({ tool, status: 'done' });
  else if (tool) actions.push({ tool, status: 'done' });
  if (!actions.length && r.user_confirmed !== true) return null;
  return { actions, saved_now: r.user_confirmed === true, legacy: true };
}
const recorded = (reply, tools) => Array.isArray(reply?.reply_diagnostics?.actions) ? reply.reply_diagnostics : legacyActions(reply, tools?.get(reply?.operation_id));

// Whether a sent reply was a sourcing turn: its recorded (or older) actions ran a search or shopping question.
export function isSourcing(reply, tools) {
  return (recorded(reply, tools)?.actions ?? []).some(a => SEARCH_TOOLS.has(a.tool) && a.status === 'done');
}

// What one later message did to a turn's results, from its reply's recorded actions.
export function labelsFor(reply, inbound = {}, tools) {
  const diag = recorded(reply, tools), labels = new Set();
  if (!diag) { labels.add(inbound.quality_signal?.kind ? 'missed' : 'not_recorded'); return labels; }
  const actions = diag.actions ?? [];
  if (diag.saved_now || done(actions, 'save_to_wishlist').length && diag.saved_now !== false) labels.add('saved');
  if (diag.alerts_turned_on) labels.add('alert_on');
  for (const a of done(actions, 'respond_to_options')) labels.add({ interest: 'picked', decline: 'rejected', clarify: 'clarified' }[a.decision] ?? 'replied');
  if (done(actions, 'prepare_checkout').length) labels.add('purchase_intent');
  for (const a of actions.filter(a => SEARCH_TOOLS.has(a.tool) && a.status === 'done')) {
    if (a.continuation === 'new_request') { labels.add('moved_on'); continue; }
    labels.add('refined');
    if (a.keep_option_indices?.length) labels.add('picked');
    if (a.exclude_option_indices?.length) labels.add('rejected');
  }
  if (inbound.quality_signal?.kind) labels.add('missed');
  if (!labels.size) labels.add('replied');
  return labels;
}
const searchedAgain = (reply, tools) => isSourcing(reply, tools);

export function headline(labels) {
  if ([...labels].some(l => POSITIVE.has(l))) return 'positive';
  if ([...labels].some(l => NEGATIVE.has(l))) return 'negative';
  if (labels.has('silent')) return 'silent';
  if (labels.has('waiting')) return 'waiting';
  return 'neutral';
}

// How the request came in: a photo, a link the user supplied, or text.
function requestType(inbound, reply) {
  if (inbound?.image_status || (reply?.reply_diagnostics?.actions ?? []).some(a => a.use_image) || Array.isArray(reply?.search_result?.sources)) return 'photo';
  if (reply?.search_result?.text_wishlist_diagnostics?.supplied_links?.length) return 'link';
  return 'text';
}

// What the results were: verified pages, unverified listings only, nothing, a shopping question, or a failure.
function resultOf(inbound, reply, products, tools) {
  const outcome = reply?.reply_diagnostics?.outcome;
  // The OpenAI account refused the turn (out of credit, over the spend limit): an account outage, not a search
  // result, counted apart as lib/chat-metrics.js does (founder decision, October 22).
  if (BILLING_CODES.has(reply?.reply_diagnostics?.model_error_code)) return 'outage';
  if (inbound?.image_status === 'failed') return 'unreadable';
  if (reply.status !== 'sent' || reply.source === 'ai_fallback' || reply.source === 'ai_recovery' || ['fallback', 'stalled', 'uncertain'].includes(outcome)) return 'failed';
  if (products.some(verifiedProduct)) return 'verified';
  if (products.length) return 'unverified_only';
  const asked = (recorded(reply, tools)?.actions ?? []).some(a => a.tool === 'ask_shopping_question' && a.status === 'done');
  return asked ? 'question' : 'nothing_found';
}

// When a reply was sent. sent_at (db/027) is exact. Without it, an `ai:` row's created_at is the placeholder
// claimed when the message arrived, so it counts only when the row was re-dated at send time (as in lib/chat-metrics.js).
function sentTime(row, inboundAt) {
  if (row.status !== 'sent') return NaN;
  if (row.sent_at) return ms(row.sent_at);
  if (kindOf(row.operation_id) !== 'ai' || ms(row.created_at) - inboundAt > 1000) return ms(row.created_at);
  return NaN;
}

export function turnOutcomes({ messages = [], usage = [], events = [] }, { now = Date.now() } = {}) {
  const rows = [...messages].sort((a, b) => ms(a.created_at) - ms(b.created_at));
  const inbound = rows.filter(m => m.direction === 'inbound' && m.provider_id && !m.provider_id.startsWith('identification-test:'));
  const byInbound = new Map(inbound.map(m => [`${m.conversation_id}|${m.provider_id}`, m]));
  const replies = rows.filter(m => m.direction === 'outbound' && m.operation_id?.includes(':'));
  const mainReply = new Map(replies.filter(r => kindOf(r.operation_id) === 'ai').map(r => [`${r.conversation_id}|${inboundIdOf(r.operation_id)}`, r]));
  const cost = new Map(), tools = new Map();
  for (const u of usage) {
    const key = inboundIdOf(u.operation); cost.set(key, (cost.get(key) ?? 0) + Number(u.cost_usd ?? 0));
    if (u.action && !tools.has(u.operation)) tools.set(u.operation, u.action);
  }

  // Sourcing turns, each with every sent message that belongs to it (result, acknowledgment, follow-up).
  const turns = [];
  for (const reply of replies.filter(r => kindOf(r.operation_id) === 'ai' && isSourcing(r, tools))) {
    const id = inboundIdOf(reply.operation_id), asked = byInbound.get(`${reply.conversation_id}|${id}`);
    if (!asked || reply.status === 'blocked') continue;
    const own = replies.filter(r => r.conversation_id === reply.conversation_id && inboundIdOf(r.operation_id) === id);
    // A pick recorded later in the same turn (respond_to_options after the search) stores its own result with an
    // empty product list; the options the search showed stay in the pending state it carries.
    const stored = Array.isArray(reply.search_result?.products) ? reply.search_result.products : [];
    const products = stored.length ? stored : reply.search_result?.text_wishlist_state?.options ?? [];
    const shownEvent = events.find(e => e.kind === 'results_shown' && e.ref === reply.operation_id);
    const timing = reply.search_result?.timing_diagnostics, t0 = ms(asked.created_at);
    const sentAt = sentTime(reply, t0);
    const firstSent = Math.min(...own.map(r => sentTime(r, t0)).filter(Number.isFinite));
    turns.push({
      operation: reply.operation_id, conversation_id: reply.conversation_id, at: asked.created_at, results_at: Number.isFinite(sentAt) ? new Date(sentAt).toISOString() : null,
      request_type: requestType(asked, reply), result: resultOf(asked, reply, products, tools),
      // A search that continues an earlier request (more, other or narrower results) is not a new request.
      new_request: (recorded(reply, tools)?.actions ?? []).find(a => SEARCH_TOOLS.has(a.tool) && a.status === 'done')?.continuation !== 'same_request',
      products_shown: shownEvent?.quantity ?? products.length, verified_shown: products.filter(verifiedProduct).length,
      first_message_ms: Number.isFinite(timing?.first_message_ms) ? timing.first_message_ms : Number.isFinite(firstSent) ? Math.max(0, firstSent - t0) : null,
      // When the results reached the tester: the answer's text (timing.text_ms, recorded since October 22), not
      // the product cards and photos that follow it; older turns fall back to when everything was sent.
      result_ms: Number.isFinite(timing?.text_ms) ? timing.text_ms : Number.isFinite(timing?.result_ms) ? timing.result_ms : Number.isFinite(sentAt) ? Math.max(0, sentAt - t0) : null,
      cost_usd: Number((cost.get(id) ?? 0).toFixed(6)),
      labels: new Set(), threaded: false,
      outbound_ids: new Set(own.map(r => r.provider_id).filter(Boolean)), operations: new Set(own.map(r => r.operation_id)),
    });
  }
  const byOutbound = new Map(turns.flatMap(t => [...t.outbound_ids].map(id => [`${t.conversation_id}|${id}`, t])));
  const byOperation = new Map(turns.flatMap(t => [...t.operations].map(op => [`${t.conversation_id}|${op}`, t])));
  const closedAt = new Map();

  for (const message of inbound) {
    const at = ms(message.created_at), key = `${message.conversation_id}|${message.reply_provider_id}`;
    const pointed = message.reply_provider_id ? byOutbound.get(key) : null;
    // A 👎 tapback or #dev note is a flag on the reply it points at; it never reaches the agent.
    if (message.developer_feedback) { if (pointed) pointed.labels.add('flagged'); continue; }
    const reply = mainReply.get(`${message.conversation_id}|${message.provider_id}`);
    if (!reply) continue;
    // Threaded to a sourcing turn's message: that turn. Otherwise the newest turn with results already sent.
    const target = pointed ?? turns.filter(t => t.conversation_id === message.conversation_id && Number.isFinite(ms(t.results_at)) && ms(t.results_at) < at && t.operation !== reply.operation_id).at(-1);
    if (!target || target.operation === reply.operation_id || (!pointed && at >= (closedAt.get(target.operation) ?? Infinity))) continue;
    if (pointed) target.threaded = true;
    for (const label of labelsFor(reply, message, tools)) target.labels.add(label);
    if (searchedAgain(reply, tools) && !closedAt.has(target.operation)) closedAt.set(target.operation, ms(reply.sent_at ?? reply.created_at) || at);
  }
  for (const e of events) {
    const turn = turns.find(t => t.conversation_id === e.conversation_id && t.operations.has(e.ref)) ?? byOperation.get(`${e.conversation_id}|${e.ref}`);
    if (!turn) continue;
    if (e.kind === 'link_click') turn.labels.add('clicked');
    if (e.kind === 'reaction') turn.labels.add(e.detail === 'question' ? 'confused' : e.detail === 'other' ? 'replied' : 'reacted');
  }
  return turns.map(({ labels, outbound_ids, operations, ...turn }) => {
    if (!labels.size) labels.add(turn.results_at && now - ms(turn.results_at) < SILENT_AFTER_MS ? 'waiting' : 'silent');
    const list = LABELS.map(l => l.key).filter(k => labels.has(k));
    return { ...turn, labels: list, headline: headline(labels) };
  });
}

// Counts for a period: how many turns, how many showed a verified page, positive engagement among turns
// that showed products, failures, and latency and cost per turn.
const quantile = (values, q) => { const s = values.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : null; };
export function outcomeSummary(all) {
  // Turns the OpenAI account refused say nothing about search quality: counted on their own, left out of the rest.
  const turns = all.filter(t => t.result !== 'outage');
  // Engagement is judged on turns that showed products and whose follow-up is known.
  const showed = turns.filter(t => t.products_shown > 0), settled = showed.filter(t => t.headline !== 'waiting' && !(t.labels.length === 1 && t.labels[0] === 'not_recorded'));
  const rate = (n, d) => d ? Number((n / d).toFixed(3)) : null;
  return {
    turns: turns.length, outages: all.length - turns.length,
    by_type: Object.fromEntries(['text', 'photo', 'link'].map(k => [k, turns.filter(t => t.request_type === k).length])),
    verified_rate: rate(turns.filter(t => t.result === 'verified').length, turns.filter(t => t.result !== 'question').length),
    positive_rate: rate(settled.filter(t => t.headline === 'positive').length, settled.length), positive_sample: settled.length,
    negative_rate: rate(settled.filter(t => t.headline === 'negative').length, settled.length),
    failed_rate: rate(turns.filter(t => ['failed', 'unreadable', 'nothing_found'].includes(t.result)).length, turns.length),
    first_message_ms: { p50: quantile(turns.map(t => t.first_message_ms), 0.5), p90: quantile(turns.map(t => t.first_message_ms), 0.9) },
    result_ms: { p50: quantile(turns.map(t => t.result_ms), 0.5), p90: quantile(turns.map(t => t.result_ms), 0.9) },
    cost_per_turn_usd: turns.length ? Number((turns.reduce((s, t) => s + t.cost_usd, 0) / turns.length).toFixed(4)) : null,
    labels: Object.fromEntries(LABELS.map(l => [l.key, turns.filter(t => t.labels.includes(l.key)).length])),
  };
}

// Reads the period's rows and labels them. A turn's follow-ups are read up to now, so the last day's turns may still be waiting.
export async function loadTurnOutcomes(store, { days = 7, now = Date.now() } = {}) {
  const since = new Date(now - days * DAY).toISOString();
  const turns = turnOutcomes(await store.outcomeRows(since), { now });
  return { since, summary: outcomeSummary(turns), label_meanings: LABELS, turns };
}
