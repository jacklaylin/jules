import { publicURL } from './public-url.js';
import { sameProductURL } from './indexed-product.js';
import { sameProductGroups, sameBrand, brandOf } from './same-product.js';

// A dupe request ("find a dupe for a better price") uses an item the user linked as its reference
// point. The reference stays on the search plan with the price read from its own page, and the
// search then looks at other products like it. The original itself is shown again only as the same
// item at another store whose own page shows a lower price in the same currency (founder rule,
// October 21: "don't follow up with the exact item unless you found it for less money"). Prices are
// never converted, and a search-index price is never the reference.

const ISO = /^[A-Z]{3}$/;
const host = url => { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };

// The price a store's own page shows for this listing: one price, read from the page, not a search
// index's observation. A size/colour range is not one price to compare against.
export function pagePrice(p) {
  const check = p?.listing_check;
  const s = p?.price_snapshot ?? check?.price_snapshot;
  if (check?.status !== 'verified' || check.verification_basis === 'search_index' || check.retrieval === 'search_index') return null;
  if (!s || s.evidence_level === 'indexed' || !(Number.isFinite(s.amount) && s.amount > 0) || !ISO.test(s.currency ?? '')) return null;
  return { amount: s.amount, currency: s.currency };
}

// The linked item a dupe search compares against, as kept on the plan.
export function referenceFromLink(option) {
  const url = publicURL(option?.url);
  if (!url) return null;
  const check = option.listing_check;
  const verified = check?.status === 'verified';
  return { url, name: (verified ? check.product_name : null) ?? option.name ?? null, brand: (verified ? check.product_brand : null) ?? option.brand ?? null,
    color: verified ? check.color ?? null : null, price: pagePrice(option), page: verified ? 'verified' : 'unread',
    product_sku: verified ? check.product_sku ?? null : null, description: verified && typeof check.description === 'string' ? check.description.slice(0, 400) : null,
    product_images: verified ? (check.product_images ?? []).slice(0, 2) : [] };
}

// The reference for this search: the link the user sent with a dupe request, else the one kept on
// the plan while the same request continues. Anything else has no reference.
export function dupeReference({ alternatives, continuation, supplied = [], previous = null }) {
  const linked = alternatives ? supplied.map(referenceFromLink).find(Boolean) : null;
  if (linked) return linked;
  return continuation && previous?.url ? previous : null;
}

const asListing = reference => ({ url: reference.url, brand: reference.brand ?? '', name: reference.name ?? '', sourcing_status: 'store_found',
  listing_check: { status: 'verified', product_name: reference.name, product_brand: reference.brand, color: reference.color, product_sku: reference.product_sku,
    description: reference.description, product_images: reference.product_images ?? [] } });

// Applies the reference rules to one search's results:
// - the reference's own page is never an option;
// - a listing that is certainly the same item (lib/same-product.js) is kept only at another store
//   whose page price is lower in the same currency, and is marked with that saving;
// - unless the user shops within the reference's brand, any other listing from that brand could be
//   the same item under another name, so it follows the same price rule (certain or not, it is only
//   shown when it costs less than the original);
// - with no readable reference price, nothing that could be the same item is shown.
// One small model call, only when results share the reference's brand. Never throws.
export async function applyReference(value, reference, { requiredBrands = [], fallbackBrand = null, env = {}, same = sameProductGroups } = {}) {
  if (!reference?.url) return { value, record: null };
  const record = { url: reference.url, price: reference.price, page: reference.page, withheld: [], cheaper: [] };
  const products = value.products ?? [];
  // An unread page names no brand; the plan's brand for it (the model's reading of the request) stands in.
  const brand = reference.brand || fallbackBrand;
  const within = Boolean(brand) && requiredBrands.some(b => sameBrand(b, brand));
  const fromBrand = p => Boolean(brand) && sameBrand(brandOf(p), brand);
  const own = p => sameProductURL(p.url, reference.url) || publicURL(p.url) === reference.url;
  const verifiedFromBrand = products.filter(p => !own(p) && fromBrand(p) && p.sourcing_status === 'store_found' && p.listing_check?.status === 'verified');
  let certain = new Set();
  if (verifiedFromBrand.length) {
    const groups = await same([asListing(reference), ...verifiedFromBrand], { env }).catch(() => []);
    certain = new Set(groups.filter(g => g.includes(0)).flat().filter(i => i > 0).map(i => verifiedFromBrand[i - 1].url));
  }
  record.same_brand_checked = verifiedFromBrand.length; record.certain_copies = certain.size;
  const kept = [];
  for (const p of products) {
    if (own(p)) { record.withheld.push({ url: p.url, reason: 'reference_page' }); continue; }
    const copy = certain.has(p.url), possible = !copy && !within && fromBrand(p);
    if (!copy && !possible) { kept.push(p); continue; }
    if (copy && host(p.url) === host(reference.url)) { record.withheld.push({ url: p.url, reason: 'same_store' }); continue; }
    const price = pagePrice(p);
    const reason = !reference.price ? 'reference_price_unread' : !price ? 'price_unread' : price.currency !== reference.price.currency ? 'other_currency' : price.amount >= reference.price.amount ? 'not_lower' : null;
    if (reason) { record.withheld.push({ url: p.url, reason, certain: copy }); continue; }
    record.cheaper.push({ url: p.url, certain: copy, amount: price.amount, currency: price.currency });
    kept.push(copy ? { ...p, reference_saving: { amount: Math.round((reference.price.amount - price.amount) * 100) / 100, currency: price.currency, reference_price: reference.price.amount } } : p);
  }
  return { value: { ...value, products: kept }, record };
}
