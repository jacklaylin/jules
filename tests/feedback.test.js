import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { receiveInInbox } from '../lib/inbox.js';
import { createStore } from '../lib/store.js';
import { createProcessor } from '../lib/imessage.js';
import { createAdminHandler } from '../api/admin.js';
import { generateReply } from '../lib/ai.js';
import { developerReport, FEEDBACK_ACK } from '../lib/developer-feedback.js';
import { agentTurn, tool, toolNames } from './helpers/agent.js';

// Developer feedback is declared by the tester with #dev or a 👎 tapback (a founder-approved command
// format, see AGENTS.md); it is saved before the agent runs. Nothing else is ever saved as feedback.
const text = (body, extra = {}) => ({ space:{phone:'test-line'}, message:{ id:'test-message', sender:{id:'test-sender'}, content:{ type:'text', text:body }, attachments:[], ...extra } });
const flag = (emoji = '👎') => ({ space:{phone:'test-line'}, message:{ id:'guid:reaction:1', sender:{id:'test-sender'}, content:{ type:'reaction', emoji, target:{ id:'jules-reply' }, text:emoji }, attachments:[] } });
function fixture(turn = tool('conversation_reply', { response:'Sure.' })) {
  const reports = new Map(), sent = [], reserved = new Set(), agent = [];
  const store = {
    receive: async () => 'conversation', claimAI: async () => true,
    context: async () => [{ id:'00000000-0000-4000-8000-000000000001', direction:'inbound', body:'message', status:'received' }],
    saveFeedback: async (id, body) => reports.set(id, body), prepareAI: async () => {}, finish: async () => {},
    reserve: async (_c, op) => { if (reserved.has(op)) return false; reserved.add(op); return true; },
    operation: async () => ({ conversation_id:'conversation', body:FEEDBACK_ACK, status:'sent' }),
  };
  return { reports, sent, agent, store, send: async (_delivery, body) => sent.push(body),
    generate: (m, e, _f, memory) => { agent.push(m); return generateReply(m, e, async () => agentTurn(turn), memory); } };
}
const env = { AI_ENABLED:'true', OPENAI_API_KEY:'test' };

test('#dev is read as a command in any casing or punctuation; lookalikes are ordinary messages', () => {
  for (const [body, note] of [['#dev replies are long', 'replies are long'], ['#DEV: vary the wording', 'vary the wording'], ['  #dev\nwhy StockX first?', 'why StockX first?'], ['#dev', 'Flagged with #dev (no note).']])
    assert.deepEqual(developerReport(text(body).message), { channel:'marker', note });
  for (const body of ['DM your replies are way too long', 'DM me the link', 'any tips for the DMV?', '#devops jackets', 'love the #dev tag', 'dev: hello'])
    assert.equal(developerReport(text(body).message), null, body);
  assert.equal(developerReport(flag().message).channel, 'reaction');
  assert.equal(developerReport(flag('👎🏽').message).channel, 'reaction');
  for (const emoji of ['👍', '❤️', '❓', '‼️']) assert.equal(developerReport(flag(emoji).message), null);
});

test('a #dev message is saved verbatim once, acknowledged once, and never reaches the agent', async () => {
  const options = fixture();
  assert.equal(await receiveInInbox(text('#dev lead with the brand site, then cheaper resellers'), env, options), 'developer_feedback_saved');
  assert.equal(await receiveInInbox(text('#dev lead with the brand site, then cheaper resellers'), env, options), 'developer_feedback_saved');
  assert.equal(options.reports.get('test-message'), 'lead with the brand site, then cheaper resellers');
  assert.deepEqual(options.sent, [FEEDBACK_ACK]); assert.equal(options.agent.length, 0);
});

test('a threaded #dev and a 👎 tapback both report the targeted message', async () => {
  const threaded = fixture();
  await receiveInInbox(text('#dev', { content:{ type:'reply', text:'#dev', target:{ id:'jules-reply' } } }), env, threaded);
  assert.equal(threaded.reports.get('test-message'), 'Flagged with #dev (no note).');
  const tapped = fixture();
  assert.equal(await receiveInInbox(flag(), env, tapped), 'developer_feedback_saved');
  assert.equal(tapped.reports.get('guid:reaction:1'), 'Flagged this reply with 👎.'); assert.deepEqual(tapped.sent, [FEEDBACK_ACK]); assert.equal(tapped.agent.length, 0);
});

test('unmarked comments about Jules go to the agent, which has no feedback tool, and nothing is saved', async () => {
  for (const body of ['DM your replies are way too long', 'you said the same thing twice', 'that’s not what I asked for']) {
    const options = fixture(); let offered;
    options.generate = (m, e, _f, memory) => generateReply(m, e, async (_url, request) => { offered = toolNames(request); return agentTurn(tool('conversation_reply', { response:'Fair point.' })); }, memory);
    await receiveInInbox(text(body), env, options);
    assert.equal(options.reports.size, 0); assert.deepEqual(options.sent, ['Fair point.']);
    assert.ok(!offered.includes('send_developer_feedback'));
  }
});

test('a failed feedback save never acknowledges success and fails the delivery so Photon retries', async () => {
  const options = fixture(); options.store.saveFeedback = async () => { throw new Error('offline'); };
  await assert.rejects(receiveInInbox(text('#dev bug'), env, options)); assert.deepEqual(options.sent, []);
});

test('with the agent off, #dev is still saved but no reply is sent', async () => {
  const options = fixture();
  assert.equal(await receiveInInbox(text('#dev bug'), { AI_ENABLED:'false' }, options), 'developer_feedback_saved');
  assert.equal(options.reports.size, 1); assert.deepEqual(options.sent, []);
});

test('a #dev screenshot is kept with the report; an unreadable image does not lose it', async () => {
  const options = fixture(); let saved;
  options.store.saveImages = async (_id, images) => { saved = images; };
  await receiveInInbox(text('#dev look at this', { attachments:[{ id:'a' }] }), env, { ...options, loadImages: async () => [{ mime_type:'image/png', data:'x' }] });
  assert.equal(saved.length, 1);
  const broken = fixture(); broken.store.saveImages = async () => { throw new Error('bad'); };
  await receiveInInbox(text('#dev look', { attachments:[{ id:'a' }] }), env, { ...broken, loadImages: async () => [] });
  assert.equal(broken.reports.get('test-message'), 'look'); assert.deepEqual(broken.sent, [FEEDBACK_ACK]);
});

const webhookEnv = { SPECTRUM_PROJECT_ID:'fake-project', SPECTRUM_PROJECT_SECRET:'fake-project-secret', SPECTRUM_WEBHOOK_SECRET:'fake-webhook-secret' };
function signed(value, id = 'hook') {
  const body = Buffer.from(JSON.stringify(value)), timestamp = String(1800000000);
  const signature = 'v0=' + createHmac('sha256', webhookEnv.SPECTRUM_WEBHOOK_SECRET).update(`v0:${timestamp}:`).update(body).digest('hex');
  return [body, { 'content-type':'application/json', 'x-spectrum-signature':signature, 'x-spectrum-timestamp':timestamp, 'x-spectrum-webhook-id':id }, webhookEnv];
}
const reaction = (emoji, target = { id:'jules-reply', content:{ type:'text', text:'One option to start with.' } }) => ({ event:'messages',
  space:{ id:'dm', platform:'iMessage', type:'dm', phone:'line' },
  message:{ id:`guid:reaction:${emoji}`, direction:'inbound', sender:{ id:'sender' }, content:{ type:'reaction', emoji, target } } });

test('the webhook passes only a 👎 tapback on, with its target, and logs other tapbacks by kind only', async () => {
  const handled = [], logs = [];
  const process = createProcessor({ now:() => 1800000000000, log:line => logs.push(JSON.parse(line)), handle:async delivery => { handled.push(delivery.message); return 'handled'; } });
  assert.equal(await process(...signed(reaction('👎'))), 200);
  assert.equal(handled.length, 1); assert.equal(handled[0].content.text, '👎'); assert.equal(handled[0].content.target.id, 'jules-reply');
  for (const emoji of ['👍', '❤️', '😂', '🔥']) assert.equal(await process(...signed(reaction(emoji), emoji)), 200);
  assert.equal(handled.length, 1);
  assert.deepEqual(logs.filter(l => l.event === 'reaction_received').map(l => l.emoji), ['👍', '❤️', '😂', 'other']);
  assert.doesNotMatch(JSON.stringify(logs), /One option to start with|sender/);
  assert.equal(await process(...signed(reaction('👎', { id:'' }), 'bad')), 400);
});

test('a stored flag records its target as the reply reference; feedback reads stay private', async () => {
  const paths = [], bodies = [];
  const store = createStore({ SUPABASE_URL:'https://example.invalid', SUPABASE_SERVICE_ROLE_KEY:'fake' }, async (url, options) => {
    paths.push(url); bodies.push(options?.body); return { ok:true, text:async () => JSON.stringify(url.includes('provider_id=') ? [{ id:'id', created_at:'2026-10-06T00:00:00Z' }] : []) };
  });
  await store.receive(flag());
  assert.equal(JSON.parse(bodies[0]).p_reply_provider_id, 'jules-reply');
  await store.saveFeedback('provider', 'bug'); await store.feedback(); await store.context('conversation', 'provider'); await store.historyForMemory('conversation');
  assert.match(paths[2], /developer_feedback=not.is.null/);
  assert.match(paths[4], /developer_feedback=is.null/);
  assert.match(paths[5], /developer_feedback=is.null/);
  assert.match(paths[4], /operation_id.is.null,operation_id.not.like.feedback/);
});

test('owner can retrieve feedback through admin', async () => {
  const handler = createAdminHandler({ auth:async () => 200, storeFactory:() => ({ feedback:async () => [{ developer_feedback:'bug' }] }) });
  const res = { setHeader(){}, end(body){ this.body = JSON.parse(body); } };
  await handler({ method:'GET', url:'/api/admin?view=feedback', headers:{} }, res);
  assert.equal(res.statusCode, 200); assert.equal(res.body.feedback[0].developer_feedback, 'bug');
});
