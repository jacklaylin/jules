import { createHmac, timingSafeEqual } from 'node:crypto';
import { publicURL } from './public-url.js';

// A wishlist page link opens through Jules (/go/, lib/adoption-events.js) so the tap is counted like one from a
// text. It has no reply behind it, so its token carries the store link itself, signed with the owner's
// conversation and wishlist item: /go/w.<payload>.<signature>. Only Jules can make one, so it is not an open redirect.
function signature(payload, env) {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || key.startsWith('replace-with')) return null;
  return createHmac('sha256', key).update(`jules-wishlist-click:v1:${payload}`).digest('base64url').slice(0, 16);
}
export function wishlistGoLink(conversation, group, url, env) {
  const payload = Buffer.from(JSON.stringify([conversation, group, url])).toString('base64url'), sig = signature(payload, env);
  return sig && publicURL(url) ? `/go/w.${payload}.${sig}` : null;
}
export function readWishlistGoLink(token, env) {
  const m = /^w\.([A-Za-z0-9_-]{1,4000})\.([A-Za-z0-9_-]{16})$/.exec(token ?? ''), expected = m && signature(m[1], env);
  if (!expected || !timingSafeEqual(Buffer.from(m[2]), Buffer.from(expected))) return null;
  try { const [conversation, group, url] = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8')); return publicURL(url) ? { conversation, group, url } : null; }
  catch { return null; }
}
