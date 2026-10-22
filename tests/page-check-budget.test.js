import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderBudget,PAGE_RENDER_MS} from '../lib/search.js';
import {DIRECTIONS_CAP,DIRECTIONS_MINIMUM} from '../lib/text-wishlist.js';

// SPEED.md change 1: one slow store page no longer holds a whole search. A rendered page check gets at
// most PAGE_RENDER_MS, and less when the search's own deadline is closer.
test('a page render gets its own limit, never past the search deadline',()=>{
  const now=1_000_000;
  assert.equal(renderBudget(now+60000,now),PAGE_RENDER_MS);
  assert.equal(renderBudget(now+5000,now),5000);
  assert.equal(renderBudget(now-10,now),1);
  assert.ok(PAGE_RENDER_MS<=15000);
});

test('discovery directions stop at 25 seconds, and the stylist still needs room for them',()=>{
  assert.equal(DIRECTIONS_CAP,25000);
  assert.ok(DIRECTIONS_MINIMUM>=DIRECTIONS_CAP);
});
