import { test } from 'node:test';
import assert from 'node:assert/strict';
import { receiveInInbox } from '../lib/inbox.js';
import { generateReply } from '../lib/ai.js';
import { FEEDBACK_ACK, CONTINUATION_NOTE, CONTINUATION_ACK, CONTINUATION_WINDOW_MS, reportToContinue, continuesReport } from '../lib/developer-feedback.js';
import { agentTurn, tool } from './helpers/agent.js';

// A developer report is often finished in a second message: the link, screenshot or detail the note
// led into. A model reads a message that arrives soon after a report together with that report; when
// it adds to the report it is appended there and acknowledged, and never reaches the shopping agent.
const now = Date.parse('2026-10-19T17:50:00Z');
const ago = seconds => new Date(now - seconds * 1000).toISOString();
const report = { provider_id:'report-1', developer_feedback:'the third store looks fake, this is the real site:', created_at:ago(2) };
const follow = (body, extra = {}) => ({ space:{phone:'test-line'}, message:{ id:'follow-1', sender:{id:'test-sender'}, content:{ type:'text', text:body }, attachments:[], ...extra } });
const env = { AI_ENABLED:'true', OPENAI_API_KEY:'test' };

function fixture({ before = [report], continues = true } = {}) {
  const reports = new Map(), sent = [], agent = [], checks = [], images = [];
  const store = {
    receive: async () => 'conversation', claimAI: async () => true,
    context: async () => [{ id:'00000000-0000-4000-8000-000000000001', direction:'inbound', body:'message', status:'received' }],
    inboundBefore: async (_c, provider) => { assert.equal(provider, 'follow-1'); return before; },
    saveFeedback: async (id, body) => reports.set(id, body), saveImages: async (id, list) => images.push([id, list.length]),
    prepareAI: async () => {}, finish: async () => {}, reserve: async () => true,
    operation: async () => ({ conversation_id:'conversation', body:CONTINUATION_ACK, status:'sent' }),
  };
  return { reports, sent, agent, checks, images, store, now:() => now, send: async (_delivery, body) => sent.push(body),
    loadImages: async () => [{ mime_type:'image/png', data:'x' }],
    continuationCheck: async input => { checks.push(input); if (continues instanceof Error) throw continues; return continues; },
    generate: (m, e, _f, memory) => { agent.push(m); return generateReply(m, e, async () => agentTurn(tool('conversation_reply', { response:'Sure.' })), memory); } };
}

test('a follow-up that finishes a report is added to it, acknowledged, and never reaches the agent', async () => {
  for (const body of ['https://www.brand-store.example/', 'here: https://www.brand-store.example/', 'also the second link was sold out', 'same thing happened with the jeans yesterday']) {
    const options = fixture();
    assert.equal(await receiveInInbox(follow(body), env, options), 'developer_feedback_continued', body);
    assert.equal(options.reports.get('report-1'), `${report.developer_feedback}\n${body}`);
    assert.equal(options.reports.get('follow-1'), CONTINUATION_NOTE);
    assert.deepEqual(options.sent, [CONTINUATION_ACK]); assert.equal(options.agent.length, 0);
    // The check sees the report and the message, never anything else.
    assert.deepEqual(options.checks[0], { report:report.developer_feedback, message:body, images:0, secondsAfter:2 });
  }
});

test('a screenshot sent after a report is kept with the follow-up; the report text is unchanged', async () => {
  const options = fixture();
  assert.equal(await receiveInInbox(follow('', { attachments:[{ id:'a' }] }), env, options), 'developer_feedback_continued');
  assert.deepEqual(options.images, [['follow-1', 1]]);
  assert.equal(options.reports.get('follow-1'), CONTINUATION_NOTE); assert.equal(options.reports.has('report-1'), false);
});

test('a new message for Jules after a report, a failed check, or a late message goes to the agent as usual', async () => {
  for (const continues of [false, new Error('provider down')]) {
    const options = fixture({ continues });
    assert.notEqual(await receiveInInbox(follow('ok can you find me black jeans instead'), env, options), 'developer_feedback_continued');
    assert.equal(options.agent.length, 1); assert.equal(options.reports.size, 0); assert.ok(!options.sent.includes(CONTINUATION_ACK));
  }
  // Too long after the report, or no report just before: the check never runs.
  for (const before of [[{ ...report, created_at:ago(CONTINUATION_WINDOW_MS / 1000 + 5) }], [{ provider_id:'m', developer_feedback:null, created_at:ago(2) }], []]) {
    const options = fixture({ before });
    await receiveInInbox(follow('https://www.brand-store.example/'), env, options);
    assert.equal(options.checks.length, 0); assert.equal(options.agent.length, 1);
  }
});

test('multi-turn: a report finished over several messages keeps adding to the first report', () => {
  const chain = [{ provider_id:'follow-1', developer_feedback:CONTINUATION_NOTE, created_at:ago(5) }, report];
  assert.equal(reportToContinue(chain, now), report);
  // A real message in between ends the chain.
  assert.equal(reportToContinue([{ provider_id:'m', developer_feedback:null, created_at:ago(5) }, report], now), null);
  // The window runs from the latest message of the chain.
  assert.equal(reportToContinue([{ ...chain[0], created_at:ago(200) }, { ...report, created_at:ago(210) }], now), null);
  // A 👎 tapback's note can be continued too (its explanation often follows).
  const tap = { provider_id:'tap', developer_feedback:'Flagged this reply with 👎.', created_at:ago(10) };
  assert.equal(reportToContinue([tap], now), tap);
});

test('the continuation check is a structured model reading of the report and the message', async () => {
  let request;
  const reply = value => async (_url, options) => { request = JSON.parse(options.body); return { ok:true, json:async () => ({ status:'completed', output:[{ type:'message', content:[{ type:'output_text', text:JSON.stringify({ newest_message:value }) }] }] }) }; };
  const input = { report:'the links look like spam', message:'https://real.example/', images:0, secondsAfter:2 };
  assert.equal(await continuesReport(input, env, reply('adds_to_the_report')), true);
  assert.deepEqual(JSON.parse(request.input), { developer_note:input.report, newest_message:input.message, newest_message_images:0, seconds_after_the_note:2 });
  assert.equal(request.text.format.name, 'report_continuation');
  assert.equal(await continuesReport(input, env, reply('new_message')), false);
  assert.equal(await continuesReport(input, {}, () => assert.fail('no model without a key')), false);
  await assert.rejects(continuesReport(input, env, async () => ({ ok:false })));
});

test('the #dev report itself is still saved and acknowledged as before', async () => {
  const options = fixture({ before:[] });
  assert.equal(await receiveInInbox(follow('#dev the third store looks fake'), env, options), 'developer_feedback_saved');
  assert.equal(options.reports.get('follow-1'), 'the third store looks fake'); assert.deepEqual(options.sent, [FEEDBACK_ACK]);
});

test('a continuation is never listed or counted as a report of its own', async () => {
  const { createStore } = await import('../lib/store.js');
  const paths = [];
  const store = createStore({ SUPABASE_URL:'https://example.invalid', SUPABASE_SERVICE_ROLE_KEY:'fake' }, async url => { paths.push(decodeURIComponent(url)); return new Response('[]', { headers:{ 'content-type':'application/json' } }); });
  await store.feedback(); await store.feedbackSince('2026-10-19T00:00:00Z');
  await store.inboundBefore('conversation', 'follow-1');
  assert.ok(paths.slice(0, 2).every(p => p.includes(`developer_feedback=neq.${CONTINUATION_NOTE}`)));
  assert.match(paths[2], /direction=eq\.inbound&provider_id=neq\.follow-1/); assert.doesNotMatch(paths[2], /select=[^&]*body/);
});
