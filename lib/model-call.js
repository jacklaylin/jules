// The one way Jules calls the model. Every request goes to the OpenAI Responses URL with the role's
// model; a role pointed at OpenRouter (lib/models.js) is re-routed at the fetch boundary by lib/usage.js,
// which this module loads so metering and routing are in place whenever a model call can be made. Eval
// and diagnostics wrappers (lib/agent-eval.js, lib/replay.js, turnTrace) recognise calls by this URL.
import './usage.js';
import { modelFor, reasoningFor, OPENAI_RESPONSES } from './models.js';

// Why the model API refused a request, from its own error code and rate-limit headers (never the
// error message): `rate_limit_exceeded` with the exhausted limit (requests or tokens) is a rate tier
// to raise, `insufficient_quota` is billing. Read from a copy, so the caller can still read the body.
export async function modelRefusal(response) {
  let code = null;
  try { code = (await response.clone().json())?.error?.code ?? null; } catch { /* no JSON body */ }
  const header = name => response.headers?.get?.(name) ?? null;
  const limit = header('x-ratelimit-remaining-requests') === '0' ? 'requests' : header('x-ratelimit-remaining-tokens') === '0' ? 'tokens' : null;
  const retry = Number(header('retry-after-ms')) || Number(header('retry-after')) * 1000 || null;
  return { error_code: typeof code === 'string' ? code.slice(0, 40) : null, limit, retry_after_ms: retry };
}

// A request the model API rate-limited (HTTP 429) is sent once more after the wait the API asks for,
// when that wait is short, instead of failing (October 15–16 fallbacks were 429s on both the first try
// and the compact retry). Exhausted quota or a long wait fails at once. Null: no retry.
export const RATE_LIMIT_WAIT_MAX_MS = 4000;
// An account out of credit or quota stays refused until the founder tops it up, so no retry can
// succeed (October 20: each such turn spent ~40 s on retries before the same fallback).
export const BILLING_CODES = new Set(['insufficient_quota', 'credit_balance_exhausted', 'billing_hard_limit_reached']);
export async function rateLimitWait(response) {
  if (response?.status !== 429) return null;
  const { error_code, retry_after_ms } = await modelRefusal(response);
  if (BILLING_CODES.has(error_code)) return null;
  const wait = retry_after_ms ?? 1000;
  return wait <= RATE_LIMIT_WAIT_MAX_MS ? wait : null;
}

// Sends one Responses request and returns the raw response, after waiting out one short 429.
// body is the request beyond the model (instructions, input, tools, limits); store is off unless set.
// timeout covers both tries, so a retry never runs past the caller's deadline.
// reasoning: add the role's reasoning effort (MODEL_<ROLE>_REASONING) when the model is a reasoning one.
export async function modelResponse({ role = 'extract', model = null, env = {}, fetcher = fetch, timeout = null, reasoning = false, body = {} }) {
  const chosen = model ?? modelFor(role, env);
  const request = { method: 'POST', headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: chosen, store: false, ...(reasoning ? reasoningFor(role, chosen, env) : {}), ...body }),
    ...(timeout ? { signal: AbortSignal.timeout(timeout) } : {}) };
  let response = await fetcher(OPENAI_RESPONSES, request);
  const wait = await rateLimitWait(response);
  if (wait !== null) {
    console.log(JSON.stringify({ event: 'model_rate_limited', role, retry_after_ms: wait }));
    await new Promise(resolve => setTimeout(resolve, wait));
    response = await fetcher(OPENAI_RESPONSES, request);
  }
  return response;
}

// The text the model wrote, across its output messages.
export const outputText = data => (data?.output ?? []).flatMap(o => o.content ?? []).filter(c => c.type === 'output_text').map(c => c.text).join('');

// A failed request's error: the caller's own message (so its error class and logs stay the same) with
// the fields reply diagnostics use: the model's HTTP status, its error code and exhausted limit, and the
// wait it asked for. Never error.status, which API handlers turn into their own response code. billing
// marks an account out of credit. failed may instead build the caller's own error from the response.
async function failure(response, failed) {
  const { error_code = null, limit = null, retry_after_ms = null } = response ? await modelRefusal(response) : {};
  const error = typeof failed === 'function' ? await failed(response) : new Error(failed);
  return Object.assign(error, { model_status: response?.status ?? null, model_error_code: error_code, model_limit: limit, retry_after_ms },
    BILLING_CODES.has(error_code) ? { billing: true } : {});
}

// One structured call: sends the request, then checks it succeeded and completed and parses the JSON
// the schema asked for. failed and incomplete are the caller's error messages (or functions that build
// its error); incomplete: false reads the output whatever the response's status. orNull: a failed or incomplete call returns null instead of throwing. raw: return the
// whole response data (for callers that read more than the text). parse: the caller's own parsing of
// the output text (default JSON.parse).
export async function callModel({ role, model, env = {}, fetcher = fetch, timeout, reasoning, instructions, input, schema, name, maxOutputTokens, body = {},
  failed = 'Model request failed', incomplete = 'Model response incomplete', orNull = false, raw = false, parse = JSON.parse }) {
  const response = await modelResponse({ role, model, env, fetcher, timeout, reasoning, body: {
    ...(maxOutputTokens ? { max_output_tokens: maxOutputTokens } : {}), ...body,
    ...(instructions !== undefined ? { instructions } : {}), ...(input !== undefined ? { input } : {}),
    ...(schema ? { text: { format: { type: 'json_schema', name, strict: true, schema } } } : {}) } });
  if (!response?.ok) { if (orNull) return null; throw await failure(response, failed); }
  const data = await response.json();
  if (incomplete !== false && data.status !== 'completed') { if (orNull) return null; throw typeof incomplete === 'function' ? incomplete(data) : new Error(incomplete); }
  return raw ? data : parse(outputText(data));
}
