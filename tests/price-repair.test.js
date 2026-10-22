import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repairPrices, checkComposed } from '../lib/compose.js';

// SPEED.md change 3 (October 22): a verified price the model left out goes back beside its own product's
// link, copied from the draft, so it no longer costs a rewrite round or ends in the plain draft.
const draft = ['i looked in a few directions: workwear, minimal.', 'a few options to start with.',
  '1. Taylor Stitch Maritime Shirt Jacket — navy · $198 (on sale, was $248) · size M in stock\nhttps://taylorstitch.com/p/maritime',
  '2. Portuguese Flannel Teca Overshirt · $185\nhttps://portugueseflannel.com/p/teca',
  'i left out one over your $300 budget.', 'which feel closest?'].join('\n\n');

test('a left-out price goes on its own line above its product link, unchanged', () => {
  const reply = 'two heavier navy picks for fall:\n\nthe taylor stitch maritime is a stiff canvas, the closest to a jacket\nhttps://taylorstitch.com/p/maritime\n\nthe teca is a softer flannel, $185\nhttps://portugueseflannel.com/p/teca\n\nwhich feel closest? (i left out one over your $300 budget.)';
  const fixed = repairPrices(reply, { draft });
  assert.match(fixed, /closest to a jacket\n\$198 \(on sale, was \$248\)\nhttps:\/\/taylorstitch\.com\/p\/maritime/);
  assert.equal(fixed.match(/\$185/g).length, 1, 'a price the message already gives is not repeated');
  assert.deepEqual(checkComposed({ reply: fixed, claims: {} }, { draft }), []);
  assert.ok(checkComposed({ reply, claims: {} }, { draft }).some(p => /Include the prices/.test(p)));
});

test('prices are never placed for a link the message left out, or outside a product block', () => {
  const reply = 'one pick for you:\nhttps://portugueseflannel.com/p/teca';
  const fixed = repairPrices(reply, { draft });
  assert.equal(fixed, 'one pick for you:\n$185\nhttps://portugueseflannel.com/p/teca');
  assert.doesNotMatch(fixed, /\$198|\$300/);
  assert.equal(repairPrices('all set, no links here.', { draft }), 'all set, no links here.');
  assert.equal(repairPrices('', { draft }), '');
});

test('a message that already gives every price is left exactly as written', () => {
  const reply = 'maritime, $198 (was $248)\nhttps://taylorstitch.com/p/maritime\nteca, $185\nhttps://portugueseflannel.com/p/teca\nover $300 left out.';
  assert.equal(repairPrices(reply, { draft }), reply);
});
