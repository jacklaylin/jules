// What a reply's search_result may hold. The column is capped at 30,000 bytes of jsonb text
// (db/005_search.sql); a record over it is refused and the search that produced it was reported
// as failed (October 20: the closet summary inside every stored request pushed follow-up
// searches over, and the shopper got "i had a glitch"). So every write is bounded here:
// - always: product copies keep what later turns read (identity, price, sizes, colours, a short
//   description) and drop bulk only the live page check uses (variant ids, image lists);
//   the stored request keeps request-scoped constraints only, because taste and saved sizes are
//   read fresh from the profile each turn;
// - when still over: sourcing diagnostics shrink to a summary, then descriptions and colour
//   images go. Pending options and their links are never dropped.
export const SEARCH_RESULT_LIMIT = 30000;
// Headroom under the database limit for rounding in the byte estimate.
export const SEARCH_RESULT_BUDGET = 27000;
// Profile-derived constraints: rebuilt from facts every turn, never stored with a request.
export const PROFILE_CONSTRAINTS = ['taste', 'size_facts'];

// Bytes of the value as Postgres prints jsonb (", " and ": " separators), in UTF-8.
export function jsonbBytes(value) {
  if (value === null || value === undefined) return 4;
  if (Array.isArray(value)) return value.length ? 2 + value.reduce((n, v) => n + jsonbBytes(v === undefined ? null : v), 0) + 2 * (value.length - 1) : 2;
  if (typeof value === 'object') {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    return entries.length ? 2 + entries.reduce((n, [k, v]) => n + Buffer.byteLength(JSON.stringify(k)) + 2 + jsonbBytes(v), 0) + 2 * (entries.length - 1) : 2;
  }
  return Buffer.byteLength(JSON.stringify(value));
}

const cut = (text, n) => typeof text === 'string' && text.length > n ? text.slice(0, n) : text;
const colours = (list, { images = true } = {}) => Array.isArray(list)
  ? list.slice(0, 12).map(({ variant_ids, image, ...c }) => images ? { ...c, image: image ?? null } : c) : list;
function check(c, level) {
  if (!c || typeof c !== 'object') return c;
  // Store tags only feed the department check made before the reply; later turns don't read them.
  const { product_images, description, color_options, product_tags, ...rest } = c;
  return { ...rest,
    ...(product_images ? { product_images: product_images.slice(0, level ? 1 : 2) } : {}),
    ...(description !== undefined && level < 2 ? { description: cut(description, level ? 150 : 300) } : {}),
    ...(color_options ? { color_options: colours(color_options, { images: level < 2 }) } : {}) };
}
// One product as later turns need it. level 0 always; 1 and 2 only when the record is still over.
export function compactProduct(p, level = 0) {
  if (!p || typeof p !== 'object') return p;
  const { listing_check, listing_checks, ...rest } = p;
  return { ...rest,
    ...(listing_check !== undefined ? { listing_check: check(listing_check, level) } : {}),
    // The attempts' outcomes only: whether every page check failed is all a later turn reads.
    ...(Array.isArray(listing_checks) ? { listing_checks: listing_checks.slice(0, 4).map(c => ({ url: c?.url ?? null, status: c?.status ?? null })) } : {}) };
}
export function requestConstraints(constraints) {
  if (!constraints || typeof constraints !== 'object') return constraints;
  return Object.fromEntries(Object.entries(constraints).filter(([k]) => !PROFILE_CONSTRAINTS.includes(k)));
}
const products = (list, level) => Array.isArray(list) ? list.map(p => compactProduct(p, level)) : list;
function state(s, level) {
  if (!s || typeof s !== 'object') return s;
  return { ...s,
    ...(s.options ? { options: products(s.options, level) } : {}),
    ...(s.kept_options ? { kept_options: products(s.kept_options, level) } : {}),
    ...(s.selected_set ? { selected_set: products(s.selected_set, level) } : {}),
    ...(s.constraints ? { constraints: requestConstraints(s.constraints) } : {}) };
}
// Sourcing diagnostics as a summary: what was shown and why, without every candidate's page checks.
function diagnosticsSummary(d) {
  if (!d || typeof d !== 'object') return d;
  const { status, stage, shown, source_provider, timing, mode, stylist_concepts, price_band, unverified_shown, supplied_links } = d;
  return { status, stage, shown, source_provider, timing, mode, stylist_concepts, price_band, unverified_shown, supplied_links,
    candidates: Array.isArray(d.candidates) ? d.candidates.length : d.candidates, trimmed: true };
}
function shaped(result, level) {
  const next = { ...result,
    ...(result.products ? { products: products(result.products, level) } : {}),
    ...(result.text_wishlist_state ? { text_wishlist_state: state(result.text_wishlist_state, level) } : {}) };
  if (level >= 1 && next.text_wishlist_diagnostics) next.text_wishlist_diagnostics = diagnosticsSummary(next.text_wishlist_diagnostics);
  return next;
}
// The record to write, and which trims it needed beyond the standard ones (for diagnostics).
export function boundedSearchResult(result, { budget = SEARCH_RESULT_BUDGET } = {}) {
  if (!result || typeof result !== 'object') return result;
  for (let level = 0; level <= 2; level++) {
    const next = shaped(result, level);
    if (jsonbBytes(next) <= budget || level === 2) return level ? { ...next, storage_trimmed: level } : next;
  }
}
