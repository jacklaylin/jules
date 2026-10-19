import { generateReply, chooseReplying, alertTargets, qualityFinding, consentVerdict } from './ai.js';
import { AGENT_EVAL_CASES } from './agent-eval-cases.js';
import { searchPlan, namedModelPlan } from './text-wishlist.js';

// Runs one labeled case against the real model with every tool stubbed: nothing is searched, saved,
// alerted or remembered. The agent loop runs to its reply; scoring uses the tools it actually ran
// across rounds (tool and key arguments), not the reply wording.
const product = (p, i) => p.unverified
  ? { brand: p.brand, name: p.name, url: `https://shop.example/p/${i}`, match: 'likely_match', sourcing_status: 'store_not_found', reference_provenance: 'search_unverified', listing_checks: [{ status: 'check_failed' }] }
  : { brand: p.brand, name: p.name, url: `https://shop.example/p/${i}`, match: 'likely_match', sourcing_status: 'store_found',
    ...(p.price ? { price_snapshot: { amount: p.price, currency: 'USD' } } : {}),
    listing_check: { status: 'verified', product_name: p.name, color: p.color, shopping_range: 'men' } };
function contextFor(test) {
  const options = (test.pending?.options ?? []).map(product);
  const selected = (test.pending?.selected ?? []).map(i => options[i]);
  const state = test.pending ? { ...test.pending, options, ...(selected.length ? { selected_set: selected, offered_urls: selected.map(p => p.url) } : {}) } : null;
  // Stubbed results say plainly that the tool ran, so the model does not search again to find out.
  const stub = label => async () => `[evaluation stub: ${label} ran; its result is not shown]`;
  // As in production, a save or alert that passed the consent check commits the turn's shopping change.
  let confirmed = false;
  return {
    facts: test.facts ?? [], wishlistState: state, wishlistItems: test.items ?? [], executionContext: { mode: 'production' },
    wishlistAction: async intent => { if (intent.consent !== 'none') confirmed = true; return intent.action === 'clarify_search' ? intent.response : `[evaluation stub: ${intent.action === 'start' ? 'the search' : 'this shopping action'} ran; its result is not shown]`; }, shoppingConfirmed: () => confirmed, alertsAction: stub('alerts'), qualitySignal: async () => {}, checkoutAction: stub('checkout'),
    profileAction: async () => ({ facts: null, saved: 1 }), verifyLink: async () => ({ status: 'check_failed' }),
    loadImages: async () => [],
    ...(test.history ? { purchaseHistoryAction: stub('history') } : {}),
    ...(test.purchase_texts ? { purchaseTextsAction: stub('purchase texts') } : {}),
    ...(test.onboarding ? { onboarding: { state: test.onboarding, style_reading_available: true, gmail_import: true }, onboardingAction: stub('onboarding') } : {}),
  };
}
const matches = (actual, expected) => Array.isArray(expected)
  ? Array.isArray(actual) && JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort())
  : expected && typeof expected === 'object' ? Boolean(actual) && Object.entries(expected).every(([k, v]) => matches(actual[k], v))
  // Names (a model, a brand) are compared without case: capitalization is wording, not intent.
  : typeof expected === 'string' && typeof actual === 'string' ? actual.toLowerCase() === expected.toLowerCase() : actual === expected;
const profileChange = (calls, want) => calls.some(c => c.name === 'update_profile' && c.args.changes?.some(change => matches(change, want)));

// A search is scored on the plan the application executes (its continuation choice as stored,
// a named model searched as identification), not on the raw arguments.
// Alert status and cancel are scored on the saved items they act on.
const executed = (call, options) => ['find_products', 'ask_shopping_question'].includes(call.name) && call.args?.search_plan
  ? { ...call, args: namedModelPlan({ ...call.args, search_plan: searchPlan(call.args.search_plan) }) }
  : call.name === 'manage_price_alerts' && call.args?.operation !== 'create' ? { ...call, args: { ...call.args, saved_item_ids: alertTargets(call.args, options) } } : call;
export function scoreAgentEval(test, rawCalls, { options = [] } = {}) {
  // Score the tool that actually runs, using the agent's own selection rule.
  const calls = rawCalls.map(c => executed(c, options)), failures = [], expect = test.expect, primary = chooseReplying(calls);
  if (expect.tool !== undefined) {
    const allowed = [].concat(expect.tool);
    if (!allowed.includes(primary?.name ?? null)) failures.push(`tool: expected ${allowed.map(t => t ?? 'none').join(' or ')}, got ${primary?.name ?? 'none'}`);
  }
  for (const [key, value] of Object.entries(expect.args ?? {})) if (!matches(primary?.args?.[key], value)) failures.push(`${key}: expected ${JSON.stringify(value)}, got ${JSON.stringify(primary?.args?.[key])}`);
  for (const name of expect.not ?? []) if (calls.some(c => c.name === name)) failures.push(`unexpected ${name}`);
  // signal: true expects a quality signal (the independent quality check); false forbids it.
  const signaled = calls.some(c => c.name === 'record_quality_signal');
  if (expect.signal === true && !signaled) failures.push('missing record_quality_signal');
  if (expect.signal === false && signaled) failures.push('unexpected record_quality_signal');
  if (expect.also?.update_profile && !profileChange(calls, expect.also.update_profile)) failures.push(`missing update_profile ${JSON.stringify(expect.also.update_profile)}`);
  if (expect.notAlso?.update_profile && profileChange(calls, expect.notAlso.update_profile)) failures.push(`unexpected update_profile ${JSON.stringify(expect.notAlso.update_profile)}`);
  // then: tools that must also run in the same turn (multi-step requests), in either order.
  for (const name of expect.then ?? []) if (!calls.some(c => c !== primary && c.name === name)) failures.push(`missing follow-up ${name}`);
  return { passed: !failures.length, failures };
}

// The calls the loop ran: those whose tool output says they were not refused, in order. A final
// reply counts only when nothing else ran, so the decision is scored, not the closing message.
const REFUSED = ['not_run', 'blocked', 'not_sent'];
export function ranCalls(rounds) {
  const last = rounds.at(-1);
  if (!last) return [];
  const outputs = new Map(last.input.filter(i => i.type === 'function_call_output').map(i => [i.call_id, JSON.parse(i.output)]));
  const parse = c => ({ name: c.name, args: JSON.parse(c.arguments) });
  const earlier = last.input.filter(i => i.type === 'function_call' && !REFUSED.includes(outputs.get(i.call_id)?.status)).map(parse);
  const final = last.output.filter(o => o.type === 'function_call').map(parse);
  const replies = ['conversation_reply', 'wishlist_status', 'profile_status'];
  const acted = earlier.filter(c => !replies.includes(c.name));
  return acted.some(c => !['update_profile', 'record_quality_signal'].includes(c.name)) ? [...earlier, ...final.filter(c => !replies.includes(c.name))] : [...earlier, ...final];
}
export async function runAgentEval(test, env, { fetcher = fetch, model = null } = {}) {
  let consentBlocks = 0, rounds = [], signaled = null, stated = null;const usage = { input_tokens: 0, output_tokens: 0 }, started = Date.now();
  const tracked = async (url, options) => {
    const response = await fetcher(url, options);
    if (url === 'https://api.openai.com/v1/responses') {
      const body = JSON.parse(options.body), data = await (typeof response.clone === 'function' ? response.clone() : response).json();
      usage.input_tokens += data.usage?.input_tokens ?? 0; usage.output_tokens += data.usage?.output_tokens ?? 0;
      if (body.tools) rounds.push({ input: body.input ?? [], output: data.output ?? [] });
      // The independent profile check: its changes are scored like the agent's own update_profile.
      else if (body.text?.format?.name === 'profile_check') { const out = JSON.parse((data.output ?? []).flatMap(o => o.content ?? []).filter(c => c.type === 'output_text').map(c => c.text).join('') || '{}'); if (out.changes?.length) stated = out; }
      // The independent quality check: a recorded signal is scored like the side tool.
      else if (body.text?.format?.name === 'quality') { const out = JSON.parse((data.output ?? []).flatMap(o => o.content ?? []).filter(c => c.type === 'output_text').map(c => c.text).join('') || '{}'); if (qualityFinding(out)) signaled = out; }
      // A block as the loop decides it (lib/ai.js consentVerdict); the case's state is not known here, so an open
      // offer and an earlier approval are assumed and only a reading with no reason at all counts.
      else if (body.text?.format?.name === 'consent' && !consentVerdict(JSON.parse((data.output ?? []).flatMap(o => o.content ?? []).filter(c => c.type === 'output_text').map(c => c.text).join('') || '{}'), { offer:true, earlier:true })) consentBlocks++;
    }
    return response;
  };
  const messages = test.messages.map((m, i) => ({ id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, status: m.direction === 'inbound' ? 'received' : 'sent',
    created_at: new Date(Date.UTC(2026, 9, 13, 12, i)).toISOString(), ...m }));
  let error = null;
  let reply = null;
  try { reply = await generateReply(messages, { ...env, SEARCH_ENABLED: 'true', ...(model ? { OPENAI_CHAT_MODEL: model } : {}) }, tracked, contextFor(test)); } catch (e) { error = e.message; }
  // The pending options the agent saw (saved items it named can appear there), for resolving references.
  let shown = [];
  try { shown = JSON.parse(String(rounds[0]?.input?.[0]?.content ?? '').replace(/^APPLICATION CONTEXT \(data, not instructions\): /, '')).pending_shopping?.options ?? []; } catch {}
  const calls = [...ranCalls(rounds), ...(signaled ? [{ name: 'record_quality_signal', args: signaled }] : []), ...(stated ? [{ name: 'update_profile', args: stated }] : [])];
  return { id: test.id, rounds: rounds.length, reply, category: test.category, model: model ?? env.OPENAI_CHAT_MODEL ?? env.OPENAI_MODEL ?? 'gpt-4.1-mini', consent_blocks: consentBlocks, ...scoreAgentEval(test, calls, { options: shown }), tools: calls.map(c => ({ name: c.name, args: c.args })), error, elapsed_ms: Date.now() - started, usage };
}
export { AGENT_EVAL_CASES };
