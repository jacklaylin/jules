import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateReply } from '../lib/ai.js';
import { shoppingContext } from '../lib/shopping-context.js';
import { agentTurn, agentContext, tool, toolOutputs, isAgentRequest, isConsentCheck } from './helpers/agent.js';

// The user asked to save an item and watch its price, Jules asked which size, and Jules then sent
// something else (a purchase-history question). The size answer, threaded under that later message,
// still continues the waiting save and alert (October 15, frozen case signal-6730f7f4: the reply's
// thread replaced the pending state with that message's empty product set, so the approval was lost
// and the consent check refused). A reply under an older message, a no, or another topic saves nothing.
const env = { OPENAI_API_KEY:'test', SEARCH_ENABLED:'true', PRICE_ALERTS_ENABLED:'true' };
const url = 'https://www.ssense.example/men/product/our-legacy/beige-still-chino-trousers/1';
const chino = { brand:'OUR LEGACY', name:'Beige Still Chino Trousers', url, match:'unverified', listing_check:{ status:'verified', product_name:'Beige Still Chino Trousers', product_brand:'OUR LEGACY', url } };
const waiting = { stage:'size_set', options:[chino], selected_set:[chino], offered_urls:[url], confirmed_consent:'wishlist_alerts', set_at:'2026-10-15T23:30:36.186414+00:00' };
const saved = [{ id:'old', name:'Old Loafers', links:[{ url:'https://www.ssense.example/men/product/lemaire/loafers/2' }] }];
const at = minutes => new Date(Date.parse('2026-10-15T23:00:00Z') + minutes * 60000).toISOString();
const earlier = { id:'q0', direction:'outbound', status:'sent', created_at:at(10), body:'want me to keep an eye on anything else?', search_result:null };
const sizeQuestion = { id:'q1', direction:'outbound', status:'sent', created_at:'2026-10-15T23:30:36.186414+00:00', body:'which retailer size should i watch? Beige Still Chino Trousers: size availability not verified.' };
const history = { id:'q2', direction:'outbound', status:'sent', created_at:at(53), body:'so the two OUR LEGACY Slack trousers you bought were size 48 and 50, but both were returned. do you want me to keep an eye out for either size in the beige Still Chino Trousers?', search_result:null };
const conversation = [
  { direction:'outbound', status:'sent', created_at:at(18), body:`this looks like the beige Still Chino Trousers at ssense, $590. does this match?\n${url}` },
  { direction:'inbound', status:'received', created_at:at(19), body:'Yes that’s what I want. Add to my wishlist and set an alert' },
  sizeQuestion,
  { direction:'outbound', status:'sent', created_at:at(53), body:'done reading your shopping emails. a few quick questions:' },
  history,
];
const replyUnder = (body, ...referenced) => ({ id:'new', direction:'inbound', status:'received', created_at:at(54), body, reply_context:{ resolved:true, messages:referenced } });

test('a threaded reply under messages with no product set, sent since the state was set, keeps the pending state', () => {
  assert.equal(shoppingContext([...conversation, replyUnder('48', history)], waiting, saved), waiting);
  // A thread whose messages all came after the state was set (the question and the user's own reply in it).
  const ownReply = { id:'r1', direction:'inbound', created_at:at(53.5), body:'hmm', search_result:null };
  assert.equal(shoppingContext([...conversation, replyUnder('48', history, ownReply)], waiting, saved), waiting);
});

test('a reply under an older message, a product message or an unknown one does not apply to the pending state', () => {
  // Under a message sent before the state was set: as before, the saved items stand in.
  const older = shoppingContext([earlier, ...conversation, replyUnder('48', earlier)], waiting, saved);
  assert.equal(older.stage, 'reference');
  assert.equal(older.options[0].saved_item_id, 'old');
  // Under a message with its own product set: that set.
  const other = { brand:'Brand', name:'Other Trousers', url:'https://www.store.example/p/other' };
  const card = { ...history, search_result:{ text_wishlist_state:{ stage:'choice', options:[other] } } };
  assert.equal(shoppingContext([...conversation, replyUnder('48', card)], waiting, saved).options[0].url, other.url);
  // Unknown target, or a state with no recorded time: nothing is assumed.
  assert.equal(shoppingContext([...conversation, { ...replyUnder('48'), reply_context:{ resolved:false, messages:[] } }], waiting, saved), null);
  const { set_at, ...untimed } = waiting;
  assert.equal(shoppingContext([...conversation, replyUnder('48', history)], untimed, saved).options[0].saved_item_id, 'old');
});

// The agent proposes the alert for option 0; the consent reading is scripted per case. What code
// decides is checked: what the agent and the consent check were shown, and whether anything ran.
function turn(newest, reading) {
  let actions = 0, told = null, shown;
  const consent = [], readings = [];
  const fetcher = async (_url, options) => {
    if (isConsentCheck(options)) {
      consent.push(JSON.parse(JSON.parse(options.body).input));
      return { ok:true, json:async () => ({ status:'completed', output:[{ type:'message', content:[{ type:'output_text', text:JSON.stringify(reading) }] }] }) };
    }
    if (!isAgentRequest(options)) return { ok:false };
    const outputs = toolOutputs(options);
    if (!outputs.length) {
      shown = agentContext(options).pending_shopping;
      return agentTurn(tool('manage_price_alerts', { operation:'create', option_indices:[0], consent_context:'pending_offer', size_choices:[{ option_index:0, size:'48' }] }));
    }
    told = outputs[0];
    return agentTurn(tool('conversation_reply', { response:told.status === 'done' ? told.result : 'ok, i won’t save anything.', claims:{ saved_now:told.status === 'done', alerts_turned_on:told.status === 'done', alerts_turned_off:false } }));
  };
  const memory = { facts:[], wishlistState:waiting, wishlistItems:saved, onConsent:r => readings.push(r),
    wishlistAction:async () => { actions++; return 'saved Beige Still Chino Trousers and turned on price-drop reminders for size 48.'; } };
  return generateReply([...conversation, newest], env, fetcher, memory).then(body => ({ body, actions, told, shown, consent, readings }));
}
const detail = authorizes => ({ newest_message_asks_for:['answer_jules'], newest_message_answers:'the_detail_for_the_approved_action', asks_itself:false, authorizes });

test('multi-turn: the size, in any form, threaded under a later question continues the waiting save and alert', async () => {
  for (const body of ['48', 'Size 48 is fine', 'let’s go with the 48', 'EU 48 please', '48 works, same as the Slack']) {
    const result = await turn(replyUnder(body, history), detail(true));
    assert.equal(result.shown.stage, 'size_set', body);
    assert.equal(result.shown.set_at, undefined, 'the time is for code, not the model');
    assert.ok(result.consent[0].approved_earlier, body);
    assert.equal(result.readings[0].approved_earlier, true);
    assert.equal(result.actions, 1, body);
    assert.match(result.body, /saved Beige Still Chino/);
  }
});

test('multi-turn: a no or another topic in the same spot saves nothing, though the approval stays', async () => {
  for (const [body, reading] of [
    ['no, not those anymore', detail(false)],
    ['nah forget it', detail(false)],
    ['those ran small. anyway any good navy overshirts?', { newest_message_asks_for:['find_or_show'], newest_message_answers:'a_different_jules_question', asks_itself:false, authorizes:false }],
    ['call me jack', { newest_message_asks_for:['question_or_comment'], newest_message_answers:'nothing_in_particular', asks_itself:false, authorizes:true }],
  ]) {
    const result = await turn(replyUnder(body, history), reading);
    assert.equal(result.actions, 0, body);
    assert.equal(result.told.status, 'blocked', body);
    assert.equal(result.readings[0].allowed, false);
  }
});

test('multi-turn: a size threaded under a message from before the request has no approval to continue', async () => {
  // Even a reading that calls it the awaited detail is refused: the state the reply is about has none.
  const result = await turn(replyUnder('48', earlier), detail(true));
  assert.notEqual(result.shown?.stage, 'size_set');
  assert.equal(result.actions, 0);
  assert.equal(result.consent[0]?.approved_earlier ?? null, null);
});
