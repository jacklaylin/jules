import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchPlan } from '../lib/text-wishlist.js';

// The model says what a search is for (search_goal) and which item it is about (reference_item); code
// derives the mode and the reference brand's role (CHAT-SKILLS.md PR 3, the "cheaper" fix). These tests
// assert the plan the search runs, never wording.
const price = { stance:null, price_quote:null, min:null, max:null, currency:null, budget_key:null };
const plan = extra => ({ continuation:'new_request', named_model:null, brands:[], level:null, occasion:null, hard_constraints:[], guidance:[], keep_option_indices:[], exclude_option_indices:[], price, reference_item:null, stay_within_brand:null, ...extra });
const options = [{ brand:'Dries Van Noten', name:'Peyter Pants', url:'https://dsm.example/peyter' }];
const saved = [{ id:'saved-1', brand:'Lemaire', name:'Twisted Coat' }];
const pending = i => ({ source:'pending_option', option_index:i, saved_item_id:null, brand:null });

test('the same item for less keeps that item: its brand required, its name searched, results leaning cheaper', () => {
  const p = searchPlan(plan({ search_goal:'same_item_for_less', reference_item:pending(0) }), { options });
  assert.equal(p.mode, 'identify'); assert.deepEqual(p.required_brands, ['Dries Van Noten']); assert.deepEqual(p.reference_brands, []);
  assert.equal(p.named_model, 'Peyter Pants'); assert.equal(p.price.stance, 'prefers_lower'); assert.equal(p.price.max, null);
  // Even when the model listed the brand as only a reference, it is the same product.
  const listed = searchPlan(plan({ search_goal:'same_item_for_less', named_model:'Peyter', brands:[{ name:'dries van noten', role:'reference' }], reference_item:pending(0) }), { options });
  assert.deepEqual(listed.required_brands, ['dries van noten']); assert.equal(listed.named_model, 'Peyter');
  // A saved item, and an item known only by what the user said.
  assert.deepEqual(searchPlan(plan({ search_goal:'same_item_for_less', reference_item:{ source:'saved_item', option_index:null, saved_item_id:'saved-1', brand:null } }), { saved }).required_brands, ['Lemaire']);
  assert.deepEqual(searchPlan(plan({ search_goal:'same_item_for_less', named_model:'Rodeo', reference_item:{ source:'named', option_index:null, saved_item_id:null, brand:'Balenciaga' } })).required_brands, ['Balenciaga']);
});

test('an item used as a reference keeps its brand as the look to match, unless the user stays within it', () => {
  const like = searchPlan(plan({ search_goal:'like_this', named_model:'Peyter', brands:[{ name:'Dries Van Noten', role:'required' }], reference_item:pending(0), stay_within_brand:false }), { options });
  assert.equal(like.mode, 'discover'); assert.equal(like.alternatives, true); assert.equal(like.named_model, null);
  assert.deepEqual(like.required_brands, []); assert.deepEqual(like.reference_brands, ['Dries Van Noten']); assert.ok(like.guidance.some(g => g.includes('Peyter')));
  const within = searchPlan(plan({ search_goal:'like_this', reference_item:{ source:'link', option_index:null, saved_item_id:null, brand:'Our Legacy' }, stay_within_brand:true }));
  assert.deepEqual(within.required_brands, ['Our Legacy']);
  // A brand the user said to forget stays dropped; another brand they asked for keeps its role.
  const dropped = searchPlan(plan({ search_goal:'like_this', brands:[{ name:'Our Legacy', role:'dropped' }, { name:'COS', role:'required' }], reference_item:{ source:'named', option_index:null, saved_item_id:null, brand:'Our Legacy' }, stay_within_brand:false }));
  assert.deepEqual(dropped.dropped_brands, ['Our Legacy']); assert.deepEqual(dropped.required_brands, ['COS']); assert.deepEqual(dropped.reference_brands, []);
});

test('a reference that is not in what the user was shown or saved adds nothing; explore and exact items keep the model\'s roles', () => {
  const missing = searchPlan(plan({ search_goal:'same_item_for_less', reference_item:pending(5) }), { options });
  assert.deepEqual(missing.required_brands, []); assert.equal(missing.named_model, null);
  const exact = searchPlan(plan({ search_goal:'exact_item', named_model:'Romi', brands:[{ name:'Jacques Marie Mage', role:'required' }] }));
  assert.equal(exact.mode, 'identify'); assert.deepEqual(exact.required_brands, ['Jacques Marie Mage']); assert.equal(exact.price.stance, null);
  const explore = searchPlan(plan({ search_goal:'explore', brands:[{ name:'Auralee', role:'reference' }], reference_item:pending(0) }), { options });
  assert.equal(explore.mode, 'discover'); assert.deepEqual(explore.reference_brands, ['Auralee']); assert.deepEqual(explore.required_brands, []);
  // A stored plan without a goal keeps its mode.
  assert.equal(searchPlan({ ...plan({}), mode:'identify' }).mode, 'identify');
});
