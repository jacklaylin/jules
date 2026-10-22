import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateReply, consentCheck, repliedOption } from '../lib/ai.js';
import { agentTurn, tool, toolOutputs, isAgentRequest, isConsentCheck } from './helpers/agent.js';

// October 22: "Very cool! Add to my wishlist", sent as a reply under the second product's card, saved
// all three. A save or alert sent under one product's card is for that product unless the message's own
// words name the others; the consent reading quotes those words and code finds them in the message.
const env = { OPENAI_API_KEY:'test', SEARCH_ENABLED:'true', PRICE_ALERTS_ENABLED:'true' };
const product = (name, slug) => ({ brand:'Brand', name, url:`https://www.brand-store.example/products/${slug}`, match:'similar', listing_check:{ status:'verified', product_name:name } });
const options = [product('Aran Sweater Rua Red', 'aran'), product('Flossli Half Zip Sweatshirt', 'flossli'), product('Merino Half Zip in Bordeaux', 'merino')];
const choice = { stage:'choice', query:'chunky red half-zips', options };
const answer = { id:'a1', direction:'outbound', status:'sent', body:'three new options', search_result:{ products:options.map(({ url, name }) => ({ url, name })) } };
const underCard = (body, option, card = answer) => ({ direction:'inbound', status:'received', body, reply_context:{ resolved:true, messages:[{ ...card, replied_to_part:{ kind:'card', option } }] } });
const conversation = newest => [{ direction:'outbound', status:'sent', body:answer.body }, newest];
const reading = (quote = '') => ({ newest_message_asks_for:['save_or_add_to_list', 'watch_price'], newest_message_answers:'nothing_in_particular', asks_itself:true, authorizes:true, other_products_quote:quote });
const consentReply = value => ({ ok:true, json:async () => ({ status:'completed', output:[{ type:'message', content:[{ type:'output_text', text:JSON.stringify(value) }] }] }) });

test('a reply under a card names the pending option with that product, matched by its page', () => {
  assert.deepEqual(repliedOption(conversation(underCard('add to my wishlist', 2)), options), { index:1, name:'Flossli Half Zip Sweatshirt' });
  // A card from an older answer whose product is not among these options stands for none of them.
  const older = { ...answer, search_result:{ products:[{ url:'https://www.brand-store.example/products/older' }, { url:'https://www.brand-store.example/products/older-2' }] } };
  assert.equal(repliedOption(conversation(underCard('add to my wishlist', 2, older)), options), null);
  // A reply under the answer's text (no part), an unresolved reply or no reply names nothing.
  assert.equal(repliedOption(conversation({ ...underCard('add to my wishlist', 2), reply_context:{ resolved:true, messages:[answer] } }), options), null);
  assert.equal(repliedOption(conversation({ ...underCard('add to my wishlist', 2), reply_context:{ resolved:false, messages:[] } }), options), null);
  assert.equal(repliedOption(conversation({ direction:'inbound', body:'add to my wishlist' }), options), null);
});

async function check(newest, indices, value, name = 'save_to_wishlist') {
  const bodies = [], seen = [], out = {};
  const call = { name, args:{ option_indices:indices, ...(name === 'manage_price_alerts' ? { operation:'create' } : {}) } };
  const allowed = await consentCheck(conversation(newest), call, choice, env, async (_url, options) => { bodies.push(JSON.parse(options.body)); return consentReply(value); }, r => seen.push(r), choice, out);
  return { allowed, out, seen, body:bodies[0] };
}

test('without words naming the others, a save or alert under one card is for that card only', async () => {
  for (const name of ['save_to_wishlist', 'manage_price_alerts']) {
    for (const [message, quote] of [['Very cool! Add to my wishlist', ''], ['love this, save it', 'the other two'], ['add to my wishlist', 'all three']]) {
      const result = await check(underCard(message, 2), [0, 1, 2], reading(quote), name);
      assert.equal(result.allowed, true, message);
      assert.equal(result.out.only, 1, message);
      assert.deepEqual({ replied_option:result.seen[0].replied_option, others_named:result.seen[0].others_named }, { replied_option:1, others_named:false });
    }
  }
  // The reading is told which product the reply sits under and what is proposed, never the message's links.
  const { body } = await check(underCard('add to my wishlist', 2), [0, 1, 2], reading());
  const input = JSON.parse(body.input);
  assert.equal(input.replied_under_product, 'Flossli Half Zip Sweatshirt');
  assert.equal(input.proposed_products.names.length, 3);
  assert.ok(body.text.format.schema.required.includes('other_products_quote'));
});

test('words in the message that name other products keep them, in any wording', async () => {
  for (const [message, indices, quote] of [['save all three', [0, 1, 2], 'all three'], ['this and the aran please', [0, 1], 'and the aran'],
    ['actually save the merino one instead', [2], 'the merino one'], ['ADD ALL OF THEM', [0, 1, 2], 'all of them']]) {
    const result = await check(underCard(message, 2), indices, reading(quote));
    assert.equal(result.allowed, true, message);
    assert.equal(result.out.only, undefined, message);
    assert.equal(result.seen[0].others_named, true, message);
  }
});

test('a save of just the replied card, or with no card replied under, is read as before', async () => {
  for (const [newest, indices] of [[underCard('add to my wishlist', 2), [1]], [{ direction:'inbound', body:'save all of them' }, [0, 1, 2]]]) {
    const result = await check(newest, indices, reading());
    assert.equal(result.out.only, undefined);
    assert.ok(!result.body.text.format.schema.required.includes('other_products_quote'));
    assert.equal(JSON.parse(result.body.input).replied_under_product, undefined);
    assert.equal(result.seen[0].replied_option, undefined);
  }
});

test('multi-turn: the agent proposes all three under card 2 and only that product is saved, with its own size', async () => {
  let saved = null;
  const fetcher = async (_url, options) => {
    if (isConsentCheck(options)) return consentReply(reading());
    if (!isAgentRequest(options)) throw new Error('Unexpected request');
    const outputs = toolOutputs(options);
    if (!outputs.length) return agentTurn(tool('save_to_wishlist', { option_indices:[0, 1, 2], consent_context:'explicit_request', size_choices:[{ option_index:0, size:'L' }, { option_index:1, size:'M' }], same_product_groups:[[0, 2]] }));
    return agentTurn(tool('conversation_reply', { response:outputs[0].result, claims:{ saved_now:true, alerts_turned_on:false, alerts_turned_off:false } }));
  };
  const memory = { facts:[], wishlistState:choice, wishlistAction:async intent => { saved = intent; return 'saved the Flossli to your wishlist.'; } };
  const body = await generateReply(conversation(underCard('Very cool! Add to my wishlist', 2)), env, fetcher, memory);
  assert.deepEqual(saved.option_indices, [1]);
  assert.deepEqual(saved.size_choices, [{ option_index:1, size:'M' }]);
  assert.deepEqual(saved.same_product_groups, []);
  assert.match(body, /Flossli/);
});
