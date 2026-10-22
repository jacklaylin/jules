import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateReply, consentScope } from '../lib/ai.js';
import { textWishlistAction } from '../lib/text-wishlist.js';
import { agentTurn, tool, isAgentRequest, isConsentCheck } from './helpers/agent.js';

// October 22 (frozen case signal-6730f7f4): the user asked Jules to save the chinos and set a price
// alert, Jules asked which size to watch, and the size reply ("Size 48 is fine") led the agent to finish
// with save_to_wishlist instead of manage_price_alerts create in 1 of 3 replays. The item was saved and
// the alert the user asked for was silently dropped. A save that resumes an approved save-and-alert now
// carries that alert, with the size the reply gave; a save-only approval or a fresh save stays a save.
const env = { OPENAI_API_KEY:'test', SEARCH_ENABLED:'true', PRICE_ALERTS_ENABLED:'true', WISHLIST_ENABLED:'true' };
const chino = color => ({ brand:'Still by Hand', name:'Still Chino', url:'https://www.stillbyhand.example/chino-'+color.toLowerCase(), sourcing_status:'store_found', match:'likely_match',
  listing_check:{ status:'verified', product_name:'Still Chino', product_brand:'Still by Hand', color, shopping_range:'men' }, price_snapshot:{ amount:240, currency:'USD' } });
const options = [chino('Beige'), chino('Navy')];
const inspect = async links => ({ sizes:['46', '48', '50'], checks:[{ offers:[{ size:'48', key:'48', amount:240, currency:'USD', available:true, url:links[0].url }] }] });
const inbound = body => ({ direction:'inbound', status:'received', body });
const sent = body => ({ direction:'outbound', status:'sent', body });
const reading = answers => ({ ok:true, json:async () => ({ status:'completed', output:[{ type:'message', content:[{ type:'output_text', text:JSON.stringify(
  { newest_message_asks_for:['answer_jules'], newest_message_answers:answers, asks_itself:false, authorizes:true }) }] }] }) });

// One executor call outside the agent, as earlier turns ran it.
async function act(args, state, facts = []) {
  let result;
  await textWishlistAction({ action:'selection', decision:'confirm', consent:'none', size_choices:[], option_sizing:[], ...args },
    { state, facts, env, inspect, record:async r => { result = r; }, search:() => assert.fail('no search') });
  return result;
}
// The size-reply turn: the agent finishes with the given call, the consent check reads the message as
// the detail the approval waits for (or as accepting an open offer).
async function sizeReply(state, call, { answers = 'the_detail_for_the_approved_action', body = 'size 48 is fine' } = {}) {
  let recorded = null, n = 0;const checks = [];
  const memory = { facts:[], outcome:{ saved_now:false, alerts_turned_on:false, alerts_turned_off:false }, wishlistState:state,
    wishlistAction:(args, current) => textWishlistAction(args, { state:current, facts:[], env, inspect, record:async r => { recorded = r; }, search:() => assert.fail('no search') }),
    shoppingState:() => recorded && 'text_wishlist_state' in recorded ? recorded.text_wishlist_state : undefined,
    shoppingConfirmed:() => recorded?.user_confirmed === true, commitWishlist:async () => 'saved.' };
  const rounds = [[call], [tool('conversation_reply', { response:'done.' })]];
  const fetcher = async (_url, options) => {
    if (isConsentCheck(options)) { checks.push(JSON.parse(JSON.parse(options.body).input));return reading(answers); }
    if (!isAgentRequest(options)) return { ok:false };
    return agentTurn(...rounds[n++]);
  };
  await generateReply([inbound('save both chinos and tell me if they drop'), sent('which retailer size should i watch? Beige: 46, 48, 50'), inbound(body)], env, fetcher, memory);
  return { recorded, checks };
}
const sizeAnswer = { option_indices:[0, 1], consent_context:'answer_to_offer', size_choices:[{ option_index:0, size:'48' }, { option_index:1, size:'48' }] };

async function waitingForSize() {
  const offer = (await act({ decision:'interest', option_indices:[0, 1] }, { stage:'choice', options })).text_wishlist_state;
  const pending = (await act({ option_indices:[0, 1], consent:'wishlist_alerts' }, offer)).text_wishlist_state;
  assert.equal(pending.stage, 'size_set');assert.equal(pending.confirmed_consent, 'wishlist_alerts');
  return pending;
}

test('a save that answers the size question of an approved save-and-alert turns the alert on, in the size given', async () => {
  const pending = await waitingForSize();
  const { recorded, checks } = await sizeReply(pending, tool('save_to_wishlist', sizeAnswer));
  assert.equal(recorded.user_confirmed, true);
  assert.equal(recorded.products.length, 2);
  assert.deepEqual(recorded.alert_requests.map(w => w.size), ['48', '48']);
  assert.equal(recorded.text_wishlist_state, null);
  // The consent check is asked about what will happen: the save and the alert.
  assert.equal(checks[0].proposed_action, 'save and set price alerts');
  // The same reply finished with the alert tool does the same thing.
  const viaAlert = await sizeReply(pending, tool('manage_price_alerts', { operation:'create', ...sizeAnswer }));
  assert.deepEqual(viaAlert.recorded.alert_requests.map(w => w.size), recorded.alert_requests.map(w => w.size));
});

test('a save that resumes the approval but turns reminders down stays a plain save', async () => {
  const pending = await waitingForSize();
  const { recorded, checks } = await sizeReply(pending, tool('save_to_wishlist', { ...sizeAnswer, offer_alerts:false }), { body:'just save them, skip the alert' });
  assert.equal(recorded.user_confirmed, true);
  assert.deepEqual(recorded.alert_requests, []);
  assert.equal(checks[0].proposed_action, 'save to wishlist');
});

test('a save of a different set than the approval waits on is not that approval', async () => {
  const pending = await waitingForSize();
  const scope = consentScope({ name:'save_to_wishlist', args:{ option_indices:[0], offer_alerts:true } }, pending);
  assert.equal(scope.alerts, false);
  const r = await act({ option_indices:[0], consent:'wishlist', consent_context:'explicit_request', offer_alerts:true }, pending);
  assert.equal(r.user_confirmed, true);assert.deepEqual(r.alert_requests, []);
});

test('a save resuming a save-only approval does not turn on an alert', async () => {
  // A save approved without alerts, waiting on a detail; and an approval kept after reminders were
  // unavailable (the user was asked whether to save without them).
  const base = await waitingForSize();
  for (const state of [{ ...base, confirmed_consent:'wishlist' }, { ...base, stage:'offer_set' }]) {
    const { recorded, checks } = await sizeReply(state, tool('save_to_wishlist', sizeAnswer), { answers:state.stage === 'offer_set' ? 'the_save_or_alert_offer' : 'the_detail_for_the_approved_action' });
    assert.equal(recorded.user_confirmed, true);
    assert.deepEqual(recorded.alert_requests, []);
    assert.equal(checks[0].proposed_action, 'save to wishlist');
  }
});

test('a fresh save with no approval waiting is unchanged', async () => {
  const offer = (await act({ decision:'interest', option_indices:[0, 1] }, { stage:'choice', options })).text_wishlist_state;
  for (const state of [{ stage:'choice', options }, offer]) {
    const r = await act({ option_indices:[0, 1], consent:'wishlist', consent_context:state.stage === 'choice' ? 'explicit_request' : 'answer_to_offer', offer_alerts:true }, state);
    assert.equal(r.user_confirmed, true);assert.deepEqual(r.alert_requests, []);
    assert.equal(r.text_wishlist_state.offered_action, 'alerts');
    assert.equal(consentScope({ name:'save_to_wishlist', args:{ option_indices:[0, 1], offer_alerts:true } }, state).alerts, false);
  }
});
