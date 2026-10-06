import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createProcessor, GREETING, verifySignature } from '../lib/imessage.js';
import handler from '../api/imessage.js';

const env = { SPECTRUM_PROJECT_ID: 'fake-project', SPECTRUM_PROJECT_SECRET: 'fake-project-secret', SPECTRUM_WEBHOOK_SECRET: 'fake-webhook-secret' };
const now = 1800000000000;
const payload = {
  event: 'messages',
  space: { id: 'test-dm', platform: 'iMessage', type: 'dm', phone: 'shared' },
  message: { id: 'test-message', direction: 'inbound', sender: { id: 'fake-sender' }, content: { type: 'text', text: 'hello' } },
};
function request(value = payload, timestamp = String(now / 1000)) {
  const body = Buffer.from(JSON.stringify(value));
  const signature = 'v0=' + createHmac('sha256', env.SPECTRUM_WEBHOOK_SECRET).update(`v0:${timestamp}:`).update(body).digest('hex');
  return [body, { 'content-type': 'application/json', 'x-spectrum-signature': signature, 'x-spectrum-timestamp': timestamp, 'x-spectrum-webhook-id': 'test-hook' }, env];
}
function processor(send = async () => {}) {
  return createProcessor({ send, now: () => now, log: () => {} });
}
test('hello sends exact greeting through the signed shared line', async () => {
  const sent = [];
  const status = await processor(async (...args) => sent.push(args))(...request());
  assert.equal(status, 200);
  assert.equal(sent.length, 1);
  assert.equal(sent[0][1], GREETING);
  assert.equal(sent[0][0].space.phone, 'shared');
});
test('live Photon lowercase imessage platform sends the greeting', async () => {
  let sent = 0;
  const value = { ...payload, space: { ...payload.space, platform: 'imessage' } };
  assert.equal(await processor(async (_message, greeting) => {
    assert.equal(greeting, GREETING);
    sent++;
  })(...request(value)), 200);
  assert.equal(sent, 1);
});
test('rejects missing, invalid, stale, future and tampered signatures', async () => {
  const [body, headers] = request();
  assert.equal(verifySignature(body, headers, env.SPECTRUM_WEBHOOK_SECRET, now), true);
  for (const invalid of [{}, { ...headers, 'x-spectrum-signature': 'bad' }, request(payload, String(now / 1000 - 301))[1], request(payload, String(now / 1000 + 301))[1]]) {
    assert.equal(await processor() (body, invalid, env), 401);
  }
  assert.equal(await processor()(Buffer.from('{}'), headers, env), 401);
});
test('missing credentials fail closed', async () => {
  const [body, headers] = request();
  assert.equal(await processor()(body, headers, {}), 503);
});
test('own messages, reactions, attachments, and group chats never send', async () => {
  for (const value of [
    { ...payload, message: { ...payload.message, direction: 'outbound' } },
    { ...payload, message: { ...payload.message, content: { type: 'reaction' } } },
    { ...payload, message: { ...payload.message, content: { type: 'attachment' } } },
    { ...payload, space: { ...payload.space, type: 'group' } },
    { event: 'read-receipt' },
  ]) {
    assert.equal(await processor(async () => assert.fail('must not send'))(...request(value)), 200);
  }
});
test('malformed payloads do not send', async () => {
  for (const value of [null, [], { event: 'messages' }, { ...payload, message: { ...payload.message, sender: {} } }]) {
    assert.equal(await processor(async () => assert.fail('must not send'))(...request(value)), 400);
  }
});
test('retry and concurrent delivery send only once in a warm instance', async () => {
  let count = 0;
  const process = processor(async () => { count++; });
  assert.deepEqual(await Promise.all([process(...request()), process(...request())]), [200, 200]);
  assert.equal(await process(...request()), 200);
  assert.equal(count, 1);
});
test('send failure returns 502 and permits retry without leaking errors', async () => {
  let count = 0;
  const logs = [];
  const process = createProcessor({ now: () => now, log: value => logs.push(value), send: async () => { if (++count === 1) throw new Error('private sender and credentials'); } });
  assert.equal(await process(...request()), 502);
  assert.equal(await process(...request()), 200);
  assert.equal(logs.join('').includes('private sender'), false);
});

test('HTTP endpoint rejects browser GET and oversized requests', async () => {
  const response = () => ({ headers: {}, setHeader(key, value) { this.headers[key] = value; }, end(body) { this.body = body; } });
  const get = response();
  await handler({ method: 'GET' }, get);
  assert.equal(get.statusCode, 405);
  assert.equal(get.headers.Allow, 'POST');
  const large = response();
  await handler({ method: 'POST', async *[Symbol.asyncIterator]() { yield Buffer.alloc(65537); } }, large);
  assert.equal(large.statusCode, 413);
});
