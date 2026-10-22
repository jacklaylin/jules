import test from 'node:test';
import assert from 'node:assert/strict';
import { captureContext, replayFacts, snapshotStore } from '../lib/context-snapshot.js';
import { CLOSET_VERSION } from '../lib/closet-summary.js';
import { wishlistTagFingerprint } from '../lib/wishlist-tag-key.js';
import { brandTasteOf } from '../lib/brand-taste.js';
import { freezeReport, runFrozenCase } from '../lib/frozen-evals.js';
import { simulateTurn } from '../lib/chat-simulator.js';
import { agentTurn, tool, isAgentRequest } from './helpers/agent.js';

// Snapshots and replays use stub stores and stub models only: nothing here calls a paid model.
const at = minute => `2026-10-21T20:${String(minute).padStart(2, '0')}:00.000Z`;
const turn = at(30);
const fact = (field, key, value, updated) => ({ field, key, value, basis: 'stated', updated_at: updated, deleted: false });
const tote = { item_id: 'w1', url: 'https://shop.example/tote', brand: 'Lemaire', name: 'Croissant bag', description: 'Leather crossbody', messages: { created_at: at(10) } };
tote.tag = { group: 'bags', fp: wishlistTagFingerprint(tote) };
const later = { item_id: 'w2', url: 'https://shop.example/later', brand: 'Prada', name: 'Loafers', messages: { created_at: at(40) } };
const closet = { v: CLOSET_VERSION, about: 'owned', items: 3, photos_read: 0, groups: [{ group: 'trousers', items: 3 }], owned: [{ brand: 'Auralee', name: 'Wide trousers' }],
  brands: [{ brand: 'Auralee', items: 3, recent: 2, groups: { trousers: 3 } }] };
const purchases = { v: 1, items: 4, top_brands: [{ name: 'Auralee', count: 3, recent: 2 }], top_merchants: [{ name: 'SSENSE', count: 4 }], latest_items: [] };
const liked = (id, brand, when) => ({ id: `liked:likes:${id}:0`, kind: 'photo_observation', origin: 'chat', source: { id: `likes:${id}` }, data: { signal: 'liked', brand, title: 'Knit', category: 'cardigan', colors: [], details: [], status: 'sold', platform: 'Depop', from: 'screenshot', at: when } });
const ownerStore = () => ({
  wishlistEntries: async () => [tote, later],
  purchaseHistory: async () => ({ items: 4, summary: purchases, detail: async () => [] }),
  gmailImport: async () => ({ data: { closet_summary: closet } }),
  evidence: async () => [liked('m1', 'Our Legacy', at(20)), liked('m2', 'Toteme', at(45)), { id: 'receipt:1', data: { brand: 'Nope' } }],
});

test('a snapshot keeps the layer as of the turn: saves and likes before it, the purchase summary and closet without the per-piece list', async () => {
  const s = await captureContext(ownerStore(), 'owner', { before: turn });
  assert.deepEqual(s.wishlist.map(w => w.brand), ['Lemaire']);
  assert.equal(s.wishlist[0].tag.group, 'bags');
  assert.deepEqual(s.liked.map(l => l.brand), ['Our Legacy']);
  assert.equal(s.purchases.items, 4);
  assert.equal(s.closet.brands[0].brand, 'Auralee');
  assert.equal(s.closet.owned, undefined, 'the per-piece list is for ranking only');
  assert.equal(s.closet.v, undefined);
  // A failing source is empty, not a failed freeze.
  const broken = await captureContext({ wishlistEntries: async () => { throw Error('x'); }, purchaseHistory: async () => { throw Error('x'); }, gmailImport: async () => { throw Error('x'); }, evidence: async () => { throw Error('x'); } }, 'o', { before: turn });
  assert.deepEqual(broken, { wishlist: [], purchases: null, closet: null, liked: [] });
});

test('a replay rebuilds the derived facts and brand_taste through readUserContext', async () => {
  const stated = [fact('brand', 'Prada', 'favorite', at(1)), fact('size', 'clothing/tops', 'M', at(1))];
  const facts = await replayFacts(stated, await captureContext(ownerStore(), 'owner', { before: turn }));
  const fields = facts.map(f => f.field);
  for (const field of ['size', 'shopping_history', 'wardrobe', 'liked_items', 'wishlist', 'brand_taste']) assert.ok(fields.includes(field), field);
  const taste = brandTasteOf(facts);
  const by = name => taste.find(b => b.brand === name);
  assert.equal(by('Lemaire').wishlisted, 1);
  assert.deepEqual(by('Lemaire').wishlisted_as, { bags: 1 }, 'the wishlist tag still matches its item after the snapshot');
  assert.equal(by('Our Legacy').liked, 1);
  assert.equal(by('Auralee').bought, 3, 'the closet gives kept purchases');
  assert.deepEqual(by('Auralee').bought_as, { trousers: 3 });
  assert.equal(by('Prada').said.on, '2026-10-21', 'a statement keeps its date');
  assert.equal(by('Toteme'), undefined, 'liked after the turn');
  // As in prod, the purchase summary leaves its top brands to brand_taste.
  assert.equal(JSON.parse(facts.find(f => f.field === 'shopping_history').value).top_brands, undefined);
});

test('a case frozen before snapshots still replays: its stated brands become the brand reading, nothing else is invented', async () => {
  const facts = await replayFacts([fact('brand', 'Prada', 'favorite', undefined), fact('size', 'shoes', '42', undefined)], null);
  assert.deepEqual(facts.map(f => f.field).sort(), ['brand', 'brand_taste', 'size']);
  assert.equal(brandTasteOf(facts)[0].brand, 'Prada');
  assert.deepEqual(await replayFacts([], undefined), []);
  // The snapshot store never writes.
  const store = snapshotStore([], {});
  assert.equal(await store.recordEvidence(), undefined);
  assert.equal(await store.gmailImport(), null);
});

const report = { id: 'bbbbbbbb-1111-4000-8000-000000000002', kind: 'developer_feedback', conversation_id: 'conv-2', created_at: at(37), reply_provider_id: 'out-1', developer_feedback: 'these are not my style, email me at a@b.co' };
const history = [
  { id: 'm1', provider_id: 'in-1', direction: 'inbound', status: 'received', created_at: turn, body: 'find me a cardigan' },
  { id: 'm2', provider_id: 'out-1', operation_id: 'ai:in-1', direction: 'outbound', status: 'sent', source: 'ai', created_at: at(31), body: 'here are some cardigans' },
];
const freezeStore = () => ({ ...ownerStore(),
  feedbackContext: async (c, time, before, after) => [...history.filter(m => m.created_at <= time).slice(-(before + 1)), ...history.filter(m => m.created_at > time).slice(0, after)],
  context: async () => history.slice(0, 1),
  textWishlistState: async () => null, priceAlerts: async () => [],
  profile: async () => ({ facts: [fact('brand', 'Prada', 'favorite', at(1)), { ...fact('size', 'clothing/tops', 'L', at(35)) }] }),
});

test('a frozen case carries the snapshot, scrubbed, and its replay hands the agent the derived facts', async () => {
  const frozen = await freezeReport(freezeStore(), report, {}, { classify: async () => 'wrong_results' });
  assert.deepEqual(frozen.context.wishlist.map(w => w.name), ['Croissant bag']);
  assert.deepEqual(frozen.context.liked.map(l => l.brand), ['Our Legacy']);
  assert.ok(!JSON.stringify(frozen).includes('a@b.co'));
  assert.ok(frozen.limits.some(l => /purchase summary/.test(l)));
  let agentInput = '';
  const fetcher = async (url, options) => {
    const body = JSON.parse(options.body);
    if (isAgentRequest(options)) { agentInput ||= JSON.stringify(body.input); return agentTurn(tool('conversation_reply', { response: 'want me to look for something closer to Lemaire?' })); }
    if (body.text?.format?.name === 'frozen_judge') return { ok: true, json: async () => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ report_about: 'jules_reply',
      did_what_asked: { verdict: 'pass', reason: 'ok' }, coherent: { verdict: 'pass', reason: 'ok' }, no_repeated_questions: { verdict: 'not_applicable', reason: 'none' }, meets_report: { verdict: 'pass', reason: 'ok' } }) }] }] }) };
    return { ok: true, json: async () => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ body: 'composed', captions: [], verdict: 'fine', kind: null, about: null, summary: null, newest_message: 'other', changes: [] }) }] }] }) };
  };
  const result = await runFrozenCase(frozen, { OPENAI_API_KEY: 'test' }, { fetcher, model: 'stub-chat' });
  assert.equal(result.error ?? null, null);
  // Brands only the derived sources know reach the agent: a liked item, a wishlist save, the closet.
  for (const brand of ['Our Legacy', 'Lemaire', 'Auralee']) assert.ok(agentInput.includes(brand), brand);
  assert.ok(!agentInput.includes('Toteme'), 'liked after the turn');
  assert.ok(!agentInput.includes('Loafers'), 'saved after the turn');
});

test('a connected simulator turn reads the owner\'s closet and liked items, read-only', async () => {
  let memory;
  const live = { ...ownerStore(), wishlistEntries: async () => [tote], deleteEvidence: async () => assert.fail('never deletes live evidence') };
  await simulateTurn({ text: 'find me a cardigan' }, { OPENAI_API_KEY: 'fixture', MEMORY_ENABLED: 'true', WISHLIST_ENABLED: 'true', GMAIL_IMPORT_ENABLED: 'true' },
    { wishlistStore: live, wishlistConversation: 'owner', generate: async (_m, _e, _f, mem) => { memory = mem; return 'Here are a few cardigans.'; } });
  const taste = brandTasteOf(memory.facts);
  assert.equal(taste.find(b => b.brand === 'Auralee').bought, 3);
  assert.equal(taste.find(b => b.brand === 'Our Legacy').liked, 1);
  assert.equal(taste.find(b => b.brand === 'Lemaire').wishlisted, 1);
  assert.ok(memory.facts.some(f => f.field === 'wardrobe'));
});
