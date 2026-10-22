import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boundedSearchResult, jsonbBytes, requestConstraints, compactProduct, SEARCH_RESULT_BUDGET } from '../lib/search-result-budget.js';
import { actionRecord } from '../lib/turn-actions.js';
import { generateReply } from '../lib/ai.js';
import { textWishlistAction } from '../lib/text-wishlist.js';
import { receiveInInbox } from '../lib/inbox.js';
import { agentTurn, tool, toolOutputs, isAgentRequest, isConsentCheck, consentResponse } from './helpers/agent.js';

// October 20, "find me a few casual shirts": a follow-up search's record went over the 30,000-byte
// search_result limit (the whole taste profile, closet summary included, was stored with the request,
// and every product two or three times), so the search was reported as failed ("i had a glitch").
// Meanwhile the first turn sent its results after the shopper had already added detail.

const variants = n => Array.from({ length: n }, (_, i) => String(40501800000000 + i));
const product = i => ({ url: `https://shop${i}.example/products/shirt-${i}`, name: `Shirt ${i}`, brand: `Brand ${i}`, match: 'similar', sourcing_status: 'store_found',
  price_snapshot: { amount: 88 + i, currency: 'USD' },
  listing_check: { status: 'verified', url: `https://shop${i}.example/products/shirt-${i}`, product_name: `Shirt ${i}`, product_brand: `Brand ${i}`, description: 'Soft cotton. '.repeat(60),
    product_images: Array.from({ length: 6 }, (_, k) => `https://cdn.example/${i}/${k}.jpg`), size_options: [{ size: 'M', available: true }],
    color_options: Array.from({ length: 6 }, (_, k) => ({ color: `Colour ${k}`, url: `https://shop${i}.example/products/shirt-${i}?variant=${k}`, image: `https://cdn.example/${i}/c${k}.jpg`, variant_ids: variants(30) })),
    price_snapshot: { amount: 88 + i, currency: 'USD' } } });
const taste = [{ key: 'summary', field: 'shopping_history', value: 'x'.repeat(4700) }, { key: 'summary', field: 'wardrobe', value: 'y'.repeat(2200) }];
// A continuation: one kept option and three new ones, recorded as products and as the pending state.
function continuation() {
  const kept = [product(0)], options = [product(1), product(2), product(3)];
  return { identification_policy: 'text_wishlist', intent_action: 'start', products: [...kept, ...options],
    text_wishlist_state: { stage: 'choice', query: 'casual shirts', options: [...kept, ...options], kept_options: kept,
      constraints: { range: 'men', taste, size_facts: [{ key: 'tops', value: 'M' }], allow_unknown_range: true } },
    text_wishlist_diagnostics: { status: 'shown', shown: options.map(p => ({ url: p.url })), candidates: Array.from({ length: 12 }, (_, i) => ({ url: `https://c${i}.example/p`, checks: [product(i).listing_check] })) } };
}

test('jsonb size is counted as Postgres prints it', () => {
  // SELECT octet_length('{"a": 1, "b": [1, 2], "c": "é"}'::jsonb::text) = 32
  assert.equal(jsonbBytes({ a: 1, b: [1, 2], c: 'é' }), 32);
  assert.equal(jsonbBytes({}), 2); assert.equal(jsonbBytes([]), 2); assert.equal(jsonbBytes(null), 4);
});

test('a follow-up search record that used to exceed the column limit is stored within it, keeping every option', () => {
  const full = continuation();
  assert.ok(jsonbBytes(full) > 30000, 'the incident-sized record is over the limit unbounded');
  const stored = boundedSearchResult(full);
  assert.ok(jsonbBytes(stored) <= SEARCH_RESULT_BUDGET);
  // Every option, its link, price, sizes and colours survive; only bulk the live page check used goes.
  assert.deepEqual(stored.text_wishlist_state.options.map(p => p.url), full.text_wishlist_state.options.map(p => p.url));
  assert.deepEqual(stored.products.map(p => p.price_snapshot.amount), full.products.map(p => p.price_snapshot.amount));
  for (const p of stored.text_wishlist_state.options) {
    assert.equal(p.listing_check.status, 'verified'); assert.deepEqual(p.listing_check.size_options, [{ size: 'M', available: true }]);
    assert.equal(p.listing_check.color_options.length, 6); assert.ok(p.listing_check.color_options.every(c => !('variant_ids' in c) && c.url));
  }
  // The request keeps its own constraints; taste and saved sizes are read fresh from the profile each turn.
  assert.deepEqual(stored.text_wishlist_state.constraints, { range: 'men', allow_unknown_range: true });
  assert.equal(stored.text_wishlist_state.kept_options[0].url, full.text_wishlist_state.kept_options[0].url);
});

test('a trimmed record still says how the ranker ran and what the plan required', () => {
  // October 21: a red half-zip search showed a crewneck; the stored record could not tell whether the ranker fell back.
  const full = continuation();
  full.text_wishlist_diagnostics = { ...full.text_wishlist_diagnostics, rank: { considered: 6, kept: 3, fallback: true }, hard_constraints: ['half-zip sweater', 'bright red'] };
  const stored = boundedSearchResult(full);
  assert.equal(stored.text_wishlist_diagnostics.trimmed, true);
  assert.deepEqual(stored.text_wishlist_diagnostics.rank, { considered: 6, kept: 3, fallback: true });
  assert.deepEqual(stored.text_wishlist_diagnostics.hard_constraints, ['half-zip sweater', 'bright red']);
});

test('a small record is stored as it is apart from the standard trims', () => {
  const small = { identification_policy: 'text_wishlist', products: [], text_wishlist_state: { stage: 'search_clarification', options: [], constraints: { range: 'women', taste } } };
  const stored = boundedSearchResult(small);
  assert.equal(stored.storage_trimmed, undefined);
  assert.deepEqual(stored.text_wishlist_state.constraints, { range: 'women' });
  assert.equal(boundedSearchResult(null), null);
});

test('product compaction keeps what later turns read', () => {
  const p = compactProduct({ ...product(1), listing_checks: [{ url: 'u', status: 'check_failed', html: 'x'.repeat(5000) }] });
  assert.deepEqual(p.listing_checks, [{ url: 'u', status: 'check_failed' }]);
  assert.equal(p.listing_check.product_images.length, 2); assert.equal(p.listing_check.description.length, 300);
  assert.equal(p.listing_check.product_name, 'Shirt 1');
  assert.deepEqual(requestConstraints({ range: 'men', taste, size_facts: [] }), { range: 'men' });
});

test('a pending request keeps its own constraints but uses the profile as it is now', async () => {
  let seen = null;
  const facts = [{ field: 'brand', key: 'dries van noten', value: 'favorite brand' }];
  const state = { stage: 'choice', options: [product(1)], constraints: { range: 'men', taste: [{ field: 'brand', key: 'old', value: 'stale' }] } };
  await textWishlistAction({ action: 'clarify_search', query: 'casual shirts', response: 'any colour you like best?', search_plan: { continuation: true } },
    { state, facts, env: {}, record: async () => {}, candidates: async (_q, constraints) => { seen = constraints; return []; } });
  assert.equal(seen.range, 'men');
  assert.ok(seen.taste.some(f => f.key === 'dries van noten')); assert.ok(!seen.taste.some(f => f.key === 'old'));
});

test('a failed tool records why, as fixed labels and codes', () => {
  const record = actionRecord({ name: 'find_products', args: { search_plan: { continuation: 'same_request', mode: 'discover' } } },
    { status: 'failed', failure: { error_class: 'database', database_status: 400, database_code: '23514', database_table: 'messages' } });
  assert.deepEqual(record, { tool: 'find_products', status: 'failed', error_class: 'database', database_status: 400, database_code: '23514', database_table: 'messages', continuation: 'same_request', mode: 'discover' });
  assert.deepEqual(actionRecord({ name: 'find_products', args: {} }, { status: 'done', failure: { error_class: 'x' } }), { tool: 'find_products', status: 'done' });
});

// The agent loop: a search's options are unseen until the reply is sent, so a later round may not
// react to them or refine the same request (October 20: 76 s of self-refinement while the shopper waited).
const env = { OPENAI_API_KEY: 'test', SEARCH_ENABLED: 'true' };
const shirt = product(1);
function scripted(rounds) {
  const requests = [];
  const fetcher = async (_url, options) => {
    if (isConsentCheck(options)) return consentResponse(true);
    if (!isAgentRequest(options)) throw new Error('Unexpected request');
    requests.push(JSON.parse(options.body));
    const next = rounds[requests.length - 1];
    if (!next) throw new Error('No scripted round ' + requests.length);
    const out = typeof next === 'function' ? next(options) : next;
    return Array.isArray(out) ? agentTurn(...out) : out;
  };
  return { fetcher, requests };
}
// An earlier request's options are pending, as on October 20.
function shopping(state = { stage: 'choice', query: 'jackets', options: [product(5)] }) {
  let recorded = null, searches = 0;
  const memory = { facts: [], outcome: { saved_now: false, alerts_turned_on: false, alerts_turned_off: false }, wishlistState: state,
    wishlistAction: (args, current) => textWishlistAction(args, { state: current, facts: [], env, rank: async x => x, record: async r => { recorded = r; }, stylist: async () => [],
      search: async () => { searches++; return { products: [{ ...shirt, url: shirt.url + '?n=' + searches, listing_check: { ...shirt.listing_check, url: shirt.url + '?n=' + searches } }], refinement_attempted: true }; } }),
    shoppingState: () => recorded && 'text_wishlist_state' in recorded ? recorded.text_wishlist_state : undefined,
    shoppingConfirmed: () => false };
  return { memory, get searches() { return searches; } };
}
const discover = (continuation, query = 'casual shirts') => tool('find_products', { query, search_plan: { continuation, mode: 'discover', brands: [], hard_constraints: [], guidance: [], keep_option_indices: [], exclude_option_indices: [] } });
const reply = text => tool('conversation_reply', { response: text, claims: { saved_now: false, alerts_turned_on: false, alerts_turned_off: false } });

test('the agent does not react to or re-search its own unseen results; a new request still runs', async () => {
  const shop = shopping();
  let told;
  const { fetcher } = scripted([
    [discover('new_request')],
    [tool('respond_to_options', { decision: 'clarify', option_indices: [0], described_option_indices: [], response: 'which do you like?' }), discover('same_request')],
    options => { told = toolOutputs(options); return [reply('a few options to start with. Shirt 1, $89.00\n' + shirt.url + '?n=1')]; },
  ]);
  const body = await generateReply([{ direction: 'inbound', status: 'received', body: 'find me a few casual shirts' }], env, fetcher, shop.memory);
  assert.equal(shop.searches, 1);
  assert.deepEqual(told.slice(-2).map(o => o.status), ['not_run', 'not_run']);
  assert.ok(body.includes(shirt.url + '?n=1'));
});

test('a second, different request in the same message still searches', async () => {
  const shop = shopping();
  const { fetcher } = scripted([
    [discover('new_request')],
    [discover('new_request', 'relaxed trousers')],
    [reply('two searches, $89.00 each.\n' + shirt.url + '?n=1\n' + shirt.url + '?n=2')],
  ]);
  await generateReply([{ direction: 'inbound', status: 'received', body: 'find me a shirt and also some trousers' }], env, fetcher, shop.memory);
  assert.equal(shop.searches, 2);
});

// The inbox: newest message wins.
const inboxEnv = { AI_ENABLED: 'true', OPENAI_API_KEY: 'fake-test-key' };
const delivery = id => ({ space: { phone: 'fake-line' }, message: { id, sender: { id: 'fake-person' }, content: { text: 'find me a few casual shirts' } } });
function memoryStore({ newer = () => false, older = () => false } = {}) {
  const rows = [], diagnostics = [];
  const row = op => rows.find(r => r.operation_id === op);
  return { rows, diagnostics,
    receive: async () => 'conversation',
    claimAI: async (_c, op) => { if (row(op)) return false; rows.push({ operation_id: op, status: 'generating' }); return true; },
    context: async () => [{ direction: 'inbound', body: 'find me a few casual shirts', status: 'received' }],
    reserve: async (_c, op, body, source) => { if (row(op)) return false; rows.push({ operation_id: op, body, source, status: 'sending' }); return true; },
    operation: async op => row(op) ? { conversation_id: 'conversation', ...row(op) } : null,
    prepareAI: async (op, body, source) => { Object.assign(row(op), { body, source, status: 'sending' }); },
    finish: async (op, status) => { row(op).status = status; },
    searchResult: async (op, result) => { row(op).search_result = result; },
    replyDiagnostics: async (_op, data) => { diagnostics.push(data); },
    newerTurn: async () => newer(), olderTurnRunning: async () => older(),
  };
}
const quiet = { progress: async () => async () => {}, writeFollowup: async () => null };
const tick = ms => new Promise(resolve => setTimeout(resolve, ms));

test('a turn set aside by a newer message sends nothing and says why', async () => {
  let arrived = false;
  const db = memoryStore({ newer: () => arrived }), sent = [];
  const outcome = await receiveInInbox(delivery('first'), inboxEnv, { ...quiet, store: db, supersedePollMs: 5,
    send: async (_d, body) => { sent.push(body); return { id: 's' + sent.length }; },
    generate: async () => { await tick(20); arrived = true; await tick(200); return 'a few options to start with.'; } });
  assert.equal(outcome, 'imessage_ai_superseded');
  assert.deepEqual(sent, []);
  assert.equal(db.rows.find(r => r.operation_id === 'ai:first').status, 'blocked');
  assert.equal(db.diagnostics.at(-1).outcome, 'superseded');
});

test('a reply finished just as a newer message arrived is set aside at the last check before sending', async () => {
  let arrived = false;
  const db = memoryStore({ newer: () => arrived }), sent = [];
  const outcome = await receiveInInbox(delivery('first'), inboxEnv, { ...quiet, store: db, supersedePollMs: 60000,
    send: async (_d, body) => { sent.push(body); }, generate: async () => { arrived = true; return 'a few options to start with.'; } });
  assert.equal(outcome, 'imessage_ai_superseded'); assert.deepEqual(sent, []);
});

test('without a newer message the reply is sent as usual', async () => {
  const db = memoryStore(), sent = [];
  const outcome = await receiveInInbox(delivery('only'), inboxEnv, { ...quiet, store: db, supersedePollMs: 5,
    send: async (_d, body) => { sent.push(body); }, generate: async () => { await tick(30); return 'a few options to start with.'; } });
  assert.equal(outcome, 'imessage_ai_reply_sent'); assert.deepEqual(sent, ['a few options to start with.']);
});

test('a newer turn waits for an earlier reply still being prepared, then answers', async () => {
  let checks = 0, generatedAfter = null;
  const db = memoryStore({ older: () => ++checks < 3 }), sent = [];
  const outcome = await receiveInInbox(delivery('second'), inboxEnv, { ...quiet, store: db, pause: async () => {},
    send: async (_d, body) => { sent.push(body); }, generate: async () => { generatedAfter = checks; return 'here is what i found.'; } });
  assert.equal(outcome, 'imessage_ai_reply_sent'); assert.equal(generatedAfter, 3);
});

test('a failed search-state write never loses the results shown in the reply', async () => {
  const db = memoryStore(), sent = [];
  db.searchResult = async () => { throw Object.assign(new Error('Database request failed'), { database_status: 400, database_code: '23514', database_table: 'messages' }); };
  db.textWishlistState = async () => null;
  const outcome = await receiveInInbox(delivery('one'), { ...inboxEnv, WISHLIST_ENABLED: 'true', SEARCH_ENABLED: 'true' }, { ...quiet, store: db,
    send: async (_d, body) => { sent.push(body); },
    generate: async (_m, _e, _f, memory) => memory.wishlistAction({ action: 'clarify_search', query: 'casual shirts', response: 'any colour preference?', search_plan: null }) });
  assert.equal(outcome, 'imessage_ai_reply_sent');
  assert.deepEqual(sent, ['any colour preference?']);
  assert.deepEqual(db.diagnostics.at(-1).state_write_failures, [{ error_class: 'database', error_name: 'Error', database_status: 400, database_code: '23514', database_table: 'messages', step: 'search_result' }]);
});
