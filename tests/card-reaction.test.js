import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateReply } from '../lib/ai.js';
import { agentTurn, tool, toolOutputs, isAgentRequest } from './helpers/agent.js';

// October 23: "This is a good rec", sent under the Nike tank's card, was recorded as interest in the
// Somnea tank (the one Jules had recommended) and Jules offered to save the Somnea. A reaction under one
// product's card is about that product unless the message's own words name the others; a small reading
// quotes those words and code finds them in the message, the same rule as a save under a card (#367).
const env = { OPENAI_API_KEY:'test', SEARCH_ENABLED:'true', PRICE_ALERTS_ENABLED:'true' };
const product = (name, slug) => ({ brand:'Brand', name, url:`https://store.example/products/${slug}`, match:'similar', listing_check:{ status:'verified', product_name:name } });
const options = [product('Pro Dri-Fit Compression Tank', 'nike'), product('340gsm Premium Tank Top', 'somnea'), product('Outdoor Sport Tank', 'ergon')];
const choice = { stage:'choice', query:'sleeveless compression tops', options };
const answer = { id:'a1', direction:'outbound', status:'sent', body:'three tanks; i’d start with the Somnea', search_result:{ products:options.map(({ url, name }) => ({ url, name })) } };
const underCard = (body, option) => ({ direction:'inbound', status:'received', body, reply_context:{ resolved:true, messages:[{ ...answer, replied_to_part:{ kind:'card', option, url:options[option - 1].url } }] } });
const isReactionCheck = request => JSON.parse(request?.body ?? '{}').text?.format?.name === 'card_reaction';
const quoteReply = quote => ({ ok:true, json:async () => ({ status:'completed', output:[{ type:'message', content:[{ type:'output_text', text:JSON.stringify({ other_products_quote:quote }) }] }] }) });

async function react(newest, picked, quote, failCheck = false) {
  let recorded = null, checks = 0;
  const fetcher = async (_u, request) => {
    if (isReactionCheck(request)) { checks++; if (failCheck) throw new Error('down'); return quoteReply(quote); }
    if (!isAgentRequest(request)) throw new Error('Unexpected request');
    const outputs = toolOutputs(request);
    if (!outputs.length) return agentTurn(tool('respond_to_options', { decision:'interest', option_indices:picked }));
    return agentTurn(tool('conversation_reply', { response:String(outputs[0].result ?? 'noted'), claims:{ saved_now:false, alerts_turned_on:false, alerts_turned_off:false } }));
  };
  const memory = { facts:[], wishlistState:choice, wishlistAction:async intent => { recorded = intent; return 'noted.'; } };
  await generateReply([{ direction:'outbound', status:'sent', body:answer.body }, newest], env, fetcher, memory);
  return { indices:recorded?.option_indices, checks };
}

test('praise under one card picking another option is recorded for the card, in any wording', async () => {
  for (const body of ['This is a good rec', 'ooh yes', 'love this one', 'THIS'])
    assert.deepEqual((await react(underCard(body, 1), [1], '')).indices, [0], body);
  // A quote the message doesn't contain names nothing.
  assert.deepEqual((await react(underCard('This is a good rec', 1), [1], 'the Somnea')).indices, [0]);
});

test('words that name other options keep them, even under one card', async () => {
  for (const [body, picked, quote] of [['actually the somnea is better', [1], 'the somnea'], ['this and the second one', [0, 1], 'and the second one'], ['love all three', [0, 1, 2], 'all three']])
    assert.deepEqual((await react(underCard(body, 1), picked, quote)).indices, picked, body);
});

test('no check when the pick is the card itself, there is no card, or it is not interest; a failed check changes nothing', async () => {
  const same = await react(underCard('This is a good rec', 1), [0], '');
  assert.deepEqual([same.indices, same.checks], [[0], 0]);
  const loose = await react({ direction:'inbound', status:'received', body:'the second one is great' }, [1], '');
  assert.deepEqual([loose.indices, loose.checks], [[1], 0]);
  const failed = await react(underCard('This is a good rec', 1), [1], '', true);
  assert.deepEqual([failed.indices, failed.checks], [[1], 1]);
});
