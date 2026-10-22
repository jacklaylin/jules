import test from 'node:test';
import assert from 'node:assert/strict';
import { reportAdoption, windows, stripCells, methods, cards, weeks, reportAdoptionData, TRACKED_FROM } from '../lib/report-adoption.js';
import { referralRef } from '../lib/referral.js';

const NOW = Date.parse('2026-11-25T12:00:00Z'); // a Wednesday, five weeks after tracking started
const at = days => new Date(NOW - days * 86400e3).toISOString();
const A = 'conv-a', B = 'conv-b', C = 'conv-c';
const ev = (conversation_id, kind, days, detail = null, ref = 'r') => ({ conversation_id, kind, created_at: at(days), detail, ref });
const vote = (report_id, card, v, days, reason = null) => ({ report_id, card, vote: v, at: at(days), reason });

function sample() {
  const reports = [
    { conversation_id: A, id: 'ra', first_built_at: at(1), built_at: at(1), feedback: [vote('ra', 'receipt', 'down', 2), vote('ra', 'receipt', 'up', 1), vote('ra', 'gatekeeper', 'down', 1, 'not_funny')] },
    { conversation_id: B, id: 'rb', first_built_at: at(40), built_at: at(3), feedback: [vote('rb', 'receipt', 'up', 3)] },
    { conversation_id: C, id: 'rc', first_built_at: at(10), built_at: at(10), feedback: [] },
  ];
  const events = [
    ev(A, 'report_viewed', 1), ev(A, 'report_viewed', 0.5), ev(B, 'report_viewed', 2), ev(C, 'report_viewed', 5),
    ev(A, 'report_shared', 1, 'copy'), ev(A, 'report_shared', 1, 'story'), ev(B, 'report_shared', 2, 'copy'),
    ev(A, 'report_share_opened', 1, 'copy'), ev(A, 'report_share_opened', 1, 'copy'), ev(B, 'report_share_opened', 1), ev(A, 'report_share_opened', 1, 'story'),
    ev(A, 'report_card_viewed', 1, 'receipt'), ev(B, 'report_card_viewed', 1, 'receipt'), ev(A, 'report_card_viewed', 1, 'gatekeeper'),
    ev(A, 'report_card_shared', 1, 'receipt'),
  ];
  const signups = [{ phone: '+1', at: at(1), medium: 'copy' }, { phone: '+1', at: at(1), medium: 'copy' }, { phone: '+2', at: at(1), medium: null }];
  return { reports, events, signups };
}

test('the strip counts unique testers, shares, friends and signups, with the change against the earlier window', () => {
  const w = windows(NOW).week, cells = Object.fromEntries(stripCells(sample(), w).map(c => [c.key, c]));
  assert.equal(cells.built.value, '1'); assert.equal(cells.built.detail, '3 testers with a report');
  assert.equal(cells.opened.value, '2 testers'); assert.match(cells.opened.detail, /^unique · 67% of testers with a report · 3 visits$/);
  assert.equal(cells.shared.value, '2 testers'); assert.match(cells.shared.detail, /100% of openers · 3 shares/);
  assert.equal(cells.friends.value, '4 friends'); assert.match(cells.friends.detail, /1\.3 per share/);
  assert.equal(cells.signups.value, '2 people', 'each phone once');
  assert.equal(cells.votes.value, '50%'); assert.equal(cells.votes.detail, '1 up · 1 down', 'the latest vote per card per report, cast this week');
  assert.deepEqual([cells.opened.change, cells.opened.tone, cells.opened.was], ['↑ 100%', 'ok', 'was 1'], 'C opened last week');
});

test('a window that starts before tracking says New and "not tracked", never 0', () => {
  const early = Date.parse('2026-10-28T12:00:00Z'), cells = Object.fromEntries(stripCells({ reports: [], events: [], signups: [] }, windows(early).month).map(c => [c.key, c]));
  assert.deepEqual([cells.opened.change, cells.opened.was], ['New', 'not tracked before Oct 22']);
  assert.equal(cells.votes.value, '—'); assert.equal(cells.votes.change, null);
  assert.ok(windows(early).month.previous[0] < TRACKED_FROM.opens);
});

test('methods split shares, testers, friends and signups by how the link was shared', () => {
  const m = methods(sample(), windows(NOW).week.current), by = Object.fromEntries(m.rows.map(r => [r.channel, r]));
  assert.equal(m.total, 3); assert.equal(m.testers, 2);
  assert.deepEqual([by.copy.shares, by.copy.testers, by.copy.friends, by.copy.per_share, by.copy.signups], [2, 2, 2, 1, 1]);
  assert.deepEqual([by.story.shares, by.story.friends, by.download.shares], [1, 1, 0]);
  assert.equal(m.rows[0].channel, 'copy', 'most shared first');
  assert.deepEqual(m.unknown, { friends: 1, signups: 1 }, 'opens and signups from links without a method are counted apart');
});

test('cards show who reached them, latest votes, down reasons and image shares, weakest first', () => {
  const c = cards(sample(), windows(NOW).week.current), by = Object.fromEntries(c.rows.map(r => [r.card, r]));
  assert.deepEqual([by.receipt.seen, by.receipt.up, by.receipt.down, by.receipt.images, by.receipt.up_share], [2, 1, 0, 1, null], 'under five votes has no share');
  assert.deepEqual(by.gatekeeper.reasons, { not_funny: 1 });
  assert.deepEqual([c.up, c.down], [1, 1]);
  assert.ok(!by.emoji, 'a card nobody reached, voted or shared is left out');
});

test('eight weeks, newest first, with weeks before tracking marked', () => {
  const w = weeks(sample(), NOW);
  assert.equal(w.length, 8); assert.equal(w[0].current, true); assert.equal(w[0].week_of, '2026-11-23');
  assert.equal(w.at(-1).tracked, false);
  assert.deepEqual([w[0].opened, w[0].shares, w[0].friends], [2, 3, 4]);
});

test('the view reads reports, recent events and signups credited to a report owner', async () => {
  const env = { SUPABASE_SERVICE_ROLE_KEY: 'secret' }, s = sample(), asked = [];
  const store = { reportSummaries: async () => s.reports, reportEventsSince: async since => { asked.push(since); return s.events; },
    referralSignups: async () => [{ phone_number: '+1', ref: referralRef(A, env), utm_medium: 'copy', consent_at: at(1) }, { phone_number: '+9', ref: 'podcast', consent_at: at(1) }, { phone_number: '+3', ref: 'shared-report', consent_at: at(1) }] };
  const view = await reportAdoptionData(store, env, NOW);
  assert.ok(Date.parse(asked[0]) <= NOW - 56 * 86400e3, 'events cover the eight weeks and both month windows');
  assert.equal(view.periods.week.strip.find(c => c.key === 'signups').value, '2 people', 'another source is not a report signup');
  assert.deepEqual(Object.keys(view.periods), ['week', 'month']);
  assert.ok(!JSON.stringify(view).includes('+1'), 'no phone leaves the server');
  assert.deepEqual(reportAdoption({ reports: [], events: [], signups: [] }, NOW).weeks.length, 8);
});
