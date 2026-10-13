import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../lib/store.js';
import { triagePackets, diagnostics, redact } from '../lib/feedback-triage.js';

const report = { id: 'r1', conversation_id: 'c1', created_at: '2026-10-12T10:00:00Z', body: 'DM the search ignored my size, text me at +1 (415) 555-0100', developer_feedback: 'Search ignored my size', reply_provider_id: 'p0' };
const turns = [
  { id: 'm1', direction: 'inbound', body: 'Find suede loafers', created_at: '2026-10-12T09:58:00Z', status: 'received', source: 'tester' },
  { id: 'm2', direction: 'outbound', body: 'Here are two options', created_at: '2026-10-12T09:59:00Z', status: 'sent', source: 'ai',
    search_result: { identification_policy: 'text_wishlist', intent_action: 'start', products: [{ name: 'Loafer', url: 'https://example.invalid/p', verified: true, price: 400 }], text_wishlist_state: { stage: 'choice', options: [] }, text_wishlist_diagnostics: { failed_checks: [{ url: 'https://x.invalid', reason: 'http_403' }] } } },
  { ...report, direction: 'inbound', status: 'received', source: 'tester', message_images: [{ id: 'i1' }], image_status: 'failed' },
];

test('triage packets carry the report, nearby turns and diagnostics without sender identity', async () => {
  const store = { feedbackSince: async (since, limit) => { assert.equal(since, '2026-10-11T00:00:00Z'); assert.equal(limit, 50); return [report]; },
    feedbackContext: async (conversation, at) => { assert.equal(conversation, 'c1'); assert.equal(at, report.created_at); return turns; } };
  const result = await triagePackets(store, { since: '2026-10-11T00:00:00Z' });
  assert.equal(result.count, 1); assert.equal(result.cursor, report.created_at);
  const [packet] = result.packets;
  assert.equal(packet.report, 'Search ignored my size'); assert.equal(packet.replying_to_earlier_message, true);
  assert.doesNotMatch(JSON.stringify(result), /555-0100|sender/);
  assert.equal(packet.context[2].is_feedback_report, true); assert.equal(packet.context[2].image_status, 'failed');
  const d = packet.context[1].diagnostics;
  assert.equal(d.identification_policy, 'text_wishlist'); assert.equal(d.products_count, 1); assert.equal(d.text_wishlist_state_stage, 'choice');
  assert.equal(d.text_wishlist_diagnostics.failed_checks[0].reason, 'http_403'); assert.equal(d.products[0].price, undefined);
});

test('latest returns only the newest reports and an empty inbox keeps the cursor', async () => {
  const rows = ['a', 'b', 'c'].map((id, i) => ({ ...report, id, created_at: `2026-10-1${i}T00:00:00Z` }));
  const store = { feedbackSince: async () => rows, feedbackContext: async () => [] };
  assert.deepEqual((await triagePackets(store, { latest: 1 })).packets.map(p => p.feedback_id), ['c']);
  const empty = await triagePackets({ feedbackSince: async () => [], feedbackContext: assert.fail }, { since: 'x' });
  assert.equal(empty.count, 0); assert.equal(empty.cursor, 'x');
});

test('redaction masks contact formats and diagnostics tolerate missing results', () => {
  assert.equal(redact('mail a.b@example.com or 415-555-0100 about size 44'), 'mail [email] or [phone] about size 44');
  assert.equal(diagnostics(null), null);
});

test('triage store reads are private, cursor-ordered and exclude sender identity', async () => {
  const paths = [];
  const store = createStore({ SUPABASE_URL: 'https://example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fake' }, async url => { paths.push(url); return { ok: true, text: async () => '[]' }; });
  await store.feedbackSince('2026-10-12T00:00:00Z'); await store.feedbackContext('c1', '2026-10-12T00:00:00Z');
  assert.match(paths[0], /developer_feedback=not.is.null/); assert.match(paths[0], /created_at=gt.2026-10-12/); assert.match(paths[0], /order=created_at.asc/);
  assert.doesNotMatch(paths[0], /sender_id/);
  assert.match(paths[1], /conversation_id=eq.c1&created_at=lte/); assert.match(paths[2], /created_at=gt.*limit=4/);
});
