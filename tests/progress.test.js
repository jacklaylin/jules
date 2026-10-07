import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beginProgress, progressEmoji } from '../lib/photon.js';
import { receiveInInbox } from '../lib/inbox.js';

test('reactions acknowledge identification, recommendations, and uncaptained images', () => {
  const message = (text, attachments = []) => ({ content: { text }, attachments });
  assert.equal(progressEmoji(message('Find the jacket in this image')), '🔎');
  assert.equal(progressEmoji(message('What is this jacket?')), '🔎');
  assert.equal(progressEmoji(message('Can you recommend shoes?')), '💭');
  assert.equal(progressEmoji(message('What should I wear?')), '💭');
  assert.equal(progressEmoji(message('[Image]', [{}])), '👀');
  assert.equal(progressEmoji(message('Thanks')), null);
  assert.equal(progressEmoji(message('I really want the Prada Speedrock sneakers.')), '👀');
  assert.equal(progressEmoji(message('I want the ASICS GEL-KAYANO 14')), '👀');
});

test('typing and reactions use the incoming line and message; failures allow cleanup', async () => {
  const calls = [];
  const conversation = { startTyping: async () => calls.push('start'), stopTyping: async () => calls.push('stop'),
    send: async builder => { const content = await builder.build(); assert.equal(content.target.id, 'test-message');
      assert.equal(content.emoji, '🔎'); calls.push('reaction'); throw new Error('private failure'); } };
  const provider = () => ({ user: async id => id, space: { create: async (id, params) => {
    assert.equal(id, 'test-user'); assert.equal(params.phone, 'test-line'); return conversation;
  } } });
  provider.config = () => ({});
  const stop = await beginProgress({ space: { phone: 'test-line' }, message: {
    id: 'test-message', sender: { id: 'test-user' }, content: { type: 'text', text: 'Find this' },
  } }, { SPECTRUM_PROJECT_ID: 'test-project', SPECTRUM_PROJECT_SECRET: 'test-secret' }, {
    provider, connect: async () => ({ stop: async () => calls.push('disconnect') }), log: () => {},
  });
  await stop();
  assert.deepEqual(calls, ['start', 'reaction', 'stop', 'disconnect']);
});

test('durable duplicates do not react twice and cleanup runs when preparing a reply fails', async () => {
  let claimed = false, starts = 0, stops = 0;
  const options = { store: { receive: async () => 'test-conversation', claimAI: async () => {
    if (claimed) return false; claimed = true; return true;
  }, context: async () => [], prepareAI: async () => { throw new Error('offline'); } },
  generate: async () => 'Reply', progress: async () => { starts++; return async () => { stops++; }; } };
  const delivery = { message: { id: 'test-message', content: { text: 'Find this' } } };
  await assert.rejects(receiveInInbox(delivery, { AI_ENABLED: 'true' }, options));
  assert.equal(await receiveInInbox(delivery, { AI_ENABLED: 'true' }, options), 'imessage_ai_duplicate');
  assert.equal(starts, 1); assert.equal(stops, 1);
});
