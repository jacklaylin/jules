import { RETAILERS, isSuppressedStore, isLookalikeStore } from './retailers.js';
import { publicURL } from './public-url.js';

// Google Shopping rows stopped carrying the store's link (seen October 20, 2026): a row names its seller
// (`source`) and carries a token for Google's own product page, and reading that page costs one search.
// So only rows from trusted registry stores are resolved, at most `limit` and one per store; other rows
// without a link are left out. Google's listed price stays an index observation, never a verified price.

const norm = value => String(value ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const host = url => { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
const onDomain = (url, domain) => { const h = host(url); return Boolean(h) && (h === domain || h.endsWith('.' + domain)); };

// The registry store a Shopping seller name refers to ("Neiman Marcus", "farfetch.com").
export function registryStore(source) {
  const s = norm(source);
  if (!s) return null;
  return RETAILERS.find(r => [r.name, r.domain, r.domain.split('.')[0]].some(v => norm(v) === s)) ?? null;
}

// Returns the rows that have a store link, each with `link` set, in the original order. A row that still
// carries its own link costs nothing. `rank` orders which unlinked rows are worth a lookup (higher first).
// search(params) runs one SerpAPI request.
export async function shoppingStoreRows(rows, search, { limit = 2, rank = () => 0 } = {}) {
  const list = (Array.isArray(rows) ? rows : []).filter(r => r && typeof r === 'object');
  const stats = { rows: list.length, linked: 0, unlinked: 0, trusted: 0, resolved: 0, failed: 0, untrusted_link: 0 };
  const stores = new Set(), wanted = [];
  list.forEach((r, i) => {
    if (typeof r.link === 'string' && r.link) { stats.linked++; return; }
    stats.unlinked++;
    const store = registryStore(r.source);
    if (!store || typeof r.immersive_product_page_token !== 'string') return;
    stats.trusted++;
    wanted.push({ i, r, store, score: rank(r) });
  });
  const chosen = wanted.sort((a, b) => b.score - a.score || a.i - b.i).filter(w => !stores.has(w.store.domain) && stores.add(w.store.domain)).slice(0, limit);
  const links = new Map();
  await Promise.all(chosen.map(async ({ i, r, store }) => {
    let data;
    try { data = await search({ engine: 'google_immersive_product', page_token: r.immersive_product_page_token }); } catch { stats.failed++; return; }
    const offers = Array.isArray(data?.product_results?.stores) ? data.product_results.stores : [];
    // The seller Google named, on its own domain: the link's host decides trust, not the name shown.
    const offer = offers.find(s => registryStore(s?.name)?.domain === store.domain && onDomain(s.link, store.domain));
    const url = publicURL(offer?.link);
    if (!url || isSuppressedStore(url) || isLookalikeStore(url)) { stats.untrusted_link++; return; }
    stats.resolved++;
    // The store's own listed price on Google's page replaces the row's (which may be another seller's).
    links.set(i, { link: url, ...(offer.extracted_price != null || offer.price != null ? { extracted_price: offer.extracted_price, price: offer.price } : {}) });
  }));
  return { rows: list.flatMap((r, i) => typeof r.link === 'string' && r.link ? [r] : links.has(i) ? [{ ...r, ...links.get(i) }] : []), stats };
}
