import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beginProgress, progressEmoji } from '../lib/photon.js';
import { receiveInInbox } from '../lib/inbox.js';

test('reactions follow structured intent rather than message phrases', () => {
  assert.equal(progressEmoji({action:'search'}), '🔎');
  assert.equal(progressEmoji({action:'start'}), '👀');
  for (const decision of ['interest','confirm']) assert.equal(progressEmoji({action:'selection',decision}), '👍');
  for (const decision of ['decline','clarify']) assert.equal(progressEmoji({action:'selection',decision}), null);
  assert.equal(progressEmoji({action:'conversation'}), null);
  assert.equal(progressEmoji({content:{text:'Find this outfit I love'}}), null);
});

test('read receipt, typing and reactions use the incoming line and message; failures allow cleanup', async () => {
  const calls = [];
  const conversation = { startTyping: async () => calls.push('start'), stopTyping: async () => calls.push('stop'),
    send: async builder => { const content = await builder.build(); assert.equal(content.target.id, 'test-message');
      if (content.type === 'read') { calls.push('read'); throw new Error('private failure'); }
      assert.equal(content.emoji, '🔎'); calls.push('reaction'); throw new Error('private failure'); } };
  const provider = () => ({ user: async id => id, space: { create: async (id, params) => {
    assert.equal(id, 'test-user'); assert.equal(params.phone, 'test-line'); return conversation;
  } } });
  provider.config = () => ({});
  const stop = await beginProgress({ space: { phone: 'test-line' }, message: {
    id: 'test-message', direction: 'inbound', sender: { id: 'test-user' }, content: { type: 'text', text: 'Find this' },
  } }, { SPECTRUM_PROJECT_ID: 'test-project', SPECTRUM_PROJECT_SECRET: 'test-secret' }, {
    provider, connect: async () => ({ stop: async () => calls.push('disconnect') }), log: () => {},
  });
  await stop.react({action:'search'});
  await stop.react({action:'search'});
  await stop();
  assert.deepEqual(calls, ['read', 'start', 'reaction', 'stop', 'disconnect']);
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

// SPEED.md change 2 (October 22): the read receipt and typing dots start alongside the context read, not before it.
test('a slow typing start does not hold the context read, and the turn still stops it', async () => {
  const order = []; let release, stops = 0;
  const ready = new Promise(resolve => { release = resolve; });
  const store = { receive: async () => 'test-conversation', claimAI: async () => true,
    context: async () => { order.push('context'); release(); return []; },
    prepareAI: async () => {}, finish: async () => {} };
  const progress = async () => { await ready; order.push('typing'); return async () => { stops++; }; };
  const delivery = { space: { phone: 'test-line' }, message: { id: 'test-message', sender: { id: 'test-user' }, content: { text: 'hi' } } };
  await receiveInInbox(delivery, { AI_ENABLED: 'true' }, { store, progress, generate: async () => 'Hello.', send: async () => ({}) });
  assert.deepEqual(order, ['context', 'typing']);
  assert.equal(stops, 1);
});

test('typing that starts after its time limit is stopped instead of left running', async () => {
  let stops = 0, late;
  const started = new Promise(resolve => { late = resolve; });
  const store = { receive: async () => 'test-conversation', claimAI: async () => true, context: async () => [],
    prepareAI: async () => {}, finish: async () => {} };
  const delivery = { space: { phone: 'test-line' }, message: { id: 'test-message', sender: { id: 'test-user' }, content: { text: 'hi' } } };
  const outcome = await receiveInInbox(delivery, { AI_ENABLED: 'true' }, { store, progressTimeoutMs: 5,
    progress: () => started, generate: async () => 'Hello.', send: async () => ({}) });
  assert.equal(outcome, 'imessage_ai_reply_sent');
  late(async () => { stops++; }); await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(stops, 1);
});
