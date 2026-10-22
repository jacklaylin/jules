import { sizeKey } from './price-alerts.js';

// Store-stated counts for single sizes, from stores that publish them in their own size picker rather than in
// structured data (low-stock alerts, PRD Section 28, step 3). Read as data from the page Jules already
// fetched; the caller has already matched the page to the watched product and color.
//   Slam Jam          <input data-quantity='2' name="10.5" value="<variant id>">   the store's count per size
//   Dries Van Noten   <div class="select-option-size" data-size="36" data-qty="1">   the store's count per size
// Not read (October 22 survey): END. labels sizes "Few Items Left", which states no number; Haven ("30 - LAST
// ONE") and Proenza Schouler ("Only 1 left") publish no structured product data, so their page can't be
// confirmed as the watched item and their price checks are unreadable too.
// A size with no stated count is unknown, never "plenty"; anything ambiguous is left out.

const attrs = text => Object.fromEntries([...text.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(m => [m[1].toLowerCase(), m[2] ?? m[3]]));
const host = url => { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
const count = value => /^\d{1,4}$/.test(String(value ?? '').trim()) ? Number(value) : null;

// Each store's size picker as rows: { size, quantity, id? }. Rows from a picker that isn't clearly the
// page's one product (two different product forms, two color pickers) are dropped.
const READERS = {
  'slamjam.com'(html) {
    const rows = [], forms = new Set();
    for (const m of html.matchAll(/<input\b[^>]*\bdata-quantity\s*=\s*['"][^'"]*['"][^>]*>/gi)) {
      const a = attrs(m[0]), quantity = count(a['data-quantity']);
      if (quantity === null || !a.name || !/^\d{6,}$/.test(a.value ?? '')) continue;
      forms.add(a.form ?? ''); rows.push({ size: a.name.trim(), quantity, id: a.value });
    }
    return forms.size === 1 ? rows : [];
  },
  'driesvannoten.com'(html) {
    if ((html.match(/\bselect-list-size\b/g) ?? []).length !== 1 || (html.match(/\bselect-option-color\b/g) ?? []).length > 1) return [];
    return [...html.matchAll(/<div\b[^>]*\bselect-option-size\b[^>]*>/gi)].flatMap(m => {
      const a = attrs(m[0]), quantity = count(a['data-qty']);
      return quantity === null || !a['data-size'] ? [] : [{ size: a['data-size'].trim(), quantity }];
    });
  },
};
const SOURCES = { 'slamjam.com': 'slamjam_size_quantity', 'driesvannoten.com': 'dries_size_quantity' };
const readerFor = url => Object.keys(READERS).find(d => host(url) === d || host(url).endsWith('.' + d));

// Counts for the watched sizes. variantOptions maps a Shopify variant id to its options (lib/price-alerts.js),
// so a watched color can be checked when the picker lists several colors' variants; two different variants
// for one size with no way to tell which is the watched color are ambiguous and left out.
export function storeLabelCounts(html, url, { sizes = [], color = null, variantOptions = new Map(), checked_at = new Date().toISOString() } = {}) {
  const domain = readerFor(url);
  if (!domain || !sizes.length) return [];
  let rows;
  try { rows = READERS[domain](html); } catch { return []; }
  const normalize = value => String(value ?? '').trim().toLowerCase();
  const out = [];
  for (const size of sizes) {
    const key = sizeKey(size);
    let matches = rows.filter(r => sizeKey(r.size) === key);
    if (color) matches = matches.filter(r => !r.id || !variantOptions.has(r.id) || variantOptions.get(r.id).some(o => normalize(o) === normalize(color)));
    const ids = new Set(matches.map(r => r.id ?? 'page')), quantities = new Set(matches.map(r => r.quantity));
    if (!matches.length || ids.size !== 1 || quantities.size !== 1) continue;
    const [{ quantity, id }] = matches;
    out.push({ size, key, url, checked_at, quantity, available: quantity > 0, quantity_source: SOURCES[domain], ...(id ? { retailer_variant_id: id } : {}) });
  }
  return out;
}
