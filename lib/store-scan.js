import { createHash } from 'node:crypto';
import { serpApiJSON, assertSerpApiAvailable } from './serpapi.js';
import { RETAILERS, RESALE_MARKETPLACES, isSuppressedStore, isLookalikeStore } from './retailers.js';
import { registeredStore } from './alert-discovery.js';
import { verifyListing, SOLD_OUT } from './listings.js';
import { productIdentity } from './wishlist.js';
import { publicURL } from './public-url.js';
import { sameProductGroups, sameBrand } from './same-product.js';

// After a save, looks for the same product for less at other stores, in the background.
//  - One Google search for the product, leaving out the store it was saved from and the brand's own
//    site, returns other stores' product pages directly (Google Shopping covers luxury stores poorly:
//    it never listed SSENSE for a LEMAIRE jacket SSENSE sells).
//  - Trusted stores (the curated registry) come first: up to MAX_STORES of their pages are read (no
//    search cost); only pages showing a price clearly below the saved one go on. Only when none of them
//    has it for less are other stores from the same results read (founder decision, October 20): never
//    a suppressed, copycat or resale site, and labelled unreviewed wherever they show.
//  - Whether each page is this product is the same model check search results use (lib/same-product.js):
//    stores name one item differently, so words cannot decide it. A shared product code also counts.
//  - A product's verified offers are shared across users for a day (store_scans), so a popular item
//    is scanned once, not once per person.
// A store joins the wishlist card only with its own page's price; sizes are not confirmed and the card says so.

export const MAX_STORES = 3, MAX_ITEMS = 3, SCAN_FRESH_MS = 864e5;
// A saving under 3% is noise between stores (rounding, sale timing), not a better deal.
export const MIN_SAVING = 0.03;
const norm = value => String(value ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const host = url => { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
const within = (h, domain) => h === domain || h.endsWith('.' + domain);

export function scanKey(product) {
  const identity = productIdentity(product);
  return identity ? createHash('sha256').update(identity).digest('hex').slice(0, 40) : null;
}
const savedPrice = product => {
  const p = product.links?.[0]?.price_snapshot;
  return p && Number(p.amount) > 0 && /^[A-Z]{3}$/.test(p.currency ?? '') ? { amount: Number(p.amount), currency: p.currency } : null;
};

// The sites the search leaves out: the stores already on the card and the brand's own store.
export function excludedSites(product) {
  const official = RETAILERS.filter(r => r.tier === 'official' && r.brands.some(b => sameBrand(b, product.brand))).map(r => r.domain);
  return [...new Set([...(product.links ?? []).map(l => host(l.url)), ...official].filter(Boolean))];
}
export function scanQuery(product, exclude) {
  const { brand, name } = product, color = product.selected_color ?? product.listing_check?.color ?? null;
  const words = [norm(name).startsWith(norm(brand)) ? '' : brand, name, color && !norm(name).includes(norm(color)) ? color : ''].filter(Boolean).join(' ');
  return (words.slice(0, 200) + ' ' + exclude.slice(0, 6).map(d => '-site:' + d).join(' ')).trim();
}
// Scam stores are built to look cheaper, which is exactly what this scan rewards, so an unreviewed store
// also passes three checks on its address and price (format checks, never a reading of what a page says):
//  - its domain is not a known store's or the brand's name with words added (ssense-sale.shop,
//    lemaireoutlet.com): the usual counterfeit-shop address;
//  - its domain ending is not one of the cheap endings scam shops cluster on;
//  - its price is not implausibly far below the saved one (MAX_UNREVIEWED_DISCOUNT).
export const MAX_UNREVIEWED_DISCOUNT = 0.6;
const RISKY_ENDINGS = ['shop', 'store', 'top', 'xyz', 'online', 'site', 'icu', 'vip', 'buzz', 'club', 'live', 'sale', 'deals', 'cfd', 'sbs', 'bond', 'cyou', 'fun', 'life', 'website', 'space', 'click'];
const NAMES = [...new Set(RETAILERS.flatMap(r => [r.domain.split('.')[0], ...(r.brands ?? [])]).map(norm).filter(n => n.length >= 5))];
export function unreviewedAddressRisk(url, brand) {
  const h = host(url), labels = h.split('.'), name = norm(labels.length > 2 && labels.at(-2).length <= 3 ? labels.at(-3) : labels.at(-2));
  if (RISKY_ENDINGS.includes(labels.at(-1))) return 'risky_domain_ending';
  if ([...NAMES, norm(brand)].some(n => n.length >= 5 && name !== n && name.includes(n))) return 'store_name_in_domain';
  return null;
}

// Store pages from the results, one per store, never a store already on the card, in two tiers: trusted
// (registry) stores, and other stores that are not suppressed, copycat or resale sites.
export function candidatePages(results, exclude, brand) {
  const seen = new Set(), trusted = [], other = [];
  for (const r of results) {
    const url = publicURL(r?.link), h = host(url);
    if (!url || seen.has(h) || exclude.some(d => within(h, d)) || isSuppressedStore(url) || isLookalikeStore(url, brand) || RESALE_MARKETPLACES.some(d => within(h, d))) continue;
    seen.add(h);
    const tier = registeredStore(url) ? trusted : unreviewedAddressRisk(url, brand) ? null : other;
    if (tier && tier.length < MAX_STORES) tier.push(url);
  }
  return { trusted, other };
}

// Scans one saved item and returns the offers cheaper than this person's saved price.
export async function scanItem(product, { env, search, verify, same = sameProductGroups, store, now = Date.now() }) {
  const saved = savedPrice(product), key = scanKey(product);
  if (!saved) return { outcome: 'skipped', reason: 'no_saved_price', searches: 0 };
  if (!key || !product.brand || !product.name) return { outcome: 'skipped', reason: 'no_product_identity', searches: 0 };
  if (saved.currency !== (env.SHOPPING_CURRENCY ?? 'USD')) return { outcome: 'skipped', reason: 'other_currency', searches: 0 };
  const exclude = excludedSites(product), onCard = (product.links ?? []).map(l => host(l.url));
  const cheaper = offers => offers.filter(o => o.price_snapshot.currency === saved.currency && o.price_snapshot.amount <= saved.amount * (1 - MIN_SAVING) && !onCard.includes(host(o.url)));
  // Another person's scan of the same product today is reused; its offers are checked against this price.
  let cached = null;
  try { cached = await store.storeScan(key); } catch { /* Without the shared table every save scans. */ }
  if (cached && now - Date.parse(cached.scanned_at) < SCAN_FRESH_MS) return { outcome: 'completed', source: 'shared', searches: 0, offers: cheaper(cached.result?.offers ?? []), checked: [] };
  try { assertSerpApiAvailable(env); } catch { return { outcome: 'skipped', reason: 'search_paused', searches: 0 }; }
  let results;
  try { results = (await search({ engine: 'google', q: scanQuery(product, exclude), num: '20' })).organic_results ?? []; }
  catch { return { outcome: 'skipped', reason: 'search_failed', searches: 1 }; }
  const pages = candidatePages(results, exclude, product.brand);
  const examine = async (urls, tier) => {
    // Each page is read without the saved name: identity is decided below, not by matching words.
    const checked = await Promise.all(urls.map(async url => {
      let check;
      try { check = await verify(url, null, env); } catch { check = { status: 'check_failed' }; }
      const row = { store: host(url), url, tier };
      if (check.status !== 'verified' || check.verification_basis === 'search_index') return { ...row, outcome: 'page_unreadable', status: check.status };
      if (check.product_brand && !sameBrand(check.product_brand, product.brand)) return { ...row, outcome: 'different_brand' };
      const price = check.price_snapshot;
      if (!price || !(price.amount > 0) || publicURL(price.source_url) !== publicURL(check.url)) return { ...row, outcome: 'no_page_price' };
      if (SOLD_OUT.includes(check.availability)) return { ...row, outcome: 'sold_out' };
      if (price.currency !== saved.currency || price.amount > saved.amount * (1 - MIN_SAVING)) return { ...row, outcome: 'not_cheaper', page_price: price.amount };
      if (tier === 'unreviewed' && price.amount < saved.amount * (1 - MAX_UNREVIEWED_DISCOUNT)) return { ...row, outcome: 'implausible_discount', page_price: price.amount };
      return { ...row, outcome: 'cheaper', check };
    }));
    // One model check for every cheaper page against the saved listing; a shared product code also counts.
    const cheaperPages = checked.filter(c => c.outcome === 'cheaper');
    if (cheaperPages.length) {
      const sku = norm(product.listing_check?.product_sku);
      const listings = [{ url: product.links?.[0]?.url, brand: product.brand, name: product.name, selected_color: product.selected_color, listing_check: product.listing_check },
        ...cheaperPages.map(c => ({ url: c.check.url, brand: c.check.product_brand ?? product.brand, name: c.check.product_name, listing_check: c.check }))];
      const groups = await same(listings, { env });
      const matched = new Set((groups.find(g => g.includes(0)) ?? []).filter(i => i > 0).map(i => i - 1));
      cheaperPages.forEach((c, k) => {
        const code = sku && norm(c.check.product_sku) === sku;
        if (!matched.has(k) && !code) { c.outcome = 'different_product'; c.page_name = String(c.check.product_name ?? '').slice(0, 120); return; }
        const url = publicURL(c.check.url) ?? c.url;
        c.outcome = 'verified';
        c.offer = { url, tier, retailer: RETAILERS.find(r => within(host(url), r.domain))?.name ?? host(url), color: c.check.color ?? null,
          price_snapshot: { amount: c.check.price_snapshot.amount, currency: c.check.price_snapshot.currency, source_url: url, checked_at: c.check.price_snapshot.checked_at ?? c.check.checked_at ?? new Date().toISOString() } };
      });
    }
    return checked;
  };
  let checked = await examine(pages.trusted, 'trusted');
  // Other stores only when no trusted store has it for less (a store already cheaper elsewhere on the card included).
  if (!cheaper(checked.filter(c => c.offer).map(c => c.offer)).length && pages.other.length) checked = [...checked, ...await examine(pages.other, 'unreviewed')];
  const offers = checked.filter(c => c.offer).map(c => c.offer);
  try { await store.saveStoreScan(key, { offers }); } catch { /* Next save scans again. */ }
  return { outcome: 'completed', source: 'search', searches: 1, candidates: pages.trusted.length + pages.other.length, offers: cheaper(offers), checked: checked.map(({ offer, check, ...c }) => c) };
}

const serp = (env, fetcher) => params => serpApiJSON('https://serpapi.com/search.json?' + new URLSearchParams({ ...params, api_key: env.SERPAPI_API_KEY, gl: (env.SHOPPING_COUNTRY ?? 'US').toLowerCase(), hl: 'en' }), { redirect: 'error', signal: AbortSignal.timeout(15000) }, env, fetcher);
// A store page read with no paid index fallback: the page itself is the evidence.
const readPage = fetcher => (url, name, env) => verifyListing(url, name, fetcher, undefined, env, { indexed: false });

// The items one save created, scanned in turn. Found stores join the item's links with sizes unconfirmed.
export async function scanSavedItems({ store, operation, env, fetcher = fetch, search = serp(env, fetcher), verify = readPage(fetcher), same = (listings, options) => sameProductGroups(listings, { ...options, fetcher }) }) {
  if (!env.SERPAPI_API_KEY || env.SERPAPI_API_KEY.startsWith('replace-with')) return [];
  const items = (await store.savedWishlistItems(operation)).slice(0, MAX_ITEMS), results = [];
  for (const item of items) {
    const started = Date.now();
    let result;
    try { result = await scanItem(item.product, { env, search, verify, same, store }); }
    catch { result = { outcome: 'failed', searches: 0 }; }
    let added = 0;
    if (result.offers?.length) {
      const discovered_at = new Date().toISOString();
      const links = result.offers.map(o => ({ url: o.url, retailer: o.retailer, price_snapshot: o.price_snapshot, availability: null, verification_status: 'verified', discovered: { at: discovered_at, via: 'store_scan', sizes: 'unconfirmed' }, ...(o.tier === 'unreviewed' ? { store_tier: 'unreviewed' } : {}) }));
      try { added = await store.addWishlistLinks(item.conversation_id, item.id, links); }
      catch { result = { ...result, outcome: 'save_failed' }; }
    }
    const { offers, ...logged } = result;
    console.log(JSON.stringify({ event: 'store_scan', operation, item_id: item.id, ...logged, found: offers?.length ?? 0, added, elapsed_ms: Date.now() - started }));
    results.push({ item_id: item.id, ...result, added });
  }
  return results;
}
