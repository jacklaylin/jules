// Answer engines the visibility probe asks (scripts/aeo/probe.js). Each engine sends one question with
// web search on and reads back the answer text, the URLs it cites, the sources it searched and its token
// usage. Plain fetch, no SDKs. Keys come from environment variables, or from the cloud environment's
// network secrets (AEO_INJECTED_KEYS); an engine with neither is skipped.

// List prices in USD per 1M tokens, checked 2026-10-20 (OpenAI rows copied from lib/usage.js). Estimates
// only: provider invoices are the source of truth. Not imported from lib/usage.js on purpose: importing it
// installs Jules' fetch meter, which would record probe spend in the product's cost dashboard and caps.
export const PRICES = {
  openai: {
    'gpt-5.5': { input: 5.00, cached: 0.50, output: 30.00 },
    'gpt-5': { input: 1.25, cached: 0.125, output: 10.00 },
    'gpt-5-mini': { input: 0.25, cached: 0.025, output: 2.00 },
    'gpt-4.1': { input: 2.00, cached: 0.50, output: 8.00 },
    'gpt-4.1-mini': { input: 0.40, cached: 0.10, output: 1.60 },
  },
  openai_web_search: 0.010, // USD 10 per 1,000 calls
  anthropic: {
    'claude-opus-5-5': { input: 4.00, cached: 0.20, output: 20.00 },
    'claude-sonnet-5-5': { input: 2.00, cached: 0.20, output: 10.00 },
    'claude-haiku-5-5': { input: 0.10, cached: 0.01, output: 0.50 },
  },
  anthropic_web_search: 0.010, // USD 10 per 1,000 searches
  // Perplexity Sonar: token price plus a per-request search fee (low search context). Used only when the
  // response doesn't report its own cost.
  perplexity: {
    sonar: { input: 1.00, output: 1.00, request: 0.005 },
    'sonar-pro': { input: 3.00, output: 15.00, request: 0.006 },
  },
};

const tokenCost = (rate, { input_tokens = 0, cached_tokens = 0, output_tokens = 0 }) =>
  ((input_tokens - cached_tokens) * rate.input + cached_tokens * (rate.cached ?? rate.input) + output_tokens * rate.output) / 1e6;

async function post(fetchImpl, url, headers, body) {
  const res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(180000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

// key is null when the cloud environment adds the key to requests itself (a network secret), so the
// probe sends no key of its own and never sees it.
const bearer = key => key ? { authorization: `Bearer ${key}` } : {};

const unique = urls => [...new Set(urls.filter(u => typeof u === 'string' && /^https?:\/\//.test(u)))];

// OpenAI Responses API with the web_search tool (what ChatGPT search is built on).
export const openai = {
  id: 'openai',
  label: 'OpenAI (web search)',
  keyEnv: 'OPENAI_API_KEY',
  modelEnv: 'AEO_OPENAI_MODEL',
  defaultModel: 'gpt-5.5',
  request: (fetchImpl, key, model, question) => post(fetchImpl, 'https://api.openai.com/v1/responses', bearer(key), {
    model,
    input: question,
    tools: [{ type: 'web_search', user_location: { type: 'approximate', country: 'US' } }],
    include: ['web_search_call.action.sources'],
    ...(/^(gpt-5|o\d)/.test(model) ? { reasoning: { effort: 'low' } } : {}),
  }),
  parse(data, model) {
    const output = data.output ?? [];
    const parts = output.filter(o => o.type === 'message').flatMap(o => o.content ?? []).filter(c => c.type === 'output_text');
    const searches = output.filter(o => o.type === 'web_search_call');
    const usage = {
      input_tokens: data.usage?.input_tokens ?? 0,
      cached_tokens: data.usage?.input_tokens_details?.cached_tokens ?? 0,
      output_tokens: data.usage?.output_tokens ?? 0,
      web_searches: searches.length,
    };
    return {
      answer: parts.map(p => p.text).join('\n\n'),
      cited_urls: unique(parts.flatMap(p => (p.annotations ?? []).filter(a => a.type === 'url_citation').map(a => a.url))),
      source_urls: unique(searches.flatMap(s => (s.action?.sources ?? []).map(src => src.url))),
      usage,
      stop_reason: data.status ?? null,
      cost_usd: PRICES.openai[model] ? tokenCost(PRICES.openai[model], usage) + usage.web_searches * PRICES.openai_web_search : null,
    };
  },
};

// Perplexity Sonar (chat completions; search is built in).
export const perplexity = {
  id: 'perplexity',
  label: 'Perplexity (Sonar)',
  keyEnv: 'PERPLEXITY_API_KEY',
  modelEnv: 'AEO_PERPLEXITY_MODEL',
  defaultModel: 'sonar',
  request: (fetchImpl, key, model, question) => post(fetchImpl, 'https://api.perplexity.ai/chat/completions', bearer(key), {
    model,
    messages: [{ role: 'user', content: question }],
    web_search_options: { user_location: { country: 'US' } },
  }),
  parse(data, model) {
    const message = data.choices?.[0]?.message ?? {};
    const usage = { input_tokens: data.usage?.prompt_tokens ?? 0, cached_tokens: 0, output_tokens: data.usage?.completion_tokens ?? 0, web_searches: 1 };
    const rate = PRICES.perplexity[model];
    const reported = Number(data.usage?.cost?.total_cost);
    return {
      answer: String(message.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim(),
      cited_urls: unique(data.citations ?? (data.search_results ?? []).map(r => r.url)),
      source_urls: unique((data.search_results ?? []).map(r => r.url)),
      usage,
      stop_reason: data.choices?.[0]?.finish_reason ?? null,
      cost_usd: Number.isFinite(reported) ? reported : rate ? tokenCost(rate, usage) + rate.request : null,
    };
  },
};

// Anthropic Messages API with the server-side web search tool (what Claude's web search uses).
export const anthropic = {
  id: 'anthropic',
  label: 'Anthropic (web search)',
  keyEnv: 'ANTHROPIC_API_KEY',
  modelEnv: 'AEO_ANTHROPIC_MODEL',
  defaultModel: 'claude-opus-5-5',
  // One request per question: a paused turn (stop_reason pause_turn) is recorded as is, not resumed, so
  // cost stays capped. Server-side fallback re-runs a declined request on another model inside the same call.
  request: (fetchImpl, key, model, question) => post(fetchImpl, 'https://api.anthropic.com/v1/messages', {
    ...(key ? { 'x-api-key': key } : {}),
    'anthropic-version': '2023-06-01',
    'anthropic-beta': 'server-side-fallback-2026-07-01',
  }, {
    model,
    max_tokens: 8000,
    output_config: { effort: 'medium' },
    fallbacks: 'default',
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5, user_location: { type: 'approximate', country: 'US' } }],
    messages: [{ role: 'user', content: question }],
  }),
  parse(data, model) {
    const content = data.content ?? [];
    const texts = content.filter(b => b.type === 'text');
    const usage = {
      input_tokens: (data.usage?.input_tokens ?? 0) + (data.usage?.cache_read_input_tokens ?? 0),
      cached_tokens: data.usage?.cache_read_input_tokens ?? 0,
      output_tokens: data.usage?.output_tokens ?? 0,
      web_searches: data.usage?.server_tool_use?.web_search_requests ?? 0,
    };
    const rate = PRICES.anthropic[data.model ?? model] ?? PRICES.anthropic[model];
    return {
      answer: texts.map(b => b.text).join(''),
      cited_urls: unique(texts.flatMap(b => (b.citations ?? []).map(c => c.url))),
      source_urls: unique(content.filter(b => b.type === 'web_search_tool_result' && Array.isArray(b.content)).flatMap(b => b.content.map(r => r.url))),
      usage,
      stop_reason: data.stop_reason ?? null,
      cost_usd: rate ? tokenCost(rate, usage) + usage.web_searches * PRICES.anthropic_web_search : null,
    };
  },
};

export const ENGINES = [openai, perplexity, anthropic];
