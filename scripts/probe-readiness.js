// Local contract probes: real application functions, controlled interpretation,
// retailer evidence, persistence and delivery. No live providers or user records.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { selectionOutcome } from '../lib/wishlist-selection.js';
import { receiveInInbox } from '../lib/inbox.js';
import { validateChanges } from '../lib/memory.js';

const results = [];
async function probe(id, requirement, run) {
  try {
    const evidence = await run();
    results.push({ id, requirement, passed: true, evidence });
  } catch (error) {
    // Controlled fixtures only. Never record SDK errors or provider payloads.
    results.push({ id, requirement, passed: false,
      failure: error instanceof assert.AssertionError ? error.message : 'Probe could not complete.' });
  }
}

await probe('raw-category-size', 'An interpreted suit size retains its raw label without a made-up system or brand.', async () => {
  const source = { id: '00000000-0000-4000-8000-000000000001', direction: 'inbound',
    body: 'I am a 50R.', created_at: '2026-10-07T12:00:00Z' };
  const facts = validateChanges([{ field: 'size', key: 'suits/unknown', value: '50R',
    action: 'set', source_id: source.id, evidence: source.body }], [source]);
  assert.equal(facts.length, 1);
  assert.equal(facts[0].key, 'suits/unknown');
  assert.equal(facts[0].value, '50R');
  return { retained: true, scope: 'general_category' };
});

for (const [category, label, value, system] of [
  ['shoes', 'EU 45', '45', 'eu'],
  ['suits', '50R', '50R', 'unknown'],
  ['jackets', 'L', 'L', 'unknown'],
  ['pants', '32x32', '32x32', 'unknown'],
]) await probe(`saved-size-${category}`, `Approved ${category} monitoring uses a saved category size without asking again.`, async () => {
  const option = { brand: 'Fixture Brand', name: `Fixture ${category}`,
    url: 'https://www.prada.com/p/readiness-fixture', sourcing_status: 'store_found',
    listing_check: { status: 'verified', color: 'Fixture color' } };
  let observed;
  await selectionOutcome({ decision: 'confirm', option_indices: [0], consent: 'wishlist_alerts',
    consent_context: 'answer_to_offer', size_choices: [] }, {
    state: { stage: 'offer_set', options: [option], selected_set: [option], offered_urls: [option.url] },
    facts: [{ field: 'size', key: `${category}/${system}`, value }],
    env: { PRICE_ALERTS_ENABLED: 'true' }, constraints: {},
    inspect: async () => ({ sizes: [label], checks: [{ offers: [{ url: option.url,
      size: label, key: label.toUpperCase(), amount: 100, currency: 'USD', available: true }] }] }),
    respond: async (_body, state, action = {}) => { observed = { state, action }; },
  });
  assert.equal(observed.action.user_confirmed, true, 'Approved action did not advance using the saved category size.');
  assert.equal(observed.action.alert_requests?.length, 1);
  assert.equal(observed.action.alert_requests[0].size, label);
  assert.equal(observed.action.alert_requests[0].baselines.length, 1);
  return { prepared_size: label, verified_baselines: 1, persisted: false };
});

const options = [0, 1, 2].map(i => ({ name: `Fixture variant ${i}`, url: `https://www.prada.com/p/readiness-${i}`,
  listing_check: { status: 'verified', color: `Variant ${i}` } }));
await probe('subset-interest', 'Interpreted interest in two variants preserves both without saving or enabling alerts.', async () => {
  let observed;
  await selectionOutcome({ decision: 'interest', option_indices: [0, 1], consent: 'none' }, {
    state: { stage: 'choice', options }, facts: [], env: {}, constraints: {},
    respond: async (_body, state, action = {}) => { observed = { state, action }; },
  });
  assert.deepEqual(observed.state.selected_set.map(p => p.url), options.slice(0, 2).map(p => p.url));
  assert.equal(observed.state.stage, 'offer_set');
  assert.equal(observed.action.user_confirmed, undefined);
  assert.equal(observed.action.alert_requests, undefined);
  return { selected_count: 2, mutation_authorized: false };
});
await probe('consent-scope', 'Consent to an existing offer cannot mutate an item outside that offer.', async () => {
  let observed;
  await selectionOutcome({ decision: 'confirm', option_indices: [2], consent: 'wishlist',
    consent_context: 'answer_to_offer' }, {
    state: { stage: 'offer_set', options, selected_set: options.slice(0, 2), offered_urls: options.slice(0, 2).map(p => p.url) },
    facts: [], env: {}, constraints: {},
    respond: async (_body, state, action = {}) => { observed = { state, action }; },
  });
  assert.equal(observed.action.user_confirmed, undefined);
  assert.equal(observed.action.products, undefined);
  return { unoffered_action_blocked: true };
});
await probe('image-caption-memory', 'An image caption containing an established size enters the profile-learning path.', async () => {
  const source = { id: '00000000-0000-4000-8000-000000000002', direction: 'inbound',
    body: 'I am a 50R.', created_at: '2026-10-07T12:00:00Z' };
  let memoryCalls = 0, facts = [], suppliedFacts;
  const store = { receive: async () => 'fixture-conversation', claimAI: async () => true,
    saveImages: async () => {}, context: async () => [source], profile: async () => ({ facts }),
    memoryStatus: async () => {}, prepareAI: async () => {}, finish: async () => {} };
  await receiveInInbox({ space: { phone: 'fixture-line' }, message: {
    id: 'fixture-message', sender: { id: 'fixture-user' }, content: { text: source.body },
    attachments: [{ id: 'fixture-image' }],
  } }, { AI_ENABLED: 'true', MEMORY_ENABLED: 'true' }, {
    store, progress: async () => async () => {}, send: async () => {},
    loadImages: async () => [{ mime_type: 'image/jpeg', data: 'fixture-bytes' }],
    updateMemory: async () => { memoryCalls++; facts = [{ field: 'size', key: 'suits/unknown', value: '50R' }]; return { facts }; },
    generate: async (_messages, _env, _fetch, memory) => { suppliedFacts = memory.facts; return 'Fixture response'; },
  });
  assert.equal(memoryCalls, 1, 'Explicit caption size never entered profile learning.');
  assert.equal(suppliedFacts.some(f => f.key === 'suits/unknown' && f.value === '50R'), true);
  return { caption_learning_invoked: true, learned_fact_supplied: true };
});

const report = { generated_at: new Date().toISOString(), layer: 'local_contract_probes',
  live_models_used: false, live_persistence_used: false, phone_messages_sent: 0,
  tester_ready: false,
  unverified: ['Natural-language interpretation', 'Real-image/product accuracy', 'Receipt-derived retailer learning and ranking',
    'Thread target resolution', 'Chat alert cancellation', 'Deployed persistence and scheduler', 'Actual phone delivery', 'Automatic failure recovery'],
  summary: { probes: results.length, passed: results.filter(r => r.passed).length, failed: results.filter(r => !r.passed).length }, results };
if (process.argv[2]) {
  const path = resolve(process.argv[2]);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
}
console.log(JSON.stringify(report, null, 2));
// A nonzero status means unmet product requirements, not a failed test runner.
if (report.summary.failed) process.exitCode = 1;
