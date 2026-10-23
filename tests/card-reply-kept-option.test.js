import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../lib/store.js';
import { cardOption } from '../lib/message-context.js';
import { generateReply } from '../lib/ai.js';
import { agentTurn, tool, toolOutputs, isAgentRequest, isConsentCheck } from './helpers/agent.js';

// October 22: "Love this. Add to my wishlist" under the Filling Pieces card saved the Norse Projects
// sweater. The search kept Norse from the last answer as result 1 without linking it again, so the
// cards were Filling Pieces (card 1) and ReefKnots (card 2). Card 1 was read as result 1, and the save
// and its consent narrowing both took Norse. A card now names its product's page, and an older card's
// number is counted over the answer's linked products.
const url = slug => `https://store.example/products/${slug}`;
const products = [{ brand:'Norse Projects', name:'Flossli Half Zip', url:url('flossli') }, { brand:'Filling Pieces', name:'Zip Knit Chunky Fisherman', url:url('fisherman') }, { brand:'ReefKnots', name:'Burford Half Zip', url:url('burford') }];
const body = `still considering the Flossli. two new ones:\n\n1. Filling Pieces Zip Knit\n${url('fisherman')}\n\n2. ReefKnots Burford.\n${url('burford')}`;
const answer = (parts) => ({ id:'answer', provider_id:'p-answer', direction:'outbound', status:'sent', body, created_at:'2026-10-22T21:57:42Z', reply_provider_id:null,
  search_result:{ products, text_wishlist_state:{ stage:'choice', options:products } }, reply_diagnostics:{ outcome:'sent', sent_parts:parts } });

test('a card stands for the product it showed, not the result with its number', () => {
  const sent = answer([]);
  // Cards sent since this change name the page.
  assert.deepEqual(cardOption(sent, { id:'c1', kind:'card', option:1, url:url('fisherman') }), { option:2, url:url('fisherman') });
  assert.deepEqual(cardOption(sent, { id:'c2', kind:'card', option:2, url:url('burford') }), { option:3, url:url('burford') });
  // Older cards counted the linked products.
  assert.deepEqual(cardOption(sent, { id:'c1', kind:'card', option:1 }), { option:2, url:url('fisherman') });
  assert.deepEqual(cardOption(sent, { id:'c2', kind:'card', option:2 }), { option:3, url:url('burford') });
  // With nothing linked or no stored results, the number is kept as it was.
  assert.deepEqual(cardOption({ body:'two shirts', search_result:{} }, { option:2 }), { option:2 });
  assert.deepEqual(cardOption({ ...sent, body:'no links' }, { option:1 }), { option:1 });
  // A page that is not among the results names nothing.
  assert.deepEqual(cardOption(sent, { option:1, url:url('other') }), { option:1 });
});

const store = messages => createStore({ SUPABASE_URL:'https://example.invalid', SUPABASE_SERVICE_ROLE_KEY:'fake' }, async address => {
  const u = new URL(address), p = k => u.searchParams.get(k), part = p('reply_diagnostics->sent_parts');
  let rows;
  if (part) { const [{ id }] = JSON.parse(part.slice(3)); rows = messages.filter(m => m.direction === 'outbound' && m.reply_diagnostics?.sent_parts?.some(s => s.id === id)); }
  else if (p('provider_id')) rows = messages.filter(m => m.provider_id === p('provider_id').slice(3));
  else if (p('reply_provider_id')) rows = [];
  else rows = [...messages].reverse();
  return { ok:true, text:async () => JSON.stringify(rows) };
});

test('a reply under the first card of an answer that kept an earlier option resolves to the card’s product', async () => {
  for (const parts of [[{ id:'p-card-1', kind:'card', option:1 }, { id:'p-card-2', kind:'card', option:2 }],
    [{ id:'p-card-1', kind:'card', option:1, url:url('fisherman') }, { id:'p-card-2', kind:'card', option:2, url:url('burford') }]]) {
    const current = { id:'current', provider_id:'p-current', direction:'inbound', body:'Love this. Add to my wishlist', created_at:'2026-10-22T21:58:00Z', reply_provider_id:'p-card-1' };
    const rows = await store([answer(parts), current]).context('owner', 'p-current');
    assert.deepEqual(rows.find(m => m.id === 'current').reply_context.messages[0].replied_to_part, { kind:'card', option:2, url:url('fisherman') });
  }
});

test('multi-turn: the agent proposes the kept option under the Filling Pieces card, and Filling Pieces is saved', async () => {
  const env = { OPENAI_API_KEY:'test', SEARCH_ENABLED:'true', PRICE_ALERTS_ENABLED:'true' };
  const options = products.map(p => ({ ...p, match:'similar', listing_check:{ status:'verified', product_name:p.name } }));
  const choice = { stage:'choice', query:'chunky red half-zips', options };
  const card = { ...answer([]), reply_diagnostics:undefined, replied_to_part:{ kind:'card', option:2, url:url('fisherman') } };
  const newest = { direction:'inbound', status:'received', body:'Love this. Add to my wishlist', reply_context:{ resolved:true, messages:[card] } };
  const reading = { newest_message_asks_for:['save_or_add_to_list'], newest_message_answers:'nothing_in_particular', asks_itself:true, authorizes:true, other_products_quote:'' };
  let saved = null;
  const fetcher = async (_u, request) => {
    if (isConsentCheck(request)) return { ok:true, json:async () => ({ status:'completed', output:[{ type:'message', content:[{ type:'output_text', text:JSON.stringify(reading) }] }] }) };
    if (!isAgentRequest(request)) throw new Error('Unexpected request');
    const outputs = toolOutputs(request);
    if (!outputs.length) return agentTurn(tool('save_to_wishlist', { option_indices:[0], consent_context:'explicit_request' }));
    return agentTurn(tool('conversation_reply', { response:outputs[0].result, claims:{ saved_now:true, alerts_turned_on:false, alerts_turned_off:false } }));
  };
  const memory = { facts:[], wishlistState:choice, wishlistAction:async intent => { saved = intent; return 'saved the Filling Pieces to your wishlist.'; } };
  await generateReply([{ direction:'outbound', status:'sent', body }, newest], env, fetcher, memory);
  assert.deepEqual(saved.option_indices, [1]);
});
