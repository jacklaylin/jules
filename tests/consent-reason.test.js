import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateReply, consentVerdict, consentCheck } from '../lib/ai.js';
import { agentTurn, tool, toolOutputs, isAgentRequest, isConsentCheck } from './helpers/agent.js';

// A save or alert needs a reason the consent reading gives and the state confirms: the newest message
// asks for it, answers an offer that is actually open, or gives the detail an earlier approval waits
// for. An "authorizes" verdict with no such reason (a link, a correction, a comment on the results) is
// not consent, whatever the reading's overall answer says.
const env = { OPENAI_API_KEY:'test', SEARCH_ENABLED:'true', PRICE_ALERTS_ENABLED:'true' };
const url = 'https://www.brand-store.example/products/ripped-tee-red';
const option = { brand:'Brand', name:'Ripped Tee', url, match:'likely_match', listing_check:{ status:'verified', product_name:'Ripped Tee', product_brand:'Brand', url } };
const choice = { stage:'choice', query:'distressed tees', options:[option, { ...option, url:url.replace('red', 'grey') }] };
const reading = (newest_message_answers, asks_itself, authorizes = true) => ({ newest_message_answers, asks_itself, authorizes });
const consentReply = value => ({ ok:true, json:async () => ({ status:'completed', output:[{ type:'message', content:[{ type:'output_text', text:JSON.stringify(value) }] }] }) });
const reply = response => tool('conversation_reply', { response, claims:{ saved_now:false, alerts_turned_on:false, alerts_turned_off:false } });

test('the verdict needs a reason: asking, an open offer, or an earlier approval waiting for a detail', () => {
  assert.equal(consentVerdict(reading('nothing_in_particular', true)), true);
  assert.equal(consentVerdict(reading('nothing_in_particular', false)), false);
  assert.equal(consentVerdict(reading('a_different_jules_question', false)), false);
  assert.equal(consentVerdict(reading('a_different_jules_question', true)), true);
  assert.equal(consentVerdict(reading('the_save_or_alert_offer', false)), false);
  assert.equal(consentVerdict(reading('the_save_or_alert_offer', false), { offer:true }), true);
  assert.equal(consentVerdict(reading('the_save_or_alert_offer', false), { earlier:{ approved:'save to wishlist' } }), true);
  assert.equal(consentVerdict(reading('the_detail_for_the_approved_action', false)), false);
  assert.equal(consentVerdict(reading('the_detail_for_the_approved_action', false), { earlier:{ approved:'save to wishlist' } }), true);
  // A reason never overrides a "no".
  assert.equal(consentVerdict(reading('nothing_in_particular', true, false)), false);
  assert.equal(consentVerdict(reading('the_save_or_alert_offer', false, false), { offer:true }), false);
  assert.equal(consentVerdict({}), false);
});

test('the consent check uses the state for the offer and approval, and reports its reading without message text', async () => {
  const messages = [{ direction:'outbound', status:'sent', body:'here are two tees. which catch your eye?' }, { direction:'inbound', body:url }];
  const save = { name:'save_to_wishlist', args:{} };
  const seen = [];
  const check = (state, value) => consentCheck(messages, save, state, env, async () => consentReply(value), r => seen.push(r));
  // Results were shown but nothing was offered: a reading that calls the link an answer to an offer is refused.
  assert.equal(await check(choice, reading('the_save_or_alert_offer', false)), false);
  assert.equal(await check(choice, reading('nothing_in_particular', false)), false);
  // The same answer with an offer actually open, or an approval waiting for a detail, goes ahead.
  assert.equal(await check({ ...choice, stage:'offer_set' }, reading('the_save_or_alert_offer', false)), true);
  assert.equal(await check({ ...choice, stage:'size_set', confirmed_consent:'wishlist' }, reading('the_detail_for_the_approved_action', false)), true);
  assert.deepEqual(seen.map(r => r.allowed), [false, false, true, true]);
  assert.deepEqual(Object.keys(seen[0]).sort(), ['allowed', 'answers', 'approved_earlier', 'asks_itself', 'authorizes', 'open_offer', 'tool']);
  assert.ok(!JSON.stringify(seen).includes(url));
});

// The agent reads a message after results as a save, the consent model says yes without a reason, and
// nothing is saved; the agent is told and replies instead. Then a real request in the next turn saves.
function turn(newest, value, state = choice) {
  let saves = 0, told = null, consents = [];
  const fetcher = async (_url, options) => {
    if (isConsentCheck(options)) return consentReply(value);
    if (!isAgentRequest(options)) throw new Error('Unexpected request');
    const outputs = toolOutputs(options);
    if (!outputs.length) return agentTurn(tool('save_to_wishlist', { option_indices:[0], consent_context:'explicit_request' }));
    told = outputs[0];
    return agentTurn(reply(told.status === 'done' ? told.result : 'got it. want me to look for that tee on the brand’s own site?'));
  };
  const memory = { facts:[], wishlistState:state, onConsent:r => consents.push(r),
    wishlistAction:async () => { saves++; return 'saved Ripped Tee to your wishlist.'; } };
  return generateReply([{ direction:'outbound', status:'sent', body:'here are two tees. which catch your eye?' }, { direction:'inbound', status:'received', body:newest }], env, fetcher, memory)
    .then(body => ({ body, saves, told, consents }));
}

test('a link, a correction or a comment after results is never a save, in any wording', async () => {
  for (const newest of [`https://www.brand-store.example/`, `this is the real site https://www.brand-store.example/`, 'the second one is sold out', 'the first link looks off', 'i like the first one']) {
    for (const value of [reading('nothing_in_particular', false), reading('the_save_or_alert_offer', false)]) {
      const result = await turn(newest, value);
      assert.equal(result.saves, 0, newest);
      assert.equal(result.told.status, 'blocked', newest);
      assert.equal(result.consents[0].allowed, false);
      assert.doesNotMatch(result.body, /saved/);
    }
  }
});

test('multi-turn: after a refused save, an explicit request or an accepted open offer saves', async () => {
  for (const newest of ['add the red one to my wishlist', 'save that first tee please', 'put it on my list']) {
    const result = await turn(newest, reading('nothing_in_particular', true));
    assert.equal(result.saves, 1, newest); assert.match(result.body, /saved Ripped Tee/);
  }
  const accepted = await turn('yes please', reading('the_save_or_alert_offer', false), { ...choice, stage:'offer_set', selected_set:[option], offered_urls:[url] });
  assert.equal(accepted.saves, 1); assert.equal(accepted.consents[0].open_offer, true);
});
