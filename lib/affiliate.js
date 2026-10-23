import { createHmac } from 'node:crypto';
import { publicURL } from './public-url.js';

// Affiliate links (AFFILIATE-LINKS.md). With AFFILIATE_ENABLED on, a person's tap on a Jules /go/ link is sent
// through Sovrn's Redirect API, which forwards to the same store page and credits a purchase to Jules. Sovrn
// forwards to the original link when the store isn't in its network. It runs after the tap, so it never
// changes which products or stores Jules shows. Never `cp` (Sovrn's own other-retailer fallback): the store
// the person tapped is the store they reach.
// The tracking id (cuid) is an opaque hash of the tap's link, never a phone, email or user id, and can be
// recomputed from the link_click row (ref, link_index) to match a Sovrn purchase back to the product.
const MAX_URL = 2000;
export function affiliateURL(url, { env, ref, medium }) {
  const key = env.SOVRN_CAMPAIGN_KEY;
  if (env.AFFILIATE_ENABLED !== 'true' || !key || key.startsWith('replace-with') || !/^[A-Za-z0-9]{8,64}$/.test(key)) return null;
  const store = publicURL(url);
  // A link that already carries Sovrn's affiliate marker is not wrapped again (Sovrn code of conduct §7.3).
  if (!store || /[?&]afsrc=1(?:&|$)/.test(store)) return null;
  const cuid = createHmac('sha256', key).update(`jules-affiliate:v1:${ref}`).digest('hex').slice(0, 24);
  const wrapped = 'https://redirect.viglink.com/?' + new URLSearchParams({ key, u: store, cuid, utm_source: 'jules', utm_medium: medium });
  return wrapped.length <= MAX_URL ? wrapped : null;
}
