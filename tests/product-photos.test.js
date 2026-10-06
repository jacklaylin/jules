import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { fetchProductPhoto, productPhotoURL } from '../lib/product-photos.js';
import { sendGreeting } from '../lib/photon.js';
import { receiveInInbox } from '../lib/inbox.js';

const photoURL = 'https://encrypted-tbn0.gstatic.com/images?q=test';
test('product photos allow only compared Google thumbnails and reject unsafe, oversized, and invalid downloads', async () => {
  for (const url of ['http://encrypted-tbn0.gstatic.com/a', 'https://encrypted-tbn0.gstatic.com.evil.test/a', 'https://user@encrypted-tbn0.gstatic.com/a', 'https://127.0.0.1/a']) {
    assert.equal(productPhotoURL(url), null);
    await assert.rejects(fetchProductPhoto(url, () => assert.fail('Unsafe URL fetched')));
  }
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: 'white' } }).png().toBuffer();
  const bytes = await fetchProductPhoto(photoURL, async (url, options) => {
    assert.equal(url, photoURL); assert.equal(options.redirect, 'error');
    return new Response(png, { headers: { 'content-type': 'image/png' } });
  });
  assert.equal((await sharp(bytes).metadata()).format, 'jpeg');
  for (const response of [new Response('not an image', { headers: { 'content-type': 'text/html' } }),
    new Response('bad bytes', { headers: { 'content-type': 'image/jpeg' } }),
    new Response(Buffer.alloc(1000001), { headers: { 'content-type': 'image/jpeg' } })]) {
    await assert.rejects(fetchProductPhoto(photoURL, async () => response));
  }
});

function transport({ failText = false } = {}) {
  const sent = [], logs = []; let stopped = false;
  const provider = () => ({ user: async () => ({}), space: { create: async () => ({ send: async input => {
    const content = typeof input === 'string' ? { type: 'text', text: input } : await input.build();
    sent.push(content);
    if (failText) throw new Error('Ambiguous send');
    return { id: `test-sent-${sent.length}`, content };
  } }) } });
  provider.config = () => ({});
  return { sent, logs, stopped: () => stopped, options: {
    provider, connect: async () => ({ stop: async () => { stopped = true; } }),
    log: value => logs.push(JSON.parse(value)),
  } };
}
const delivery = { space: { phone: 'test-line' }, message: {
  id: 'test-image', sender: { id: 'test-user' }, content: { type: 'attachment' }, attachments: [{}],
} };
test('answer threads to the original image; numbered photo label and photo follow without claiming exact identity', async () => {
  const sdk = transport();
  await sendGreeting(delivery, 'Possible jacket match\nhttps://example.com/jacket', {}, {
    ...sdk.options, replyTarget: delivery.message,
    products: [{ name: 'Test jacket', match: 'likely_match', candidate_image: photoURL }],
    loadPhoto: async () => Buffer.from('test-photo'),
  });
  assert.equal(sdk.sent[0].type, 'reply'); assert.equal(sdk.sent[0].target.id, 'test-image');
  assert.match(sdk.sent[1].content.text, /Product photo 1: Test jacket\. Possible match/);
  assert.equal(sdk.sent[1].target.id, 'test-sent-1');
  assert.equal(sdk.sent[2].content.type, 'attachment'); assert.equal(sdk.sent[2].target.id, 'test-sent-2');
  assert.equal(sdk.stopped(), true);
});
test('unavailable photos preserve the text reply; ambiguous text sends never retry or send photos', async () => {
  const sdk = transport();
  await sendGreeting(delivery, 'Answer', {}, { ...sdk.options, replyTarget: delivery.message,
    products: [{ candidate_image: photoURL }], loadPhoto: async () => { throw new Error('offline'); } });
  assert.equal(sdk.sent.length, 1); assert.equal(sdk.logs[0].stage, 'download');
  const failed = transport({ failText: true });
  await assert.rejects(sendGreeting(delivery, 'Answer', {}, { ...failed.options, replyTarget: delivery.message,
    products: [{ candidate_image: photoURL }], loadPhoto: async () => assert.fail() }));
  assert.equal(failed.sent.length, 1); assert.equal(failed.stopped(), true);
});
test('follow-up searches retain the original provider image ID and pass only saved visual results to delivery', async () => {
  let reserved = false, calls = 0;
  const products = [{ name: 'Test jacket', candidate_image: photoURL }];
  const store = { receive: async () => 'test-conversation', claimAI: async () => { if (reserved) return false; reserved = true; return true; },
    context: async () => [{ id: 'test-db-image', provider_id: 'test-original-image', direction: 'inbound', message_images: [{}] }],
    imagesForMessage: async id => { assert.equal(id, 'test-db-image'); return [{}]; }, searchResult: async () => {},
    prepareAI: async () => {}, finish: async () => {} };
  const options = { store, progress: async () => async () => {}, generate: async (context, env, fetcher, memory) => {
    await memory.loadImages(); await memory.recordSearch({ identification_policy: 'visual_comparison', products }); return 'Answer';
  }, send: async (received, body, env, rich) => {
    calls++; assert.equal(rich.replyTarget.id, 'test-original-image'); assert.deepEqual(rich.products, products);
  } };
  const followup = { ...delivery, message: { ...delivery.message, id: 'test-followup', attachments: [] } };
  await receiveInInbox(followup, { AI_ENABLED: 'true' }, options);
  await receiveInInbox(followup, { AI_ENABLED: 'true' }, options);
  assert.equal(calls, 1);
});
