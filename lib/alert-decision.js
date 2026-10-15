import { createHash } from 'node:crypto';
import { baselineOffers, priceDrop, lowestAvailable, sizeKey, shippingTo } from './price-alerts.js';

// One pure decision per scheduled check: what changed for the watched size, whether it
// deserves a message, and which reference prices to keep. No fetching, storage or sending.

export const FAILURES_BEFORE_RECOVERY = 3;
const host = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };
// Whole amounts read naturally in a text: $800, not $800.00.
const money = (amount, currency) => new Intl.NumberFormat('en-US', { style: 'currency', currency, ...(Number.isInteger(amount) ? { minimumFractionDigits: 0, maximumFractionDigits: 0 } : {}) }).format(amount);
// A saved "Name · Ivory" reads as "Name in Ivory".
const itemName = name => String(name).replace(/\s+·\s+([^·]+)$/, ' in $1');
// Rounded down so a discount is never overstated; under 1% is not worth a number.
const percentOff = (was, now) => { const p = Math.floor((1 - now / was) * 100); return p >= 1 ? `, ${p}% off` : ''; };
const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);

export const alertSizes = alert => [...new Set(alert.links.flatMap(l => l.requested_sizes ?? [alert.size]))];

// Stock for the watched size across stores we could read. An unreadable store is unknown, never sold out.
export function sizeStock(checks, sizes, urls) {
  const keys = new Set(sizes.map(sizeKey));
  const rows = (checks ?? []).flatMap(c => c.offers ?? []).filter(o => urls.includes(o.url) && keys.has(o.key));
  if (rows.some(o => o.available === true)) return 'in_stock';
  return rows.length ? 'sold_out' : 'unknown';
}

// The stock state the previous check established. Before any recorded check, a reference price
// that was saved while the size was sold out everywhere counts as sold out.
export function previousStock(alert, sizes, urls) {
  const last = alert.last_result;
  if (last?.stock) return last.stock;
  if (last?.checks) return sizeStock(last.checks, sizes, urls);
  return alert.baselines?.length && alert.baselines.every(b => b.available === false) ? 'sold_out' : 'unknown';
}

// What the user would pay before tax. Another store's lower item price only counts when that
// store lists its shipping to the user's country; the same store keeps its own shipping terms.
function comparable(baseline, offer, country) {
  const shipping = shippingTo(offer, country);
  if (shipping.status === 'does_not_ship') return null;
  if (host(offer.url) === host(baseline.url)) return { shipping, total: offer.amount + (shipping.amount ?? 0), cost: offer.amount };
  if (shipping.status !== 'listed') return { shipping, unconfirmed: true };
  return { shipping, total: offer.amount + shipping.amount, cost: offer.amount + shipping.amount };
}

function fees(shipping) {
  if (shipping?.status === 'listed') return shipping.amount === 0 ? 'Free shipping per the store; taxes and other fees not included.' : `Plus ${money(shipping.amount, shipping.currency)} shipping per the store; taxes and other fees not included.`;
  return 'Shipping and other fees not included.';
}

export function decidePriceCheck(alert, checks, { country = 'US' } = {}) {
  const sizes = alertSizes(alert), urls = alert.links.map(l => l.url);
  const found = new Set(alert.links.filter(l => l.discovered_at).map(l => l.url));
  // Name the store only when it is news: a store found while watching, or a different store than the reference price.
  const where = (offer, baseline) => found.has(offer.url) ? ` at ${host(offer.url)}, a store I found for you` : baseline && host(offer.url) !== host(baseline.url) ? ` at ${host(offer.url)}` : '';
  const offers = [...new Map(sizes.flatMap(size => baselineOffers(checks, size)).map(o => [o.url + o.key + o.currency, o])).values()]
    .filter(o => urls.includes(o.url) && o.available === true && shippingTo(o, country).status !== 'does_not_ship');
  const readable = checks.some(c => c.offers?.length);
  const stock = readable ? sizeStock(checks, sizes, urls) : 'unknown';
  const before = previousStock(alert, sizes, urls);
  const failures = readable ? 0 : (alert.last_result?.failures ?? 0) + 1;
  const record = { stock: readable ? stock : before, failures };
  if (!readable) return { status: 'check_failed', event: null, record, needs_recovery: failures >= FAILURES_BEFORE_RECOVERY };

  const baselines = alert.baselines ?? [];
  const establish = baselines.length ? null : lowestAvailable(offers).map(o => ({ ...o, drop_percent: 0 }));

  // The cheapest qualifying drop against any reference price in the same size and currency.
  let drop = null; const unconfirmed = [];
  for (const offer of offers) for (const baseline of baselines) {
    if (baseline.key !== offer.key || baseline.currency !== offer.currency) continue;
    const cost = comparable(baseline, offer, country);
    if (!cost) continue;
    if (cost.unconfirmed) { if (priceDrop(baseline, offer)) unconfirmed.push({ url: offer.url, size: offer.size, amount: offer.amount, currency: offer.currency }); continue; }
    if (priceDrop(baseline, { ...offer, amount: cost.cost }) && (!drop || cost.total < drop.total)) drop = { offer, baseline, ...cost };
  }
  if (unconfirmed.length) record.unconfirmed_savings = unconfirmed;
  const restocked = before === 'sold_out' && stock === 'in_stock' && offers.length > 0;

  if (drop) {
    const { offer, baseline, shipping } = drop;
    const lead = `🚨 Price drop on your saved ${itemName(alert.name)}${restocked ? ', and it’s back in stock' : ''}. Your size is available now${where(offer, baseline)} for ${money(offer.amount, offer.currency)} (was ${money(baseline.amount, baseline.currency)}${percentOff(baseline.amount, offer.amount)}). ${fees(shipping)}`;
    return {
      status: 'price_drop', record, establish,
      event: {
        kind: 'price_drop', offer, baseline, shipping,
        body: [lead, offer.variant_url ?? offer.url].join('\n'),
        fingerprint: fingerprint([baseline.key, baseline.currency, baseline.amount]),
      },
      // The new reference price applies only after the message is sent.
      after_send: baselines.map(b => b.currency === offer.currency ? { ...offer, ...(b.drop_percent === 0 ? { drop_percent: 0 } : {}) } : b),
    };
  }
  if (restocked) {
    const preferred = offers.filter(o => !baselines.length || baselines.some(b => b.currency === o.currency));
    const offer = (preferred.length ? preferred : offers).sort((a, b) => a.amount - b.amount)[0], shipping = shippingTo(offer, country);
    return {
      status: 'restock', record, establish,
      event: {
        kind: 'restock', offer, shipping,
        body: [`🚨 Back in stock: your saved ${itemName(alert.name)}. Your size is available now${where(offer, baselines.find(b => b.currency === offer.currency))} for ${money(offer.amount, offer.currency)}. ${fees(shipping)}`, offer.variant_url ?? offer.url].join('\n'),
        fingerprint: fingerprint(['restock', offer.key, offer.url, alert.last_checked_at ?? null]),
      },
    };
  }
  if (!baselines.length) return { status: establish.length ? 'baseline_established' : 'awaiting_availability', event: null, record, establish: establish.length ? establish : null };
  return { status: 'no_drop', event: null, record };
}
