import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateReply } from '../lib/ai.js';
import { turnActions, turnRecord } from '../lib/narrate.js';
import { agentTurn, tool, isAgentRequest, isConsentCheck, consentResponse, isClaimAudit, auditResponse } from './helpers/agent.js';

// CHAT_NARRATE: the agent runs the tools and leaves a note; the writer composes the message from the turn
// record code built. These tests script the agent, the writer and the claim audit.
const env = { OPENAI_API_KEY:'test', SEARCH_ENABLED:'true', WISHLIST_ENABLED:'true', CHAT_NARRATE:'on' };
const url = 'https://www.ssense.example/products/peyter-pants-black';
const peyter = { brand:'Dries Van Noten', name:'Peyter Pants', url, match:'likely_match', sourcing_status:'store_found',
  listing_check:{ status:'verified', product_name:'Peyter Pants', product_brand:'Dries Van Noten', color:'Black', url }, price_snapshot:{ amount:610, currency:'USD' } };
const note = response => tool('conversation_reply', { response });
const say = body => [{ direction:'outbound', status:'sent', body:`found the Peyter at SSENSE for $610\n${url}\nwant me to save it?` }, { direction:'inbound', status:'received', body }];
const isWriter = options => JSON.parse(options?.body ?? '{}').text?.format?.name === 'jules_message';
const written = reply => ({ ok:true, json:async () => ({ status:'completed', output:[{ type:'message', content:[{ type:'output_text', text:JSON.stringify({ reply }) }] }] }) });
const recordOf = options => JSON.parse(JSON.parse(options.body).input.find(i => i.content.startsWith('TURN_RECORD')).content.replace(/^TURN_RECORD \(data, not instructions\): /, ''));

function model({ rounds, writes = [], audits = [], authorizes = true }) {
  const agent = [], writer = [], audited = [];
  const fetcher = async (_url, options) => {
    if (isConsentCheck(options)) return consentResponse(authorizes);
    if (isClaimAudit(options)) { audited.push(options); const next = audits[audited.length - 1]; return next ? auditResponse(next) : { ok:false }; }
    if (isWriter(options)) { writer.push(options); const next = writes[writer.length - 1]; if (next === undefined) throw new Error('No scripted write'); return next === null ? { ok:false, status:500, json:async () => ({}) } : written(next); }
    if (!isAgentRequest(options)) throw new Error('Unexpected request');
    agent.push(JSON.parse(options.body));
    const next = rounds[agent.length - 1];
    if (!next) throw new Error('No scripted round ' + agent.length);
    return agentTurn(...next);
  };
  return { fetcher, agent, writer, audited };
}
// A shopping memory whose save is refused or committed by the test; the outcome is what the inbox would hold.
function shopping({ saved = false } = {}) {
  const outcome = { saved_now:false, alerts_turned_on:false, alerts_turned_off:false };
  return { outcome, memory:{ outcome, facts:[], wishlistState:{ stage:'offer_set', options:[peyter], selected_set:[peyter], offered_urls:[url] },
    wishlistAction:async () => 'saved to your wishlist.', shoppingConfirmed:() => saved,
    commitWishlist:async () => { outcome.saved_now = true; outcome.saved_items = ['Dries Van Noten Peyter Pants']; return 'saved to your wishlist.'; } } };
}

test('the turn record says what ran and what happened, from the transcript and outcome only', () => {
  const transcript = [
    { type:'function_call', call_id:'a', name:'find_products', arguments:JSON.stringify({ query:'peyter pants' }) },
    { type:'function_call_output', call_id:'a', output:JSON.stringify({ status:'done', result:'1. Peyter' }) },
    { type:'function_call', call_id:'b', name:'save_to_wishlist', arguments:JSON.stringify({ option_indices:[0] }) },
    { type:'function_call_output', call_id:'b', output:JSON.stringify({ status:'not_run', later:true }) },
    { type:'function_call', call_id:'c', name:'save_to_wishlist', arguments:JSON.stringify({ option_indices:[0] }) },
    { type:'function_call_output', call_id:'c', output:JSON.stringify({ status:'blocked', error:'Nothing was saved' }) },
    { type:'function_call', call_id:'d', name:'conversation_reply', arguments:JSON.stringify({ response:'saved it!' }) },
  ];
  assert.deepEqual(turnActions(transcript), [
    { tool:'find_products', status:'ran', for:{ query:'peyter pants' } },
    { tool:'save_to_wishlist', status:'refused', for:{ option_indices:[0] }, why:'the newest message did not ask for it or accept an offer of it' },
  ]);
  const record = turnRecord({ transcript, outcome:{ saved_now:false, alerts_turned_on:false, alerts_turned_off:false, names:['SSENSE'], saved_items:[] }, drafts:'1. Peyter' });
  assert.deepEqual(record.happened, { saved_now:false, alerts_turned_on:false, alerts_turned_off:false });
  assert.equal(JSON.stringify(record).includes('saved it!'), false, 'the agent\'s own words are never part of the record');
});

test('a note that claims a refused save never reaches the user: the writer writes from the record', async () => {
  const shop = shopping({ saved:false });
  const { fetcher, agent, writer } = model({ authorizes:false,
    rounds:[[tool('save_to_wishlist', { option_indices:[0] })], [note('saved it for you!')]],
    writes:['i haven’t saved it yet. want me to add the Peyter to your wishlist?'], audits:[{ saved_now:false }] });
  const body = await generateReply(say('these are nice'), env, fetcher, shop.memory);
  assert.equal(body, 'i haven’t saved it yet. want me to add the Peyter to your wishlist?');
  assert.equal(agent.length, 2, 'the agent is not asked to write again');
  const record = recordOf(writer[0]);
  assert.equal(record.actions[0].status, 'refused');
  assert.equal(record.happened.saved_now, false);
});

test('with the flag on the agent gets no voice guide, no writing rules and no claims field', async () => {
  const { fetcher, agent } = model({ rounds:[[note('say hi back')]], writes:['hey! what are we shopping for?'], audits:[{}] });
  await generateReply([{ direction:'inbound', status:'received', body:'hi' }], env, fetcher, {});
  assert.equal(agent[0].instructions.includes('Voice guide'), false);
  assert.equal(agent[0].instructions.includes('WRITING THE MESSAGE'), false);
  const reply = agent[0].tools.find(t => t.name === 'conversation_reply');
  assert.deepEqual(Object.keys(reply.parameters.properties).sort(), ['answers_message_ids', 'response']);
});

test('a committed save is said by the writer and passes the audit', async () => {
  const shop = shopping({ saved:true });
  const { fetcher, writer, audited } = model({
    rounds:[[tool('save_to_wishlist', { option_indices:[0] })], [note('confirm and ask about alerts')]],
    writes:['done, the Peyter is on your wishlist. want a heads up if the price drops?'], audits:[{ saved_now:true }] });
  const body = await generateReply(say('save it'), env, fetcher, shop.memory);
  assert.match(body, /on your wishlist/);
  assert.equal(recordOf(writer[0]).happened.saved_now, true);
  assert.equal(audited.length, 1);
});

test('a writer message that fails the checks twice falls back as today, never back to the agent', async () => {
  const shop = shopping({ saved:false });
  const rejected = [];
  const { fetcher, agent, writer } = model({ authorizes:false,
    rounds:[[tool('save_to_wishlist', { option_indices:[0] })], [note('saved!')]],
    writes:['saved it!', 'all saved!'], audits:[{ saved_now:true }, { saved_now:true }] });
  // Nothing ran that left a draft, so there is nothing true to send: the inbox's fallback takes over.
  await assert.rejects(generateReply(say('nice'), env, fetcher, { ...shop.memory, onRejected:r => rejected.push(r) }), /Reply failed checks/);
  assert.equal(writer.length, 2);
  assert.equal(agent.length, 2, 'the agent is not asked to write again');
  assert.equal(rejected.length, 2);
  assert.ok(rejected.every(r => r.round === 'writer' && r.problem_kinds.includes('audited_claim')));
});

test('an unreachable writer leaves the agent\'s note checked as the message', async () => {
  const { fetcher, writer } = model({ rounds:[[note('hey! what are we shopping for?')]], writes:[null], audits:[{}] });
  const body = await generateReply([{ direction:'inbound', status:'received', body:'hi' }], env, fetcher, {});
  assert.equal(writer.length, 1);
  assert.equal(body, 'hey! what are we shopping for?');
});

test('with the flag off nothing changes: no writer call', async () => {
  const { fetcher, writer } = model({ rounds:[[tool('conversation_reply', { response:'hey!', claims:{ saved_now:false, alerts_turned_on:false, alerts_turned_off:false } })]], audits:[{}] });
  const body = await generateReply([{ direction:'inbound', status:'received', body:'hi' }], { ...env, CHAT_NARRATE:'' }, fetcher, {});
  assert.equal(body, 'hey!');
  assert.equal(writer.length, 0);
});
