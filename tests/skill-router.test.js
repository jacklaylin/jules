import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeTurn, routeInput, loadedSkills, routeCoverage, routeRecall, ROUTED, profileSources, JOB_CONTEXT } from '../lib/skills/router.js';
import { SKILLS } from '../lib/skills/index.js';
import { generateReply } from '../lib/ai.js';
import { receiveInInbox } from '../lib/inbox.js';
import { agentTurn, tool } from './helpers/agent.js';

const env = { AI_ENABLED: 'true', OPENAI_API_KEY: 'fake-test-key' };
const ALL = SKILLS.map(s => s.id);
const say = (body, extra = {}) => ({ direction: 'inbound', body, status: 'received', ...extra });
const jules = body => ({ direction: 'outbound', body, status: 'sent' });
const reading = value => ({ ok: true, json: async () => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] }) });
const isRoute = options => JSON.parse(options?.body ?? '{}').text?.format?.name === 'route';

test('the router reads the message and app state, and keeps only known jobs', async () => {
  let body;
  const route = await routeTurn([say('find me black loafers'), jules('here are three pairs'), say('love the second, save it and watch the price')],
    { wishlistState: { stage: 'choice', options: [{}, {}, {}] }, wishlistItems: [{ id: 'w1' }] }, env,
    async (_u, options) => { body = JSON.parse(options.body); return reading({ jobs: ['save_or_watch', 'made_up'], confident: true, reason: 'Save a shown option and watch it.' }); });
  assert.deepEqual(route.jobs, ['save_or_watch']);
  // Shown options join a shopping turn from app state, not from the router.
  // A save of shown options also loads finding, in case the items are not among them.
  assert.deepEqual(route.loaded, ['core', 'find_exact', 'options', 'save_or_watch']);
  assert.equal(body.model, 'gpt-4.1-mini');
  const context = JSON.parse(body.input[0].content[0].text);
  assert.equal(context.newest_message, 'love the second, save it and watch the price');
  assert.deepEqual(context.state, { shown_options: 3, shopping_stage: 'choice', offered: null, waiting_for_detail: false, saved_items: 1, style_question_waiting: false, purchase_history: false });
  assert.equal(context.recent.length, 2);
  for (const s of ROUTED) assert.ok(body.instructions.includes(`${s.id}: ${s.job}`));
  assert.equal(body.text.format.schema.properties.jobs.items.enum.includes('core'), false);
});

test('unsure, failed or unreachable routing loads every skill and never throws', async () => {
  const messages = [say('hmm')];
  const unsure = await routeTurn(messages, {}, env, async () => reading({ jobs: ['conversation'], confident: false, reason: 'Unclear.' }));
  assert.deepEqual(unsure.loaded, ALL);
  const failed = await routeTurn(messages, {}, env, async () => ({ ok: false, status: 500, json: async () => ({}) }));
  assert.equal(failed.failed, true); assert.deepEqual(failed.loaded, ALL);
  const thrown = await routeTurn(messages, {}, env, async () => { throw new Error('network'); });
  assert.deepEqual(thrown.loaded, ALL);
});

test('app state adds the skills it already calls for', () => {
  assert.deepEqual(loadedSkills({ jobs: ['find_exact'], confident: true }, { interview: { waiting_for: 'q1' }, waitlist: { replies_left: 2 } }), ['core', 'find_exact', 'save_or_watch', 'profile', 'conversation']);
  // A non-shopping turn does not pull in the options skill just because options are pending.
  assert.deepEqual(loadedSkills({ jobs: ['profile'], confident: true }, { wishlistState: { options: [{}] } }), ['core', 'profile']);
  // Saving follows any search, and a save needs finding (October 22 replay); other jobs pull in neither.
  assert.deepEqual(loadedSkills({ jobs: ['explore'], confident: true }), ['core', 'find_exact', 'explore', 'save_or_watch']);
  assert.deepEqual(loadedSkills({ jobs: ['save_or_watch'], confident: true }), ['core', 'find_exact', 'save_or_watch']);
  assert.deepEqual(loadedSkills({ jobs: ['saved_items', 'conversation'], confident: true }), ['core', 'saved_items', 'conversation']);
});

test('a threaded reply shows the router what the user replied under', () => {
  const input = routeInput([jules('three shirts'), say('this one', { reply_context: { resolved: true, messages: [{ direction: 'outbound', body: 'three shirts', replied_to_part: { kind: 'card', option: 1 } }] } })], {});
  assert.deepEqual(JSON.parse(input[0].content[0].text).replying_to, [{ from: 'jules', text: 'three shirts', part: 'card' }]);
  const unseen = routeInput([say('save it', { reply_context: { resolved: false, messages: [] } })], {});
  assert.equal(JSON.parse(unseen[0].content[0].text).replying_to, 'a message Jules cannot see');
});

test('coverage names the tools the loaded skills would not have offered', () => {
  const route = { jobs: ['find_exact'], confident: true, loaded: ['core', 'find_exact'] };
  assert.deepEqual(routeCoverage(route, [{ tool: 'find_products', status: 'done' }, { tool: 'conversation_reply' }]).missed, []);
  const missed = routeCoverage(route, [{ tool: 'find_products' }, { tool: 'update_profile' }]);
  assert.equal(missed.covered, false); assert.deepEqual(missed.missed, ['update_profile']);
  assert.equal(routeCoverage(null, []), null);
});

test('recall counts covered turns and skips turns without a route', () => {
  const row = skill_route => ({ reply_diagnostics: skill_route ? { skill_route } : {} });
  const report = routeRecall([
    row({ jobs: ['find_exact'], confident: true, loaded: ['core', 'find_exact'], covered: true, missed: [], ms: 600 }),
    row({ jobs: ['find_exact'], confident: true, loaded: ['core', 'find_exact'], covered: false, missed: ['update_profile'], ms: 800 }),
    row({ jobs: [], confident: false, loaded: ALL, covered: true, missed: [], ms: 700 }),
    row({ failed: true, loaded: ALL, covered: true, missed: [], ms: 8000 }), row(null), {}]);
  assert.equal(report.turns, 4); assert.equal(report.recall, 0.75); assert.equal(report.confident_recall, 0.5);
  assert.equal(report.unsure, 1); assert.equal(report.failed, 1);
  assert.deepEqual(report.missed_tools, { update_profile: 1 }); assert.deepEqual(report.picked, { find_exact: 2 });
});

test('the shadow router runs beside the turn without changing the agent prompt or reply', async () => {
  const agentBodies = []; let routed = null;
  const fetcher = async (_u, options) => {
    if (isRoute(options)) return reading({ jobs: ['conversation'], confident: true, reason: 'Small talk.' });
    agentBodies.push(JSON.parse(options.body));
    return agentTurn(tool('conversation_reply', { response: 'Happy to help.' }));
  };
  const reply = await generateReply([say('thanks!')], env, fetcher, { onRoute: p => { routed = p; } });
  assert.equal(reply, 'Happy to help.');
  assert.deepEqual((await routed).loaded, ['core', 'conversation']);
  const plain = []; await generateReply([say('thanks!')], env, async (_u, o) => { plain.push(JSON.parse(o.body)); return agentTurn(tool('conversation_reply', { response: 'Happy to help.' })); });
  assert.equal(agentBodies[0].instructions, plain[0].instructions, 'every rule still loads');
  assert.deepEqual(agentBodies[0].tools, plain[0].tools);
  // CHAT_ROUTER=off turns it off.
  routed = null; await generateReply([say('thanks!')], { ...env, CHAT_ROUTER: 'off' }, fetcher, { onRoute: p => { routed = p; } });
  assert.equal(routed, null);
});

test('the inbox keeps the route and its coverage with the turn, after the reply is sent', async () => {
  const diagnostics = []; let sentAt = null, writtenAt = null;
  const state = {};
  const db = { state, receive: async () => 'conversation', claimAI: async () => true, context: async () => [say('find loafers, I take a 10')],
    prepareAI: async (op, body, source) => Object.assign(state, { op, body, source }), finish: async (op, status) => { state.status = status; },
    replyDiagnostics: async (_op, data) => { diagnostics.push(data); if (data.outcome === 'sent') writtenAt = Date.now(); } };
  const delivery = { space: { phone: 'fake-line' }, message: { id: 'fake-message', sender: { id: 'fake-person' }, content: { text: 'find loafers, I take a 10' } } };
  const route = new Promise(resolve => setTimeout(() => resolve({ jobs: ['find_exact'], confident: true, reason: 'Find loafers.', ms: 30, loaded: ['core', 'find_exact'] }), 30));
  await receiveInInbox(delivery, env, { store: db, send: async () => { sentAt = Date.now(); },
    generate: async (_m, _e, _f, memory) => { memory.onRoute(route); memory.onAction({ tool: 'update_profile', status: 'done' }); memory.onAction({ tool: 'find_products', status: 'done' }); return 'Here are some loafers.'; } });
  const final = diagnostics.find(d => d.outcome === 'sent');
  assert.deepEqual(final.skill_route.missed, ['update_profile']); assert.equal(final.skill_route.covered, false);
  assert.ok(writtenAt >= sentAt, 'the reply goes out first');
});

// Context routing (CHAT_CONTEXT_ROUTING=on): the router's picks choose which derived profile sources the agent reads.
const FACTS = [
  { field: 'size', key: 'shoes/us', value: '10', basis: 'explicit' }, { field: 'avoid', key: 'logos', value: 'no big logos', basis: 'explicit' },
  ...['shopping_history', 'wardrobe', 'outfit_photos', 'liked_items', 'wishlist', 'brand_taste'].map(field => ({ field, key: 'summary', value: '{}', basis: 'inferred' })),
];
const profileFields = body => JSON.parse(body.input[0].content.replace('APPLICATION CONTEXT (data, not instructions): ', '')).saved_profile.map(f => f.field);

test('each job reads the derived sources its rules use; search, options and profile turns read all', () => {
  for (const job of ['find_exact', 'better_price', 'explore', 'options', 'profile']) assert.equal(profileSources(['core', job]), null, job);
  assert.deepEqual(profileSources(['core', 'saved_items']), []);
  assert.deepEqual(profileSources(['core', 'save_or_watch']), ['shopping_history']);
  assert.deepEqual(profileSources(['core', 'conversation']), ['wardrobe', 'outfit_photos', 'liked_items', 'brand_taste']);
  // Several jobs read the union; one that reads everything makes the turn read everything.
  assert.deepEqual(profileSources(['core', 'save_or_watch', 'saved_items']), ['shopping_history']);
  assert.equal(profileSources(['core', 'save_or_watch', 'explore']), null);
  // Unsure or failed routes load every skill, so they read everything; so does an unknown job or no route.
  assert.equal(profileSources(ALL), null);
  assert.equal(profileSources(['core', 'made_up']), null);
  assert.equal(profileSources([]), null);
  for (const job of ROUTED.map(s => s.id)) assert.ok(job in JOB_CONTEXT, `${job} has a context entry`);
});

test('with context routing on, a confident save turn sends stated facts and only the sources it uses', async () => {
  const bodies = [];
  const fetcher = route => async (_u, options) => {
    if (isRoute(options)) return reading(route);
    bodies.push(JSON.parse(options.body));
    return agentTurn(tool('conversation_reply', { response: 'Done.' }));
  };
  const on = { ...env, CHAT_CONTEXT_ROUTING: 'on' };
  await generateReply([say('what have I saved?')], on, fetcher({ jobs: ['saved_items'], confident: true, reason: 'Asks about saves.' }), { facts: FACTS });
  assert.deepEqual(profileFields(bodies.at(-1)), ['size', 'avoid']);
  // Unsure: everything goes in, as today.
  await generateReply([say('hmm')], on, fetcher({ jobs: ['saved_items'], confident: false, reason: 'Unclear.' }), { facts: FACTS });
  assert.equal(profileFields(bodies.at(-1)).length, FACTS.length);
  // A search turn reads everything.
  await generateReply([say('find me loafers')], on, fetcher({ jobs: ['explore'], confident: true, reason: 'Wants loafers.' }), { facts: FACTS });
  assert.equal(profileFields(bodies.at(-1)).length, FACTS.length);
  // Off (the default): the router stays in shadow and the profile is whole.
  await generateReply([say('what have I saved?')], env, fetcher({ jobs: ['saved_items'], confident: true, reason: 'Asks about saves.' }), { facts: FACTS });
  assert.equal(profileFields(bodies.at(-1)).length, FACTS.length);
  // The instructions are the same either way, so the cached prefix is shared.
  assert.equal(bodies[0].instructions, bodies.at(-1).instructions);
  assert.match(bodies[0].instructions, /brand_taste: the brands they like/);
});
