import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createProcessor } from '../lib/imessage.js';
import { receiveInInbox } from '../lib/inbox.js';
import { errorClass, safeError, reportInboundFailure, resetIncidents, INCIDENT_MS } from '../lib/reply-failures.js';

// October 15: an unrun migration made store.smsOptedOut fail on a missing column, so every message
// failed before the agent ran, with nothing in the logs but a message id. These tests cover what a
// failure like that now leaves behind: a safe error class, the step, and one founder text per incident.

const env = { AI_ENABLED: 'true', OPENAI_API_KEY: 'fake-test-key', FOUNDER_ALERT_PHONE: 'founder-test-handle' };
const delivery = (id = 'fake-message') => ({ space: { phone: 'fake-line' }, message: { id, sender: { id: 'fake-tester' }, content: { type: 'text', text: 'private words' }, attachments: [] } });
const missingColumn = () => Object.assign(new Error('Database request failed'), { database_status: 400, database_code: '42703' });
const sendTo = sent => async (d, body) => { sent.push({ to: d.message.sender.id, body }); return { id: `sent-${sent.length}` }; };
const brokenStore = () => ({ receive: async () => 'conversation-1234567890', smsOptedOut: async () => { throw missingColumn(); },
  claimAI: async () => assert.fail('the agent must not run') });
async function captureLogs(work) {
  const lines = [], original = console.log;
  console.log = line => lines.push(String(line));
  try { await work(); } finally { console.log = original; }
  return lines;
}

beforeEach(() => resetIncidents());

test('errors are classified by code and status, and an unrun migration has its own class', () => {
  assert.equal(errorClass(missingColumn()), 'schema_missing');
  assert.equal(errorClass(Object.assign(new Error('Database request failed'), { database_status: 404, database_code: 'PGRST202' })), 'schema_missing');
  assert.equal(errorClass(Object.assign(new Error('Database request failed'), { database_status: 503 })), 'database');
  const sdk = Object.assign(new Error('send to +15555550100 failed with token abc'), { name: 'SpectrumError' });
  assert.deepEqual(safeError(sdk, 'send'), { error_class: 'exception', error_name: 'SpectrumError', database_status: null, database_code: null, database_table: null, step: 'send' });
  assert.equal(safeError(Object.assign(missingColumn(), { inbox_step: 'opt_out_check' })).step, 'opt_out_check');
  assert.equal(safeError(undefined).error_class, 'exception', 'a thrown non-error still classifies');
});

test('a failure before the agent runs is logged by class and step and texted to the founder once per incident', async () => {
  const sent = [];
  let caught;
  const logs = await captureLogs(async () => {
    await receiveInInbox(delivery('m1'), env, { store: brokenStore(), send: sendTo(sent) }).catch(error => { caught = error; });
    await assert.rejects(receiveInInbox(delivery('m2'), env, { store: brokenStore(), send: sendTo(sent) }));
  });
  assert.equal(caught.inbox_step, 'opt_out_check', 'the step travels with the error to the webhook log');
  assert.equal(sent.length, 1, 'the second message in the same incident sends no second alert');
  assert.equal(sent[0].to, 'founder-test-handle');
  assert.match(sent[0].body, /opt_out_check/); assert.match(sent[0].body, /schema_missing/); assert.match(sent[0].body, /42703/);
  assert.match(sent[0].body, /schema-check/, 'the alert points at the check that names the migration');
  const failures = logs.map(l => JSON.parse(l)).filter(l => l.event === 'inbound_failed');
  assert.deepEqual(failures.map(l => l.new_incident), [true, false]);
  assert.equal(failures[0].database_code, '42703'); assert.equal(failures[0].step, 'opt_out_check');
  for (const text of [...logs, sent[0].body]) assert.ok(!/private words|fake-tester|fake-line|Database request failed/.test(text), 'no message text, phone or error message');
});

test('a different failure, or the same one after the incident window, alerts again', async () => {
  let now = 1000;
  const alerts = [];
  const alert = async (_env, { kind, diagnostics }) => { alerts.push(`${kind}:${diagnostics.step}`); return true; };
  const quiet = { alert, now: () => now, log: () => {} };
  await reportInboundFailure(env, { error: missingColumn(), step: 'receive', line: 'fake-line' }, quiet);
  await reportInboundFailure(env, { error: missingColumn(), step: 'receive', line: 'fake-line' }, quiet);
  await reportInboundFailure(env, { error: missingColumn(), step: 'claim', line: 'fake-line' }, quiet);
  now += INCIDENT_MS;
  await reportInboundFailure(env, { error: missingColumn(), step: 'receive', line: 'fake-line' }, quiet);
  assert.deepEqual(alerts, ['inbound_failed:receive', 'inbound_failed:claim', 'inbound_failed:receive']);
});

test('the webhook failure log carries the safe error class and never the error message', async () => {
  const webhookEnv = { SPECTRUM_PROJECT_ID: 'fake-project', SPECTRUM_PROJECT_SECRET: 'fake-project-secret', SPECTRUM_WEBHOOK_SECRET: 'fake-webhook-secret' };
  const now = 1800000000000, logs = [];
  const payload = { event: 'messages', space: { id: 'test-dm', platform: 'iMessage', type: 'dm', phone: 'shared' },
    message: { id: 'test-message', direction: 'inbound', sender: { id: 'fake-sender' }, content: { type: 'text', text: 'private words' } } };
  const body = Buffer.from(JSON.stringify(payload)), timestamp = String(now / 1000);
  const signature = 'v0=' + createHmac('sha256', webhookEnv.SPECTRUM_WEBHOOK_SECRET).update(`v0:${timestamp}:`).update(body).digest('hex');
  const process = createProcessor({ now: () => now, log: line => logs.push(line),
    handle: async () => { throw Object.assign(missingColumn(), { inbox_step: 'opt_out_check' }); } });
  const status = await process(body, { 'content-type': 'application/json', 'x-spectrum-signature': signature, 'x-spectrum-timestamp': timestamp, 'x-spectrum-webhook-id': 'test-hook' }, webhookEnv);
  assert.equal(status, 502);
  const line = JSON.parse(logs.at(-1));
  assert.deepEqual(line, { event: 'imessage_reply_failed', message_id: 'test-message', error_class: 'schema_missing', error_name: 'Error', database_status: 400, database_code: '42703', database_table: null, step: 'opt_out_check' });
  assert.ok(!logs.join('').includes('private words') && !logs.join('').includes('Database request failed'));
});
