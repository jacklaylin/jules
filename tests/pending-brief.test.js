import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateReply } from '../lib/ai.js';
import { stateFromSearch } from '../lib/shopping-context.js';
import { tool, restating, agentTurn, agentContext } from './helpers/agent.js';

// A search that ran outside the text wishlist (a photo search, or the web search beside it) recorded its
// products but not what they were for. The next turn's pending options then had no brief and no plan,
// and a follow-up such as "save the black one, is it anywhere else?" was planned against an older
// request still in the conversation. The brief is now kept with the result, so the pending state
// says which request its options belong to.
const url = 'https://optician.example/products/romi-black';
const found = { intro:'found', products:[{ brand:'Jacques Marie Mage', name:'Romi / Black', url, match:'likely_match', reason:'Same frame.' }], needs_review:false };
const response = output => ({ ok:true, json:async () => ({ status:'completed', output }) });
const searchOutput = [{ type:'web_search_call', status:'completed', action:{ type:'search', sources:[{ url }] } }, { type:'message', role:'assistant', content:[{ type:'output_text', text:JSON.stringify(found) }] }];

for (const query of ['Jacques Marie Mage Romi glasses best price', '  black Romi frames from the photo  ']) test(`a photo-path search keeps its brief with the result: ${query.trim()}`, async () => {
  let calls = 0, recorded;
  await generateReply([{ direction:'inbound', body:'where is this cheapest?' }], { OPENAI_API_KEY:'fake', SEARCH_ENABLED:'true' }, restating(async (_endpoint, options) => {
    if (++calls === 1) return response([tool('find_products', { query, use_image:true })]);
    return response(searchOutput);
  }), { loadImages:async () => [{ mime_type:'image/jpeg', data:'fake' }], recordSearch:async r => { recorded = r; } });
  assert.equal(recorded.search_brief, query.trim());
  const state = stateFromSearch(recorded);
  assert.equal(state.search_brief, query.trim()); assert.equal(state.search_plan.mode, 'identify'); assert.equal(state.search_plan.continuation, false);

  // The next turn (a threaded follow-up with an older, different request saved in the wishlist) sees
  // the brief and plan of the options it is about.
  let context;
  await generateReply([{ direction:'outbound', status:'sent', body:'here are some options' }, { direction:'inbound', body:'save the black, is it at any other stores?' }],
    { OPENAI_API_KEY:'fake', SEARCH_ENABLED:'true', WISHLIST_ENABLED:'true' }, restating(async (_u, options) => { context ??= agentContext(options); return agentTurn(tool('conversation_reply', { response:'ok' })); }),
    { wishlistState:state, wishlistAction:async () => 'unused', wishlistItems:[{ id:'g1', name:'Peyter Pants', links:[{ url:'https://shop.example/peyter' }], price_alert:{ active:true, size:'32' } }] });
  assert.equal(context.pending_shopping.search_brief, query.trim());
  assert.equal(context.pending_shopping.current_search_plan.mode, 'identify');
});

test('a search result that already carries its own brief (a visual search) keeps it', async () => {
  const visual = { ...found, search_brief:'black acetate frames, keyhole bridge', visual_targets:[{ label:'glasses', search_mode:'exact' }] };
  assert.equal(stateFromSearch(visual).search_brief, 'black acetate frames, keyhole bridge');
});
