// Answer-engine visibility probe (scripts/aeo): mention detection, engine response parsing and the report.
// No live API calls: engine responses are inline fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { detectMention, competitorsNamed, analyzeAnswer, summarize, renderReport, domainKind } from '../scripts/aeo/analyze.js';
import { openai, perplexity, anthropic } from '../scripts/aeo/engines.js';

const config = JSON.parse(readFileSync(new URL('../scripts/aeo/questions.json', import.meta.url), 'utf8'));

test('the question list is versioned, unique, and never names Jules', () => {
  assert.ok(Number.isInteger(config.version));
  assert.ok(config.questions.length >= 12 && config.questions.length <= 20);
  assert.equal(new Set(config.questions.map(q => q.id)).size, config.questions.length);
  for (const q of config.questions) assert.doesNotMatch(q.text, /jules/i, q.id);
  for (const c of config.competitors) assert.doesNotThrow(() => new RegExp(c.pattern), c.name);
});

test('textjules.com in the answer or its citations is a confirmed mention', () => {
  assert.deepEqual(
    (({ mentioned, confidence, cited }) => ({ mentioned, confidence, cited }))(detectMention('Try textjules.com for restock texts.')),
    { mentioned: true, confidence: 'confirmed', cited: false });
  const cited = detectMention('Some services can watch prices for you [1].', ['https://www.textjules.com/faq']);
  assert.equal(cited.confidence, 'confirmed');
  assert.equal(cited.cited, true);
  assert.equal(detectMention('Nothing here', ['https://nottextjules.com.example.org/']).cited, false);
});

test('"Jules" counts only as the shopping service, never as another Jules', () => {
  const likely = detectMention('Jules is a personal shopper you text over iMessage; it watches prices in your size.');
  assert.equal(likely.confidence, 'likely');
  assert.match(likely.excerpts[0], /personal shopper/);
  for (const text of [
    'For a dupe of this vintage look, think Jules Verne-era travel coats from any resale store.',
    'Jules Koundé often wears this jacket; you can find it in your size on resale sites.',
    'My cousin Jules went hiking last weekend in the mountains near the lake.',
    'Nothing about the service at all.',
  ]) {
    const result = detectMention(text);
    assert.equal(result.mentioned, false, text);
  }
  assert.equal(detectMention('Jules Verne wrote about shopping for size 10 shoes.').ignored.length, 1);
});

test('competitors are named by pattern, not by substring', () => {
  assert.deepEqual(competitorsNamed('Use Phia or Google Lens; Daydream works too.', config.competitors).sort(), ['Daydream', 'Google Lens', 'Phia']);
  assert.deepEqual(competitorsNamed('A daydreamer with honeycomb knits.', config.competitors), []);
});

test('each engine response is read into answer, citations, sources and cost', () => {
  const o = openai.parse({ status: 'completed', usage: { input_tokens: 10000, output_tokens: 1000, input_tokens_details: { cached_tokens: 0 } }, output: [
    { type: 'web_search_call', action: { sources: [{ type: 'url', url: 'https://www.reddit.com/r/findfashion/x' }] } },
    { type: 'message', content: [{ type: 'output_text', text: 'Try Phia.', annotations: [{ type: 'url_citation', url: 'https://phia.com/' }, { type: 'url_citation', url: 'https://phia.com/' }] }] },
  ] }, 'gpt-5.5');
  assert.equal(o.answer, 'Try Phia.');
  assert.deepEqual(o.cited_urls, ['https://phia.com/']);
  assert.deepEqual(o.source_urls, ['https://www.reddit.com/r/findfashion/x']);
  assert.equal(o.usage.web_searches, 1);
  assert.ok(Math.abs(o.cost_usd - (10000 * 5 + 1000 * 30) / 1e6 - 0.01) < 1e-9);

  const p = perplexity.parse({ choices: [{ message: { content: '<think>hm</think>Use Lens [1].' }, finish_reason: 'stop' }], citations: ['https://lens.google/'], search_results: [{ url: 'https://lens.google/' }], usage: { prompt_tokens: 100, completion_tokens: 50, cost: { total_cost: 0.0062 } } }, 'sonar');
  assert.equal(p.answer, 'Use Lens [1].');
  assert.deepEqual(p.cited_urls, ['https://lens.google/']);
  assert.equal(p.cost_usd, 0.0062);

  const a = anthropic.parse({ model: 'claude-opus-5-5', stop_reason: 'end_turn', usage: { input_tokens: 2000, output_tokens: 500, server_tool_use: { web_search_requests: 2 } }, content: [
    { type: 'server_tool_use', name: 'web_search' },
    { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://www.textjules.com/' }] },
    { type: 'text', text: 'Jules texts you restocks', citations: [{ type: 'web_search_result_location', url: 'https://www.textjules.com/' }] },
    { type: 'text', text: ' in your size.' },
  ] }, 'claude-opus-5-5');
  assert.equal(a.answer, 'Jules texts you restocks in your size.');
  assert.deepEqual(a.cited_urls, ['https://www.textjules.com/']);
  assert.ok(Math.abs(a.cost_usd - ((2000 * 4 + 500 * 20) / 1e6 + 0.02)) < 1e-9);
  // An errored web search returns an error object instead of a result list; it must not throw.
  assert.deepEqual(anthropic.parse({ content: [{ type: 'web_search_tool_result', content: { type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' } }] }, 'claude-opus-5-5').source_urls, []);
});

const answer = (engine, question, text, cited, cost = 0.01) => ({
  question_id: question, question: question, job: 'test', engine, model: 'm', date: '2026-11-03', ok: true, cost_usd: cost,
  ...analyzeAnswer({ answer: text, cited_urls: cited, source_urls: [], usage: {}, stop_reason: 'end_turn', cost_usd: cost }, config.competitors),
});
const runFor = (date, results, engines = [{ id: 'openai', label: 'OpenAI', model: 'm', status: 'ran' }, { id: 'perplexity', label: 'Perplexity', model: 'sonar', status: 'skipped', note: 'PERPLEXITY_API_KEY is not set' }]) => {
  const run = { date, questions_version: 1, questions: [{ id: 'q1', text: 'Question one?', job: 'alerts' }, { id: 'q2', text: 'Question two?', job: 'dupes' }], engines, results };
  run.summary = summarize(run);
  return run;
};

test('the report counts mentions per engine, lists cited domains and competitors, and finds off-site gaps', () => {
  const run = runFor('2026-11-03', [
    answer('openai', 'q1', 'Phia is popular, see Reddit.', ['https://www.reddit.com/r/a', 'https://www.nordstrom.com/x', 'https://bestapps.example.com/list']),
    answer('openai', 'q2', 'Try Google Lens.', ['https://reddit.com/r/b', 'https://www.nordstrom.com/y', 'https://bestapps.example.com/other']),
    { question_id: 'q2', engine: 'openai', ok: false, error: 'HTTP 500: boom' },
  ]);
  const openaiRow = run.summary.engines.find(e => e.id === 'openai');
  assert.deepEqual([openaiRow.answers, openaiRow.mentioned, openaiRow.errors], [2, 0, 1]);
  assert.equal(domainKind('nordstrom.com'), 'store');
  assert.deepEqual(run.summary.gaps.map(g => g.domain), ['bestapps.example.com', 'reddit.com']);
  const md = renderReport(run);
  assert.match(md, /# Answer-engine visibility — 2026-11-03/);
  assert.match(md, /\| OpenAI \| `m` \| 0\/2 \(0%\)/);
  assert.match(md, /skipped: PERPLEXITY_API_KEY is not set/);
  assert.match(md, /Phia \(1\)/);
  assert.match(md, /No answer mentioned Jules\./);
  assert.match(md, /\| reddit\.com \| community \| 2 \(q1, q2\)/);
  assert.match(md, /HTTP 500: boom/);
  assert.doesNotMatch(md, /nordstrom\.com \| store/);
});

test('the report compares with the previous run', () => {
  const before = runFor('2026-10-20', [answer('openai', 'q1', 'Phia.', []), answer('openai', 'q2', 'Lens.', [])]);
  const after = runFor('2026-11-03', [
    answer('openai', 'q1', 'Jules is a personal shopper you text; it sends restock alerts in your size.', ['https://textjules.com/']),
    answer('openai', 'q2', 'Lens.', []),
  ]);
  const md = renderReport(after, before);
  assert.match(md, /## Compared with 2026-10-20/);
  assert.match(md, /\| OpenAI \| 0\/2 \| 1\/2 \|/);
  assert.match(md, /`q1`: now mentioned by openai/);
  assert.match(md, /openai\*\*, `q1` \(confirmed, cited\)/);
});

test('an engine whose key the cloud environment adds sends no key of its own', async () => {
  for (const engine of [openai, perplexity, anthropic]) {
    const sent = [];
    const fake = async (url, init) => { sent.push(init.headers); return { ok: true, text: async () => '{}' }; };
    await engine.request(fake, null, engine.defaultModel, 'q');
    await engine.request(fake, 'k', engine.defaultModel, 'q');
    assert.ok(!('authorization' in sent[0]) && !('x-api-key' in sent[0]), engine.id);
    assert.ok(sent[1].authorization === 'Bearer k' || sent[1]['x-api-key'] === 'k', engine.id);
  }
});
