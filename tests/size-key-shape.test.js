import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateChanges, updateProfile } from '../lib/memory.js';
import { sizeKeyShape, malformedSize, shoppingConstraints } from '../lib/relevance.js';
import { generateReply } from '../lib/ai.js';
import { createProfileHandler } from '../api/profile.js';
import { agentTurn, tool, agentContext, isAgentRequest, toolOutputs } from './helpers/agent.js';

// A size fact's key is category/system[/brand]. Code checks only that shape; which item category a
// size is for is the model's reading of the message. A store name is not a category/system key.
const id = '00000000-0000-4000-8000-000000000001';
const said = { id, direction:'inbound', body:'Size 31 is also fine', created_at:'2026-10-15T10:00:00Z' };
const env = { MEMORY_ENABLED:'true', AI_ENABLED:'true', OPENAI_API_KEY:'fake-test' };
const set = key => ({ field:'size', key, value:'31', action:'set', source_id:id, evidence:'Size 31 is also fine' });
function db(facts = []) {
  let profile = { facts, version:0 };
  return { recordEvidence:async()=>{}, profile:async()=>structuredClone(profile), conversation:async()=>({ id }),
    saveProfile:async(_id, version, next)=>{ if (version !== profile.version) return false; profile = { facts:next, version:version+1 }; return true; } };
}
const malformed = { field:'size', key:'example retail aps', value:'31', deleted:false, source:'message', source_id:id, evidence:'Size 31 is also fine', updated_at:said.created_at, basis:'stated', evidence_ids:[] };

test('size keys must be category/system or category/system/brand', () => {
  for (const key of ['bottoms/waist', 'bottoms/unknown', 'shoes/eu/example brand', 'suits/unknown'])
    assert.equal(sizeKeyShape(key), true, key);
  // The category is one of a fixed list: a department or a free-text kind of item is not one (October 22).
  for (const key of ['example retail aps', 'trousers', 'trousers/', '/waist', 'a/b/c/d', ' / ', '', 'women/tops/us', 'jacket/lemaire', 'trousers/waist'])
    assert.equal(sizeKeyShape(key), false, key);
  assert.equal(validateChanges([set('bottoms/waist')], [said]).length, 1);
  assert.throws(() => validateChanges([set('example retail aps')], [said]), /size key/);
  // Other fields keep their own key rules.
  assert.equal(validateChanges([{ ...set('example retail aps'), field:'brand', value:'likes' }], [said]).length, 1);
  // A brand key is the brand's name, never a source prefix like the old style-pack copies.
  assert.throws(() => validateChanges([{ ...set('style-pack/example'), field:'brand', value:'likes' }], [said]), /brand key/);
});

test('a size the model filed under a store name is not saved; valid changes beside it are', async () => {
  const store = db();
  const result = await updateProfile(store, id, said, { changes:[
    { action:'remember', field:'size', key:'example retail aps', value:'31', quote:'Size 31 is also fine' },
    { action:'remember', field:'size', key:'bottoms/unknown', value:'31', quote:'Size 31 is also fine' }], acknowledgment:'' });
  assert.equal(result.saved, 1);
  assert.deepEqual(result.facts.map(f => f.key), ['bottoms/unknown']);
  assert.deepEqual(result.rejected, [{ field:'size', key:'example retail aps', reason:'size_key_needs_item_category' }]);
});

test('an existing malformed size can still be forgotten', async () => {
  const store = db([malformed]);
  const result = await updateProfile(store, id, { ...said, id:'00000000-0000-4000-8000-000000000002', body:'forget that size' },
    { changes:[{ action:'forget', field:'size', key:'example retail aps', value:'', quote:'forget that size' }], acknowledgment:'' });
  assert.equal(result.saved, 1);
  assert.equal(result.facts[0].deleted, true);
});

test('the agent learns a size was not saved and why, so it can ask which item it is for', async () => {
  let outputs = [];
  await generateReply([said], env, async (_url, options) => {
    if (!isAgentRequest(options)) return { ok:false };
    outputs = toolOutputs(options);
    return outputs.length ? agentTurn(tool('conversation_reply', { response:'Which item is size 31 for?' }))
      : agentTurn(tool('update_profile', { changes:[{ action:'remember', field:'size', key:'example retail aps', value:'31', quote:'Size 31 is also fine' }], acknowledgment:'Noted.' }));
  }, { profileAction:async args => updateProfile(db(), id, said, args) });
  const result = outputs.find(o => o.status);
  assert.equal(result.status, 'not_saved');
  assert.equal(result.not_saved[0].reason, 'size_key_needs_item_category');
  assert.ok(result.note);
});

test('an existing malformed size stays visible for correction but is never applied', async () => {
  const good = { ...malformed, key:'shoes/eu', value:'45' };
  assert.equal(malformedSize(malformed), true);
  assert.equal(malformedSize(good), false);
  assert.equal(malformedSize({ ...malformed, deleted:true }), false);
  assert.deepEqual(shoppingConstraints([malformed, good]).size_facts, [{ key:'shoes/eu', value:'45' }]);
  let context;
  await generateReply([{ ...said, body:'what do you remember about me?' }], env, async (_url, options) => {
    if (!isAgentRequest(options)) return { ok:false };
    context = agentContext(options);
    return agentTurn(tool('profile_status', { response:'I have a size 31 saved but not what it is for. Which item is it?' }));
  }, { facts:[malformed, good], profileAction:async()=>({ saved:0 }) });
  const saved = Object.fromEntries(context.saved_profile.map(f => [f.key, f]));
  assert.equal(saved['example retail aps'].value, '31');
  assert.ok(saved['example retail aps'].needs_correction);
  assert.equal(saved['shoes/eu'].needs_correction, undefined);
});

const res = () => ({ setHeader(){}, end(body){ this.body = JSON.parse(body); } });
const req = input => ({ method:'POST', url:'/api/profile', headers:{ 'content-type':'application/json' }, async *[Symbol.asyncIterator](){ yield Buffer.from(JSON.stringify(input)); } });
test('owner edits in the inbox use the same size key shape, and can remove a malformed one', async () => {
  const store = db([malformed]);
  const handler = createProfileHandler({ auth:async()=>200, storeFactory:()=>store, env });
  let result = res(); await handler(req({ conversation:id, action:'set', field:'size', key:'example retail aps', value:'32', version:0 }), result);
  assert.equal(result.statusCode, 400);
  result = res(); await handler(req({ conversation:id, action:'remove', field:'size', key:'example retail aps', value:'', version:0 }), result);
  assert.equal(result.statusCode, 200);
  result = res(); await handler(req({ conversation:id, action:'set', field:'size', key:'bottoms/waist', value:'31', version:1 }), result);
  assert.equal(result.statusCode, 200);
  assert.deepEqual((await store.profile(id)).facts.filter(f => !f.deleted).map(f => f.key), ['bottoms/waist']);
});

test('old size keys move onto the fixed categories; unclear ones are left for Jules to ask', async () => {
  const { migrateKey } = await import('../scripts/size-key-migration.js');
  const size = (key, value) => ({ field:'size', key, value });
  assert.equal(migrateKey(size('women/tops/us', 'M')), 'tops/us');
  assert.equal(migrateKey(size('women/shoes/us', '9.5')), 'shoes/us_women');
  assert.equal(migrateKey(size('women/shoes/eu', '39.5')), 'shoes/eu');
  assert.equal(migrateKey(size('jacket/lemaire', 'large')), 'outerwear/letter/lemaire');
  assert.equal(migrateKey(size('trousers/waist', '32')), 'bottoms/waist');
  assert.equal(migrateKey(size('women/unknown', 'equivalent of size 8 for women')), null);
  assert.equal(migrateKey(size('example retail aps', '31')), null);
  assert.equal(migrateKey(size('shoes/eu', '45')), null, 'already fine');
});
