import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateReply, consentRefused } from '../lib/ai.js';
import { textWishlistAction } from '../lib/text-wishlist.js';
import { agentTurn, tool, toolOutputs, isAgentRequest, isConsentCheck } from './helpers/agent.js';

// October 19–21: about ten save turns tried a save or alert the consent check had just refused a
// second time (another option set, or the alert after the save), each costing another agent round and
// another check. A refusal is a reading of the newest message, so it answers the same question for the
// rest of the turn: a later save or alert with the same scope is refused without a new check, and the
// refused tools are left out of the next round's choice. A search that finds products the user has not
// seen is a new scope, and the next message is a new turn.
const env = { OPENAI_API_KEY:'test', SEARCH_ENABLED:'true', PRICE_ALERTS_ENABLED:'true', WISHLIST_ENABLED:'true' };
const facts = [{ field:'gender', key:'identity', value:'man', basis:'stated' }];
const product = (brand, name, slug) => { const url = `https://www.${slug}.example/products/${slug}`;
  return { brand, name, url, match:'likely_match', sourcing_status:'store_found', price_snapshot:{ amount:395, currency:'USD' },
    listing_check:{ status:'verified', product_name:name, product_brand:brand, color:'Navy', shopping_range:'men', url } }; };
const cardigan = product('Drake’s', 'Merino Cardigan', 'drakes'), sunspel = product('Sunspel', 'Lambswool Cardigan', 'sunspel'), coat = product('Arpenteur', 'Travail Jacket', 'arpenteur');
const reply = (response, claims = {}) => tool('conversation_reply', { response, claims:{ saved_now:false, alerts_turned_on:false, alerts_turned_off:false, ...claims } });
const inbound = body => ({ direction:'inbound', status:'received', body });
const sent = body => ({ direction:'outbound', status:'sent', body });
const save = indices => tool('save_to_wishlist', { option_indices:indices, consent_context:'explicit_request' });
const alert = indices => tool('manage_price_alerts', { operation:'create', option_indices:indices, consent_context:'explicit_request' });
const likes = indices => tool('respond_to_options', { decision:'interest', option_indices:indices });
const asking = asks => asks.some(a => ['save_or_add_to_list', 'watch_price'].includes(a));
const reading = asks => ({ newest_message_asks_for:asks, newest_message_answers:'nothing_in_particular', asks_itself:asking(asks), authorizes:asking(asks) });
const comment = reading(['choose_or_react']);
const consentReply = value => ({ ok:true, json:async () => ({ status:'completed', output:[{ type:'message', content:[{ type:'output_text', text:JSON.stringify(value) }] }] }) });
const shown = { stage:'choice', options:[cardigan, sunspel] };
const messages = said => [inbound('find me a navy cardigan'), sent('two navy cardigans: Drake’s and Sunspel. which do you like?'), inbound(said)];

// A scripted turn: the agent rounds, the consent readings (one per check, the last repeats), and the
// text-wishlist executor with search faked. choices: each agent round's tool_choice.
function turn({ rounds, readings = [comment], results = [cardigan], state = shown, consentRefusals }) {
  let recorded = null, commits = 0, n = 0;const checks = [], consents = [], outputs = [], choices = [];
  const outcome = { saved_now:false, alerts_turned_on:false, alerts_turned_off:false };
  const memory = { facts, outcome, wishlistState:state, onConsent:r => consents.push(r), ...(consentRefusals ? { consentRefusals } : {}),
    wishlistAction:(args, current) => textWishlistAction(args, { state:current, facts, env, inspect:async () => ({ sizes:[], checks:[] }), rank:async x => x, record:async r => { recorded = r; },
      search:async () => ({ products:results, refinement_attempted:true }) }),
    shoppingState:() => recorded && 'text_wishlist_state' in recorded ? recorded.text_wishlist_state : undefined,
    shoppingConfirmed:() => recorded?.user_confirmed === true,
    commitWishlist:async () => { commits++; outcome.saved_now = true; return 'saved to your wishlist.'; } };
  const fetcher = async (_url, options) => {
    if (isConsentCheck(options)) { checks.push(JSON.parse(JSON.parse(options.body).input)); return consentReply(readings[Math.min(checks.length, readings.length) - 1]); }
    if (!isAgentRequest(options)) throw new Error('Unexpected request');
    outputs.push(toolOutputs(options));choices.push(JSON.parse(options.body).tool_choice);
    const next = rounds[n++];if (!next) throw new Error('No scripted round ' + n);
    return agentTurn(...next);
  };
  return { fetcher, memory, checks, consents, outputs, choices, get commits() { return commits; } };
}
const statuses = t => t.outputs.at(-1).map(o => o.status);
const offeredNames = choice => choice?.type === 'allowed_tools' ? choice.tools.map(t => t.name) : null;

test('a refused save covers an alert; a refused alert leaves a plain save open; a new scope is asked again', () => {
  assert.equal(consentRefused([{ alerts:false, fresh:false }], { alerts:false, fresh:false }), true);
  assert.equal(consentRefused([{ alerts:false, fresh:false }], { alerts:true, fresh:false }), true);
  assert.equal(consentRefused([{ alerts:true, fresh:false }], { alerts:false, fresh:false }), false);
  assert.equal(consentRefused([{ alerts:true, fresh:false }], { alerts:true, fresh:false }), true);
  assert.equal(consentRefused([{ alerts:false, fresh:false }], { alerts:false, fresh:true }), false);
  assert.equal(consentRefused([], { alerts:false, fresh:false }), false);
});

test('a refused save is not tried again with other options: one check, and the next round cannot choose save or alert', async () => {
  // The model ignores the narrowed choice and tries the other option, then the alert: both are refused
  // without asking the check again, and the turn ends with its message.
  const t = turn({ rounds:[[save([0])], [save([1])], [alert([0, 1])], [reply('the Drake’s is a good pick. want me to save it?')]] });
  const body = await generateReply(messages('ooh the Drake’s is lovely'), env, t.fetcher, t.memory);
  assert.match(body, /save it/);
  assert.equal(t.commits, 0);
  assert.equal(t.checks.length, 1);
  assert.equal(statuses(t).filter(s => s === 'blocked').length, 3);
  assert.deepEqual(t.consents.map(c => [c.tool, c.allowed, c.reused === true]), [['save_to_wishlist', false, false], ['save_to_wishlist', false, true], ['manage_price_alerts', false, true]]);
  // Round one chooses freely; after the refusal, save and alert are left out (still listed, so the prompt cache holds).
  assert.equal(t.choices[0], 'required');
  for (const choice of t.choices.slice(1)) {
    const names = offeredNames(choice);
    assert.ok(names && !names.includes('save_to_wishlist') && !names.includes('manage_price_alerts'));
    assert.ok(names.includes('conversation_reply') && names.includes('respond_to_options') && names.includes('find_products'));
  }
});

test('after a refusal the model records the reaction instead, and the user can accept the save next turn', async () => {
  // Turn 1 (liking one): the save is refused, the reaction runs, Jules offers the save.
  const first = turn({ rounds:[[save([0])], [likes([0])], [reply('the Drake’s, nice. want me to save it?')]] });
  await generateReply(messages('the Drake’s is the one'), env, first.fetcher, first.memory);
  assert.equal(first.commits, 0); assert.equal(first.checks.length, 1);
  assert.deepEqual(statuses(first), ['blocked', 'done']);
  // Turn 2 (a yes to the offer): a new turn carries no refusal over; the check asks again and the save runs.
  const accept = turn({ rounds:[[tool('save_to_wishlist', { option_indices:[0], consent_context:'answer_to_offer' })], [reply('saved.', { saved_now:true })]],
    readings:[{ newest_message_asks_for:['save_or_add_to_list'], newest_message_answers:'the_save_or_alert_offer', asks_itself:false, authorizes:true }],
    state:{ stage:'offer_set', options:[cardigan, sunspel], selected_set:[cardigan], offered_urls:[cardigan.url] } });
  await generateReply([sent('the Drake’s, nice. want me to save it?'), inbound('go on then')], env, accept.fetcher, accept.memory);
  assert.equal(accept.checks.length, 1); assert.equal(accept.commits, 1);
  assert.equal(accept.choices[0], 'required');
});

test('two saves in one round are checked once when the first is refused', async () => {
  const t = turn({ rounds:[[save([0]), save([1])], [reply('which one do you want to keep?')]] });
  await generateReply(messages('both look nice'), env, t.fetcher, t.memory);
  assert.equal(t.checks.length, 1); assert.equal(t.commits, 0);
  assert.deepEqual(t.consents.map(c => c.reused === true), [false, true]);
});

test('a refused alert still lets a plain save ask: the message asked to save, not to watch prices', async () => {
  const t = turn({ rounds:[[alert([0])], [save([0])], [reply('saved the Drake’s.', { saved_now:true })]], readings:[reading(['save_or_add_to_list'])] });
  await generateReply(messages('save the Drake’s'), env, t.fetcher, t.memory);
  assert.equal(t.checks.length, 2); assert.equal(t.commits, 1);
  const names = offeredNames(t.choices[1]);
  assert.ok(names.includes('save_to_wishlist') && !names.includes('manage_price_alerts'));
});

test('a save refused on shown options is asked again on products this turn’s search found for the message', async () => {
  // The save on the shown option is refused; the search then finds a product the user has not seen,
  // a new scope, so save is offered again and the check reads it against what was found.
  const t = turn({ rounds:[[save([0])], [tool('find_products', { query:'grey merino cardigan' })], [save([0])], [reply('found it in grey and saved it.', { saved_now:true })]],
    readings:[comment, reading(['find_or_show', 'save_or_add_to_list'])], results:[coat], state:{ stage:'choice', options:[cardigan] } });
  await generateReply([sent('here’s the Drake’s cardigan in navy.'), inbound('find it in grey and save it')], env, t.fetcher, t.memory);
  assert.equal(t.checks.length, 2); assert.equal(t.commits, 1);
  assert.deepEqual(t.checks.map(c => c.proposed_products.found_this_turn), [false, true]);
  assert.ok(!offeredNames(t.choices[1]).includes('save_to_wishlist'));
  assert.equal(t.choices[2], 'required');
});

test('the inbox’s compact retry keeps the refusal: the same message is not checked again', async () => {
  const consentRefusals = [];
  const first = turn({ rounds:[[save([0])]], consentRefusals });
  await assert.rejects(generateReply(messages('nice'), env, first.fetcher, first.memory));
  assert.equal(first.checks.length, 1);
  const retry = turn({ rounds:[[save([0])], [reply('glad you like it. want me to save it?')]], consentRefusals });
  await generateReply(messages('nice'), env, retry.fetcher, { ...retry.memory, compact:true });
  assert.equal(retry.checks.length, 0); assert.equal(retry.commits, 0);
  assert.equal(offeredNames(retry.choices[0])?.includes('save_to_wishlist'), false);
});

test('a save the check allows is unchanged: no narrowed choice, one check', async () => {
  const t = turn({ rounds:[[save([1])], [reply('saved the Sunspel.', { saved_now:true })]], readings:[reading(['save_or_add_to_list'])] });
  await generateReply(messages('pop the Sunspel on my list'), env, t.fetcher, t.memory);
  assert.equal(t.commits, 1); assert.equal(t.checks.length, 1);
  assert.deepEqual(t.choices, ['required', 'required']);
});
