import { serpApiJSON, assertSerpApiAvailable } from './serpapi.js';
import { merchantURL } from './product-photos.js';
import { RETAILERS } from './retailers.js';
import { shoppingStoreRows } from './shopping-links.js';
import { readSizeOffers, sizeKey } from './price-alerts.js';

// Finds other stores selling the watched product. Google's catalog only suggests candidates;
// a store joins the watch only after its own product page matches the full product name, the
// known color and lists a priced offer in the watched size.

export const DISCOVERY_INTERVAL_MS = 7 * 864e5;
export const MAX_ALERT_LINKS = 8;
const RECOVERY_RETRY_MS = 864e5, CANDIDATES = 4, CACHE_MS = 3600000;
const host = url => { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
// A lower price alone does not establish a store's credibility, so only registry stores are added.
export const registeredStore = url => { const h = host(url); return Boolean(h) && RETAILERS.some(r => h === r.domain || h.endsWith('.' + r.domain)); };
const cache = new Map();

export function discoveryDue(alert, { now = Date.now(), recovery = false } = {}) {
  if (alert.links.length >= MAX_ALERT_LINKS) return false;
  // A search that could not run is retried after a day, not on every check.
  const attempted = Date.parse(alert.last_result?.discovery?.attempted_at ?? '');
  if (alert.last_result?.discovery?.status === 'unavailable' && Number.isFinite(attempted) && now - attempted < RECOVERY_RETRY_MS) return false;
  const last = Date.parse(alert.last_result?.discovered_at ?? '');
  if (!Number.isFinite(last)) return true;
  return now - last >= (recovery ? RECOVERY_RETRY_MS : DISCOVERY_INTERVAL_MS);
}

// Shopping rows name a seller but no longer carry its link (October 20, 2026): the trusted stores not
// already watched are looked up, two at most (one search each).
async function candidateURLs(query, env, fetcher, watched = []) {
  const key = query + '\n' + env.SHOPPING_COUNTRY + '\n' + [...watched].sort().join(','), prior = cache.get(key);
  if (prior && Date.now() - prior.at < CACHE_MS) return { urls: prior.urls, calls: 0 };
  let calls = 0;
  const search = params => { calls++; return serpApiJSON('https://serpapi.com/search.json?' + new URLSearchParams({ ...params, api_key: env.SERPAPI_API_KEY, gl: (env.SHOPPING_COUNTRY ?? 'US').toLowerCase(), hl: 'en' }), { redirect: 'error', signal: AbortSignal.timeout(15000) }, env, fetcher); };
  const shopping = await search({ engine: 'google_shopping', q: query });
  // One lookup failing leaves the other candidates usable.
  const { rows } = await shoppingStoreRows(shopping.shopping_results, search, { exclude: watched });
  const urls = rows.map(r => r.link);
  cache.set(key, { at: Date.now(), urls }); if (cache.size > 100) cache.delete(cache.keys().next().value);
  return { urls, calls };
}

export async function discoverAlertLinks(alert, checks, { env, fetcher = fetch, read = readSizeOffers, sizes } = {}) {
  const unavailable = reason => { console.log(JSON.stringify({ event: 'price_alert_discovery_unavailable', alert_id: alert.id, reason })); return { status: 'unavailable', reason, links: [], checks: [] }; };
  if (!env.SERPAPI_API_KEY || env.SERPAPI_API_KEY.startsWith('replace-with')) return unavailable('not_configured');
  try { assertSerpApiAvailable(env); } catch { return unavailable('search_paused'); }
  // Without a known color, a store page that declares one cannot be bound to this variant.
  const color = alert.links.find(l => l.color)?.color ?? checks.find(c => c.color)?.color ?? null;
  const name = alert.links[0]?.name ?? alert.name;
  let found;
  try { found = await candidateURLs([name, color].filter(Boolean).join(' '), env, fetcher, alert.links.map(l => host(l.url)).filter(Boolean)); }
  catch { return unavailable('search_failed'); }
  const watched = new Set(alert.links.map(l => host(l.url))), seen = new Set();
  const candidates = found.urls.map(merchantURL).filter(url => {
    const h = host(url);
    if (!url || watched.has(h) || seen.has(h) || !registeredStore(url)) return false;
    seen.add(h); return true;
  }).slice(0, Math.min(CANDIDATES, MAX_ALERT_LINKS - alert.links.length));
  const keys = new Set(sizes.map(sizeKey)), discovered_at = new Date().toISOString();
  const results = await Promise.all(candidates.map(async url => {
    const link = { url, name, ...(color ? { color } : {}), market_country: env.SHOPPING_COUNTRY, market_currency: env.SHOPPING_CURRENCY };
    const check = await read(link, fetcher, { minimumMatch: 1 });
    const sized = check.status === 'checked' && check.offers.some(o => keys.has(o.key) && Number.isFinite(o.amount));
    const accepted = sized && (color || !check.color);
    return { url, accepted, check, link: { url, name, ...(color ? { color } : {}), discovered_at, discovered_via: 'google_shopping' } };
  }));
  const accepted = results.filter(r => r.accepted);
  console.log(JSON.stringify({ event: 'price_alert_discovery', alert_id: alert.id, searches: found.calls, candidates: candidates.length, accepted: accepted.length, rejected: results.filter(r => !r.accepted).map(r => ({ host: host(r.url), status: r.check.status })) }));
  return { status: 'completed', links: accepted.map(r => r.link), checks: accepted.map(r => r.check), candidates: candidates.length, searches: found.calls };
}
