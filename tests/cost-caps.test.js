import test from 'node:test';
import assert from 'node:assert/strict';
// The meter wraps the global fetch, so the stub must be in place first.
const fetched = [];
globalThis.fetch = async url => { fetched.push(String(url));
  if (String(url).startsWith('https://serpapi.com/search?fail')) return new Response('{"error":"Your account has run out of searches."}', { status: 429 });
  if (String(url).startsWith('https://serpapi.com/')) return new Response('{"organic_results":[]}');
  return new Response(JSON.stringify({ model: 'gpt-4.1-mini-2025-04-14', usage: { input_tokens: 1000, output_tokens: 100 }, output: [] })); };
const { withUsage } = await import('../lib/usage.js');
const { capSettings, capsOn, capState, rowCost, spendFrom, checkCaps, capNotice, clearCapCache, spendingReport, CostCapReached } = await import('../lib/cost-caps.js');
const { receiveInInbox } = await import('../lib/inbox.js');
const { createPriceChecksHandler } = await import('../api/price-checks.js');
const { runGmailStep } = await import('../lib/gmail-worker.js');
const { createSignupHandler, FULL_MESSAGE } = await import('../lib/public-signup.js');
const { capsText, personRows } = await import('../public/costs-view.js');

const NOW = new Date('2026-10-19T18:00:00Z'), TODAY = '2026-10-19';
// The price-check, Gmail and signup handlers read the real clock, so their spend rows are dated today.
const CLOCK_TODAY = new Date().toISOString().slice(0, 10);
// A summed usage row as the views return it: a gpt-4.1 call worth $2.00 per 1M input tokens.
const dollars = (amount, day = TODAY) => ({ day, provider: 'openai', model: 'gpt-4.1-2025-04-14', units: 1, input_tokens: amount * 500000, cached_tokens: 0, output_tokens: 0, web_search_calls: 0, cost_usd: 0 });
const spendStore = (user = {}, global = []) => ({ reads: 0,
  async userSpend(id) { this.reads++; return user[id] ?? []; },
  async globalSpend() { this.reads++; return global; } });
const quiet = fn => async (...args) => { const log = console.log; console.log = () => {}; try { return await fn(...args); } finally { console.log = log; } };

test('caps are off unless a positive dollar amount is set, and then no spend is read', async () => {
  for (const env of [{}, { COST_CAP_USER_DAILY_USD: '' }, { COST_CAP_USER_DAILY_USD: '0' }, { COST_CAP_GLOBAL_MONTHLY_USD: 'lots' }, { COST_CAP_USER_MONTHLY_USD: '-5' }]) assert.equal(capsOn(capSettings(env)), false, JSON.stringify(env));
  assert.deepEqual(capSettings({ COST_CAP_USER_DAILY_USD: '1.5', COST_CAP_GLOBAL_MONTHLY_USD: '200' }), { user: { day: 1.5, month: null }, global: { day: null, month: 200 } });
  const store = spendStore();
  assert.deepEqual(await checkCaps(store, 'c1', {}), { capped: false, off: true });
  assert.equal(store.reads, 0);
});

test('spend is priced from token and search counts at current prices, so calls stored at $0 still count', () => {
  // gpt-5.5 rows written before it had a price were stored with cost_usd 0.
  assert.equal(rowCost({ provider: 'openai', model: 'gpt-5.5-2026-04-23', input_tokens: 1e6, cached_tokens: 0, output_tokens: 1e5, web_search_calls: 0, cost_usd: 0 }), 8);
  assert.equal(rowCost({ provider: 'serpapi', model: 'google', units: 4, cost_usd: 0.1 }), 0.06);
  assert.equal(rowCost({ provider: 'serpapi', units: 4 }, { SERPAPI_COST_PER_SEARCH: '0.01' }), 0.04);
  // Before db/036 the per-person fallback view has only the stored estimate.
  assert.equal(rowCost({ day: TODAY, cost_usd: '0.42' }), 0.42);
  assert.deepEqual(spendFrom([dollars(1), dollars(2, '2026-10-02')], TODAY), { day: 1, month: 3 });
});

test('the first ceiling reached wins: global before personal, month before day, each with its reset', () => {
  const settings = capSettings({ COST_CAP_USER_DAILY_USD: '1', COST_CAP_USER_MONTHLY_USD: '5', COST_CAP_GLOBAL_DAILY_USD: '20', COST_CAP_GLOBAL_MONTHLY_USD: '100' });
  assert.equal(capState({ user: { day: 0.99, month: 4 }, global: { day: 10, month: 50 }, settings, now: NOW }).capped, false);
  const day = capState({ user: { day: 1, month: 4 }, global: { day: 10, month: 50 }, settings, now: NOW });
  assert.deepEqual([day.scope, day.period, day.resets_at], ['user', 'day', '2026-10-20T00:00:00.000Z']);
  const month = capState({ user: { day: 2, month: 6 }, global: { day: 10, month: 50 }, settings, now: NOW });
  assert.deepEqual([month.scope, month.period, month.resets_at], ['user', 'month', '2026-11-01T00:00:00.000Z']);
  const global = capState({ user: { day: 2, month: 6 }, global: { day: 25, month: 50 }, settings, now: NOW });
  assert.deepEqual([global.scope, global.period], ['global', 'day']);
});

test('a personal cap reads only that person; a global cap reads everyone; an unreadable spend lets Jules carry on', quiet(async () => {
  clearCapCache();
  const env = { COST_CAP_USER_DAILY_USD: '1', COST_CAP_GLOBAL_DAILY_USD: '10' };
  const store = spendStore({ heavy: [dollars(1.2)], light: [dollars(0.2)] }, [dollars(1.4)]);
  assert.equal((await checkCaps(store, 'heavy', env, { now: NOW })).capped, true);
  assert.equal((await checkCaps(store, 'light', env, { now: NOW })).capped, false);
  assert.equal((await checkCaps(spendStore({}, [dollars(10)]), 'light', env, { now: NOW, fresh: true })).scope, 'global');
  clearCapCache();
  const broken = { userSpend: async () => { throw Object.assign(Error('missing view'), { database_status: 404 }); }, globalSpend: async () => [] };
  assert.deepEqual(await checkCaps(broken, 'heavy', env, { now: NOW }), { capped: false, unknown: true });
}));

test('the notice is honest about the limit and when it resets, and never claims results', () => {
  const personal = capNotice({ scope: 'user', period: 'day', resets_at: '2026-10-20T00:00:00.000Z' }, NOW);
  assert.match(personal, /limit for today/); assert.match(personal, /in about 6 hours/); assert.match(personal, /message is saved/);
  assert.match(capNotice({ scope: 'user', period: 'month', resets_at: '2026-11-01T00:00:00.000Z' }, NOW), /this month.*on november 1/s);
  assert.match(capNotice({ scope: 'global', period: 'day', resets_at: '2026-10-19T18:40:00.000Z' }, NOW), /at capacity.*in about an hour/s);
});

test('metered work for a capped person stops before any paid call; owner tools without a person are not capped', quiet(async () => {
  clearCapCache(); fetched.length = 0;
  const env = { COST_CAP_USER_MONTHLY_USD: '5' }, recorded = [];
  const store = { ...spendStore({ capped: [dollars(6)] }), recordUsage: async rows => recorded.push(...rows) };
  let ran = false;
  await assert.rejects(withUsage({ store, env, conversation: 'capped', operation: 'style:analyze:1', feature: 'style_reading' }, async () => { ran = true; await fetch('https://api.openai.com/v1/responses'); }),
    error => error instanceof CostCapReached && error.status === 429 && /personal spending limit for this month/.test(error.message));
  assert.equal(ran, false); assert.equal(fetched.length, 0);
  assert.equal(await withUsage({ store, env, conversation: null, operation: 'admin-eval:x', feature: 'eval_agent' }, async () => 'ran'), 'ran');
}));

test('a SerpApi call it refused (no searches left) is not recorded as spend', async () => {
  const recorded = [];
  await withUsage({ store: { recordUsage: async rows => recorded.push(...rows) }, env: {}, conversation: 'c', operation: 'o', feature: 'chat', quiet: true }, async () => {
    await fetch('https://serpapi.com/search?fail=1'); await fetch('https://serpapi.com/search?engine=google');
  });
  assert.equal(recorded.length, 1); assert.equal(recorded[0].cost_usd, 0.015);
});

// Chat: a capped person gets one fixed notice, their message stays stored, and the agent never runs.
function chatStore(spend) {
  const operations = new Map();
  return { operations, claims: 0, received: [], at: NOW.getTime(),
    async receive(delivery) { this.received.push(delivery.message.content.text); return 'person'; },
    async smsOptedOut() { return false; },
    async claimAI() { this.claims++; return true; },
    async userSpend() { return spend.user; }, async globalSpend() { return spend.global ?? []; },
    async noticeSince(_c, prefix, since) { return [...operations].some(([op, row]) => op.startsWith(prefix) && row.at >= Date.parse(since)); },
    async reserve(_c, op, body) { if (operations.has(op)) return false; operations.set(op, { body, status: 'sending', at: this.at }); return true; },
    async finish(op, status) { if (operations.has(op)) operations.get(op).status = status; },
    async operation(op) { return operations.get(op) ?? null; },
    async replyDiagnostics() {}, async prepareAI() {}, async searchResult() {},
    async context() { return [{ id: 'm', direction: 'inbound', body: 'hi', created_at: NOW.toISOString() }]; } };
}
let messageCount = 0;
const inbound = text => ({ space: { phone: 'fake-line' }, message: { id: `fake-cap-${++messageCount}`, sender: { id: 'fake-sender' }, content: { text } } });

test('chat over a cap: the message is kept, one honest notice goes out, later messages wait quietly, and no AI work starts', quiet(async () => {
  clearCapCache();
  const env = { AI_ENABLED: 'true', COST_CAP_USER_DAILY_USD: '1' }, store = chatStore({ user: [dollars(1.5)] }), sent = [];
  let generated = 0, now = NOW.getTime();
  const options = { store, now: () => now, send: async (_d, body) => { sent.push(body); return { id: `sent-${sent.length}` }; },
    generate: async () => { generated++; return 'agent reply'; }, progress: async () => async () => {} };
  assert.equal(await receiveInInbox(inbound('find me a navy overcoat in 40R'), env, options), 'imessage_cost_cap_notice');
  assert.equal(sent.length, 1); assert.match(sent[0], /limit for today/);
  assert.equal(await receiveInInbox(inbound('hello?'), env, options), 'imessage_cost_cap_quiet');
  assert.equal(sent.length, 1);
  now += 3 * 3600000 + 1; store.at = now;
  assert.equal(await receiveInInbox(inbound('still there?'), env, options), 'imessage_cost_cap_notice');
  assert.deepEqual(store.received, ['find me a navy overcoat in 40R', 'hello?', 'still there?']);
  assert.equal(generated, 0); assert.equal(store.claims, 0, 'no AI reply is claimed, so the stalled-reply watchdog has nothing to chase');
}));

test('chat under the cap runs as usual', quiet(async () => {
  clearCapCache();
  const store = chatStore({ user: [dollars(0.5)] }), sent = [];
  let generated = 0;
  await receiveInInbox(inbound('find me loafers'), { AI_ENABLED: 'true', COST_CAP_USER_DAILY_USD: '1' }, { store, now: () => NOW.getTime(),
    send: async (_d, body) => { sent.push(body); return { id: 'x' }; }, generate: async () => { generated++; return 'agent reply'; }, progress: async () => async () => {} });
  assert.equal(generated, 1); assert.equal(store.claims, 1);
}));

test('price checks skip a capped person and keep their alert for a later run', quiet(async () => {
  clearCapCache();
  const alerts = [{ id: 'a1', conversation_id: 'capped', revision: 1, links: [], baselines: [] }];
  let inspected = 0, recorded = 0;
  const store = { ...spendStore({ capped: [dollars(3, CLOCK_TODAY)] }), claimPriceAlerts: async () => alerts, recordPriceCheck: async () => { recorded++; }, recordJobRun: async () => {} };
  const res = { setHeader() {}, end(body) { this.body = JSON.parse(body); } };
  await createPriceChecksHandler({ env: { CRON_SECRET: 'secret', PRICE_ALERTS_ENABLED: 'true', COST_CAP_USER_DAILY_USD: '2' }, storeFactory: () => store,
    inspect: async () => { inspected++; return { checks: [] }; } })({ method: 'GET', headers: { authorization: 'Bearer secret' } }, res);
  assert.deepEqual(res.body, { checked: 0, sent: 0, failed: 0, capped: 1 });
  assert.equal(inspected, 0); assert.equal(recorded, 0);
}));

test('a Gmail import step for a capped person waits with nothing changed instead of counting as a failure', quiet(async () => {
  clearCapCache();
  let row = { conversation_id: 'capped', revision: 1, token_ciphertext: 'sealed', data: { job: { status: 'extracting', started_at: 'synthetic', failures: 1 } } };
  const store = { ...spendStore({ capped: [dollars(3, CLOCK_TODAY)] }), claimGmailImport: async () => structuredClone(row), gmailImport: async () => structuredClone(row),
    finishGmailImport: async (_o, _r, data, token) => { row = { ...row, data, token_ciphertext: token }; return true; }, evidence: async () => [], profile: async () => ({ facts: [] }) };
  await runGmailStep('capped', store, { COST_CAP_USER_DAILY_USD: '2' }, {}, { step: async () => assert.fail('no paid step'), schedule: () => assert.fail('no new chain') });
  assert.deepEqual(row.data.job, { status: 'extracting', started_at: 'synthetic', failures: 1 });
}));

test('over the global cap, new signups pause with a plain message', quiet(async () => {
  clearCapCache();
  const env = { PUBLIC_SIGNUP_ENABLED: 'true', SITE_ORIGIN: 'https://jules.example', COST_CAP_GLOBAL_DAILY_USD: '10' };
  let signups = 0;
  const handler = createSignupHandler({ env, storeFactory: () => ({ ...spendStore({}, [dollars(12, CLOCK_TODAY)]), signup: async () => { signups++; return 'saved'; } }), log: () => {} });
  const get = { setHeader() {}, end(body) { this.body = JSON.parse(body); } };
  await handler({ method: 'GET', headers: {} }, get);
  assert.deepEqual(get.body, { enabled: false, message: FULL_MESSAGE });
  const post = { setHeader() {}, end(body) { this.body = JSON.parse(body); } };
  await handler({ method: 'POST', headers: { origin: 'https://jules.example' } }, post);
  assert.equal(post.statusCode, 503); assert.equal(post.body.error, FULL_MESSAGE); assert.equal(signups, 0);
}));

test('Admin shows each person’s spend against their cap, and the global position', async () => {
  const env = { COST_CAP_USER_DAILY_USD: '1', COST_CAP_USER_MONTHLY_USD: '10', COST_CAP_GLOBAL_MONTHLY_USD: '100' };
  const store = { spendByUser: async () => [{ conversation_id: 'a', ...dollars(1.2) }, { conversation_id: 'a', ...dollars(3, '2026-10-03') }, { conversation_id: 'b', ...dollars(0.85) }, { conversation_id: 'c', ...dollars(0.1) }],
    globalSpend: async () => [dollars(5.15)] };
  const report = await spendingReport(store, env, { now: NOW });
  assert.deepEqual(report.people.map(p => [p.conversation_id, Number(p.today.toFixed(2)), Number(p.month.toFixed(2)), p.capped?.period ?? null]), [['a', 1.2, 4.2, 'day'], ['b', 0.85, 0.85, null], ['c', 0.1, 0.1, null]]);
  const rows = personRows({ ...report, people: report.people.map(p => ({ ...p, name: null, sender_id: '+15550100' })) });
  assert.deepEqual(rows.map(r => [r.today, r.month, r.badge]), [['$1.20 of $1.00', '$4.20 of $10.00', 'fail'], ['$0.85 of $1.00', '$0.85 of $10.00', 'warn'], ['$0.10 of $1.00', '$0.10 of $10.00', 'ok']]);
  assert.match(rows[0].status, /^Capped until Oct 20/);
  assert.deepEqual(capsText({ spending: report }), { text: 'Global cap: this month $5.15 of $100.00 · 1 person is at their cap.', over: true });
  assert.deepEqual(capsText({ spending: await spendingReport(store, {}, { now: NOW }) }), { text: 'Spending caps are off.', over: false });
});
