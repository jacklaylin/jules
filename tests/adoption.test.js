import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adoption, weekStart } from '../lib/adoption.js';
import { createStore } from '../lib/store.js';
import { createAdminHandler } from '../api/admin.js';
import { testerCells, weekCells, summaryCells, duration } from '../public/adoption-view.js';
import { shownProducts, trackLinks, goLink, readGoLink, resultLinks, createGoHandler } from '../lib/adoption-events.js';
import { createImageHandler } from '../api/image.js';
import { receiveInInbox } from '../lib/inbox.js';
import sharp from 'sharp';

const A = '00000000-0000-4000-8000-00000000000a', B = '00000000-0000-4000-8000-00000000000b', C = '00000000-0000-4000-8000-00000000000c';
// Wednesday Oct 14 2026, noon UTC.
const now = Date.parse('2026-10-14T12:00:00Z');
const rows = {
  conversations: [
    { id: A, sender_id: '+15550000001', created_at: '2026-09-30T10:00:00Z' },
    { id: B, sender_id: '+15550000002', created_at: '2026-10-06T10:00:00Z' },
    { id: C, sender_id: '+15550000003', created_at: '2026-10-13T09:00:00Z' },
  ],
  inbound: [
    { conversation_id: A, created_at: '2026-09-30T10:01:00Z' },
    { conversation_id: A, created_at: '2026-10-12T08:00:00Z' },
    { conversation_id: A, created_at: '2026-10-12T09:00:00Z' },
    { conversation_id: A, created_at: '2026-10-14T09:00:00Z' },
    { conversation_id: B, created_at: '2026-10-06T10:05:00Z' },
  ],
  results: [{ conversation_id: A, created_at: '2026-09-30T13:01:00Z' }, { conversation_id: B, created_at: '2026-10-06T10:06:00Z' }],
  saves: [{ conversation_id: A, saved_at: '2026-10-01T10:00:00Z' }],
  alerts: [{ conversation_id: A, active: true, created_at: '2026-10-08T10:00:00Z' }, { conversation_id: A, active: false, created_at: '2026-10-02T10:00:00Z' }],
  costs: [{ conversation_id: A, cost_usd: '0.125' }, { conversation_id: A, cost_usd: 0.2 }],
};

test('each tester gets their furthest ladder step, activity and activation speed', () => {
  const report = adoption(rows, now);
  const [a, b, c] = report.testers;
  assert.deepEqual([a.id, b.id, c.id], [A, B, C], 'sorted by furthest step');
  assert.equal(a.stage, 'watching'); assert.equal(b.stage, 'results'); assert.equal(c.stage, 'joined');
  assert.equal(a.active_days_7, 2, 'two distinct days in the last week');
  assert.equal(a.active_days_total, 3);
  assert.equal(a.alerts_active, 1); assert.equal(a.alerts_total, 2);
  assert.equal(a.reached.watching, '2026-10-02T10:00:00Z', 'first alert ever, even if cancelled later');
  assert.equal(a.hours_to_results, 3);
  assert.equal(a.cost_usd, 0.33);
  assert.equal(c.last_active_at, null); assert.equal(c.hours_to_results, null); assert.equal(c.cost_usd, null);
  assert.deepEqual(report.summary, { testers: 3, active_7: 1, results: 2, saved: 1, watching_now: 1, shown: 0, saves_tracked: 0, clicks: 0, clickers: 0, intent: 0, save_rate: null });
  assert.equal(a.save_rate, null, 'no save rate before results-shown tracking'); assert.equal(a.clicks, 0);
});

test('weekly ladder counts testers who reached each step by the end of each week, newest first', () => {
  const { weeks } = adoption(rows, now);
  assert.deepEqual(weeks.map(w => w.week_of), ['2026-10-12', '2026-10-05', '2026-09-28']);
  assert.equal(weeks[0].current, true);
  assert.deepEqual(weeks[2], { week_of: '2026-09-28', current: false, joined: 1, active: 1, reached: { joined: 1, messaged: 1, results: 1, saved: 1, watching: 1, intent: 0 } });
  assert.deepEqual(weeks[1].reached, { joined: 2, messaged: 2, results: 2, saved: 1, watching: 1, intent: 0 });
  assert.equal(weeks[1].active, 1, 'only B messaged that week');
  assert.deepEqual(weeks[0], { week_of: '2026-10-12', current: true, joined: 1, active: 1, reached: { joined: 3, messaged: 2, results: 2, saved: 1, watching: 1, intent: 0 } });
});

test('the ladder is capped at eight weeks and an empty database gives an empty report', () => {
  const old = adoption({ conversations: [{ id: A, sender_id: 'x', created_at: '2026-01-01T00:00:00Z' }] }, now);
  assert.equal(old.weeks.length, 8);
  assert.equal(old.weeks.at(-1).reached.joined, 1);
  const empty = adoption({}, now);
  assert.deepEqual(empty.testers, []); assert.deepEqual(empty.weeks, []); assert.equal(empty.summary.testers, 0);
  assert.equal(weekStart('2026-10-18T23:59:00Z').toISOString(), '2026-10-12T00:00:00.000Z', 'Sunday belongs to the week that started Monday');
});

test('adoptionRows reads ids and timestamps only and keeps replies that carried products', async () => {
  const paths = [];
  const fetcher = async url => {
    const path = decodeURIComponent(new URL(url).pathname.replace('/rest/v1/', '') + new URL(url).search); paths.push(path);
    const body = path.startsWith('messages') && path.includes('outbound')
      ? [{ conversation_id: A, created_at: 't1', first: { url: 'https://shop.example/a' } }, { conversation_id: A, created_at: 't2', first: null }]
      : [];
    return { ok: true, text: async () => JSON.stringify(body) };
  };
  const result = await createStore({ SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'fake' }, fetcher).adoptionRows();
  assert.deepEqual(result.results, [{ conversation_id: A, created_at: 't1' }]);
  assert.ok(paths.every(p => !/select=[^&]*body/.test(p)), 'no message text is read');
  assert.ok(paths.some(p => p.includes('identification-test')), 'owner test messages are excluded');
  assert.ok(paths.some(p => p.includes('line=neq.simulator')));
});

test('the admin API serves the adoption view to the owner only', async () => {
  const store = { adoptionRows: async () => rows };
  const call = async access => {
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(body) { this.body = body; } };
    await createAdminHandler({ auth: async () => access, storeFactory: () => store })({ method: 'GET', url: '/api/admin?view=adoption', headers: {} }, res);
    return { status: res.statusCode, body: JSON.parse(res.body) };
  };
  const ok = await call(200);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.summary.testers, 3);
  assert.equal((await call(401)).status, 401);
});

test('page cells read plainly', () => {
  const report = adoption(rows, now);
  const a = testerCells(report.testers[0], report.steps, now);
  assert.deepEqual(a.stage, { label: 'Watching', tone: 'ok' });
  assert.equal(testerCells(report.testers[1], report.steps, now).stage.tone, 'plain');
  assert.equal(a.active_days, '2 of 7'); assert.equal(a.alerts, '1 on · 2 set'); assert.equal(a.first_results, '3 hours'); assert.equal(a.cost, '$0.33');
  assert.equal(testerCells(report.testers[2], report.steps, now).last_active, 'never');
  assert.deepEqual([duration(0.01), duration(1), duration(72), duration(null)], ['1 min', '1 hour', '3 days', '—']);
  const week = weekCells(report.weeks[0], report.steps);
  assert.ok(week.week.includes('(this week)'));
  assert.deepEqual(week.steps.map(s => s.value), ['3', '2 · 67%', '2 · 67%', '1 · 33%', '1 · 33%', '0 · 0%']);
  assert.equal(summaryCells(report.summary)[1].note, '33% of testers');
});

// Adoption events (db/032): product options shown per reply, product-link clicks and purchase requests.
const events = [
  { conversation_id: A, kind: 'results_shown', quantity: 3, created_at: '2026-10-08T10:00:00Z' },
  { conversation_id: A, kind: 'results_shown', quantity: 1, created_at: '2026-10-12T10:00:00Z' },
  { conversation_id: B, kind: 'results_shown', quantity: 2, created_at: '2026-10-09T10:00:00Z' },
  { conversation_id: A, kind: 'link_click', quantity: 1, created_at: '2026-10-12T10:05:00Z' },
  { conversation_id: A, kind: 'link_click', quantity: 1, created_at: '2026-10-12T10:06:00Z' },
  { conversation_id: B, kind: 'purchase_intent', quantity: 1, created_at: '2026-10-09T11:00:00Z' },
];

test('events add save rate since tracking began, click counts and a purchase-intent step', () => {
  const saves = [...rows.saves, { conversation_id: A, saved_at: '2026-10-12T10:10:00Z' }];
  const report = adoption({ ...rows, saves, events }, now);
  const a = report.testers.find(t => t.id === A), b = report.testers.find(t => t.id === B);
  assert.equal(report.tracked_since, '2026-10-08T10:00:00Z');
  assert.equal(a.saves, 2, 'every save still counts as a save');
  assert.equal(a.saves_tracked, 1, 'the save from before tracking is left out of the rate');
  assert.equal(a.shown, 4); assert.equal(a.save_rate, 0.25); assert.equal(a.clicks, 2);
  assert.equal(b.stage, 'intent', 'purchase intent is the top step even without a save or alert');
  assert.equal(b.reached.intent, '2026-10-09T11:00:00Z'); assert.equal(b.save_rate, 0);
  assert.equal(report.testers[0].id, B, 'furthest step first');
  assert.equal(report.weeks[1].reached.intent, 1);
  assert.deepEqual({ ...report.summary, save_rate: Math.round(report.summary.save_rate * 1000) / 1000 },
    { testers: 3, active_7: 1, results: 2, saved: 1, watching_now: 1, shown: 6, saves_tracked: 1, clicks: 2, clickers: 1, intent: 1, save_rate: 0.167 });
  const cells = summaryCells(report.summary);
  assert.deepEqual(cells.slice(-3).map(c => [c.value, c.note]), [['17%', '1 saved of 6 shown'], ['2', 'from 1 tester'], ['1', '33% of testers']]);
  const c = testerCells(a, report.steps, now);
  assert.deepEqual([c.shown, c.save_rate, c.clicks], ['4', '25%', '2']);
  assert.equal(testerCells(b, report.steps, now).stage.label, 'Purchase intent');
  assert.deepEqual(summaryCells(adoption(rows, now).summary).slice(-3).map(c => c.value), ['—', '0', '0']);
});

test('before db/032 runs, a missing adoption_events table reads as no events; other failures still surface', async () => {
  const storeWith = status => createStore({ SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'fake' }, async url => url.includes('adoption_events')
    ? { ok: false, status, json: async () => ({ code: 'PGRST205' }) } : { ok: true, text: async () => '[]' });
  assert.deepEqual((await storeWith(400).adoptionRows()).events, []);
  assert.deepEqual((await storeWith(404).adoptionRows()).events, []);
  await assert.rejects(storeWith(500).adoptionRows());
});

const env = { SITE_ORIGIN: 'https://jules.example', SUPABASE_SERVICE_ROLE_KEY: 'secret' };
const result = { products: [
  { url: 'https://shop.example/coat', merchant_options: [{ url: 'https://other.example/coat' }] },
  { url: 'https://shop.example/scarf' },
  { url: 'https://shop.example/hat' },
], checkout_links: [{ url: 'https://shop.example/hat', checkout_url: 'https://shop.example/cart/1' }] };

test('results shown counts products linked in the sent reply, not every product found', () => {
  assert.equal(shownProducts('Coat:\nhttps://other.example/coat.\nScarf: https://shop.example/scarf', result), 2);
  assert.equal(shownProducts('No links here.', result), 0);
  assert.equal(shownProducts('https://shop.example/coat', null), 0);
});

test('tracked links replace only this reply\'s product links and keep the sentence around them', () => {
  const body = 'Coat (https://shop.example/coat). Also https://unrelated.example/x and https://shop.example/scarf';
  const tracked = trackLinks(body, result, 'ai:m1', env);
  const links = tracked.match(/https:\/\/jules\.example\/go\/[\w.-]*[\w-]/g);
  assert.equal(links.length, 2);
  assert.ok(tracked.includes('https://unrelated.example/x'), 'a link from elsewhere is unchanged');
  assert.ok(tracked.startsWith('Coat (https://jules.example/go/') && tracked.includes('). Also'), 'punctuation stays outside the link');
  assert.deepEqual(readGoLink(links[0].split('/go/')[1], env), { operation: 'ai:m1', index: 0 });
  assert.equal(resultLinks(result)[readGoLink(links[1].split('/go/')[1], env).index], 'https://shop.example/scarf');
  assert.equal(trackLinks(body, result, 'ai:m1', { ...env, SITE_ORIGIN: '' }), body, 'without a site origin nothing changes');
});

test('the go link records a tap and forwards to the store; tampered links, previews and missing tables are handled', async () => {
  const env = { SITE_ORIGIN: 'https://jules.example', SUPABASE_SERVICE_ROLE_KEY: 'secret', LINK_CLICK_TRACKING: 'true' };
  const recorded = [];
  const store = { replyResult: async operation => operation === 'ai:m1' ? { conversation_id: A, search_result: result } : null,
    recordAdoptionEvent: async row => recorded.push(row) };
  const open = async (token, { method = 'GET', agent = 'Mozilla/5.0 (iPhone)', handlerStore = store } = {}) => {
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(body) { this.body = body; } };
    await createImageHandler({ env, storeFactory: () => handlerStore, auth: assert.fail })({ method, url: `/api/image?go=${encodeURIComponent(token)}`, headers: { 'user-agent': agent } }, res);
    return res;
  };
  const token = goLink('ai:m1', 1, env).split('/go/')[1];
  const res = await open(token);
  assert.equal(res.statusCode, 302); assert.equal(res.headers.Location, 'https://other.example/coat');
  assert.deepEqual(recorded, [{ quantity: 1, conversation_id: A, kind: 'link_click', ref: 'ai:m1' }]);
  assert.ok(!JSON.stringify(recorded).includes('coat'), 'the event keeps no product link or text');
  assert.equal((await open(token, { agent: 'facebookexternalhit/1.1 Facebot Twitterbot/1.0' })).statusCode, 200, 'a preview fetcher gets the preview page');
  assert.equal((await open(token, { method: 'HEAD' })).statusCode, 302);
  assert.equal(recorded.length, 1, 'link previews and HEAD checks are not taps');
  assert.equal((await open(token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A'))).statusCode, 404, 'a tampered signature is refused');
  assert.equal((await open(goLink('ai:m1', 9, env).split('/go/')[1])).statusCode, 404, 'a position with no link is refused');
  assert.equal((await open(goLink('ai:other', 0, env).split('/go/')[1])).statusCode, 404);
  const unmigrated = { ...store, recordAdoptionEvent: async () => { const e = new Error('Database request failed'); e.database_status = 404; throw e; } };
  assert.equal((await open(token, { handlerStore: unmigrated })).headers.Location, 'https://other.example/coat', 'the tap still forwards before db/032 runs');
  assert.equal((await open(token, { method: 'POST' })).statusCode, 405);
  assert.equal(createGoHandler.length, 1);
});

function turn(generate, extraEnv = {}) {
  const sent = [], stored = [], recorded = [];
  const store = { receive: async () => C, claimAI: async () => true, context: async () => [{ id: '00000000-0000-4000-8000-000000000001', direction: 'inbound', body: 'coats please', status: 'received' }],
    prepareAI: async (_op, body) => stored.push(body), finish: async () => {}, searchResult: async () => {}, recordAdoptionEvent: async row => recorded.push(row) };
  const run = () => receiveInInbox({ space: { phone: 'l' }, message: { id: 'm1', sender: { id: 's' }, content: { type: 'text', text: 'coats please' }, attachments: [] } },
    { AI_ENABLED: 'true', OPENAI_API_KEY: 'test', SEARCH_ENABLED: 'true', WISHLIST_ENABLED: 'true', CHECKOUT_LINKS_ENABLED: 'true', ...env, ...extraEnv },
    { store, send: async (_d, body) => { sent.push(body); return { id: 'p1' }; }, compose: async args => ({ body: args.draft, captions: [], composed: true }), generate });
  return { sent, stored, recorded, run };
}

test('a sent reply with products records how many it showed and sends /go/ product links', async () => {
  const body = 'Two picks:\nhttps://shop.example/coat\nhttps://shop.example/scarf';
  const searching = async (_m, _e, _f, memory) => { await memory.recordSearch(result); return body; };
  const off = turn(searching);
  await off.run();
  assert.deepEqual(off.recorded, [{ quantity: 2, conversation_id: C, kind: 'results_shown', ref: 'ai:m1' }]);
  assert.equal(off.sent[0].match(/https:\/\/jules\.example\/go\//g).length, 2, 'product links preview through /go/ even with tracking off');
  assert.equal(off.stored[0], body);
  const on = turn(searching, { LINK_CLICK_TRACKING: 'true' });
  await on.run();
  assert.equal(on.sent[0].match(/https:\/\/jules\.example\/go\//g).length, 2);
  assert.equal(on.stored[0], body, 'history keeps the store links');
  assert.equal(on.recorded[0].quantity, 2);
  const chat = turn(async () => 'Navy works with grey.');
  await chat.run();
  assert.deepEqual(chat.recorded, [], 'a reply without products records nothing');
});

test('a purchase request records purchase intent with the number of items and no text', async () => {
  const buying = async (_m, _e, _f, memory) => memory.checkoutAction([{ url: 'https://shop.example/hat', name: 'Hat', size: null }]);
  const t = turn(buying);
  await t.run();
  assert.deepEqual(t.recorded.find(r => r.kind === 'purchase_intent'), { quantity: 1, conversation_id: C, kind: 'purchase_intent', ref: 'ai:m1' });
  assert.match(t.sent[0], /https:\/\/jules\.example\/go\//, 'the checkout link previews through /go/');
});

const previewed = { products: [
  { brand: 'Our Legacy', name: 'Borrowed <Shirt> "Navy"', url: 'https://www.ssense.com/en-us/men/product/our-legacy/shirt/1', retailer: { name: 'SSENSE' },
    candidate_image: 'https://encrypted-tbn0.gstatic.com/shopping?q=tbn:abc', price_snapshot: { amount: 245, currency: 'USD' }, listing_check: { status: 'in_stock' },
    merchant_options: [{ url: 'https://www.mrporter.com/shirt/2', retailer: { name: 'MR PORTER' } }] },
  { brand: 'Auralee', name: 'Auralee wool trousers', url: 'https://auralee.example/trousers' },
] };
async function preview(token, { agent = 'facebookexternalhit/1.1 Facebot Twitterbot/1.0', method = 'GET', extra = '', tracking = 'false', loadPhoto, recorded = [] } = {}) {
  const store = { replyResult: async operation => operation === 'ai:p1' ? { conversation_id: A, search_result: previewed } : null, recordAdoptionEvent: async row => recorded.push(row) };
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(body) { this.body = body; } };
  await createGoHandler({ env: { ...env, LINK_CLICK_TRACKING: tracking }, store, loadPhoto })({ method, url: `/api/image?go=${encodeURIComponent(token)}${extra}`, headers: { 'user-agent': agent } }, res);
  return res;
}
const previewToken = index => goLink('ai:p1', index, env).split('/go/')[1];

test('a preview fetcher gets the product name, store and photo, with no price or stock', async () => {
  const res = await preview(previewToken(0));
  assert.equal(res.statusCode, 200); assert.match(res.headers['Content-Type'], /text\/html/);
  assert.ok(res.body.includes('<meta property="og:title" content="Our Legacy Borrowed &lt;Shirt&gt; &quot;Navy&quot;">'), 'title is brand + name, escaped');
  assert.ok(res.body.includes('content="At SSENSE"'));
  assert.ok(res.body.includes(`content="https://jules.example/api/image?go=${encodeURIComponent(previewToken(0))}&amp;image=1"`));
  assert.ok(!/245|USD|in_stock|stock/i.test(res.body), 'no price or availability in the preview');
  const other = await preview(previewToken(1));
  assert.ok(other.body.includes('content="At MR PORTER"'), 'another store for the same product names that store');
  const plain = await preview(previewToken(2));
  assert.ok(plain.body.includes('content="Auralee wool trousers"'), 'a name that already starts with the brand is not doubled');
  assert.ok(!plain.body.includes('og:image'), 'no product photo means no image, not brand art');
  assert.equal((await preview(previewToken(0), { method: 'HEAD' })).body, undefined);
});

test('the preview photo is the product thumbnail on a white square; missing or failed photos return no image', async () => {
  const thumb = await sharp({ create: { width: 200, height: 300, channels: 3, background: '#336699' } }).jpeg().toBuffer();
  assert.equal((await preview(previewToken(0), { extra: '&image=1', loadPhoto: async () => { throw new Error('blocked'); } })).statusCode, 404, 'a photo that cannot be fetched is left out');
  const fetched = [];
  const res = await preview(previewToken(0), { agent: 'Mozilla/5.0', extra: '&image=1', loadPhoto: async url => { fetched.push(url); return thumb; } });
  assert.equal(res.statusCode, 200); assert.equal(res.headers['Content-Type'], 'image/jpeg');
  const meta = await sharp(res.body).metadata();
  assert.deepEqual([meta.width, meta.height], [800, 800]);
  assert.deepEqual(fetched, [previewed.products[0].candidate_image]);
  assert.equal((await preview(previewToken(2), { extra: '&image=1', loadPhoto: assert.fail })).statusCode, 404);
});

test('a person tapping a /go/ link goes straight to the store; taps are recorded only with tracking on', async () => {
  const off = [], on = [];
  const res = await preview(previewToken(0), { agent: 'Mozilla/5.0 (iPhone)', recorded: off });
  assert.equal(res.statusCode, 302); assert.equal(res.headers.Location, previewed.products[0].url);
  assert.deepEqual(off, [], 'tracking off records nothing');
  await preview(previewToken(0), { agent: 'Mozilla/5.0 (iPhone)', tracking: 'true', recorded: on });
  assert.equal(on.length, 1);
  await preview(previewToken(0), { tracking: 'true', recorded: on });
  await preview(previewToken(0), { tracking: 'true', extra: '&image=1', loadPhoto: async () => { throw new Error('x'); }, recorded: on });
  assert.equal(on.length, 1, 'preview page and photo fetches are not taps');
  const tampered = previewToken(0).slice(0, -1) + (previewToken(0).endsWith('A') ? 'B' : 'A');
  assert.equal((await preview(tampered)).statusCode, 404);
  assert.equal((await preview(tampered, { extra: '&image=1' })).statusCode, 404, 'a tampered link gets no photo either');
});
