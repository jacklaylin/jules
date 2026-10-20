import { createHash } from 'node:crypto';
import { serpApiJSON, assertSerpApiAvailable, recentShoppingResults } from './serpapi.js';
import { isSuppressedStore, isLookalikeStore } from './retailers.js';
import { registryStore } from './shopping-links.js';
import { registeredStore } from './alert-discovery.js';
import { verifyListing, SOLD_OUT } from './listings.js';
import { productIdentity } from './wishlist.js';
import { publicURL } from './public-url.js';

// After a save, looks for the same product for less at another trusted store, in the background.
// Google Shopping only suggests where to look (its listed price can be stale); a store is added to the
// wishlist card only after its own page shows this product, in this colour, at a lower price. Sizes are
// not confirmed: the card says so. Searches are spent only where a saving looks likely:
//  - the Shopping results the identifying search already paid for are read first (0 searches);
//  - otherwise one Shopping search for the product;
//  - one lookup per store worth checking (its listing link), at most MAX_STORES;
//  - a product's verified offers are shared across users for a day (store_scans), so a popular item
//    is scanned once, not once per person.

export const MAX_STORES = 2, MAX_ITEMS = 3, SCAN_FRESH_MS = 864e5;
// A saving under 3% is noise between stores (rounding, sale timing), not a better deal.
export const MIN_SAVING = 0.03;
const norm = value => String(value ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const words = value => String(value ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['’]s\b/g, 's').match(/[a-z0-9]+/g) ?? [];
const host = url => { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
const DEPARTMENT = new Set(['men', 'mens', 'women', 'womens', 'unisex']);

// The registry store a Shopping seller name refers to: one definition, shared with identification search.
export { registryStore };

// Whether a title names this product: the brand, and the product name's own words (connectors, the
// department and the colour aside). A model name is often one word among generic ones ("Speedrock
// Re-Nylon and suede sneakers" vs "Collapse Re-Nylon and suede sneakers"), so every word must match;
// a long name may miss one, as stores word the same item differently ("Waxed" / "Wax", a "Loves").
const CONNECTORS = new Set(['and', 'the', 'with', 'in', 'x', 'by', 'of', 'for', 'a', 'an']);
const joined = value => String(value ?? '').replace(/([a-z0-9])[-‐‑]([a-z0-9])/gi, '$1$2');
const stem = w => w.length > 4 && w.endsWith('ed') ? w.slice(0, -2) : w.length > 3 ? w.replace(/s$/, '') : w;
export function titleMatches(title, { brand, name, color = null }) {
  const have = new Set([...words(title), ...words(joined(title))].map(stem)), own = words(brand);
  if (!own.length || !own.every(w => have.has(stem(w)))) return false;
  const skip = new Set([...own, ...words(color)]);
  const terms = [...new Set(words(joined(name)).filter(w => !skip.has(w) && !DEPARTMENT.has(w) && !CONNECTORS.has(w)).map(stem))];
  return terms.length > 0 && terms.filter(w => !have.has(w)).length <= Math.floor(terms.length / 6);
}
const namesColor = (text, color) => { const c = words(color); return c.length > 0 && c.every(w => words(text).includes(w)); };

// Stores worth one lookup: a trusted seller, not the saved store, a matching title, and a listed price
// clearly below the saved one. One result per store (the one naming the colour, else the cheapest).
export function pickCandidates(rows, { brand, name, color, saved, exclude = [] }) {
  const ceiling = saved.amount * (1 - MIN_SAVING), best = new Map();
  for (const r of rows) {
    const store = registryStore(r?.source), price = Number(r?.extracted_price);
    if (!store || !r.immersive_product_page_token || exclude.some(h => h === store.domain || h.endsWith('.' + store.domain))) continue;
    if (!(price > 0 && price <= ceiling) || typeof r.title !== 'string' || !titleMatches(r.title, { brand, name, color })) continue;
    const row = { store, price, title: r.title, token: r.immersive_product_page_token, colored: Boolean(color && namesColor(r.title, color)) };
    const prior = best.get(store.domain);
    if (!prior || row.colored > prior.colored || row.colored === prior.colored && row.price < prior.price) best.set(store.domain, row);
  }
  return [...best.values()].sort((a, b) => b.colored - a.colored || a.price - b.price).slice(0, MAX_STORES);
}

// The page's colour must be the saved colour, or the page must sell the saved colour at one price.
// A page that names no colour is accepted only when the Shopping listing named the saved colour.
export function colorAccepted(check, color, title) {
  if (!color) return true;
  if (check.color) return norm(check.color) === norm(color) || (check.color_options ?? []).some(o => norm(o.color) === norm(color)) && check.price_status === 'found';
  return namesColor(title, color);
}

// The page is this product: the same product code, or the brand and most of the product name's words.
export function sameProduct(check, { brand, name, sku, color = null }) {
  if (sku && check.product_sku && norm(sku) === norm(check.product_sku)) return true;
  return typeof check.product_name === 'string' && titleMatches(`${check.product_brand ?? ''} ${check.product_name}`, { brand, name, color });
}

export function scanKey(product) {
  const identity = productIdentity(product);
  return identity ? createHash('sha256').update(identity).digest('hex').slice(0, 40) : null;
}

const savedPrice = product => {
  const link = product.links?.[0], p = link?.price_snapshot;
  return p && Number(p.amount) > 0 && /^[A-Z]{3}$/.test(p.currency ?? '') ? { amount: Number(p.amount), currency: p.currency } : null;
};

// Checks one candidate: its listing link (one search), then its own page (no search).
async function checkCandidate(candidate, { brand, name, color, sku, env, search, verify }) {
  let url;
  try {
    const data = await search({ engine: 'google_immersive_product', page_token: candidate.token });
    const stores = data.product_results?.stores ?? [];
    url = publicURL((stores.find(s => registryStore(s.name)?.domain === candidate.store.domain) ?? stores[0])?.link);
  } catch { return { store: candidate.store.domain, outcome: 'link_lookup_failed' }; }
  // The link's own host decides trust, not the seller name Google showed.
  if (!url || !registeredStore(url) || isSuppressedStore(url) || isLookalikeStore(url, brand)) return { store: candidate.store.domain, outcome: 'untrusted_link', host: host(url) };
  let check;
  // Read without the saved name: stores word the same product differently ("Paul Smith Loves Barbour …
  // Waxed Jacket" and "Barbour x Paul Smith … Wax Jacket"), so identity is checked below instead.
  try { check = await verify(url, null, env); } catch { check = { status: 'check_failed' }; }
  const result = { store: candidate.store.domain, url, listed_price: candidate.price };
  if (check.status !== 'verified' || check.verification_basis === 'search_index') return { ...result, outcome: 'page_unreadable', status: check.status };
  if (!sameProduct(check, { brand, name, sku, color })) return { ...result, outcome: 'different_product', page_name: String(check.product_name ?? '').slice(0, 120) };
  if (check.product_brand && !(norm(check.product_brand).includes(norm(brand)) || norm(brand).includes(norm(check.product_brand)))) return { ...result, outcome: 'different_brand' };
  const price = check.price_snapshot;
  if (!price || !(price.amount > 0) || publicURL(price.source_url) !== publicURL(check.url)) return { ...result, outcome: 'no_page_price' };
  if (SOLD_OUT.includes(check.availability)) return { ...result, outcome: 'sold_out' };
  if (!colorAccepted(check, color, candidate.title)) return { ...result, outcome: 'color_mismatch', page_color: check.color ?? null };
  return { ...result, outcome: 'verified', offer: { url: publicURL(check.url) ?? url, retailer: candidate.store.name, price_snapshot: { amount: price.amount, currency: price.currency, source_url: publicURL(check.url) ?? url, checked_at: price.checked_at ?? check.checked_at ?? new Date().toISOString() }, color: check.color ?? null } };
}

// Scans one saved item and returns what it found (offers cheaper than this user's saved price).
export async function scanItem(product, { env, search, verify, store, recent = recentShoppingResults, now = Date.now() }) {
  const brand = product.brand, name = product.name, color = product.selected_color ?? product.listing_check?.color ?? null;
  const saved = savedPrice(product), key = scanKey(product);
  if (!saved) return { outcome: 'skipped', reason: 'no_saved_price', searches: 0 };
  if (!key || !brand || !name) return { outcome: 'skipped', reason: 'no_product_identity', searches: 0 };
  if (saved.currency !== (env.SHOPPING_CURRENCY ?? 'USD')) return { outcome: 'skipped', reason: 'other_currency', searches: 0 };
  const exclude = (product.links ?? []).map(l => host(l.url)).filter(Boolean);
  const cheaper = offers => offers.filter(o => o.price_snapshot.currency === saved.currency && o.price_snapshot.amount <= saved.amount * (1 - MIN_SAVING) && !exclude.includes(host(o.url)));
  // Another person's scan of the same product today is reused; its offers are checked against this price.
  let cached = null;
  try { cached = await store.storeScan(key); } catch { /* Without the shared table every save scans. */ }
  if (cached && now - Date.parse(cached.scanned_at) < SCAN_FRESH_MS) return { outcome: 'completed', source: 'shared', searches: 0, offers: cheaper(cached.result?.offers ?? []), checked: [] };
  try { assertSerpApiAvailable(env); } catch { return { outcome: 'skipped', reason: 'search_paused', searches: 0 }; }
  let searches = 0, source = 'recent';
  let rows = recent((env.SHOPPING_COUNTRY ?? 'US').toLowerCase(), now).filter(r => typeof r?.title === 'string' && titleMatches(r.title, { brand, name, color }));
  if (!rows.length) {
    source = 'search'; searches++;
    const q = [norm(name).startsWith(norm(brand)) ? '' : brand, name, color].filter(Boolean).join(' ').slice(0, 200);
    try { rows = (await search({ engine: 'google_shopping', q })).shopping_results ?? []; }
    catch { return { outcome: 'skipped', reason: 'search_failed', searches }; }
  }
  const candidates = pickCandidates(rows, { brand, name, color, saved, exclude });
  searches += candidates.length;
  const sku = product.listing_check?.product_sku ?? null;
  const checked = await Promise.all(candidates.map(c => checkCandidate(c, { brand, name, color, sku, env, search, verify })));
  const offers = checked.filter(c => c.offer).map(c => c.offer);
  // Shared only from a full search: the identifying search's results may have covered other stores.
  if (source === 'search') try { await store.saveStoreScan(key, { offers }); } catch { /* Next save scans again. */ }
  return { outcome: 'completed', source, searches, candidates: candidates.length, offers: cheaper(offers), checked: checked.map(({ offer, ...c }) => c) };
}

const serp = (env, fetcher) => params => serpApiJSON('https://serpapi.com/search.json?' + new URLSearchParams({ ...params, api_key: env.SERPAPI_API_KEY, gl: (env.SHOPPING_COUNTRY ?? 'US').toLowerCase(), hl: 'en' }), { redirect: 'error', signal: AbortSignal.timeout(15000) }, env, fetcher);
// A store page read with no paid index fallback: the page itself is the evidence.
const readPage = fetcher => (url, name, env) => verifyListing(url, name, fetcher, undefined, env, { indexed: false });

// The items one save created, scanned in turn. Found stores join the item's links with sizes unconfirmed.
export async function scanSavedItems({ store, operation, env, fetcher = fetch, search = serp(env, fetcher), verify = readPage(fetcher) }) {
  if (!env.SERPAPI_API_KEY || env.SERPAPI_API_KEY.startsWith('replace-with')) return [];
  const items = (await store.savedWishlistItems(operation)).slice(0, MAX_ITEMS), results = [];
  for (const item of items) {
    const started = Date.now();
    let result;
    try { result = await scanItem(item.product, { env, search, verify, store }); }
    catch { result = { outcome: 'failed', searches: 0 }; }
    let added = 0;
    if (result.offers?.length) {
      const discovered_at = new Date().toISOString();
      const links = result.offers.map(o => ({ url: o.url, retailer: o.retailer, price_snapshot: o.price_snapshot, availability: null, verification_status: 'verified', discovered: { at: discovered_at, via: 'store_scan', sizes: 'unconfirmed' } }));
      try { added = await store.addWishlistLinks(item.conversation_id, item.id, links); }
      catch { result = { ...result, outcome: 'save_failed' }; }
    }
    const { offers, ...logged } = result;
    console.log(JSON.stringify({ event: 'store_scan', operation, item_id: item.id, ...logged, found: offers?.length ?? 0, added, elapsed_ms: Date.now() - started }));
    results.push({ item_id: item.id, ...result, added });
  }
  return results;
}
