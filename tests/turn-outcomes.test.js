import test from 'node:test';
import assert from 'node:assert/strict';
import { turnOutcomes, outcomeSummary, labelsFor, isSourcing } from '../lib/turn-outcomes.js';
import { actionRecord, turnActions } from '../lib/turn-actions.js';
import { reactionKind, recordReaction } from '../lib/adoption-events.js';

// A conversation built from turns. Each user turn is an inbound row and Jules's reply row whose
// reply_diagnostics carry the agent's recorded actions. The message text is deliberately the same
// meaningless string everywhere: labels must come from the structured actions, never from wording.
const C = 'conv-1', T0 = Date.parse('2026-10-19T12:00:00Z'), NOW = T0 + 3 * 86400000;
const at = minutes => new Date(T0 + minutes * 60000).toISOString();
const verified = n => Array.from({ length: n }, (_, i) => ({ url: `https://store.example/p${i}`, listing_check: { status: 'verified' } }));
const search = (extra = {}) => ({ tool: 'find_products', status: 'done', continuation: 'new_request', ...extra });
function chat(turns) {
  const messages = [];
  turns.forEach((t, i) => {
    const id = t.id ?? `in${i}`, minute = t.minute ?? i * 10;
    messages.push({ conversation_id: C, direction: 'inbound', provider_id: id, created_at: at(minute), body: 'same words every time',
      reply_provider_id: t.replyTo ?? null, quality_signal: t.signal ?? null, developer_feedback: t.flag ?? null, image_status: t.photo ? 'ready' : null });
    if (t.flag) return;
    messages.push({ conversation_id: C, direction: 'outbound', operation_id: `ai:${id}`, provider_id: `out-${id}`, status: t.status ?? 'sent', source: t.source ?? 'ai',
      created_at: at(minute + 1), sent_at: t.status && t.status !== 'sent' ? null : at(minute + 1), body: 'same words every time',
      search_result: t.products ? { products: t.products, timing_diagnostics: { first_message_ms: 2000, result_ms: 40000 } } : null,
      reply_diagnostics: { outcome: t.outcome ?? 'sent', ...turnActions(t.actions ?? [], t.outcome_flags ?? {}, 'conversation_reply') } });
  });
  return messages;
}
const outcomes = (turns, extra = {}) => turnOutcomes({ messages: chat(turns), ...extra }, { now: NOW });

test('only replies that searched or asked a shopping question are sourcing turns', () => {
  const result = outcomes([{ actions: [search()], products: verified(2) }, { actions: [{ tool: 'conversation_reply', status: 'done' }] }, { actions: [{ tool: 'ask_shopping_question', status: 'done' }] }]);
  assert.deepEqual(result.map(t => t.result), ['verified', 'question']);
  // Older rows, before actions were recorded, use the stored intent or the tool the turn chose. An empty
  // product list alone is not a search: saves, alerts and reactions store one too.
  assert.equal(isSourcing({ search_result: { products: [] } }), false);
  assert.equal(isSourcing({ search_result: { products: [], intent_action: 'start', intent_decision: 'interest' } }), true);
  assert.equal(isSourcing({ operation_id: 'ai:x', search_result: { products: [] } }, new Map([['ai:x', 'find_products']])), true);
  assert.equal(isSourcing({ search_result: { products: [], intent_action: 'selection', intent_decision: 'confirm', user_confirmed: true } }), false);
});

test('picking a subset, then saving it, labels the results as picked and saved', () => {
  const [turn] = outcomes([
    { actions: [search()], products: verified(3) },
    { actions: [{ tool: 'respond_to_options', status: 'done', decision: 'interest', option_indices: [0, 2] }] },
    { actions: [{ tool: 'save_to_wishlist', status: 'done', option_indices: [0, 2] }], outcome_flags: { saved_now: true } },
  ]);
  assert.deepEqual(turn.labels, ['saved', 'picked']);
  assert.equal(turn.headline, 'positive');
});

test('saving all with alerts labels saved and alert on', () => {
  const [turn] = outcomes([{ actions: [search()], products: verified(2) },
    { actions: [{ tool: 'manage_price_alerts', status: 'done', operation: 'create', option_indices: [0, 1] }], outcome_flags: { saved_now: true, alerts_turned_on: true } }]);
  assert.deepEqual(turn.labels, ['saved', 'alert_on']);
});

test('rejecting every option is negative; a save the consent check blocked is not a save', () => {
  const [none] = outcomes([{ actions: [search()], products: verified(2) }, { actions: [{ tool: 'respond_to_options', status: 'done', decision: 'decline' }] }]);
  assert.deepEqual(none.labels, ['rejected']); assert.equal(none.headline, 'negative');
  const [blocked] = outcomes([{ actions: [search()], products: verified(2) }, { actions: [{ tool: 'save_to_wishlist', status: 'blocked', option_indices: [0] }], outcome_flags: { saved_now: false } }]);
  assert.deepEqual(blocked.labels, ['replied']); assert.equal(blocked.headline, 'neutral');
});

test('an ambiguous pick that Jules asked about is clarified, not a pick', () => {
  const [turn] = outcomes([{ actions: [search()], products: verified(2) }, { actions: [{ tool: 'respond_to_options', status: 'done', decision: 'clarify' }] }]);
  assert.deepEqual(turn.labels, ['clarified']); assert.equal(turn.headline, 'neutral');
});

test('a correction that searches the same request again is refined; kept and ruled-out options count too', () => {
  const result = outcomes([{ actions: [search()], products: verified(3) },
    { actions: [search({ continuation: 'same_request', keep_option_indices: [1], exclude_option_indices: [0, 2] })], products: verified(2) },
    { actions: [{ tool: 'save_to_wishlist', status: 'done' }], outcome_flags: { saved_now: true } }]);
  assert.deepEqual(result[0].labels, ['picked', 'rejected', 'refined']);
  assert.equal(result[0].headline, 'positive');
  // The save after the second search belongs to the second set of results, not the first.
  assert.deepEqual(result[1].labels, ['saved']);
});

test('a quality signal on the next message marks the results missed', () => {
  const [turn] = outcomes([{ actions: [search()], products: verified(2) }, { actions: [search({ continuation: 'same_request' })], products: verified(1), signal: { kind: 'wrong_results', about: 'previous_reply' } }]);
  assert.deepEqual(turn.labels, ['missed', 'refined']); assert.equal(turn.headline, 'negative');
});

test('a topic change is moved on and closes the window; a later unrelated message does not attach', () => {
  const result = outcomes([{ actions: [search()], products: verified(2) },
    { actions: [search({ continuation: 'new_request' })], products: verified(1) },
    { actions: [{ tool: 'respond_to_options', status: 'done', decision: 'decline' }] }]);
  assert.deepEqual(result[0].labels, ['moved_on']);
  assert.deepEqual(result[1].labels, ['rejected']);
});

test('a threaded reply to older results applies to those results, not the newest ones', () => {
  const result = outcomes([{ id: 'a', actions: [search()], products: verified(2) },
    { id: 'b', actions: [search()], products: verified(2) },
    { id: 'c', replyTo: 'out-a', actions: [{ tool: 'save_to_wishlist', status: 'done' }], outcome_flags: { saved_now: true } }]);
  assert.deepEqual(result[0].labels, ['saved', 'moved_on']); assert.equal(result[0].threaded, true);
  assert.deepEqual(result[1].labels, ['silent']);
});

test('a message sent while a search is still running belongs to the earlier results', () => {
  // in1 starts a search at minute 10 whose result is sent at minute 11; in2 arrives at minute 10.5,
  // before those results, and picks from the first set.
  const result = outcomes([{ actions: [search()], products: verified(2) },
    { id: 'in1', minute: 10, actions: [search({ continuation: 'same_request' })], products: verified(2) },
    { id: 'in2', minute: 10.5, actions: [{ tool: 'respond_to_options', status: 'done', decision: 'interest', option_indices: [1] }] }]);
  // in1 refined the first results; in2 came before the new results, so it is still about the first set.
  assert.deepEqual(result[0].labels, ['picked', 'refined']);
  assert.deepEqual(result[1].labels, ['silent']);
});

test('tapbacks, link taps and 👎 flags label the turn they point at', () => {
  const messages = chat([{ id: 'a', actions: [search()], products: verified(2) }, { id: 'b', actions: [search()], products: verified(2) }, { id: 'f', replyTo: 'out-b', flag: { note: 'flag' } }]);
  const events = [{ conversation_id: C, kind: 'reaction', ref: 'ai:a', detail: 'love' }, { conversation_id: C, kind: 'link_click', ref: 'ai:a' }, { conversation_id: C, kind: 'reaction', ref: 'ai:b', detail: 'question' }];
  const [a, b] = turnOutcomes({ messages, events }, { now: NOW });
  assert.deepEqual(a.labels, ['clicked', 'reacted', 'moved_on']); assert.equal(a.headline, 'positive');
  assert.deepEqual(b.labels, ['flagged', 'confused']); assert.equal(b.headline, 'negative');
});

test('no reply within a day is silent; within a day it is still waiting', () => {
  const messages = chat([{ actions: [search()], products: verified(1) }]);
  assert.deepEqual(turnOutcomes({ messages }, { now: NOW })[0].labels, ['silent']);
  assert.deepEqual(turnOutcomes({ messages }, { now: T0 + 3600000 })[0].labels, ['waiting']);
});

test('request type, results, timing and cost come from the stored rows', () => {
  const messages = chat([{ id: 'p', photo: true, actions: [search({ use_image: true })], products: [{ sourcing_status: 'store_not_found' }] },
    { id: 'x', actions: [search()], status: 'sent', source: 'ai_fallback', outcome: 'fallback' }]);
  messages[1].search_result.text_wishlist_diagnostics = { supplied_links: [] };
  const usage = [{ operation: 'ai:p', cost_usd: 0.012 }, { operation: 'ack:p', cost_usd: 0.001 }, { operation: 'ai:x', cost_usd: 0.004 }];
  const [photo, failed] = turnOutcomes({ messages, usage }, { now: NOW });
  assert.equal(photo.request_type, 'photo'); assert.equal(photo.result, 'unverified_only'); assert.equal(photo.verified_shown, 0);
  assert.equal(photo.cost_usd, 0.013); assert.equal(photo.first_message_ms, 2000); assert.equal(photo.result_ms, 40000);
  assert.equal(failed.result, 'failed');
});

test('older follow-ups use the stored intent; with nothing stored they are not recorded, and left out of engagement', () => {
  const messages = chat([{ actions: [search()], products: verified(2) }, { actions: [search()], products: verified(2) }, { actions: [search()], products: verified(1) }, {}]);
  const replies = messages.filter(m => m.direction === 'outbound');
  delete replies[1].reply_diagnostics.actions; replies[1].search_result = { products: [], intent_action: 'selection', intent_decision: 'confirm', user_confirmed: true };
  delete replies[3].reply_diagnostics.actions; replies[3].search_result = null;
  const turns = turnOutcomes({ messages }, { now: NOW });
  assert.deepEqual(turns.map(t => t.labels), [['saved', 'moved_on'], ['not_recorded']]);
  assert.equal(outcomeSummary(turns).positive_sample, 1);
});

test('without a recorded send time, the placeholder row time is never used as the result time', () => {
  const messages = chat([{ actions: [search()], products: verified(1) }]);
  const reply = messages[1]; reply.sent_at = null; reply.search_result.timing_diagnostics = null; reply.created_at = messages[0].created_at;
  assert.equal(turnOutcomes({ messages }, { now: NOW })[0].result_ms, null);
});

test('a search followed by a pick in the same turn still counts the options it showed', () => {
  const messages = chat([{ actions: [search(), { tool: 'respond_to_options', status: 'done', decision: 'interest', option_indices: [0] }] }]);
  messages[1].search_result = { products: [], text_wishlist_state: { stage: 'offer_set', options: verified(2), selected_set: verified(1) } };
  const [turn] = turnOutcomes({ messages }, { now: NOW });
  assert.equal(turn.result, 'verified'); assert.equal(turn.products_shown, 2); assert.equal(turn.verified_shown, 2);
});

test('the summary reports rates on their own samples', () => {
  const turns = outcomes([{ actions: [search()], products: verified(2) }, { actions: [{ tool: 'save_to_wishlist', status: 'done' }], outcome_flags: { saved_now: true } },
    { actions: [search()], products: [] }, { actions: [search()], products: verified(1) }]);
  const s = outcomeSummary(turns);
  assert.equal(s.turns, 3); assert.equal(s.verified_rate, 0.667); assert.equal(s.failed_rate, 0.333);
  assert.equal(s.positive_sample, 2); assert.equal(s.positive_rate, 0.5); assert.equal(s.labels.saved, 1);
});

test('recorded actions keep only structured fields, never text or links', () => {
  const record = actionRecord({ name: 'find_products', args: { query: 'private words', acknowledgment: 'looking now', use_image: false,
    search_plan: { continuation: 'same_request', mode: 'discover', keep_option_indices: [1, 'x'], named_model: 'secret', exclude_option_indices: [] } } }, { status: 'done', result: 'text' });
  assert.deepEqual(record, { tool: 'find_products', status: 'done', continuation: 'same_request', mode: 'discover', keep_option_indices: [1] });
  assert.deepEqual(actionRecord({ name: 'respond_to_options', args: { decision: 'made-up', option_indices: [0], response: 'q' } }, { status: 'weird' }), { tool: 'respond_to_options', status: 'unknown', option_indices: [0] });
  assert.equal(labelsFor({ reply_diagnostics: turnActions([], {}) }).has('replied'), true);
});

test('tapbacks are stored as fixed kinds against the reacting person’s own reply', async () => {
  assert.equal(reactionKind('❤'), 'love'); assert.equal(reactionKind('👍🏽'), 'like'); assert.equal(reactionKind('🎉'), 'other');
  const rows = [], lookups = [];
  const store = { reactionTarget: async (id, sender) => { lookups.push([id, sender]); return id === 'out-1' ? { conversation_id: C, operation_id: 'ai:in1' } : null; }, recordAdoptionEvent: async row => rows.push(row) };
  await recordReaction(store, { message: { sender: { id: '+1555' }, content: { emoji: '‼️' } }, target: 'out-1' });
  await recordReaction(store, { message: { sender: { id: '+1555' }, content: { emoji: '❤️' } }, target: 'someone-else' });
  assert.deepEqual(lookups, [['out-1', '+1555'], ['someone-else', '+1555']]);
  assert.deepEqual(rows, [{ quantity: 1, conversation_id: C, kind: 'reaction', ref: 'ai:in1', detail: 'emphasize' }]);
  // A missing table (db/034 not run) never throws.
  await recordReaction({ reactionTarget: async () => ({ conversation_id: C, operation_id: 'ai:in1' }), recordAdoptionEvent: async () => { throw Object.assign(new Error('x'), { database_status: 400 }); } },
    { message: { sender: { id: '+1555' }, content: { emoji: '👍' } }, target: 'out-1' });
});
