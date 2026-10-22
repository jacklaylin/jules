import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeReply, auditProblems, problemKinds } from '../lib/compose.js';
import { generateReply } from '../lib/ai.js';
import { finishTextWishlist } from '../lib/text-wishlist.js';
import { agentTurn, tool, isAgentRequest, isConsentCheck, consentResponse, isClaimAudit, auditResponse } from './helpers/agent.js';

// The writer declares its own claims, so a message that says an item was added while declaring nothing
// passed every check. An independent reading of the message is compared with what the turn did:
// nothing saved but the message says saved; something saved but the message names another item;
// alerts said to be on when none were turned on. The audit is a model call, so these tests script its
// reading rather than match any wording.
const none = { saved_now:false, alerts_turned_on:false, alerts_turned_off:false };
const env = { OPENAI_API_KEY:'test', SEARCH_ENABLED:'true', WISHLIST_ENABLED:'true', PRICE_ALERTS_ENABLED:'true' };
const reply = (response, claims = {}) => tool('conversation_reply', { response, claims:{ ...none, ...claims } });
const written = (text, claims = {}) => ({ ok:true, json:async () => ({ status:'completed', output:[{ type:'message', content:[{ type:'output_text', text:JSON.stringify({ reply:text, claims:{ ...none, ...claims }, photo_captions:[] }) }] }] }) });

test('the independent reading is compared with what happened, in every direction', () => {
  const read = audit => ({ ...none, names_other_saved_item:false, ...audit });
  assert.deepEqual(auditProblems(read({}), none), []);
  assert.deepEqual(auditProblems(null, { ...none, saved_now:true }), [], 'an unavailable audit leaves the declared claims standing');
  assert.match(auditProblems(read({ saved_now:true }), none).join(), /says saved now happened, but it did not/);
  assert.match(auditProblems(read({ alerts_turned_on:true }), none).join(), /alerts turned on happened, but it did not/);
  assert.match(auditProblems(read({ alerts_turned_off:true }), none).join(), /alerts turned off happened/);
  assert.match(auditProblems(read({}), { ...none, saved_now:true, saved_items:['Romi / Black'] }).join(), /saved now did not happen, but it did/);
  const wrongItem = auditProblems(read({ saved_now:true, names_other_saved_item:true }), { ...none, saved_now:true, saved_items:['Romi / Black'] });
  assert.equal(wrongItem.length, 1); assert.match(wrongItem[0], /different item was saved.*Romi \/ Black/);
  // With no saved names to compare against, "a different item" cannot be judged (or fixed) and is not a problem.
  assert.deepEqual(auditProblems(read({ saved_now:true, names_other_saved_item:true }), { ...none, saved_now:true, saved_items:[] }), []);
  assert.deepEqual(auditProblems(read({ saved_now:true, alerts_turned_on:true }), { ...none, saved_now:true, alerts_turned_on:true, saved_items:['Peyter Pants'] }), []);
  assert.deepEqual(problemKinds([...wrongItem, 'Include these links unchanged: https://x.example', 'Remove prices that are not in the outcome: 10']), ['audited_claim', 'missing_link', 'added_price']);
});

// Multi-turn variants from the October 15 reports: a size question pending after "add it and set an
// alert" (nothing saved), a save of one item in the same turn as a search for another, and an alert
// request answered while the size is unknown.
for (const { id, did, first, audits, expectRetry } of [
  { id:'save claimed while a size question is pending', did:null, first:'added them to your wishlist. which size should i watch?', audits:[{ saved_now:true }, {}], expectRetry:/saved now happened, but it did not/ },
  { id:'alert claimed while the size is unknown', did:null, first:'all set, i’m watching these for price drops.', audits:[{ alerts_turned_on:true }, {}], expectRetry:/alerts turned on happened, but it did not/ },
  { id:'save attributed to the item searched in the same turn', did:'Romi / Black', first:'added the black pants to your wishlist.', audits:[{ saved_now:true, names_other_saved_item:true }, { saved_now:true }], expectRetry:/different item was saved.*Romi \/ Black/ },
]) test(`agent loop: ${id} is rewritten before it is sent`, async () => {
  let agentCalls = 0, audited = 0, retryProblems;
  const outcome = { ...none, ...(did ? { saved_now:true, saved_items:[did] } : {}) };
  const fetcher = async (_url, options) => {
    if (isConsentCheck(options)) return consentResponse(true);
    if (isClaimAudit(options)) { const body = JSON.parse(options.body); assert.match(body.input[0].content, did ? /Romi/ : /\[\]/); return auditResponse(audits[audited++]); }
    assert.ok(isAgentRequest(options));
    if (++agentCalls === 1) return agentTurn(reply(first, did ? { saved_now:true } : {}));
    retryProblems = JSON.parse(options.body).input.filter(i => i.type === 'function_call_output').map(i => JSON.parse(i.output)).at(-1).problems.join(' ');
    return agentTurn(reply(did ? 'saved the Romi in black.' : 'which size should i watch? nothing is saved yet.', did ? { saved_now:true } : {}));
  };
  const body = await generateReply([{ direction:'outbound', status:'sent', body:'here are some options' }, { direction:'inbound', body:'go ahead' }], env, fetcher, { outcome });
  assert.equal(agentCalls, 2); assert.equal(audited, 2); assert.match(retryProblems, expectRetry);
  assert.doesNotMatch(body, did ? /pants/ : /added|watching/);
});

test('agent loop: an honest message is sent after one reading, and an unavailable reading does not block it', async () => {
  for (const audit of [auditResponse({}), { ok:false }]) {
    let agentCalls = 0;
    const body = await generateReply([{ direction:'inbound', body:'call me jack' }], env, async (_url, options) => {
      if (isClaimAudit(options)) return audit;
      agentCalls++; return agentTurn(reply('got it, jack.'));
    }, {});
    assert.equal(body, 'got it, jack.'); assert.equal(agentCalls, 1);
  }
  // Without the wishlist nothing can be saved or alerted, so no reading is made.
  const body = await generateReply([{ direction:'inbound', body:'hi' }], { OPENAI_API_KEY:'test' }, async (_url, options) => {
    assert.ok(!isClaimAudit(options), 'no audit without the wishlist'); return agentTurn(reply('hey!'));
  }, {});
  assert.equal(body, 'hey!');
});

test('composer: an unsupported save claim is retried, and a draft sent instead records why', async () => {
  const draft = 'which retailer size should i watch? i haven’t saved these or enabled reminders yet.';
  let calls = 0;
  const fixed = await composeReply({ draft, facts:none, env, fetcher:async (_url, options) => {
    if (isClaimAudit(options)) return auditResponse(calls === 1 ? { saved_now:true } : {});
    calls++; return written(calls === 1 ? 'added it! which size should i watch?' : 'which size should i watch? nothing saved yet.');
  } });
  assert.equal(calls, 2); assert.equal(fixed.composed, true); assert.match(fixed.body, /nothing saved yet/);
  const lied = await composeReply({ draft, facts:none, env, fetcher:async (_url, options) => isClaimAudit(options) ? auditResponse({ saved_now:true }) : written('added it!') });
  assert.equal(lied.composed, false); assert.equal(lied.body, draft); assert.deepEqual(lied.fallback, { reason:'checks', problem_kinds:['audited_claim'] });
  const offline = await composeReply({ draft, facts:none, env, fetcher:async () => { throw new Error('offline'); } });
  assert.equal(offline.fallback.reason, 'request_failed');
  // A link or price the recent turns already stated may be repeated without failing the checks.
  const repeated = await composeReply({ draft, facts:none, env:{ OPENAI_API_KEY:'test' }, conversation:[{ from:'jules', text:'the ssense pair is $590\nhttps://www.ssense.com/p/1' }],
    fetcher:async () => written('still the $590 pair from ssense:\nhttps://www.ssense.com/p/1\nwhich size should i watch?') });
  assert.equal(repeated.composed, true);
});

test('a save draft names what was saved, so a reply that also reports a search cannot swap the item', async () => {
  const rows = names => names.map((name, i) => ({ reply_id:'r1', item_id:`00000000-0000-4000-8000-00000000000${i + 1}`, name, links:[{ url:`https://shop.example/${i}` }], messages:{ created_at:'2026-10-15' } }));
  for (const names of [['Romi / Black'], ['Peyter Pants', 'Still Chino Trousers']]) {
    const store = { wishlistReplyId:async () => 'r1', wishlistEntries:async () => rows(names), recordEvidence:async () => {} };
    const outcome = {};
    const body = await finishTextWishlist({ store, operation:'op', conversationId:'c', result:{ identification_policy:'text_wishlist', user_confirmed:true }, env:{}, outcome });
    for (const name of names) assert.ok(body.includes(name), name);
    assert.deepEqual(outcome.saved_items, names);
  }
});

test('an already-saved confirmation records which items were already saved, for the claim check', async () => {
  const rows = [{ reply_id:'r0', item_id:'00000000-0000-4000-8000-000000000001', name:'LEMAIRE Black Leather Biker Jacket', links:[{ url:'https://shop.example/jacket' }], messages:{ created_at:'2026-10-15' } }];
  const store = { wishlistReplyId:async () => 'r1', wishlistEntries:async () => rows, recordEvidence:async () => {} };
  const { groupWishlist } = await import('../lib/wishlist.js');
  const outcome = {};
  const body = await finishTextWishlist({ store, operation:'op', conversationId:'c', result:{ identification_policy:'text_wishlist', user_confirmed:true, existing_saved_groups:[groupWishlist(rows)[0].id] }, env:{}, outcome });
  assert.match(body, /already in your wishlist/);
  assert.equal(outcome.saved_now, false); assert.equal(outcome.saved_items, undefined);
  assert.deepEqual(outcome.already_saved_items, ['LEMAIRE Black Leather Biker Jacket']);
});
