import { generateReply } from './ai.js';
import { AGENT_EVAL_CASES } from './agent-eval-cases.js';

// Runs one labeled case against the real model with every tool stubbed: nothing is searched, saved,
// alerted or remembered. Scores the agent's first decision (tool and key arguments).
const product = (p, i) => ({ brand: p.brand, name: p.name, url: `https://shop.example/p/${i}`, match: 'likely_match', sourcing_status: 'store_found',
  listing_check: { status: 'verified', product_name: p.name, color: p.color, shopping_range: 'men' } });
function contextFor(test) {
  const options = (test.pending?.options ?? []).map(product);
  const selected = (test.pending?.selected ?? []).map(i => options[i]);
  const state = test.pending ? { ...test.pending, options, ...(selected.length ? { selected_set: selected, offered_urls: selected.map(p => p.url) } : {}) } : null;
  const stub = label => async () => `[${label}]`;
  return {
    facts: test.facts ?? [], wishlistState: state, wishlistItems: test.items ?? [], executionContext: { mode: 'production' },
    wishlistAction: stub('wishlist'), alertsAction: stub('alerts'), feedbackAction: stub('feedback'),
    profileAction: async () => ({ facts: null, saved: 1 }), verifyLink: async () => ({ status: 'check_failed' }),
    loadImages: async () => [],
    ...(test.history ? { purchaseHistoryAction: stub('history') } : {}),
    ...(test.onboarding ? { onboarding: { state: test.onboarding, style_reading_available: true, gmail_import: true }, onboardingAction: stub('onboarding') } : {}),
  };
}
const matches = (actual, expected) => Array.isArray(expected)
  ? Array.isArray(actual) && JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort())
  : expected && typeof expected === 'object' ? Boolean(actual) && Object.entries(expected).every(([k, v]) => matches(actual[k], v)) : actual === expected;
const profileChange = (calls, want) => calls.some(c => c.name === 'update_profile' && c.args.changes?.some(change => matches(change, want)));

export function scoreAgentEval(test, calls) {
  const failures = [], expect = test.expect, primary = calls.find(c => c.name !== 'update_profile');
  if (expect.tool !== undefined) {
    const allowed = [].concat(expect.tool);
    if (!allowed.includes(primary?.name ?? null)) failures.push(`tool: expected ${allowed.map(t => t ?? 'none').join(' or ')}, got ${primary?.name ?? 'none'}`);
  }
  for (const [key, value] of Object.entries(expect.args ?? {})) if (!matches(primary?.args?.[key], value)) failures.push(`${key}: expected ${JSON.stringify(value)}, got ${JSON.stringify(primary?.args?.[key])}`);
  for (const name of expect.not ?? []) if (calls.some(c => c.name === name)) failures.push(`unexpected ${name}`);
  if (expect.also?.update_profile && !profileChange(calls, expect.also.update_profile)) failures.push(`missing update_profile ${JSON.stringify(expect.also.update_profile)}`);
  if (expect.notAlso?.update_profile && profileChange(calls, expect.notAlso.update_profile)) failures.push(`unexpected update_profile ${JSON.stringify(expect.notAlso.update_profile)}`);
  return { passed: !failures.length, failures };
}

export async function runAgentEval(test, env, { fetcher = fetch } = {}) {
  const calls = [], usage = { input_tokens: 0, output_tokens: 0 }, started = Date.now();
  const tracked = async (url, options) => {
    const response = await fetcher(url, options);
    if (url === 'https://api.openai.com/v1/responses' && JSON.parse(options.body).tools && !calls.length) {
      const data = await response.clone().json();
      usage.input_tokens += data.usage?.input_tokens ?? 0; usage.output_tokens += data.usage?.output_tokens ?? 0;
      calls.push(...(data.output ?? []).filter(o => o.type === 'function_call').map(c => ({ name: c.name, args: JSON.parse(c.arguments) })));
    }
    return response;
  };
  const messages = test.messages.map((m, i) => ({ id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, status: m.direction === 'inbound' ? 'received' : 'sent',
    created_at: new Date(Date.UTC(2026, 9, 13, 12, i)).toISOString(), ...m }));
  let error = null;
  try { await generateReply(messages, { ...env, SEARCH_ENABLED: 'true' }, tracked, contextFor(test)); } catch (e) { error = e.message; }
  return { id: test.id, category: test.category, ...scoreAgentEval(test, calls), tools: calls.map(c => ({ name: c.name, args: c.args })), error, elapsed_ms: Date.now() - started, usage };
}
export { AGENT_EVAL_CASES };
