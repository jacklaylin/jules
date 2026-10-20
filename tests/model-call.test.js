import test from 'node:test';
import assert from 'node:assert/strict';
// Every model call goes through lib/model-call.js. The meter wraps the global fetch when that module
// loads, so this stub must be in place first; calls that inject their own fetcher bypass it.
const network = [];
let queue = [];
globalThis.fetch = async (url, init) => {
  network.push({ url: String(url), body: JSON.parse(init.body) });
  return queue.shift()?.() ?? new Response(JSON.stringify({ model: 'gpt-4.1-mini', status: 'completed', usage: { input_tokens: 100, output_tokens: 10 }, output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '{"ok":true}' }] }] }));
};
const { callModel, modelResponse } = await import('../lib/model-call.js');
const { withUsage } = await import('../lib/usage.js');
const { profileCheck } = await import('../lib/memory.js');
const { errorClass } = await import('../lib/reply-failures.js');

const completed = value => new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] }));
const refused = (code, headers = {}) => new Response(JSON.stringify({ error: { code } }), { status: 429, headers });
const env = { OPENAI_API_KEY: 'fake-test-key' };
const messages = [{ direction: 'inbound', status: 'received', body: 'i wear a 10 in shoes' }];

test('a request carries the role\'s model, the key, store off and the structured-output schema', async () => {
  const seen = [];
  const out = await callModel({ role: 'extract', env: { ...env, MODEL_EXTRACT: 'gpt-4.1-nano' }, timeout: 5000, instructions: 'read', input: 'data', name: 'thing', schema: { type: 'object' }, maxOutputTokens: 50,
    fetcher: async (url, init) => { seen.push({ url, init, body: JSON.parse(init.body) }); return completed({ a: 1 }); } });
  assert.deepEqual(out, { a: 1 });
  const [{ url, init, body }] = seen;
  assert.equal(url, 'https://api.openai.com/v1/responses');
  assert.equal(init.headers.Authorization, 'Bearer fake-test-key'); assert.ok(init.signal);
  assert.deepEqual(body, { model: 'gpt-4.1-nano', store: false, max_output_tokens: 50, instructions: 'read', input: 'data', text: { format: { type: 'json_schema', name: 'thing', strict: true, schema: { type: 'object' } } } });
});

test('a background call (the profile check) waits out one short rate limit instead of failing', async () => {
  let calls = 0;
  const changes = [{ field: 'size', key: 'shoes/general', action: 'set', value: '10', evidence: 'i wear a 10 in shoes' }];
  const result = await profileCheck(messages, [], env, async () => ++calls === 1 ? refused('rate_limit_exceeded', { 'retry-after-ms': '5' }) : completed({ changes }));
  assert.equal(calls, 2);
  assert.deepEqual(result.changes, changes);
});

test('exhausted credit, a long wait or a second rate limit fail with the caller\'s own error and the refusal\'s diagnostics', async () => {
  for (const [response, calls, billing] of [[() => refused('credit_balance_exhausted', { 'retry-after-ms': '5' }), 1, true],
    [() => refused('rate_limit_exceeded', { 'retry-after': '30', 'x-ratelimit-remaining-tokens': '0' }), 1, undefined],
    [() => refused('rate_limit_exceeded', { 'retry-after-ms': '5' }), 2, undefined]]) {
    let n = 0;
    const error = await profileCheck(messages, [], env, async () => { n++; return response(); }).catch(e => e);
    assert.equal(error.message, 'Profile check failed'); assert.equal(errorClass(error), 'exception');
    assert.equal(n, calls); assert.equal(error.billing, billing);
    assert.equal(error.model_status, 429); assert.ok(error.model_error_code);
    // API handlers map error.status to their own HTTP response; a model refusal never sets it.
    assert.equal(error.status, undefined);
  }
  const limited = await profileCheck(messages, [], env, async () => refused('rate_limit_exceeded', { 'retry-after': '30', 'x-ratelimit-remaining-tokens': '0' })).catch(e => e);
  assert.equal(limited.model_limit, 'tokens'); assert.equal(limited.retry_after_ms, 30000);
});

test('an incomplete response, orNull and a caller-built error behave as each caller expects', async () => {
  const incomplete = async () => new Response(JSON.stringify({ status: 'incomplete', output: [] }));
  await assert.rejects(callModel({ env, fetcher: incomplete, incomplete: 'Read incomplete' }), /Read incomplete/);
  assert.equal(await callModel({ env, fetcher: incomplete, orNull: true }), null);
  assert.equal(await callModel({ env, fetcher: async () => ({ ok: false, status: 500 }), orNull: true }), null);
  const error = await callModel({ env, fetcher: async () => ({ ok: false, status: 503 }), failed: response => Object.assign(Error('Stylist request failed'), { outcome: 'http_' + response.status }) }).catch(e => e);
  assert.equal(error.outcome, 'http_503'); assert.equal(error.model_status, 503);
});

test('every model call made inside a user action is metered once, and a role on OpenRouter is routed and metered', async () => {
  const rows = [];
  network.length = 0;
  queue = [() => refused('rate_limit_exceeded', { 'retry-after-ms': '5' })];
  await withUsage({ env: {}, conversation: 'c1', operation: 'ai:m1', feature: 'chat', onUsage: r => rows.push(...r) }, async () => {
    assert.deepEqual(await callModel({ env, instructions: 'x', input: 'y' }), { ok: true });
    await modelResponse({ role: 'chat', env, body: { input: 'ok' } });
  });
  assert.equal(network.length, 3, 'the rate-limited try, its retry, and the second call');
  assert.equal(rows.length, 2, 'the refused try is free; each completed call is one row');
  assert.ok(rows.every(r => r.provider === 'openai' && r.feature === 'chat' && r.input_tokens === 100));

  const saved = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = 'fake-router-key';
  rows.length = 0; network.length = 0;
  try {
    await withUsage({ env: {}, conversation: 'c1', operation: 'ai:m2', feature: 'chat', onUsage: r => rows.push(...r) }, async () => {
      await callModel({ role: 'extract', env: { ...env, MODEL_EXTRACT: 'openrouter:anthropic/claude-haiku-5.5' }, input: 'y', raw: true });
    });
  } finally { if (saved === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = saved; }
  assert.equal(network[0].url, 'https://openrouter.ai/api/v1/responses'); assert.equal(network[0].body.model, 'anthropic/claude-haiku-5.5');
  assert.deepEqual(rows.map(r => r.provider), ['openrouter']);
});
