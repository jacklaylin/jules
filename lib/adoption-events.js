// Adoption events (db/032, Admin › Adoption): product options shown per reply, outbound product-link
// clicks and purchase requests. Rows hold ids and counts only: no message text, product names or phone numbers.
// Recording is best effort: before the migration runs (or if the write fails) the reply still goes out.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { publicURL } from './public-url.js';

export async function recordAdoptionEvent(store, row) {
  if (!store?.recordAdoptionEvent || !row.conversation_id) return;
  try { await store.recordAdoptionEvent({ quantity: 1, ...row }); }
  catch (error) { console.log(JSON.stringify({ event: 'adoption_event_failed', kind: row.kind, status: error?.database_status ?? null })); }
}

// Every product link a reply's search result could show, in a fixed order: each product's page, its other
// stores, then checkout links. A tracked link points at a position in this list, so the result stays the source of truth.
export function resultLinks(result) {
  const links = [];
  for (const p of result?.products ?? []) links.push(p.url, ...(p.merchant_options ?? []).map(m => m.url));
  for (const l of result?.checkout_links ?? []) links.push(l.url, l.checkout_url);
  return links.map(url => publicURL(url) ? url : null);
}

const URLS = /https:\/\/\S+/g;
// Trailing punctuation is part of the sentence, not the link.
const split = token => { const m = token.match(/^(.*?)([).,!?;:’”"']*)$/); return [m[1], m[2]]; };

// How many product options a sent reply showed: products with at least one of their links in the text.
export function shownProducts(body, result) {
  const sent = new Set((String(body ?? '').match(URLS) ?? []).map(t => split(t)[0]));
  return (result?.products ?? []).filter(p => [p.url, ...(p.merchant_options ?? []).map(m => m.url)].some(url => url && sent.has(url))).length;
}

function signature(operation, index, env) {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || key.startsWith('replace-with')) return null;
  return createHmac('sha256', key).update(`jules-link-click:v1:${operation}:${index}`).digest('base64url').slice(0, 16);
}
export function goLink(operation, index, env) {
  const sig = signature(operation, index, env);
  if (!env.SITE_ORIGIN || !sig) return null;
  return `${env.SITE_ORIGIN.replace(/\/$/, '')}/go/${Buffer.from(operation).toString('base64url')}.${index}.${sig}`;
}
export function readGoLink(token, env) {
  const m = /^([A-Za-z0-9_-]{1,200})\.(\d{1,3})\.([A-Za-z0-9_-]{16})$/.exec(token ?? '');
  if (!m) return null;
  const operation = Buffer.from(m[1], 'base64url').toString('utf8'), index = Number(m[2]), expected = signature(operation, index, env);
  return expected && timingSafeEqual(Buffer.from(m[3]), Buffer.from(expected)) ? { operation, index } : null;
}

// Product links in an outgoing reply become Jules links that record the click and forward to the store.
// Only exact links from this reply's result are changed; any other text and links stay as written.
export function trackLinks(body, result, operation, env) {
  const links = resultLinks(result);
  return String(body ?? '').replace(URLS, token => {
    const [url, tail] = split(token), index = links.indexOf(url), tracked = index >= 0 ? goLink(operation, index, env) : null;
    return tracked ? tracked + tail : token;
  });
}

// Link-preview fetchers (iMessage, social cards) open links without a person tapping them.
const PREVIEW_AGENT = /bot|facebookexternalhit|preview|crawler|spider|slurp/i;

// GET /go/<token>: records the click, then forwards to the product link from the reply's stored result.
export function createGoHandler({ env, store }) {
  return async (req, res) => {
    const page = (status, text) => { res.statusCode = status; res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(text); };
    if (!['GET', 'HEAD'].includes(req.method)) { res.setHeader('Allow', 'GET, HEAD'); return page(405, 'Method not allowed.'); }
    const link = readGoLink(new URL(req.url, 'https://local.invalid').searchParams.get('go'), env);
    if (!link) return page(404, 'This link is not valid. Ask Jules for the product link again.');
    let reply;
    try { reply = await store.replyResult(link.operation); }
    catch { return page(503, 'This link could not be opened right now. Try again in a moment.'); }
    const url = resultLinks(reply?.search_result)[link.index];
    if (!url) return page(404, 'This link is no longer available. Ask Jules for the product link again.');
    if (req.method === 'GET' && !PREVIEW_AGENT.test(req.headers?.['user-agent'] ?? ''))
      await recordAdoptionEvent(store, { conversation_id: reply.conversation_id, kind: 'link_click', ref: link.operation });
    res.statusCode = 302; res.setHeader('Location', url); res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer'); res.end();
  };
}
