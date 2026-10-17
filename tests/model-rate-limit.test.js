import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateReply, rateLimitWait, RATE_LIMIT_WAIT_MAX_MS } from '../lib/ai.js';
import { receiveInInbox, SEARCH_FOLLOWUP_MS } from '../lib/inbox.js';
import { modelRefusal, turnTrace, GENERIC_FALLBACK } from '../lib/reply-failures.js';
import { agentTurn, tool, isAgentRequest } from './helpers/agent.js';

// October 15–16: a plain profile question got the generic fallback because the model API answered
// 429 on the first try and on the compact retry, and nothing recorded whether it was a rate tier or
// exhausted billing. A short rate limit is now waited out once; the refusal's code, exhausted limit
// and the turn's step timings are recorded so the next fallback is diagnosable from data.

const env = { AI_ENABLED: 'true', OPENAI_API_KEY: 'fake-test-key' };
const refused = (code, headers = {}) => new Response(JSON.stringify({ error: { code, message: 'not recorded' } }), { status: 429, headers });
const ok = () => agentTurn(tool('conversation_reply', { response: 'here you go.' }));

test('a refusal is described by its code, exhausted limit and requested wait, never its message', async () => {
  assert.deepEqual(await modelRefusal(refused('rate_limit_exceeded', { 'x-ratelimit-remaining-tokens': '0', 'x-ratelimit-remaining-requests': '12', 'retry-after-ms': '850' })),
    { error_code: 'rate_limit_exceeded', limit: 'tokens', retry_after_ms: 850 });
  assert.deepEqual(await modelRefusal(refused('rate_limit_exceeded', { 'x-ratelimit-remaining-requests': '0', 'retry-after': '2' })),
    { error_code: 'rate_limit_exceeded', limit: 'requests', retry_after_ms: 2000 });
  assert.deepEqual(await modelRefusal(new Response('upstream down', { status: 503 })), { error_code: null, limit: null, retry_after_ms: null });
  // Mocks without headers or a JSON body still work.
  assert.deepEqual(await modelRefusal({ ok: false }), { error_code: null, limit: null, retry_after_ms: null });
  const response = refused('rate_limit_exceeded');
  await modelRefusal(response);
  assert.equal((await response.json()).error.code, 'rate_limit_exceeded', 'the caller can still read the body');
});

test('only a short rate limit is waited out; exhausted quota, long waits and other errors fail at once', async () => {
  assert.equal(await rateLimitWait(refused('rate_limit_exceeded', { 'retry-after-ms': '300' })), 300);
  assert.equal(await rateLimitWait(refused('rate_limit_exceeded')), 1000, 'no header: a one-second wait');
  assert.equal(await rateLimitWait(refused('rate_limit_exceeded', { 'retry-after': '30' })), null);
  assert.equal(await rateLimitWait(refused('rate_limit_exceeded', { 'retry-after-ms': String(RATE_LIMIT_WAIT_MAX_MS + 1) })), null);
  assert.equal(await rateLimitWait(refused('insufficient_quota', { 'retry-after-ms': '10' })), null);
  assert.equal(await rateLimitWait(new Response('{}', { status: 500 })), null);
  assert.equal(await rateLimitWait({ ok: true, status: 200 }), null);
});

test('a turn rate-limited once is answered instead of failing', async () => {
  for (const headers of [{ 'retry-after-ms': '5' }, { 'retry-after-ms': '5', 'x-ratelimit-remaining-tokens': '0' }, { 'retry-after-ms': '5', 'x-ratelimit-remaining-requests': '0' }]) {
    let calls = 0;
    const reply = await generateReply([{ direction: 'inbound', body: 'what are my favourite brands?', status: 'received' }], env, async (_url, options) => {
      if (!isAgentRequest(options)) return { ok: false };
      return ++calls === 1 ? refused('rate_limit_exceeded', headers) : ok();
    });
    assert.equal(reply, 'here you go.'); assert.equal(calls, 2);
  }
});

test('exhausted quota is not waited out', async () => {
  const events = [], log = console.log;
  console.log = line => { try { events.push(JSON.parse(line).event); } catch { /* not a log event */ } };
  try { await assert.rejects(generateReply([], env, async () => refused('insufficient_quota', { 'retry-after-ms': '5' })), /AI request failed/); }
  finally { console.log = log; }
  assert.ok(!events.includes('model_rate_limited'));
});

test('a persistent rate limit ends in the fallback with its code, limit and step timings recorded', async () => {
  const rows = [], diagnostics = new Map(), sent = [];
  const store = { receive: async () => 'conversation', claimAI: async (_c, op) => { rows.push({ operation_id: op }); return true; },
    context: async () => [{ direction: 'inbound', provider_id: 'fake-message', body: 'question', status: 'received' }],
    prepareAI: async (op, body, source) => Object.assign(rows.find(r => r.operation_id === op), { body, source }),
    finish: async () => {}, searchResult: async () => {}, replyDiagnostics: async (op, data) => { diagnostics.set(op, data); } };
  const generate = async (_m, _e, fetcher) => { const r = await fetcher('https://api.openai.com/v1/responses', {}); if (!r.ok) throw new Error('AI request failed'); };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => refused('rate_limit_exceeded', { 'x-ratelimit-remaining-tokens': '0', 'retry-after-ms': '20000' });
  try {
    await receiveInInbox({ space: { phone: 'fake-line' }, message: { id: 'fake-message', sender: { id: 'fake-tester' }, content: { type: 'text', text: 'question' }, attachments: [] } },
      { ...env, FOUNDER_ALERT_PHONE: 'founder-test-handle' }, { store, generate, progress: async () => async () => {}, writeFollowup: async () => null,
        send: async (d, body) => { sent.push({ to: d.message.sender.id, body }); return { id: 'sent' }; } });
  } finally { globalThis.fetch = realFetch; }
  const d = diagnostics.get('ai:fake-message');
  assert.equal(rows[0].body, GENERIC_FALLBACK);
  assert.equal(d.model_status, 429); assert.equal(d.model_error_code, 'rate_limit_exceeded'); assert.equal(d.model_limit, 'tokens');
  assert.deepEqual(d.steps.map(s => s.step).slice(0, 4), ['progress', 'context', 'agent', 'retry']);
  assert.ok(d.steps.every((s, i) => Number.isFinite(s.at_ms) && (i === 0 || s.at_ms >= d.steps[i - 1].at_ms)));
  assert.match(sent.find(s => s.to === 'founder-test-handle').body, /model 429 rate_limit_exceeded/);
});

test('step timings are bounded and kept in order', () => {
  let t = 0;
  const trace = turnTrace({ now: () => (t += 10) });
  for (let i = 0; i < 60; i++) trace.mark(`tool:${i}`, { persist: false });
  assert.equal(trace.steps.length, 40); assert.equal(trace.steps[0].step, 'tool:0');
});

test('the "still looking" follow-up waits past most finished searches and before the turn deadline', () => {
  assert.ok(SEARCH_FOLLOWUP_MS >= 90000, 'testers would rather wait than get an early follow-up');
  assert.ok(SEARCH_FOLLOWUP_MS < 105000, 'it still lands before the turn deadline');
});
