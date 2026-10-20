// Which model does which job. Every model call names its role; the role's model comes from an optional
// environment override, then the older variables (still honored), then today's default.
//   chat    — the conversation: the agent loop (lib/ai.js) and the reply composer (lib/compose.js)
//   extract — small structured reads: Gmail import and receipts, connected sources, photos, saved
//             colors, alert size labels, memory, text wishlist, discovery ranking and other checks
//   search  — the web_search retrieval step of product sourcing (lib/search.js)
//   write   — long-form writing: the style report, fit reading and stylist concepts
// A role can be pointed at OpenRouter's OpenAI-compatible Responses API with a model id such as
// "openrouter:anthropic/claude-haiku-5.5", or "openrouter:deepseek/deepseek-v4.1-flash@fireworks" to pin
// the provider that serves it. OPENROUTER_API_KEY must be set.
export const ROLES = {
  chat: { env: 'MODEL_CHAT', legacy: ['OPENAI_CHAT_MODEL', 'OPENAI_MODEL'], default: 'gpt-4.1-mini' },
  extract: { env: 'MODEL_EXTRACT', legacy: ['OPENAI_MODEL'], default: 'gpt-4.1-mini' },
  search: { env: 'MODEL_SEARCH', legacy: ['OPENAI_SEARCH_MODEL'], default: 'gpt-4.1' },
  write: { env: 'MODEL_WRITE', legacy: ['STYLE_REPORT_MODEL'], default: 'gpt-5.5' },
};

export function modelFor(role, env = {}) {
  const spec = ROLES[role];
  if (!spec) throw new Error('Unknown model role: ' + role);
  for (const name of [spec.env, ...spec.legacy]) if (env[name]) return env[name];
  return spec.default;
}

// Reasoning models (o-series, GPT-5 and later) think before answering. Effort defaults to low so a chat
// turn stays fast; MODEL_<ROLE>_REASONING (minimal, low, medium, high) changes it for one role.
export const isReasoningModel = model => /^(o\d|gpt-([5-9]|\d{2}))/.test(model ?? '');
export const reasoningFor = (role, model, env = {}) => isReasoningModel(model) ? { reasoning: { effort: env[`${ROLES[role].env}_REASONING`] || 'low' } } : {};

export const OPENAI_RESPONSES = 'https://api.openai.com/v1/responses';
export const OPENROUTER_RESPONSES = 'https://openrouter.ai/api/v1/responses';
// Providers that serve from the United States. Personal data (Gmail, receipts) may only go to these.
export const US_PROVIDERS = ['openai', 'anthropic', 'groq', 'fireworks', 'together', 'cerebras', 'sambanova', 'baseten', 'deepinfra'];

// Turns an OpenAI Responses request whose model id starts with "openrouter:" into the same request to
// OpenRouter: its URL and key (never the OpenAI key), the bare model id, and a provider block that
// refuses providers which keep prompts for training and, when pinned, allows no fallback provider.
// Any other request is returned unchanged.
export function routeRequest(url, init, env = {}) {
  if (url !== OPENAI_RESPONSES || typeof init?.body !== 'string' || !init.body.includes('"openrouter:')) return { url, init };
  const body = JSON.parse(init.body);
  if (!String(body.model ?? '').startsWith('openrouter:')) return { url, init };
  if (!env.OPENROUTER_API_KEY || env.OPENROUTER_API_KEY.startsWith('replace-with')) throw new Error(`OPENROUTER_API_KEY is not set, so ${body.model} cannot be called`);
  const [model, pin] = body.model.slice('openrouter:'.length).split('@');
  return { url: OPENROUTER_RESPONSES, init: { ...init,
    headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, model, provider: { data_collection: 'deny', ...(pin ? { only: [pin], allow_fallbacks: false } : {}) } }) } };
}

// Personal data may not leave for a model that is not pinned to a US provider, and never to DeepSeek.
export function assertPrivateDataAllowed(model) {
  if (!String(model).startsWith('openrouter:')) return;
  const [id, pin] = model.slice('openrouter:'.length).split('@');
  if (/deepseek/i.test(id) || !US_PROVIDERS.includes(pin)) throw new Error(`${model} is not allowed to read personal data: pin a US provider (${US_PROVIDERS.join(', ')}) and do not use DeepSeek`);
}
