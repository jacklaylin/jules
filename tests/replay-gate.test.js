import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gateReport } from '../lib/replay-gate.js';
import { AGENT_EVAL_CASES } from '../lib/agent-eval.js';
import { REPLAY_CASES, scoreReplay } from '../lib/replay.js';

test('the gate fails when any category is below the threshold and lists flaky cases', () => {
  const results = [
    ...Array.from({ length: 5 }, (_, i) => ({ id: 'a', category: 'agent:save', passed: i < 4, failures: i < 4 ? [] : ['tool: expected save_to_wishlist, got find_products'] })),
    ...Array.from({ length: 5 }, () => ({ id: 'b', category: 'agent:alerts', passed: true, failures: [] })),
  ];
  const ok = gateReport(results, { threshold: 0.8 });
  assert.equal(ok.passed, true);
  assert.deepEqual(ok.categories.map(c => [c.category, c.pass_rate]), [['agent:save', 0.8], ['agent:alerts', 1]]);
  assert.deepEqual(ok.cases[0], { id: 'a', category: 'agent:save', runs: 5, pass_rate: 0.8, failures: ['tool: expected save_to_wishlist, got find_products'] });
  assert.equal(gateReport(results, { threshold: 0.9 }).passed, false);
});

test('report cases cover the latest multi-turn flows and grade outcomes rather than wording', () => {
  const ids = new Set([...AGENT_EVAL_CASES, ...REPLAY_CASES].map(c => c.id));
  for (const id of ['receipt-me-for-both', 'receipt-both-mine', 'cheaper-and-alert', 'cheaper-and-alert-reworded', 'save-after-unverified', 'save-after-unverified-pair', 'named-first-try-peyter', 'save-right-after-unverified'])
    assert.ok(ids.has(id), id);
  for (const c of AGENT_EVAL_CASES.filter(c => c.category === 'reports')) {
    assert.ok(c.messages.length >= 2, `${c.id} is multi-turn`);
    assert.ok(c.expect.tool, `${c.id} asserts the intended action`);
  }
});

test('a named model with no verified link on the first reply fails the first-try case', () => {
  const peyter = REPLAY_CASES.find(c => c.id === 'named-first-try-peyter');
  assert.deepEqual(scoreReplay(peyter, { body: 'Which colour of the Peyter did you have in mind?', result: { products: [] } }).failures, ['not_found_first_try']);
  const url = 'https://www.driesvannoten.com/products/peyter-trousers-black';
  const found = scoreReplay(peyter, { body: `Found it.\n${url}`, result: { products: [{ url, brand: 'Dries Van Noten', name: 'Peyter trousers', listing_check: { status: 'verified', shopping_range: 'men' } }] } });
  assert.equal(found.passed, true, found.failures.join());
});

import { spendTracker } from '../lib/replay-gate.js';
test('the spend tracker totals priced calls, flags unpriced models and reports the cap', () => {
  const t = spendTracker(1);
  t.add([{ provider: 'openai', model: 'gpt-4.1-mini', cost_usd: 0.6, input_tokens: 10, output_tokens: 1 }, { provider: 'serpapi', cost_usd: 0.015 }]);
  assert.equal(t.capped, false);
  t.add([{ provider: 'openai', model: 'gpt-7-nova', cost_usd: 0, input_tokens: 10, output_tokens: 1 }, { provider: 'openai', model: 'gpt-4.1', cost_usd: 0.4, input_tokens: 10, output_tokens: 1 }]);
  assert.equal(t.capped, true);
  assert.deepEqual([t.openai_calls, t.searches, [...t.unpriced]], [3, 1, ['gpt-7-nova']]);
});
