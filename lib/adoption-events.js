// Adoption events (db/032, Admin › Adoption): product options shown per reply, outbound product-link
// clicks and purchase requests. Rows hold ids and counts only: no message text, product names or phone numbers.
// Recording is best effort: before the migration runs (or if the write fails) the reply still goes out.
import { createHmac, timingSafeEqual } from 'node:crypto';
import sharp from 'sharp';
import { publicURL } from './public-url.js';
import { fetchProductAssets, fetchProductPhoto, productAssetURL, productPhotoURL } from './product-photos.js';
import { retailerFor } from './retailers.js';
import { escapeHTML } from './wishlist-preview.js';
import { readWishlistGoLink } from './wishlist-go.js';

// Tapback kinds as fixed labels. 👎 is a developer flag and is stored as feedback instead (lib/developer-feedback.js).
export const REACTION_KINDS = { '❤️': 'love', '👍': 'like', '😂': 'laugh', '‼️': 'emphasize', '❓': 'question' };
const bareEmoji = emoji => String(emoji ?? '').replace(/[\u{1F3FB}-\u{1F3FF}\uFE0F]/gu, '');
export const reactionKind = emoji => Object.entries(REACTION_KINDS).find(([e]) => bareEmoji(e) === bareEmoji(emoji))?.[1] ?? 'other';

// A tapback on one of Jules's replies, recorded against that reply's operation id (db/034). The emoji is a
// protocol field Photon sends, read the same way the 👎 flag is. Best effort: a missing target or table logs and moves on.
export async function recordReaction(store, { message, target }) {
  if (!store?.reactionTarget || !target) return;
  const kind = reactionKind(message?.content?.emoji);
  try {
    const reply = await store.reactionTarget(target, message.sender?.id);
    if (!reply?.operation_id) return console.log(JSON.stringify({ event: 'reaction_target_unknown', kind }));
    await recordAdoptionEvent(store, { conversation_id: reply.conversation_id, kind: 'reaction', ref: reply.operation_id, detail: kind });
  } catch (error) { console.log(JSON.stringify({ event: 'reaction_record_failed', kind, status: error?.database_status ?? null })); }
}

export async function recordAdoptionEvent(store, row) {
  if (!store?.recordAdoptionEvent || !row.conversation_id) return;
  try { await store.recordAdoptionEvent({ quantity: 1, ...row }); }
  catch (error) { console.log(JSON.stringify({ event: 'adoption_event_failed', kind: row.kind, status: error?.database_status ?? null })); }
}

// Every product link a reply's search result could show, in a fixed order: each product's page, its other
// stores, then checkout links. A tracked link points at a position in this list, so the result stays the source of truth.
export function resultLinks(result) {
  return resultTargets(result).map(target => target?.url ?? null);
}
// The same list with the product and store each link belongs to, for its link preview.
function resultTargets(result) {
  const targets = [];
  for (const p of result?.products ?? []) targets.push({ url: p.url, product: p, retailer: p.retailer, check: p.listing_check }, ...(p.merchant_options ?? []).map(m => ({ url: m.url, product: p, retailer: m.retailer, check: m.listing_check })));
  for (const l of result?.checkout_links ?? []) {
    const product = (result?.products ?? []).find(p => p.url === l.url) ?? null;
    targets.push({ url: l.url, product, retailer: l.store }, { url: l.checkout_url, product, retailer: l.store });
  }
  return targets.map(target => publicURL(target.url) ? target : null);
}

const URLS = /https:\/\/\S+/g;
// Trailing punctuation is part of the sentence, not the link.
const split = token => { const m = token.match(/^(.*?)([).,!?;:’”"']*)$/); return [m[1], m[2]]; };

// How many product options a sent reply showed: products with at least one of their links in the text.
export function shownProducts(body, result) {
  const sent = new Set((String(body ?? '').match(URLS) ?? []).map(t => split(t)[0]));
  return (result?.products ?? []).filter(p => [p.url, ...(p.merchant_options ?? []).map(m => m.url)].some(url => url && sent.has(url))).length;
}

// The products a sent reply linked, each with a /go/ link for its own preview card, in result order.
export function productPreviews(body, result, operation, env) {
  const sent = new Set((String(body ?? '').match(URLS) ?? []).map(t => split(t)[0])), links = resultLinks(result);
  return (result?.products ?? []).flatMap(p => {
    const url = [p.url, ...(p.merchant_options ?? []).map(m => m.url)].find(u => u && sent.has(u));
    const index = url ? links.indexOf(url) : -1, preview_url = index >= 0 ? goLink(operation, index, env) : null;
    return preview_url ? [{ product: p, preview_url }] : [];
  });
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

// Product links in an outgoing reply become Jules links that preview the product and forward to the store.
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

const storeName = target => {
  const named = typeof target.retailer === 'string' ? target.retailer : target.retailer?.name;
  if (named) return named;
  try { return retailerFor(target.url, target.product?.brand ?? '').name; } catch { return null; }
};
const plain = value => String(value ?? '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g, '');
// Only facts already in the reply's result: the product's name and store. Never a price, size or stock claim.
// iMessage shows only the title and domain, so the store goes in the title unless the title already names it.
export function previewTitle(target) {
  const name = String(target.product?.name ?? '').trim(), brand = String(target.product?.brand ?? '').trim(), store = storeName(target);
  const title = !name ? store ?? 'Product link' : !brand || name.toLowerCase().startsWith(brand.toLowerCase()) ? name : `${brand} ${name}`;
  return (store && !plain(title).includes(plain(store)) ? `${title} · ${store}` : title).slice(0, 200);
}
// The product's Lens thumbnail, else the first photo from the store page Jules verified for it.
function photoSource(target) {
  if (productPhotoURL(target.product?.candidate_image)) return { url: target.product.candidate_image, page: null };
  for (const check of [target.check, target.product?.listing_check]) {
    const url = (check?.product_images ?? []).find(productAssetURL), page = check?.url ?? target.url;
    if (url && productAssetURL(page)) return { url, page };
  }
  return null;
}
const loadSourcePhoto = async source => source.page
  ? Buffer.from((await fetchProductAssets([source.url], source.page))[0].data, 'base64') : fetchProductPhoto(source.url);
function previewPage(target, token, env) {
  const origin = env.SITE_ORIGIN.replace(/\/$/, ''), store = storeName(target), title = escapeHTML(previewTitle(target));
  const canonical = `${origin}/go/${token}`, image = `${origin}/api/image?go=${encodeURIComponent(token)}&image=1`;
  // No product photo: no image at all rather than repeated brand art.
  const photo = photoSource(target)
    ? `<meta property="og:image" content="${escapeHTML(image)}"><meta property="og:image:width" content="800"><meta property="og:image:height" content="800"><meta property="og:image:type" content="image/jpeg">` : '';
  const description = store ? `<meta property="og:description" content="${escapeHTML(`At ${store}`)}">` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><meta property="og:title" content="${title}">${description}<meta property="og:type" content="website"><meta property="og:url" content="${escapeHTML(canonical)}">${photo}<meta name="robots" content="noindex,nofollow"></head><body><a href="${escapeHTML(target.url)}">${title}</a></body></html>`;
}

const photos = new Map();
async function previewPhoto(source, loadPhoto) {
  let bytes = photos.get(source.url);
  if (!bytes) {
    bytes = await sharp(await loadPhoto(source), { limitInputPixels: 25000000 }).rotate() .resize(800, 800, { fit: 'contain', background: '#ffffff' }).flatten({ background: '#ffffff' }).jpeg({ quality: 82 }).toBuffer();
    photos.set(source.url, bytes); if (photos.size > 50) photos.delete(photos.keys().next().value);
  }
  return bytes;
}

// GET /go/<token>: forwards a person to the product link from the reply's stored result, recording the tap
// (with which link it was, db/052) when LINK_CLICK_TRACKING is on. A wishlist link forwards to the store it carries. Preview fetchers get the product's name, store and photo instead, so the
// link previews even when the store blocks preview bots.
export function createGoHandler({ env, store, loadPhoto = loadSourcePhoto }) {
  return async (req, res) => {
    const page = (status, text) => { res.statusCode = status; res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(text); };
    if (!['GET', 'HEAD'].includes(req.method)) { res.setHeader('Allow', 'GET, HEAD'); return page(405, 'Method not allowed.'); }
    const params = new URL(req.url, 'https://local.invalid').searchParams, token = params.get('go');
    const saved = readWishlistGoLink(token, env);
    if (saved) {
      res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      if (req.method === 'GET' && env.LINK_CLICK_TRACKING === 'true' && !PREVIEW_AGENT.test(req.headers?.['user-agent'] ?? ''))
        await recordAdoptionEvent(store, { conversation_id: saved.conversation, kind: 'link_click', ref: `wishlist:${saved.group}` });
      res.statusCode = 302; res.setHeader('Location', saved.url); res.setHeader('Cache-Control', 'no-store'); return res.end();
    }
    const link = readGoLink(token, env);
    if (!link) return page(404, 'This link is not valid. Ask Jules for the product link again.');
    let reply;
    try { reply = await store.replyResult(link.operation); }
    catch { return page(503, 'This link could not be opened right now. Try again in a moment.'); }
    const target = resultTargets(reply?.search_result)[link.index];
    if (!target) return page(404, 'This link is no longer available. Ask Jules for the product link again.');
    res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Robots-Tag', 'noindex, nofollow'); res.setHeader('X-Content-Type-Options', 'nosniff');
    if (params.get('image') === '1') {
      const source = photoSource(target);
      if (!source) return page(404, 'No photo.');
      let bytes;
      try { bytes = await previewPhoto(source, loadPhoto); }
      catch { console.log(JSON.stringify({ event: 'go_preview_photo_failed' })); return page(404, 'No photo.'); }
      res.statusCode = 200; res.setHeader('Content-Type', 'image/jpeg'); res.setHeader('Content-Length', bytes.length); res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=86400');
      return res.end(req.method === 'HEAD' ? undefined : bytes);
    }
    if (PREVIEW_AGENT.test(req.headers?.['user-agent'] ?? '')) {
      res.statusCode = 200; res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', 'no-store');
      return res.end(req.method === 'HEAD' ? undefined : previewPage(target, token, env));
    }
    if (req.method === 'GET' && env.LINK_CLICK_TRACKING === 'true')
      await recordAdoptionEvent(store, { conversation_id: reply.conversation_id, kind: 'link_click', ref: link.operation, link_index: link.index });
    res.statusCode = 302; res.setHeader('Location', target.url); res.setHeader('Cache-Control', 'no-store'); res.end();
  };
}
