import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quality, photoOutcome } from '../lib/adoption-quality.js';
import { adoptionReport } from '../lib/adoption.js';
import { createStore } from '../lib/store.js';
import { REACTION_NOTE, developerReport } from '../lib/developer-feedback.js';
import { qualitySummaryCells, qualityTesterCells, qualityWeekCells, usedKinds } from '../public/adoption-view.js';

const A = '00000000-0000-4000-8000-00000000000a', B = '00000000-0000-4000-8000-00000000000b';
const now = Date.parse('2026-10-14T12:00:00Z');
const rows = {
  conversations: [{ id: A, sender_id: '+15550000001' }, { id: B, sender_id: '+15550000002' }],
  results: [
    { conversation_id: A, created_at: '2026-10-06T10:00:00Z' }, { conversation_id: A, created_at: '2026-10-12T10:00:00Z' },
    { conversation_id: A, created_at: '2026-10-13T10:00:00Z' }, { conversation_id: B, created_at: '2026-10-13T11:00:00Z' },
  ],
  misses: [
    { id: 'm1', conversation_id: A, created_at: '2026-10-12T10:05:00Z', kind: 'wrong_results', about: 'previous_reply', summary: 'Wanted wide-leg; got slim.' },
    { id: 'm2', conversation_id: A, created_at: '2026-10-13T10:05:00Z', kind: 'missed_available_item', about: 'earlier_reply', summary: 'Found the jacket elsewhere.' },
    { id: 'm3', conversation_id: B, created_at: '2026-10-07T10:05:00Z', kind: 'something_new', about: null, summary: null },
  ],
  flags: [{ id: 'f1', conversation_id: A, created_at: '2026-10-13T12:00:00Z' }, { id: 'f2', conversation_id: A, created_at: '2026-10-06T12:00:00Z' }],
  thumbs: [{ id: 'f1' }],
  photos: [
    { id: 'p1', conversation_id: A, provider_id: 'g1', created_at: '2026-10-12T09:00:00Z', image_status: 'saved', message_images: [{ id: 'i1' }] },
    { id: 'p2', conversation_id: A, provider_id: 'g2', created_at: '2026-10-12T09:30:00Z', image_status: 'saved', message_images: [{ id: 'i2' }] },
    { id: 'p3', conversation_id: A, provider_id: 'g3', created_at: '2026-10-06T09:00:00Z', image_status: 'failed', message_images: [] },
    { id: 'p4', conversation_id: B, provider_id: 'g4', created_at: '2026-10-13T09:00:00Z', image_status: 'saved', message_images: [{ id: 'i4' }] },
  ],
  photoReplies: [
    { operation_id: 'ai:g1', status: 'sent', products: [{ match: 'similar' }, { match: 'likely_match' }] },
    { operation_id: 'ai:g2', status: 'sent', products: [] },
    { operation_id: 'ai:g4', status: 'sent', products: null },
  ],
  photoSaves: [{ source_image_id: 'i1', correction: null }, { source_image_id: 'i1', correction: 'owner_verified_listing' }],
};

test('a photo outcome comes from its reply: likely match, similar, nothing found, not a search, unreadable or no reply', () => {
  assert.equal(photoOutcome({ image_status: 'saved' }, { status: 'sent', products: [{ match: 'similar' }, { match: 'likely_match' }] }), 'identified');
  assert.equal(photoOutcome({ image_status: 'saved' }, { status: 'sent', products: [{ match: 'similar' }] }), 'similar');
  assert.equal(photoOutcome({ image_status: 'saved' }, { status: 'sent', products: [{ match: 'unverified' }] }), 'none');
  assert.equal(photoOutcome({ image_status: 'saved' }, { status: 'sent', products: [] }), 'none');
  assert.equal(photoOutcome({ image_status: 'saved' }, { status: 'sent', products: null }), 'not_search', 'a reply with no product list did not search');
  assert.equal(photoOutcome({ image_status: 'failed' }, { status: 'sent', products: [{ match: 'likely_match' }] }), 'unreadable');
  assert.equal(photoOutcome({ image_status: 'saved' }, null), 'no_reply');
  assert.equal(photoOutcome({ image_status: 'saved' }, { status: 'failed', products: [] }), 'no_reply');
});

test('per-tester quality counts misses, flags with 👎 split out, and photos identified or saved', () => {
  const q = quality(rows, now);
  assert.deepEqual(q.per_tester[A], { misses: 2, flags: 2, thumbs: 1, photos: 3, photos_identified: 1, photos_saved: 1 });
  assert.deepEqual(q.per_tester[B], { misses: 1, flags: 0, thumbs: 0, photos: 1, photos_identified: 0, photos_saved: 0 });
  assert.deepEqual(q.totals, { misses: 3, results: 4, flags: 2, thumbs: 1 });
  assert.deepEqual(q.photos, { total: 4, saved: 1, corrected: 1, outcomes: { identified: 1, similar: 0, none: 1, not_search: 1, unreadable: 1, no_reply: 0 } });
});

test('weekly quality puts misses by kind beside that week’s results replies; unknown kinds count as other', () => {
  const { weeks } = quality(rows, now);
  assert.deepEqual(weeks.map(w => w.week_of), ['2026-10-12', '2026-10-05']);
  assert.equal(weeks[0].results, 3); assert.equal(weeks[0].misses, 2); assert.equal(weeks[0].flags, 1);
  assert.equal(weeks[0].by_kind.wrong_results, 1); assert.equal(weeks[0].by_kind.missed_available_item, 1);
  assert.equal(weeks[1].by_kind.other, 1);
  assert.equal(weeks[0].photos.identified, 1); assert.equal(weeks[1].photos.unreadable, 1);
});

test('nothing recorded means no weeks', () => {
  assert.deepEqual(quality({}, now).weeks, []);
});

test('the quality section reads no message text, counts 👎 by its fixed note, and finds each photo’s reply', async () => {
  assert.equal(developerReport({ content: { type: 'reaction', emoji: '👎' } }).note, REACTION_NOTE);
  const paths = [];
  const fetcher = async url => {
    const path = decodeURIComponent(new URL(url).pathname.replace('/rest/v1/', '') + new URL(url).search); paths.push(path);
    const body = path.includes('image_status=not.is.null') ? [{ id: 'p1', conversation_id: A, provider_id: 'g1', created_at: 't', image_status: 'saved', message_images: [] }]
      : path.includes('operation_id=in.') ? [{ operation_id: 'ai:g1', status: 'sent', products: [] }] : [];
    return { ok: true, text: async () => JSON.stringify(body) };
  };
  const result = await createStore({ SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'fake' }, fetcher).adoptionQualityRows();
  assert.deepEqual(result.photoReplies, [{ operation_id: 'ai:g1', status: 'sent', products: [] }]);
  assert.ok(paths.some(p => p.includes('operation_id=in.("ai:g1")')));
  assert.ok(paths.some(p => p.includes(`developer_feedback=like.${REACTION_NOTE}*`)));
  assert.ok(paths.every(p => !/select=[^&]*(body|developer_feedback)/.test(p)), 'neither message bodies nor feedback notes are selected');
});

test('if the quality reads fail, the rest of the adoption report still loads', async () => {
  const store = { adoptionRows: async () => ({ conversations: [{ id: A, sender_id: 'x', created_at: '2026-10-01T00:00:00Z' }] }), adoptionQualityRows: async () => { throw Object.assign(new Error('db'), { database_status: 500 }); } };
  const report = await adoptionReport(store, now);
  assert.equal(report.quality, null); assert.equal(report.summary.testers, 1);
  const ok = await adoptionReport({ ...store, adoptionQualityRows: async () => ({}) }, now);
  assert.equal(ok.quality.totals.misses, 0);
});

test('quality cells read plainly', () => {
  const q = quality(rows, now);
  const summary = qualitySummaryCells(q);
  assert.equal(summary[0].note, 'against 4 replies with results');
  assert.equal(summary[1].note, '1 by 👎, the rest by #dev');
  assert.deepEqual([summary[2].value, summary[2].note], ['1 of 2', '50% of photo searches'], 'unreadable and non-search photos are left out');
  assert.deepEqual(qualityTesterCells({ results: 3 }, q.per_tester[A]), { results: '3', misses: '2', miss_rate: '67%', flags: '2 (1 👎)', photos: '3', identified: '1', saved: '1' });
  assert.equal(qualityTesterCells({ results: 0 }, { misses: 0, flags: 0, thumbs: 0, photos: 0 }).identified, '—');
  const kinds = usedKinds(q);
  assert.deepEqual(kinds.map(k => k.key), ['wrong_results', 'missed_available_item', 'other']);
  const week = qualityWeekCells(q.weeks[0], kinds, q.photo_outcomes);
  assert.equal(week.misses, '2 · 67%'); assert.equal(week.photos, '1 identified · 1 nothing found · 1 not a search');
});
