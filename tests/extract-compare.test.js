import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdminHandler } from '../api/admin.js';
import { sealToken } from '../lib/gmail-client.js';
import { sampleSources, COMPARE_MODELS } from '../lib/extract-compare.js';

const owner = '00000000-0000-4000-8000-000000000001', other = '00000000-0000-4000-8000-000000000002';
const env = { SITE_ORIGIN: 'https://jules.example', ADMIN_EMAIL: 'owner@example.com', OPENAI_API_KEY: 'test-key', GMAIL_TOKEN_KEY: Buffer.alloc(32, 7).toString('base64'), GOOGLE_GMAIL_CLIENT_ID: 'id', GOOGLE_GMAIL_CLIENT_SECRET: 'secret' };
const sources = Array.from({ length: 80 }, (_, i) => ({ id: 'm' + i }));
const imports = {
  [owner]: { conversation_id: owner, token_ciphertext: sealToken({ access_token: 'a', refresh_token: 'r', expires_at: Date.now() + 3600e3 }, owner, env), data: { account: 'Owner@Example.com', sources } },
  [other]: { conversation_id: other, token_ciphertext: sealToken({ access_token: 'b', refresh_token: 'r', expires_at: Date.now() + 3600e3 }, other, env), data: { account: 'someone@example.com', sources } },
};
const store = { conversation: async id => ({ id }), gmailImport: async id => imports[id] ?? null, recordUsage: async () => {} };
const EMAIL = 'Thank you for your order #A100. Black Wool Scarf, $40.00. Ship to Sam.';
const message = id => ({ id, internalDate: String(Date.UTC(2026, 9, 1)), payload: { mimeType: 'text/plain', headers: [{ name: 'Subject', value: 'Your order A100' }, { name: 'From', value: 'Shop <orders@shop.example>' }, { name: 'To', value: 'Sam <sam@example.com>' }], body: { size: EMAIL.length, data: Buffer.from(EMAIL).toString('base64url') } } });
const q = value => ({ value, quote: value });
const proposal = { events: [{ kind: 'purchased', basis: { value: 'order_confirmation', quote: 'Thank you for your order' }, category: 'accessory', existing_item_id: null, evidence: 'line',
  merchant: q('Shop'), order_reference: q('A100'), product: q('Black Wool Scarf'), sku: { value: null, quote: null }, brand: { value: null, quote: null }, color: { value: null, quote: null }, size_label: { value: null, quote: null }, size_system: { value: null, quote: null }, quantity: { value: null, quote: null }, units_per_pack: { value: null, quote: null },
  unit_price: q('$40.00'), currency: q('$'), recipient: { value: 'self', quote: 'Ship to Sam' }, photo_ref: null, link_ref: null, part_of_event: null }] };
function fakes() {
  const models = [], gmail = [];
  const fetcher = async (url, init) => {
    if (String(url).startsWith('https://gmail.googleapis.com/')) { gmail.push(String(url)); return new Response(JSON.stringify(message(String(url).match(/messages\/([^?]+)/)[1]))); }
    if (String(url) === 'https://api.openai.com/v1/responses') { const body = JSON.parse(init.body); models.push([body.model, body.reasoning?.effort ?? null]);
      return new Response(JSON.stringify({ status: 'completed', model: body.model, output: [{ content: [{ type: 'output_text', text: JSON.stringify(body.model === 'gpt-6-luna' ? { events: [] } : proposal) }] }] })); }
    throw new Error('unexpected ' + url);
  };
  return { fetcher, models, gmail };
}
async function post(handler, input, origin = env.SITE_ORIGIN) {
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(body) { this.body = JSON.parse(body); } };
  await handler({ method: 'POST', url: '/api/admin', headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) }, async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(input)); } }, res);
  return res;
}

test('the sample spreads across the import and stops at the requested count', () => {
  assert.deepEqual(sampleSources({ data: { sources } }, 40).map(s => s.id).slice(0, 3), ['m0', 'm2', 'm4']);
  assert.equal(sampleSources({ data: { sources } }, 40).length, 40);
  assert.equal(sampleSources({ data: { sources: sources.slice(0, 5) } }, 40).length, 5);
});

test('the extract comparison reads only the owner’s own Gmail, from the admin page, after confirmation', async () => {
  const { fetcher, gmail } = fakes(), handler = createAdminHandler({ auth: async () => 200, env, fetcher, storeFactory: () => store });
  assert.equal((await post(handler, { action: 'extract-compare', conversation: owner, email: 0 })).statusCode, 400);
  assert.equal((await post(handler, { action: 'extract-compare', conversation: owner, email: 0, confirm: true }, 'https://evil.example')).statusCode, 400);
  assert.equal((await post(handler, { action: 'extract-compare', conversation: other, email: 0, confirm: true })).statusCode, 403);
  assert.equal((await post(handler, { action: 'extract-compare', conversation: owner, email: 40, confirm: true })).statusCode, 400);
  assert.equal((await post(createAdminHandler({ auth: async () => 403, env, fetcher, storeFactory: () => assert.fail('must not access database') }), { action: 'extract-compare', conversation: owner, email: 0, confirm: true })).statusCode, 403);
  assert.equal(gmail.length, 0);
});

test('one email is read once by each model and only the verified fields come back', async () => {
  const { fetcher, models, gmail } = fakes(), handler = createAdminHandler({ auth: async () => 200, env, fetcher, storeFactory: () => store });
  const res = await post(handler, { action: 'extract-compare', conversation: owner, email: 1, confirm: true });
  assert.equal(res.statusCode, 200);
  assert.deepEqual([res.body.total, res.body.models, res.body.result.id, res.body.result.subject], [40, COMPARE_MODELS, 'm2', 'Your order A100']);
  assert.deepEqual(gmail, ['https://gmail.googleapis.com/gmail/v1/users/me/messages/m2?format=full']);
  assert.deepEqual(models.sort(), [['gpt-4.1-mini', null], ['gpt-5-nano', 'minimal'], ['gpt-5.6-luna', 'low'], ['gpt-6-luna', 'low']]);
  const readings = res.body.result.readings;
  assert.deepEqual(readings['gpt-4.1-mini'].kept.map(e => [e.kind, e.merchant, e.product, e.order_reference, e.recipient]), [['purchased', 'shop', 'black wool scarf', 'a100', 'self']]);
  assert.deepEqual(readings['gpt-6-luna'].kept, []);
  assert.doesNotMatch(JSON.stringify(res.body), /Ship to Sam|Thank you for your order/);
});

test('agreement counts the baseline’s own reruns separately and lists each differing candidate once per email', async () => {
  const { summarizeComparison } = await import('../lib/extract-compare.js');
  const scarf = [{ kind: 'purchased', merchant: 'shop', product: 'scarf', brand: null, size_label: null, color: null, quantity: null, order_reference: 'a1' }];
  const r = (kept, ms = 1000, cost = 0.001) => ({ kept, ms, cost });
  const results = [
    { id: 'm0', subject: 'Order A1', readings: { base: [r(scarf), r(scarf), r(scarf)], cand: [r(scarf), r([]), r([])] } },
    { id: 'm1', subject: 'Order B2', readings: { base: [r([]), r([]), r({ failed: 'down' })], cand: [r([]), r([]), r([])] } },
    { id: 'm2', error: 'gmail: Gmail request failed' },
  ];
  const { summary, disagreements } = summarizeComparison(results, ['base', 'cand']);
  assert.deepEqual(summary.map(s => [s.model, s.compared, Number(s.email_agreement.toFixed(2)), s.failures]), [['base', 4, 0.75, 1], ['cand', 6, 0.67, 0]]);
  assert.deepEqual(disagreements.map(d => [d.email, d.model, d.run]), [['m0', 'cand', 1]]);
  assert.equal(Number(summary[1].cost_per_100_emails.toFixed(6)), 0.1);
});

test('a Gmail failure tells the owner which step stopped and what Google answered', async () => {
  const expired = { ...imports[owner], token_ciphertext: sealToken({ access_token: 'a', refresh_token: 'r', expires_at: 0 }, owner, env) };
  const s = { ...store, gmailImport: async id => id === owner ? expired : null };
  const fetcher = async url => { if (String(url) === 'https://oauth2.googleapis.com/token') return new Response('{"error":"invalid_grant"}', { status: 400 }); throw new Error('unexpected ' + url); };
  const res = await post(createAdminHandler({ auth: async () => 200, env, fetcher, storeFactory: () => s }), { action: 'extract-compare', conversation: owner, email: 0, confirm: true });
  assert.equal(res.statusCode, 409);
  assert.match(res.body.error, /^Opening the Gmail sign-in failed \(Google answered 400: the Gmail sign-in has expired or was revoked/);
  assert.doesNotMatch(res.body.error, /invalid_grant|refresh/);
});
