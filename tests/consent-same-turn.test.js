import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateReply, consentVerdict } from '../lib/ai.js';
import { textWishlistAction } from '../lib/text-wishlist.js';
import { agentTurn, tool, toolOutputs, isAgentRequest, isConsentCheck } from './helpers/agent.js';

// October 19: the founder asked for a product and to save it in one message. The turn searched, the
// agent reacted to the result (respond_to_options interest) and then saved it, and the independent
// consent check refused the save twice in one evening, so the founder had to ask again. The check
// was never told which products the save was for, or that the search had just found them for this
// very message, and it counted the offer this turn's own reaction had made (one the user never saw)
// as open. It now reads the request against the products found for it, counts only offers and
// approvals that existed when the user wrote, and needs the message's own requests to include saving.
const env = { OPENAI_API_KEY:'test', SEARCH_ENABLED:'true', PRICE_ALERTS_ENABLED:'true', WISHLIST_ENABLED:'true' };
const facts = [{ field:'gender', key:'identity', value:'man', basis:'stated' }];
const url = 'https://www.drakes.example/products/merino-cardigan-navy';
const cardigan = { brand:'Drake’s', name:'Merino Cardigan', url, match:'likely_match', sourcing_status:'store_found',
  listing_check:{ status:'verified', product_name:'Merino Cardigan', product_brand:'Drake’s', color:'Navy', shopping_range:'men', url }, price_snapshot:{ amount:395, currency:'USD' } };
const sunspel = { ...cardigan, brand:'Sunspel', name:'Lambswool Cardigan', url:url.replace('drakes', 'sunspel'), listing_check:{ ...cardigan.listing_check, product_brand:'Sunspel', product_name:'Lambswool Cardigan', url:url.replace('drakes', 'sunspel') } };
const coat = { ...cardigan, brand:'Arpenteur', name:'Travail Jacket', url:'https://www.arpenteur.example/travail', listing_check:{ ...cardigan.listing_check, product_brand:'Arpenteur', product_name:'Travail Jacket', url:'https://www.arpenteur.example/travail' } };
const reply = (response, claims = {}) => tool('conversation_reply', { response, claims:{ saved_now:false, alerts_turned_on:false, alerts_turned_off:false, ...claims } });
const inbound = body => ({ direction:'inbound', status:'received', body });
const sent = body => ({ direction:'outbound', status:'sent', body });
const asksToSave = { newest_message_asks_for:['find_or_show', 'save_or_add_to_list'], newest_message_answers:'nothing_in_particular', asks_itself:true, authorizes:true };
const consentReply = value => ({ ok:true, json:async () => ({ status:'completed', output:[{ type:'message', content:[{ type:'output_text', text:JSON.stringify(value) }] }] }) });

// A scripted turn: the agent rounds, a consent reading, the text-wishlist executor with search faked.
function turn({ rounds, reading = asksToSave, results = [cardigan], state = null }) {
  let recorded = null, commits = 0, n = 0;const checks = [], consents = [], outputs = [];
  const outcome = { saved_now:false, alerts_turned_on:false, alerts_turned_off:false };
  const memory = { facts, outcome, wishlistState:state, onConsent:r => consents.push(r),
    wishlistAction:(args, current) => textWishlistAction(args, { state:current, facts, env, inspect:async () => ({ sizes:[], checks:[] }), rank:async x => x, record:async r => { recorded = r; },
      search:async () => ({ products:results, refinement_attempted:true }) }),
    shoppingState:() => recorded && 'text_wishlist_state' in recorded ? recorded.text_wishlist_state : undefined,
    shoppingConfirmed:() => recorded?.user_confirmed === true,
    commitWishlist:async () => { commits++; outcome.saved_now = true; return 'saved to your wishlist.'; } };
  const fetcher = async (_url, options) => {
    if (isConsentCheck(options)) { const body = JSON.parse(options.body); checks.push(JSON.parse(body.input)); return typeof reading === 'function' ? reading(body) : consentReply(reading); }
    if (!isAgentRequest(options)) throw new Error('Unexpected request');
    outputs.push(toolOutputs(options));
    const next = rounds[n++];if (!next) throw new Error('No scripted round ' + n);
    return agentTurn(...(typeof next === 'function' ? next(options) : next));
  };
  return { fetcher, memory, checks, consents, outputs, get commits() { return commits; }, get state() { return recorded?.text_wishlist_state; } };
}
const findSaveRounds = [
  [tool('find_products', { query:'Drake’s navy merino cardigan' })],
  [tool('respond_to_options', { decision:'interest', option_indices:[0] })],
  [tool('save_to_wishlist', { option_indices:[0], consent_context:'explicit_request' })],
  [reply('found the Drake’s navy merino cardigan and saved it to your wishlist.', { saved_now:true })],
];

test('the verdict needs the message’s own requests to include the action', () => {
  // A save request (with or without a search) authorizes a save; a search, link or reaction does not,
  // even when the reading's asks_itself slips.
  assert.equal(consentVerdict(asksToSave), true);
  assert.equal(consentVerdict({ ...asksToSave, newest_message_asks_for:['find_or_show'] }), false);
  assert.equal(consentVerdict({ ...asksToSave, newest_message_asks_for:['choose_or_react'] }), false);
  assert.equal(consentVerdict({ ...asksToSave, newest_message_asks_for:[] }), false);
  // A save request is not a request to watch prices; a price-watch request covers both.
  assert.equal(consentVerdict(asksToSave, { alerts:true }), false);
  assert.equal(consentVerdict({ ...asksToSave, newest_message_asks_for:['watch_price'] }, { alerts:true }), true);
  assert.equal(consentVerdict({ ...asksToSave, newest_message_asks_for:['watch_price'] }), true);
  // A no to an open offer never saves.
  assert.equal(consentVerdict({ newest_message_asks_for:[], newest_message_answers:'the_save_or_alert_offer', asks_itself:false, authorizes:false }, { offer:true }), false);
});

test('find and save in one message: the check sees the found product, no offer from this turn, and the save runs', async () => {
  const t = turn({ rounds:findSaveRounds, state:{ stage:'choice', options:[coat] } });
  const messages = [inbound('looking for a chore coat'), sent('here’s the Arpenteur Travail. what do you think?'), inbound('find me a navy merino cardigan from Drake’s and save it to my wishlist')];
  const body = await generateReply(messages, env, t.fetcher, t.memory);
  assert.equal(t.commits, 1); assert.match(body, /saved/);
  assert.equal(t.checks.length, 1);
  // The offer the reaction made a moment ago was never sent, so nothing is open to accept.
  assert.equal(t.checks[0].pending_offer, null);
  assert.deepEqual(t.checks[0].proposed_products, { count:1, found_this_turn:true });
  assert.deepEqual(t.consents.map(c => [c.allowed, c.open_offer, c.found_this_turn]), [[true, false, true]]);
  assert.deepEqual(t.consents[0].asks_for, ['find_or_show', 'save_or_add_to_list']);
});

test('the offer a turn makes for itself cannot be accepted in that turn', async () => {
  // A yes to a different question (look for it in grey) read as accepting "the offer": before, the
  // offer this turn's reaction had just made counted as open and the save ran. Now it is refused.
  const yes = { newest_message_asks_for:['find_or_show'], newest_message_answers:'the_save_or_alert_offer', asks_itself:false, authorizes:true };
  const t = turn({ rounds:[findSaveRounds[0], findSaveRounds[1], findSaveRounds[2], [reply('here’s the navy Drake’s cardigan. want me to save it?')]], reading:yes, state:{ stage:'choice', options:[coat] } });
  await generateReply([inbound('find me a navy cardigan'), sent('want me to look for it in grey too?'), inbound('yes')], env, t.fetcher, t.memory);
  assert.equal(t.commits, 0);
  assert.ok(t.outputs.flat().some(o => o.status === 'blocked'));
  assert.deepEqual(t.consents.map(c => [c.allowed, c.open_offer]), [[false, false]]);
});

test('a search request alone never saves what it finds, even if the agent tries', async () => {
  const slip = { newest_message_asks_for:['find_or_show'], newest_message_answers:'nothing_in_particular', asks_itself:true, authorizes:true };
  const t = turn({ rounds:[findSaveRounds[0], findSaveRounds[2], [reply('here’s a navy Drake’s merino cardigan.')]], reading:slip });
  await generateReply([inbound('find me a navy merino cardigan from Drake’s')], env, t.fetcher, t.memory);
  assert.equal(t.commits, 0); assert.equal(t.consents[0].allowed, false);
});

test('search, then a later message saves: the check sees products the user has already seen', async () => {
  // Turn 1: the search shows two cardigans; nothing is saved.
  const first = turn({ rounds:[findSaveRounds[0], [reply('two navy cardigans: Drake’s and Sunspel. which do you like?')]], results:[cardigan, sunspel] });
  await generateReply([inbound('find me a navy cardigan')], env, first.fetcher, first.memory);
  assert.equal(first.commits, 0); assert.equal(first.checks.length, 0);
  const shown = first.state;assert.equal(shown.options.length, 2);
  // Turn 2, in different words each time: the save of the named option runs, read as already seen.
  for (const [said, index] of [['save the first one', 0], ['pop the Sunspel on my wishlist', 1], ['add the Drake’s one to my list please', 0]]) {
    const t = turn({ rounds:[[tool('save_to_wishlist', { option_indices:[index], consent_context:'explicit_request' })], [reply('saved.', { saved_now:true })]],
      reading:{ ...asksToSave, newest_message_asks_for:['save_or_add_to_list'] }, state:shown });
    await generateReply([inbound('find me a navy cardigan'), sent('two navy cardigans: Drake’s and Sunspel. which do you like?'), inbound(said)], env, t.fetcher, t.memory);
    assert.equal(t.commits, 1, said);
    assert.deepEqual(t.checks[0].proposed_products, { count:1, found_this_turn:false }, said);
    assert.equal(t.state.selected_set[0].url, shown.options[index].url, said);
  }
  // Liking one is a choice, not a save: the agent's reaction runs and nothing is saved.
  const like = turn({ rounds:[[tool('respond_to_options', { decision:'interest', option_indices:[0] })], [reply('the Drake’s, nice. want me to save it?')]], state:shown });
  await generateReply([inbound('find me a navy cardigan'), sent('two navy cardigans: Drake’s and Sunspel. which do you like?'), inbound('ooh the Drake’s is lovely')], env, like.fetcher, like.memory);
  assert.equal(like.commits, 0); assert.equal(like.checks.length, 0); assert.equal(like.state.stage, 'offer_set');
  // The next message accepts that offer, which the user has now seen: it counts as open.
  const accept = turn({ rounds:[[tool('save_to_wishlist', { option_indices:[0], consent_context:'answer_to_offer' })], [reply('saved.', { saved_now:true })]],
    reading:{ newest_message_asks_for:['save_or_add_to_list'], newest_message_answers:'the_save_or_alert_offer', asks_itself:false, authorizes:true }, state:like.state });
  await generateReply([sent('the Drake’s, nice. want me to save it?'), inbound('go for it')], env, accept.fetcher, accept.memory);
  assert.equal(accept.commits, 1); assert.equal(accept.checks[0].pending_offer?.offered, 'saving to the wishlist, with optional price alerts');
});

test('a consent check that fails is recorded as failed, not as a refusal', async () => {
  const t = turn({ rounds:findSaveRounds.slice(0, 3).concat([[reply('here’s the navy Drake’s cardigan. want me to save it?')]]), reading:() => ({ ok:false, status:429 }), state:{ stage:'choice', options:[coat] } });
  await generateReply([inbound('find me a navy merino cardigan from Drake’s and save it')], env, t.fetcher, t.memory);
  assert.equal(t.commits, 0);
  assert.deepEqual(t.consents, [{ tool:'save_to_wishlist', failed:'Consent check failed', allowed:false }]);
});
