import test from 'node:test';
import assert from 'node:assert/strict';
import { modelFor, reasoningFor, isReasoningModel, routeRequest, assertPrivateDataAllowed, OPENAI_RESPONSES, OPENROUTER_RESPONSES } from '../lib/models.js';
import { receiptModel } from '../lib/receipt-extraction.js';
import { reportWriter } from '../lib/style-report.js';

test('each role keeps today\'s model unless its override or an older variable says otherwise', () => {
  assert.deepEqual(['chat', 'extract', 'search', 'write'].map(r => modelFor(r, {})), ['gpt-4.1-mini', 'gpt-4.1-mini', 'gpt-4.1', 'gpt-5.5']);
  const legacy = { OPENAI_MODEL: 'gpt-4.1-nano', OPENAI_SEARCH_MODEL: 'gpt-5.5', STYLE_REPORT_MODEL: 'gpt-5.4-mini' };
  assert.deepEqual(['chat', 'extract', 'search', 'write'].map(r => modelFor(r, legacy)), ['gpt-4.1-nano', 'gpt-4.1-nano', 'gpt-5.5', 'gpt-5.4-mini']);
  assert.equal(modelFor('chat', { ...legacy, OPENAI_CHAT_MODEL: 'gpt-5-mini' }), 'gpt-5-mini');
  const roles = { ...legacy, MODEL_CHAT: 'gpt-6-luna', MODEL_EXTRACT: 'gpt-5-nano', MODEL_SEARCH: 'gpt-5.6-luna', MODEL_WRITE: 'gpt-5' };
  assert.deepEqual(['chat', 'extract', 'search', 'write'].map(r => modelFor(r, roles)), ['gpt-6-luna', 'gpt-5-nano', 'gpt-5.6-luna', 'gpt-5']);
  assert.throws(() => modelFor('vibes', {}));
});

test('reasoning effort applies only to reasoning models and can be set per role', () => {
  assert.equal(isReasoningModel('gpt-4.1-mini'), false);
  assert.equal(isReasoningModel('openrouter:anthropic/claude-haiku-5.5'), false);
  for (const m of ['gpt-5-nano', 'gpt-5.6-luna', 'gpt-6-luna', 'o4-mini']) assert.equal(isReasoningModel(m), true, m);
  assert.deepEqual(reasoningFor('chat', 'gpt-4.1-mini', {}), {});
  assert.deepEqual(reasoningFor('chat', 'gpt-5-nano', {}), { reasoning: { effort: 'low' } });
  assert.deepEqual(reasoningFor('chat', 'gpt-5-nano', { MODEL_CHAT_REASONING: 'minimal' }), { reasoning: { effort: 'minimal' } });
});

test('an openrouter: model goes to OpenRouter with its own key, never the OpenAI key', () => {
  const init = { method: 'POST', headers: { Authorization: 'Bearer openai-secret' }, body: JSON.stringify({ model: 'openrouter:deepseek/deepseek-v4.1-flash@fireworks', input: 'hi' }) };
  const routed = routeRequest(OPENAI_RESPONSES, init, { OPENROUTER_API_KEY: 'or-key' });
  assert.equal(routed.url, OPENROUTER_RESPONSES);
  assert.equal(routed.init.headers.Authorization, 'Bearer or-key');
  assert.doesNotMatch(JSON.stringify(routed.init), /openai-secret/);
  assert.deepEqual(JSON.parse(routed.init.body), { model: 'deepseek/deepseek-v4.1-flash', input: 'hi', provider: { data_collection: 'deny', only: ['fireworks'], allow_fallbacks: false } });
  const plain = { body: JSON.stringify({ model: 'gpt-4.1-mini' }) };
  assert.equal(routeRequest(OPENAI_RESPONSES, plain, {}).init, plain);
  assert.throws(() => routeRequest(OPENAI_RESPONSES, init, {}), /OPENROUTER_API_KEY is not set/);
});

test('receipts never go to DeepSeek or an unpinned or non-US provider', async () => {
  assert.doesNotThrow(() => assertPrivateDataAllowed('gpt-4.1-mini'));
  assert.doesNotThrow(() => assertPrivateDataAllowed('openrouter:anthropic/claude-haiku-5.5@anthropic'));
  assert.throws(() => assertPrivateDataAllowed('openrouter:anthropic/claude-haiku-5.5'));
  assert.throws(() => assertPrivateDataAllowed('openrouter:deepseek/deepseek-v4.1-flash@fireworks'));
  await assert.rejects(receiptModel({ schema: {}, instructions: 'i', context: {} }, { OPENAI_API_KEY: 'k', MODEL_EXTRACT: 'openrouter:deepseek/deepseek-v4.1-flash@together' }, () => assert.fail('must not send')), /not allowed to read personal data/);
});

test('the style report writes with the write role even when the extract role is overridden', async () => {
  const sent = [];
  const fetcher = async (url, init) => { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ status: 'completed', output: [{ content: [{ type: 'output_text', text: '{}' }] }] })); };
  await reportWriter({ OPENAI_API_KEY: 'k', MODEL_EXTRACT: 'gpt-5-nano' }, fetcher)({ schema: {}, instructions: 'i', context: {} });
  await reportWriter({ OPENAI_API_KEY: 'k', MODEL_WRITE: 'gpt-5.6-luna' }, fetcher)({ schema: {}, instructions: 'i', context: {} });
  await receiptModel({ schema: {}, instructions: 'i', context: {} }, { OPENAI_API_KEY: 'k', MODEL_EXTRACT: 'gpt-5-nano', MODEL_EXTRACT_REASONING: 'minimal' }, fetcher);
  assert.deepEqual(sent.map(b => [b.model, b.reasoning?.effort ?? null]), [['gpt-5.5', 'low'], ['gpt-5.6-luna', 'low'], ['gpt-5-nano', 'minimal']]);
});
