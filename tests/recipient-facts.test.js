import { test } from 'node:test';
import assert from 'node:assert/strict';
import { updateProfile, mergeFacts, ownFacts, tasteSummary } from '../lib/memory.js';
import { shoppingConstraints } from '../lib/relevance.js';
import { marketEnvironment } from '../lib/shopping-market.js';
import { generateReply } from '../lib/ai.js';
import { agentTurn, tool, agentContext, toolOutputs } from './helpers/agent.js';

// Facts about someone the user shops for live in the user's profile with a person label. They are
// used when shopping for that person and never count as the user's own.
const message = { id:'00000000-0000-4000-8000-000000000001', direction:'inbound', body:'My wife wears a US 8 in shoes, and I wear EU 45.', created_at:'2026-10-16T10:00:00Z' };
const store = () => {
  let profile = { facts:[], version:0 };
  return { recordEvidence:async () => {}, profile:async () => structuredClone(profile),
    saveProfile:async (_id, version, facts) => { if (version !== profile.version) return false; profile = { facts, version:version + 1 }; return true; } };
};

test('a fact about another person is saved under their label and never replaces the user’s own', async () => {
  const db = store();
  const { facts, saved } = await updateProfile(db, 'c', message, { changes:[
    { action:'remember', field:'size', key:'shoes/us', value:'8', quote:'My wife wears a US 8 in shoes', person:'Wife' },
    { action:'remember', field:'size', key:'shoes/eu', value:'45', quote:'I wear EU 45', person:null }] });
  assert.equal(saved, 2);
  assert.deepEqual(facts.map(f => [f.person ?? null, f.key, f.value]), [['wife', 'shoes/us', '8'], [null, 'shoes/eu', '45']]);
  // The same key for the user and for the wife are separate beliefs.
  const mine = { ...facts[0], person:undefined, value:'11', updated_at:'2026-10-16T11:00:00Z' };
  delete mine.person;
  const merged = mergeFacts({ facts }, [mine]);
  assert.deepEqual(merged.filter(f => f.key === 'shoes/us').map(f => [f.person ?? null, f.value]).sort(), [[null, '11'], ['wife', '8']]);
  assert.deepEqual(ownFacts(merged).map(f => f.key).sort(), ['shoes/eu', 'shoes/us']);
  assert.match(tasteSummary(facts), /\(wife\) size · shoes\/us: 8/);
  // A label that is not a short name is refused, and the user's own change still saves.
  const bad = await updateProfile(store(), 'c', message, { changes:[{ action:'remember', field:'size', key:'shoes/us', value:'8', quote:'My wife wears a US 8 in shoes', person:'https://example.com' }] });
  assert.equal(bad.saved, 0);
});

test('shopping for a known person uses their facts; the user’s own never apply to someone else', () => {
  const facts = [{ field:'size', key:'shoes/eu', value:'45' }, { field:'brand', key:'lemaire', value:'likes' }, { field:'shopping_range', key:'clothing', value:'men' },
    { field:'size', key:'shoes/us', value:'8', person:'wife' }, { field:'style', key:'colors', value:'prefers neutrals', person:'wife' }];
  const forWife = shoppingConstraints(facts, { for_someone_else:true, recipient:'wife', department:'women' });
  assert.deepEqual(forWife.size_facts, [{ key:'shoes/us', value:'8' }]);
  assert.deepEqual(forWife.taste.map(t => t.key), ['colors']);
  assert.equal(forWife.range, 'women');
  const forMe = shoppingConstraints(facts, {});
  assert.deepEqual(forMe.size_facts, [{ key:'shoes/eu', value:'45' }]);
  assert.equal(forMe.taste.some(t => t.key === 'colors'), false);
  assert.equal(forMe.range, 'men');
  assert.deepEqual(shoppingConstraints(facts, { for_someone_else:true }).size_facts, []);
  // Market settings come from the user's own facts only.
  assert.notEqual(marketEnvironment([{ field:'country', key:'primary', value:'FR', person:'wife' }], {}).SHOPPING_COUNTRY, 'FR');
});

test('the agent sees who each fact is about and names the recipient on the search', async () => {
  let context, intent;
  const facts = [{ field:'size', key:'shoes/us', value:'8', person:'wife', basis:'stated' }];
  await generateReply([{ id:'00000000-0000-4000-8000-000000000002', direction:'inbound', body:'find my wife some loafers', created_at:'2026-10-16T10:00:00Z' }], { OPENAI_API_KEY:'test', SEARCH_ENABLED:'true' },
    async (_url, options) => { context ??= agentContext(options);
      return toolOutputs(options).length ? agentTurn(tool('conversation_reply', { response:'Here are some loafers for her.' })) : agentTurn(tool('find_products', { query:'women loafers', for_someone_else:true, recipient:'Wife', department:'women' })); },
    { facts, wishlistState:null, wishlistAction:async args => { intent = args; return 'Found loafers.'; } });
  assert.deepEqual(context.saved_profile, [{ field:'size', key:'shoes/us', value:'8', basis:'stated', person:'wife' }]);
  assert.equal(intent.recipient, 'wife'); assert.equal(intent.for_someone_else, true);
});
