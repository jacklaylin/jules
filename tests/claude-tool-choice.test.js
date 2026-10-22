import test from 'node:test';
import assert from 'node:assert/strict';
import { generateReply } from '../lib/ai.js';
import { agentTurn, tool, isAgentRequest } from './helpers/agent.js';

const turn = [{ id: '00000000-0000-4000-8000-000000000001', direction: 'inbound', status: 'received', created_at: '2026-10-21T12:00:00Z', body: 'hey, what can you do?' }];
const text = words => ({ ok: true, json: async () => ({ status: 'completed', output: [{ type: 'reasoning', id: 'r1', summary: [] }, { type: 'message', content: [{ type: 'output_text', text: words }] }] }) });
const other = { ok: true, json: async () => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{}' }] }] }) };

test('Claude cannot be forced to call a tool: it is asked with auto and a plain answer is its conversation reply', async () => {
  const choices = [];
  const reply = await generateReply(turn, { OPENAI_API_KEY: 'test', MODEL_CHAT: 'openrouter:anthropic/claude-sonnet-5.5' }, async (_url, options) => {
    if (!isAgentRequest(options)) return other;
    const body = JSON.parse(options.body);
    choices.push(body.tool_choice);
    assert.equal(body.max_output_tokens, 6000, 'room for its mandatory reasoning');
    return text('i find, compare and save clothes for you. what are you looking for?');
  });
  assert.deepEqual([...new Set(choices)], ['auto']);
  assert.match(reply, /what are you looking for/);
});

test('OpenAI models are still required to call a tool', async () => {
  const choices = [];
  await generateReply(turn, { OPENAI_API_KEY: 'test', MODEL_CHAT: 'gpt-4.1-mini' }, async (_url, options) => {
    if (!isAgentRequest(options)) return other;
    choices.push(JSON.parse(options.body).tool_choice);
    return agentTurn(tool('conversation_reply', { response: 'i find and save clothes for you.' }));
  });
  assert.equal(choices[0], 'required');
});
