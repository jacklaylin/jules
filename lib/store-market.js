// Which country a retailer page actually serves, read from what the page and URL declare.
// Technical parsing of retailer markup and URLs; it never interprets the user's message.
const COUNTRIES = new Set(['US','CA','GB','UK','IE','AU','NZ','FR','DE','IT','ES','NL','BE','CH','AT','SE','DK','NO','FI','PT','PL','JP','KR','CN','HK','SG','TW','MX','BR','AE','SA','IN','IL','ZA']);
// Any ISO country a page declares counts (October 20: Dries Van Noten's Kiribati storefront, "KI", wasn't
// on the list, so its US version was never looked up). A bare URL segment still needs the common list.
const REGIONS = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
const isCountry = c => /^[A-Z]{2}$/.test(c) && c !== 'ZZ' && Boolean(REGIONS.of(c));
const norm = code => { const c = String(code ?? '').toUpperCase(); return c === 'UK' ? 'GB' : COUNTRIES.has(c) || isCountry(c) ? c : null; };
const attr = (tag, name) => tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1] ?? null;

// Country from locale-style URL segments: /us/en-us/, /en-ca/, /ca/, /it-it/. A lone two-letter
// segment counts only when it is a known country code and not a bare language like /en/.
export function urlMarket(url) {
  const segments = new URL(url).pathname.split('/').filter(Boolean).slice(0, 3).map(s => s.toLowerCase());
  for (const s of segments) { const m = s.match(/^[a-z]{2}[-_]([a-z]{2})$/); if (m && norm(m[1])) return norm(m[1]); }
  const first = segments[0];
  return first && /^[a-z]{2}$/.test(first) && first !== 'en' && COUNTRIES.has(first.toUpperCase()) ? norm(first) : null;
}
export function pageMarket(html, url, offers = []) {
  const currency = [...new Set(offers.map(o => o?.priceCurrency ?? [].concat(o?.priceSpecification ?? [])[0]?.priceCurrency).filter(c => /^[A-Z]{3}$/.test(c ?? '')))];
  const shopify = norm(html.match(/Shopify\.country\s*=\s*["']([A-Za-z]{2})["']/)?.[1]);
  const fromUrl = urlMarket(url);
  const og = norm(html.match(/<meta[^>]+property=["']og:locale["'][^>]+content=["'][a-z]{2}[_-]([A-Za-z]{2})["']/i)?.[1] ?? html.match(/<meta[^>]+content=["'][a-z]{2}[_-]([A-Za-z]{2})["'][^>]+property=["']og:locale["']/i)?.[1]);
  const lang = norm(html.match(/<html[^>]+lang=["'][a-z]{2}-([A-Za-z]{2})["']/i)?.[1]);
  const [country, basis] = shopify ? [shopify, 'shopify'] : fromUrl ? [fromUrl, 'url'] : og ? [og, 'og_locale'] : lang ? [lang, 'html_lang'] : [null, null];
  return { country, currency: currency.length === 1 ? currency[0] : null, basis };
}
// Other-country versions of the same page, as declared by the page (hreflang alternates).
export function marketAlternates(html, url) {
  const alternates = [];
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    if (!/\brel\s*=\s*["']alternate["']/i.test(tag)) continue;
    const hreflang = attr(tag, 'hreflang'), href = attr(tag, 'href');
    const country = norm(hreflang?.match(/^[a-z]{2,3}[-_]([a-z]{2})$/i)?.[1]);
    if (!country || !href) continue;
    try { alternates.push({ hreflang: hreflang.toLowerCase(), country, url: new URL(href.replace(/&amp;/g, '&'), url).href }); } catch { /* malformed */ }
  }
  return alternates;
}
// Prefer the English version for the shopper's country, then any language for that country.
export function alternateFor(alternates, country) {
  const matches = alternates.filter(a => a.country === norm(country));
  return matches.find(a => a.hreflang.startsWith('en')) ?? matches[0] ?? null;
}
// Shipping evidence from structured product data only: true/false when the page lists shipping
// destinations, null when it says nothing. Never inferred from the store's country.
export function shipsTo(offers, country) {
  const destinations = offers.flatMap(o => [].concat(o?.shippingDetails ?? []))
    .flatMap(d => [].concat(d?.shippingDestination ?? []))
    .flatMap(d => [].concat(d?.addressCountry ?? []).map(c => norm(typeof c === 'string' ? c : c?.name)));
  if (!destinations.length) return null;
  return destinations.includes(norm(country));
}
// Ranking: the shopper's own market first; then foreign stores with shipping evidence or an
// unknown market; foreign stores with unconfirmed or no shipping last. Nothing is dropped here.
export function marketRank(check) {
  if (!check || check.market_match !== false) return check?.market_match === true ? 0 : 1;
  return check.ships_to_shopper === true ? 1 : check.ships_to_shopper === false ? 3 : 2;
}
const regionName = code => { try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(code); } catch { return code; } };
const money = p => new Intl.NumberFormat('en-US', { style: 'currency', currency: p.currency }).format(p.amount);
// Truthful label for a listing from another country's store.
export function marketLabel(check, shopperCountry = 'US') {
  if (check?.market_match !== false || !check.store_market?.country) return '';
  const ships = check.ships_to_shopper === true ? `ships to ${shopperCountry === 'US' ? 'the US' : regionName(shopperCountry)}` : check.ships_to_shopper === false ? `doesn’t list shipping to ${shopperCountry === 'US' ? 'the US' : regionName(shopperCountry)}` : `${shopperCountry === 'US' ? 'US' : regionName(shopperCountry)} shipping unconfirmed`;
  const duties = check.shipping_evidence?.duties === 'included' ? ', duties included' : check.shipping_evidence?.duties === 'on_delivery' ? ', duties paid on delivery' : '';
  return ` · ${regionName(check.store_market.country)} store${check.foreign_price ? ', ' + money(check.foreign_price) : ''}, ${ships}${check.ships_to_shopper === true ? duties : ''}`;
}
