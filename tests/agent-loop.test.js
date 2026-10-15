import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateReply, optionFacts } from '../lib/ai.js';
import { textWishlistAction } from '../lib/text-wishlist.js';
import { receiveInInbox } from '../lib/inbox.js';
import { agentTurn, tool, toolOutputs, isAgentRequest, isConsentCheck, consentResponse } from './helpers/agent.js';

// The chat agent is a bounded loop: tools run, their results go back to the model, and the model
// either calls more tools or writes the message, which code checks before it is sent. These tests
// script the model's rounds and assert what ran, what it was told, and what was sent.
const env = { OPENAI_API_KEY:'test', SEARCH_ENABLED:'true', PRICE_ALERTS_ENABLED:'true' };
const facts = [{ field:'gender', key:'identity', value:'man', basis:'stated' }];
const url = 'https://www.dover-street-market.example/products/peyter-pants-black';
const peyter = { brand:'Dries Van Noten', name:'Peyter Pants', url, match:'likely_match', sourcing_status:'store_found',
  listing_check:{ status:'verified', product_name:'Peyter Pants', product_brand:'Dries Van Noten', color:'Black', shopping_range:'men', url }, price_snapshot:{ amount:795, currency:'USD' } };
const cheaper = { ...peyter, url:url.replace('dover-street-market', 'ssense'), listing_check:{ ...peyter.listing_check, url:url.replace('dover-street-market', 'ssense') }, price_snapshot:{ amount:610, currency:'USD' } };
const unread = { brand:'Dries Van Noten', name:'Peyter Pants', url, match:'likely_match', sourcing_status:'store_not_found', listing_checks:[{ status:'check_failed' }] };
const reply = (response, claims = {}) => tool('conversation_reply', { response, claims:{ saved_now:false, alerts_turned_on:false, alerts_turned_off:false, ...claims } });
const say = body => [{ direction:'inbound', status:'received', body }];

// A scripted model: rounds[i] answers the i-th agent request (it may inspect the request). Consent
// checks approve unless told otherwise.
function model(rounds, { authorizes = true } = {}) {
  const requests = [];
  const fetcher = async (_url, options) => {
    if (isConsentCheck(options)) return consentResponse(authorizes);
    if (!isAgentRequest(options)) throw new Error('Unexpected request');
    const body = JSON.parse(options.body); requests.push(body);
    const next = rounds[requests.length - 1];
    if (!next) throw new Error('No scripted round ' + requests.length);
    const out = typeof next === 'function' ? next(options, body) : next;
    return Array.isArray(out) ? agentTurn(...out) : out;
  };
  return { fetcher, requests };
}
// The text-wishlist executor with search, alert inspection and the inbox's state/commit hooks faked.
function shopping({ results = [[peyter]], state = null, commit = true } = {}) {
  let recorded = null, searches = 0, commits = 0;const outcome = { saved_now:false, alerts_turned_on:false, alerts_turned_off:false };
  const inspect = async links => ({ sizes:['IT 50'], checks:[{ offers:[{ size:'IT 50', key:'IT 50', amount:610, currency:'USD', available:true, url:links[0].url }] }] });
  const memory = { facts, outcome, wishlistState:state,
    wishlistAction:(args, current) => textWishlistAction(args, { state:current, facts, env, inspect, rank:async x => x, record:async r => { recorded = r; },
      search:async () => ({ products:results[Math.min(searches++, results.length - 1)], refinement_attempted:true }) }),
    shoppingState:() => recorded && 'text_wishlist_state' in recorded ? recorded.text_wishlist_state : undefined,
    shoppingConfirmed:() => recorded?.user_confirmed === true,
    ...(commit ? { commitWishlist:async () => { commits++; outcome.saved_now = true; outcome.alerts_turned_on = (recorded.alert_requests ?? []).length > 0;
      return 'saved to your wishlist. price-drop and back-in-stock reminders are on for the selected item.'; } } : {}) };
  return { memory, get recorded() { return recorded; }, get searches() { return searches; }, get commits() { return commits; }, outcome };
}

test('one turn can search, then set an alert on what the search found, then report both', async () => {
  const shop = shopping({ results:[[cheaper]], state:{ stage:'choice', options:[peyter] } });
  let told;
  const { fetcher, requests } = model([
    [tool('find_products', { query:'Dries Van Noten Peyter pants black, cheaper', search_plan:{ continuation:true, named_model:'Peyter', mode:'identify', required_brands:['Dries Van Noten'], hard_constraints:['black'], guidance:['cheaper'], keep_option_indices:[], exclude_option_indices:[0] } })],
    (options) => { told = toolOutputs(options)[0]; return [tool('manage_price_alerts', { operation:'create', option_indices:[0], consent_context:'explicit_request', size_choices:[{ option_index:0, size:'IT 50' }], option_sizing:[{ option_index:0, sizing:'apparel' }] })]; },
    [reply(`SSENSE has the Peyter for $610.00, cheaper than the $795 at Dover Street Market.\n${cheaper.url}\nsaved it and the price alert is on for IT 50.`, { saved_now:true, alerts_turned_on:true })],
  ]);
  const body = await generateReply(say('can you find these for cheaper and set a price alert?'), env, fetcher, shop.memory);
  assert.equal(requests.length, 3); assert.equal(shop.searches, 1); assert.equal(shop.commits, 1);
  // The model saw the search's options (with price and what is unknown) before choosing the alert.
  assert.equal(told.status, 'done'); assert.equal(told.pending_shopping.options[0].url, cheaper.url); assert.equal(told.pending_shopping.options[0].price, '$610.00');
  assert.equal(shop.recorded.alert_requests[0].url, cheaper.url); assert.equal(shop.recorded.alert_requests[0].size, 'IT 50');
  assert.match(body, /\$610\.00/); assert.ok(body.includes(cheaper.url));
  // The final round sees the alert's outcome, so the message can say it happened.
  assert.deepEqual(JSON.parse(requests[2].input.at(-1).output).outcome, { saved_now:true, alerts_turned_on:true, alerts_turned_off:false });
});

test('the loop stops at the round cap and then makes the model write the message', async () => {
  const shop = shopping({ results:[[peyter]] });
  const search = q => [tool('find_products', { query:q })];
  const { fetcher, requests } = model([search('a'), search('b'), search('c'), search('d'), [reply('here is what i found.\n' + url)]]);
  const body = await generateReply(say('keep looking'), env, fetcher, shop.memory);
  assert.equal(shop.searches, 4); assert.equal(requests.length, 5);
  assert.equal(requests[3].tool_choice, 'required'); assert.deepEqual(requests[4].tool_choice, { type:'function', name:'conversation_reply' });
  assert.match(body, /here is what i found/);
});

test('a repeated call is not run twice; the model is asked once to write instead', async () => {
  const shop = shopping();
  const call = tool('find_products', { query:'Peyter pants' });
  const { fetcher, requests } = model([[call], [call], [reply('found the Peyter.\n' + url + '\n$795.00 there.')]]);
  const body = await generateReply(say('find the peyter pants'), env, fetcher, shop.memory);
  assert.equal(shop.searches, 1); assert.equal(requests.length, 3);
  assert.equal(JSON.parse(requests[2].input.at(-1).output).status, 'not_run'); assert.deepEqual(requests[2].tool_choice, { type:'function', name:'conversation_reply' });
  assert.match(body, /found the Peyter/);
});

test('a search that would overrun the shared deadline is not started; the model is told why', async () => {
  const shop = shopping();
  const { fetcher } = model([[tool('find_products', { query:'Peyter pants' })], (options) => {
    assert.match(toolOutputs(options)[0].error, /No time left/); return [reply('i ran out of time to search again. want me to try now?')];
  }]);
  const body = await generateReply(say('find the peyter pants'), { ...env, AGENT_DEADLINE_MS:'30000' }, fetcher, shop.memory);
  assert.equal(shop.searches, 0); assert.match(body, /ran out of time/);
});

test('a message that drops a link, adds a price or claims a save is rejected once with the problems, then fixed', async () => {
  const shop = shopping();
  let problems;
  const { fetcher, requests } = model([
    [tool('find_products', { query:'Peyter pants' })],
    [reply('found them for $500 and saved them.', { saved_now:true })],
    (options) => { problems = toolOutputs(options).at(-1).problems; return [reply(`found them at Dover Street Market for $795.00.\n${url}\nwant me to save them?`)]; },
  ]);
  const body = await generateReply(say('find the peyter pants'), env, fetcher, shop.memory);
  assert.equal(requests.length, 3); assert.deepEqual(requests[2].tool_choice, { type:'function', name:'conversation_reply' });
  assert.ok(problems.some(p => /Include these links/.test(p))); assert.ok(problems.some(p => /Remove prices.*500/.test(p))); assert.ok(problems.some(p => /saved now/.test(p)));
  assert.match(body, /want me to save them/);
});

test('a second failed message sends the plain factual draft, never the wrong wording', async () => {
  const shop = shopping();let final;
  const { fetcher } = model([[tool('find_products', { query:'Peyter pants' })], [reply('they are $500.')], [reply('they are $450 now.')]]);
  const body = await generateReply(say('find the peyter pants'), env, fetcher, { ...shop.memory, onReply:name => { final = name; } });
  assert.ok(body.includes(url)); assert.match(body, /\$795\.00/); assert.doesNotMatch(body, /\$500|\$450/);
  // The plain draft is final: the inbox does not rewrite it again.
  assert.equal(final, 'agent_plain');
});

test('a conversation-only message may repeat prices and links already in the conversation, not new ones', async () => {
  const history = [{ direction:'outbound', status:'sent', body:`Peyter Pants · $795.00\n${url}` }, ...say('how much were they again?')];
  const ok = model([[reply(`$795 at Dover Street Market.\n${url}`)]]);
  assert.match(await generateReply(history, env, ok.fetcher, {}), /\$795/);
  const wrong = 'they were $795 at Dover Street Market. SSENSE has them for $640: https://www.ssense.com/x';
  const invented = model([[reply(wrong)], [reply(wrong + ' ')]]);
  // Twice wrong with nothing drafted: only the sentences that pass the checks are sent.
  assert.equal(await generateReply(history, env, invented.fetcher, {}), 'they were $795 at Dover Street Market.');
});

test('an unreachable model is retried once with reduced context; only then does the turn fail', async () => {
  const long = Array.from({ length:12 }, (_, i) => ({ direction:i % 2 ? 'outbound' : 'inbound', status:i % 2 ? 'sent' : 'received', body:'message ' + i }));
  const down = { ok:false, status:503, json:async () => ({}) };
  const flaky = model([down, [reply('back again.')]]);
  assert.equal(await generateReply(long, env, flaky.fetcher, {}), 'back again.');
  assert.ok(flaky.requests[1].input.length < flaky.requests[0].input.length);
  const dead = model([down, down]);
  await assert.rejects(generateReply(long, env, dead.fetcher, {}), /AI request failed/);
});

test('a blocked save comes back as a tool result; the model asks instead and nothing is saved', async () => {
  const shop = shopping({ state:{ stage:'choice', options:[peyter] } });
  const { fetcher } = model([[tool('save_to_wishlist', { option_indices:[0] })], (options) => {
    assert.equal(toolOutputs(options)[0].status, 'blocked'); return [reply('want me to save the Peyter pants to your wishlist?')];
  }], { authorizes:false });
  assert.match(await generateReply(say('yes'), env, fetcher, shop.memory), /want me to save/);
  assert.equal(shop.commits, 0); assert.equal(shop.recorded, null);
});

test('only one save or alert change runs per turn', async () => {
  const shop = shopping({ state:{ stage:'choice', options:[peyter, cheaper] } });
  let second;
  const { fetcher } = model([[tool('save_to_wishlist', { option_indices:[0] })], (options) => [tool('save_to_wishlist', { option_indices:[1] })],
    (options) => { second = toolOutputs(options).at(-1); return [reply('saved the Peyter pants.', { saved_now:true })]; }]);
  await generateReply(say('save both, one at a time'), env, fetcher, shop.memory);
  assert.equal(shop.commits, 1); assert.equal(second.status, 'not_run');
});

test('a retrieved listing whose page could not be read is offered, described with what is unknown, and can be saved', async () => {
  const shop = shopping({ results:[[unread]] });
  let told;
  const { fetcher } = model([
    [tool('find_products', { query:'Dries Van Noten Peyter pants black', search_plan:{ continuation:false, named_model:'Peyter', mode:'identify', required_brands:['Dries Van Noten'], hard_constraints:['black'], guidance:[], keep_option_indices:[], exclude_option_indices:[] } })],
    (options) => { told = toolOutputs(options)[0]; return [reply(`Dover Street Market has the Peyter pants; i couldn’t see the price or sizes on the page.\n${url}\nwant me to save them anyway?`)]; },
  ]);
  const body = await generateReply(say('Dries Van Noten Peyter pants in black'), env, fetcher, shop.memory);
  assert.ok(body.includes(url));
  const [option] = told.pending_shopping.options;
  assert.equal(option.url, url); assert.equal(option.page_checked, false); assert.equal(option.price, null); assert.equal(option.availability, 'unknown'); assert.equal(option.sizes_seen, 'unknown');
  // The next message selects it: the save is approved and committed like any other option.
  const next = shopping({ state:shop.recorded.text_wishlist_state });
  const save = model([[tool('save_to_wishlist', { option_indices:[0] })], [reply('saved to your wishlist; price and sizes still unknown.', { saved_now:true })]]);
  await generateReply([...say('Dries Van Noten Peyter pants in black'), { direction:'outbound', status:'sent', body }, ...say('add them to my wishlist')], env, save.fetcher, next.memory);
  assert.equal(next.commits, 1); assert.equal(next.recorded.user_confirmed, true); assert.equal(next.recorded.products[0].url, url);
  assert.equal(next.recorded.products[0].reference_provenance, 'search_unverified');
});

test('option facts mark an unread page’s price, stock and sizes unknown and keep verified prices', () => {
  const [verified, unknown] = optionFacts({ options:[peyter, { ...unread, price_snapshot:{ amount:700, currency:'USD' } }] });
  assert.equal(verified.price, '$795.00'); assert.equal(verified.page_checked, true);
  // A price on an unread page is shown only when it came from the search index.
  assert.equal(unknown.price, null); assert.equal(unknown.price_basis, 'unknown');
  const [indexed] = optionFacts({ options:[{ ...unread, price_snapshot:{ amount:700, currency:'USD', evidence_level:'indexed' } }] });
  assert.equal(indexed.price, '$700.00'); assert.match(indexed.price_basis, /not confirmed on the page/);
});

test('the conversation model is configurable separately from background calls', async () => {
  const { fetcher, requests } = model([[reply('hi.')]]);
  await generateReply(say('hi'), { ...env, OPENAI_MODEL:'gpt-4.1-mini', OPENAI_CHAT_MODEL:'gpt-4.1' }, fetcher, {});
  assert.equal(requests[0].model, 'gpt-4.1'); assert.equal(requests[0].reasoning, undefined);
  const reasoning = model([[reply('hi.')]]);
  await generateReply(say('hi'), { ...env, OPENAI_CHAT_MODEL:'gpt-5-mini' }, reasoning.fetcher, {});
  assert.deepEqual(reasoning.requests[0].reasoning, { effort:'low' }); assert.deepEqual(reasoning.requests[0].include, ['reasoning.encrypted_content']);
});

// Through the inbox: the save is committed inside the loop, before the reply, and the model's checked
// message is sent as written (no second rewrite).
test('inbox: a save approved in the loop is committed before the message, which reports it', async () => {
  let saved = false, payload, stored;const events = [], sends = [];
  const store = { receive:async () => 'conversation', claimAI:async () => true,
    context:async () => [{ direction:'inbound', body:'add them to my wishlist', status:'received' }],
    textWishlistState:async () => ({ stage:'choice', options:[{ ...unread, reference_provenance:'search_unverified', merchant_options:[] }] }),
    wishlistEntries:async () => saved ? payload.map((p, i) => ({ reply_id:'reply', item_id:'item-' + i, text_origin:true, name:p.name, brand:p.brand, links:p.links, messages:{ created_at:'2026-10-14' } })) : [],
    priceAlerts:async () => [], searchResult:async (_op, r) => { stored = r; }, wishlistPayload:async (_op, p) => { payload = p; },
    saveConfirmedWishlist:async () => { events.push('persist'); saved = true; }, wishlistReplyId:async () => 'reply', recordEvidence:async () => {},
    prepareAI:async () => events.push('prepare'), finish:async (_op, status) => events.push(status), saveWishlist:async () => assert.fail('Saved before sending') };
  const { fetcher } = model([[tool('save_to_wishlist', { option_indices:[0] })], (options) => {
    const done = toolOutputs(options)[0]; assert.equal(done.outcome.saved_now, true); assert.match(done.result, /saved to your wishlist/);
    return [reply('added the Peyter pants to your wishlist. i couldn’t see a price or sizes on that page yet.', { saved_now:true })];
  }]);
  const delivery = { space:{ phone:'line' }, message:{ id:'message', sender:{ id:'person' }, content:{ text:'add them to my wishlist' } } };
  await receiveInInbox(delivery, { ...env, AI_ENABLED:'true', WISHLIST_ENABLED:'true', PRICE_ALERTS_ENABLED:'false' }, { store, progress:async () => async () => {},
    generate:(m, e, _f, memory) => generateReply(m, e, fetcher, memory), send:async (_d, body) => { events.push('send'); sends.push(body); },
    compose:() => assert.fail('A checked agent message is not rewritten') });
  assert.deepEqual(events, ['persist', 'prepare', 'send', 'sent']);
  assert.equal(sends.length, 1); assert.match(sends[0], /added the Peyter pants/);
  assert.equal(stored.user_confirmed, true); assert.equal(payload[0].links[0].price_snapshot, null);
  // Chat metrics read who wrote the sent text from the stored outcome.
  assert.equal(stored.composed_by, 'model');
});

test('a search and an alert asked together with nothing pending: the search runs, then the alert on its result', async () => {
  const shop = shopping({ results:[[cheaper]] });
  let first;
  const { fetcher } = model([
    [tool('manage_price_alerts', { operation:'create', option_indices:[0], consent_context:'explicit_request', size_choices:[{ option_index:0, size:'IT 50' }] }), tool('find_products', { query:'Dries Van Noten Peyter pants, cheaper' })],
    (options) => { first = toolOutputs(options); return [tool('manage_price_alerts', { operation:'create', option_indices:[0], consent_context:'explicit_request', size_choices:[{ option_index:0, size:'IT 50' }], option_sizing:[{ option_index:0, sizing:'apparel' }] })]; },
    [reply(`found them for $610.00.\n${cheaper.url}\nsaved, with a price alert on IT 50.`, { saved_now:true, alerts_turned_on:true })],
  ]);
  const body = await generateReply(say('find the peyter pants for cheaper and set a price alert'), env, fetcher, shop.memory);
  // The search ran first; the alert on nothing was refused with a reason, then ran on the result.
  assert.equal(shop.searches, 1); assert.equal(first.find(o => o.status === 'not_run').error.includes('Search first'), true);
  assert.equal(shop.commits, 1); assert.equal(shop.recorded.alert_requests[0].url, cheaper.url); assert.match(body, /price alert/);
});
