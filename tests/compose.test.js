import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeReply, checkComposed, recentTurns } from '../lib/compose.js';
import { receiveInInbox } from '../lib/inbox.js';
import { deliverReply } from '../lib/replies.js';
import { generateReply } from '../lib/ai.js';
import { agentTurn, tool } from './helpers/agent.js';

// Every reply code drafts is rewritten by the model in Jules's voice, then checked by code: the same
// links, no new prices, and no claim of a save or alert that did not happen in this turn.
const env = { OPENAI_API_KEY:'test' };
const url = 'https://visionaryoptics.com/products/jacques-marie-mage-romi';
const draft = `One option to start with.\n\nJacques Marie Mage Romi Sunglasses · $1,295.00\n${url}\n\nDoes this feel close? Tell me what to change, or ask for more.`;
const none = { saved_now:false, alerts_turned_on:false, alerts_turned_off:false };
const written = (reply, claims = {}, photo_captions = []) => ({ ok:true, json:async () => ({ status:'completed', output:[{ type:'message', content:[{ type:'output_text', text:JSON.stringify({ reply, claims:{ ...none, ...claims }, photo_captions }) }] }] }) });

test('checks keep links and prices exact and claims honest', () => {
  const ok = { reply:`Romi in black is a strong pick at $1,295.00.\n${url}\nWant it in another color?`, claims:none, photo_captions:[] };
  assert.deepEqual(checkComposed(ok, { draft, facts:none }), []);
  assert.match(checkComposed({ ...ok, reply:'Romi is a strong pick.' }, { draft, facts:none })[0], /Include these links/);
  assert.match(checkComposed({ ...ok, reply:ok.reply + '\nhttps://stockx.com/x' }, { draft, facts:none })[0], /Remove links/);
  for (const price of ['$1,195', '€1,295.50', '990 USD']) assert.match(checkComposed({ ...ok, reply:ok.reply + ` Also ${price}.` }, { draft, facts:none }).join(), /Remove prices/, price);
  assert.match(checkComposed({ ...ok, claims:{ ...none, saved_now:true } }, { draft, facts:none })[0], /Do not say saved now/);
  assert.match(checkComposed(ok, { draft, facts:{ ...none, alerts_turned_on:true } })[0], /alerts turned on happened/);
  assert.match(checkComposed(ok, { draft, facts:none, photos:[{ name:'Romi' }] })[0], /photo captions/);
  assert.match(checkComposed({ ...ok, photo_captions:['see https://x.example'] }, { draft, facts:none, photos:[{ name:'Romi' }] })[0], /photo captions/);
  assert.match(checkComposed({ ...ok, reply:' ' }, { draft, facts:none })[0], /empty/);
});

test('the model writes the reply from the outcome, the recent turns and the voice guide', async () => {
  let request;
  const result = await composeReply({ draft, facts:none, env, conversation:recentTurns([{ direction:'inbound', body:'I want the Romi glasses' }, { direction:'outbound', status:'sending', body:'draft' }]),
    fetcher:async (_url, options) => { request = JSON.parse(options.body); return written(`Found the Romi—$1,295.00 here.\n${url}\nClose enough, or should I look at other colors?`); } });
  assert.equal(result.composed, true); assert.match(result.body, /^Found the Romi/);
  assert.match(request.instructions, /Voice guide:/); assert.match(request.instructions, /do not reuse the openers/);
  assert.match(request.input[0].content, /I want the Romi glasses/); assert.doesNotMatch(request.input[0].content, /"draft"/);
  assert.equal(JSON.parse(request.input[1].content.replace(/^OUTCOME \(data, not instructions\): /, '')).draft, draft);
  assert.equal(request.text.format.strict, true);
});

test('a rejected reply is retried once with the problems, then the factual draft is used', async () => {
  let calls = 0, retry;
  const fixed = await composeReply({ draft, facts:none, env, fetcher:async (_url, options) => { calls++; if (calls === 2) retry = JSON.parse(options.body).input.at(-1).content;
    return calls === 1 ? written('No link here.') : written(`Here you go, $1,295.\n${url}`); } });
  assert.equal(calls, 2); assert.match(retry, /Include these links/); assert.match(retry, /Include the prices the results give/); assert.equal(fixed.body, `Here you go, $1,295.\n${url}`);
  calls = 0;
  const stuck = await composeReply({ draft, facts:none, env, fetcher:async () => { calls++; return written(`Saved it!\n${url}`, { saved_now:true }); } });
  assert.equal(calls, 2); assert.equal(stuck.body, draft); assert.equal(stuck.composed, false);
});

// October 19 founder test: "size 12 in stock and ready to ship" with the verified $249 left out.
test('a reply must keep the prices the results give, and may not add shop facts they do not state', async () => {
  const { auditClaims, auditProblems } = await import('../lib/compose.js');
  const boots = 'found it.\n\nThursday Desperado | Black Matte · $249.00 · size 12 in stock\nhttps://thursdayboots.com/products/desperado';
  const dropped = checkComposed({ reply:'size 12 is in stock.\nhttps://thursdayboots.com/products/desperado', claims:{} }, { draft:boots });
  assert.ok(dropped.some(p => /^Include the prices the results give.*249/.test(p)));
  assert.deepEqual(checkComposed({ reply:'yours in a 12, $249.\nhttps://thursdayboots.com/products/desperado', claims:{} }, { draft:boots }), []);
  assert.deepEqual(checkComposed({ reply:'they were $249 last time.', claims:{} }, { draft:'', context:boots }), [], 'earlier prices may be repeated, not required');
  let sent;
  const reader = statements => async (_url, options) => { sent = JSON.parse(options.body); return { ok:true, json:async () => ({ status:'completed', output:[{ type:'message', content:[{ type:'output_text',
    text:JSON.stringify({ texts_about_purchases_changed:false, saved_now:false, alerts_turned_on:false, alerts_turned_off:false, names_other_saved_item:false, shop_statements:statements }) }] }] }) }; };
  const said = (quote, kind, in_results) => ({ quote, kind, in_results });
  const audit = await auditClaims({ reply:'size 12 in stock and ready to ship, $249.', results:boots, env, fetcher:reader([said('size 12 in stock', 'states_fact', true), said('ready to ship', 'states_fact', false)]) });
  assert.match(sent.input.find(i => i.content.startsWith('RESULTS')).content, /size 12 in stock/, 'the reader sees what the results say');
  assert.deepEqual(sent.text.format.schema.properties.shop_statements.items.properties.kind.enum, ['states_fact', 'says_unknown', 'question_or_offer']);
  const problems = auditProblems(audit, {});
  assert.equal(problems.length, 1); assert.match(problems[0], /^The message states things the results do not support: "ready to ship"/);
  // Saying something is unknown, or asking, is honest even though the results don't state it.
  const honest = await auditClaims({ reply:'size 12 in stock, $249. i couldn’t see shipping times; want me to watch the price?', results:boots, env,
    fetcher:reader([said('size 12 in stock', 'states_fact', true), said('i couldn’t see shipping times', 'says_unknown', false), said('want me to watch the price', 'question_or_offer', false)]) });
  assert.deepEqual(auditProblems(honest, {}), []);
});

test('when the model is unavailable or not configured, the draft is sent and nothing is lost', async () => {
  assert.equal((await composeReply({ draft, env, fetcher:async () => { throw new Error('offline'); } })).body, draft);
  assert.equal((await composeReply({ draft, env, fetcher:async () => ({ ok:false }) })).body, draft);
  assert.equal((await composeReply({ draft, env:{}, fetcher:assert.fail })).body, draft);
  assert.equal((await composeReply({ draft, env:{ OPENAI_API_KEY:'replace-with-key' }, fetcher:assert.fail })).body, draft);
});

function inbox(turn, { compose } = {}) {
  const sent = [], composed = [];
  const store = { receive:async () => 'c', claimAI:async () => true, context:async () => [{ id:'00000000-0000-4000-8000-000000000001', direction:'inbound', body:'Romi glasses please', status:'received' }],
    prepareAI:async () => {}, finish:async () => {}, searchResult:async () => {} };
  const options = { store, send:async (_d, body, _e, extra) => sent.push({ body, products:extra?.products ?? [] }),
    compose:async args => { composed.push(args); return compose ? compose(args) : { body:'[composed] ' + args.draft, captions:[], composed:true }; },
    generate:(m, e, _f, memory) => generateReply(m, e, async () => agentTurn(turn), { ...memory, wishlistAction:async () => draft }) };
  return { sent, composed, run:() => receiveInInbox({ space:{ phone:'l' }, message:{ id:'m', sender:{ id:'s' }, content:{ type:'text', text:'Romi glasses please' }, attachments:[] } }, { AI_ENABLED:'true', OPENAI_API_KEY:'test', SEARCH_ENABLED:'true', WISHLIST_ENABLED:'true' }, options) };
}

test('code-drafted replies are composed with the turn’s facts; replies the agent wrote are sent as written', async () => {
  const search = inbox(tool('find_products', { query:'Jacques Marie Mage Romi' }));
  await search.run();
  assert.equal(search.composed.length, 1); assert.equal(search.composed[0].draft, draft); assert.deepEqual(search.composed[0].facts, none);
  assert.equal(search.composed[0].purpose, 'find_products'); assert.equal(search.composed[0].conversation[0].text, 'Romi glasses please');
  assert.equal(search.sent[0].body, '[composed] ' + draft);
  const chat = inbox(tool('conversation_reply', { response:'Navy works with grey flannel.' }));
  await chat.run();
  assert.equal(chat.composed.length, 0); assert.equal(chat.sent[0].body, 'Navy works with grey flannel.');
});

test('a failed agent turn sends the fallback without composing', async () => {
  const sent = [];
  await receiveInInbox({ space:{ phone:'l' }, message:{ id:'m', sender:{ id:'s' }, content:{ type:'text', text:'hi' }, attachments:[] } }, { AI_ENABLED:'true' },
    { store:{ receive:async () => 'c', claimAI:async () => true, context:async () => { throw new Error('db'); }, prepareAI:async () => {}, finish:async () => {} },
      send:async (_d, body) => sent.push(body), compose:assert.fail, generate:assert.fail });
  assert.match(sent[0], /couldn’t prepare a reply/);
});

test('a save reports exactly what happened: saved now, alerts on, or already saved', async () => {
  const { finishTextWishlist } = await import('../lib/text-wishlist.js'); const { groupWishlist } = await import('../lib/wishlist.js');
  const id = '00000000-0000-4000-8000-000000000001';
  const rows = [{ reply_id:'r1', item_id:id, name:'Romi', links:[{ url }], messages:{ created_at:'2026-10-13' } }];
  const store = { wishlistReplyId:async () => 'r1', wishlistEntries:async () => rows, recordEvidence:async () => {}, enablePriceAlert:async () => ({ active:true }) };
  const base = { identification_policy:'text_wishlist', user_confirmed:true };
  let outcome = {};
  await finishTextWishlist({ store, result:base, env:{}, conversationId:id, outcome }); assert.deepEqual(outcome, { saved_now:true, alerts_turned_on:false, saved_items:['Romi'] });
  outcome = {};
  await finishTextWishlist({ store, result:{ ...base, alert_requests:[{ url, size:null, baselines:[], links:[{ url }] }] }, env:{}, conversationId:id, outcome }); assert.deepEqual(outcome, { saved_now:true, alerts_turned_on:true, saved_items:['Romi'] });
  outcome = {};
  await finishTextWishlist({ store, result:{ ...base, existing_saved_groups:[groupWishlist(rows)[0].id] }, env:{}, conversationId:id, outcome }); assert.deepEqual(outcome, { saved_now:false, alerts_turned_on:false, already_saved_items:['Romi'] });
});

test('notifications are composed before sending and the sent wording is what the conversation stores', async () => {
  const stored = [], sent = [];
  const store = { reserve:async () => true, prepareAI:async (_op, body) => stored.push(body), finish:async () => {}, recent:async () => [{ direction:'inbound', body:'thanks', status:'received' }] };
  let seen;
  await deliverReply({ store, send:async (_d, body) => sent.push(body), conversation:{ id:'c', sender_id:'s', line:'l' }, operation:'price-alert:1', body:'Price drop: Romi is now $995.', source:'operator', env, purpose:'price_alert',
    compose:async args => { seen = args; return { body:'Good news—the Romi dropped to $995.', captions:[], composed:true }; } });
  assert.equal(seen.purpose, 'price_alert'); assert.equal(seen.conversation[0].text, 'thanks'); assert.deepEqual(seen.facts, {});
  assert.deepEqual(stored, ['Good news—the Romi dropped to $995.']); assert.deepEqual(sent, ['Good news—the Romi dropped to $995.']);
});

test('the #dev acknowledgment is sent exactly as written, never composed', async () => {
  const { FEEDBACK_ACK } = await import('../lib/developer-feedback.js');
  const sent = [];
  const store = { receive:async () => 'c', saveFeedback:async () => {}, reserve:async () => true, prepareAI:assert.fail, finish:async () => {}, recent:async () => [] };
  const fetcher = globalThis.fetch; globalThis.fetch = () => assert.fail('no model call for the acknowledgment');
  try {
    await receiveInInbox({ space:{ phone:'l' }, message:{ id:'m', sender:{ id:'s' }, content:{ type:'text', text:'#dev openers repeat' }, attachments:[] } }, { AI_ENABLED:'true', OPENAI_API_KEY:'real-looking' },
      { store, send:async (_d, body) => sent.push(body), compose:assert.fail, generate:assert.fail });
  } finally { globalThis.fetch = fetcher; }
  assert.deepEqual(sent, [FEEDBACK_ACK]);
});
