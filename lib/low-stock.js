import { randomUUID } from 'node:crypto';
import { sizeKey } from './price-alerts.js';
import { retailerFor } from './retailers.js';

// "Only one left in your size": a low-stock reading for a watched item, decided once per check.
// Pure: no fetching, storage or sending. Founder decisions, October 21, 2026 (PRD Section 28):
// - Low means the store's own page or data states 1–3 left for the watched size (and color).
//   Other sizes selling out, an unreadable size or store, and indexed data never count.
// - One text per low-stock episode. The episode stays open while the size reads low or can't be
//   confirmed, and ends only when a check verifies more than 3 left or the size sold out.
// - It counts as a price alert under the shared rules for unprompted texts (lib/nudges.js): the person
//   asked for the alert, so the nudge cap and quiet hours don't hold it. A person can turn off only these
//   texts (price_alerts.low_stock_alerts); the episode is still tracked so turning them back on mid-episode
//   doesn't send.

export const LOW_STOCK_MAX = 3;
const host = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };
// The store's own name from the registry ("SSENSE"), else its domain.
export const storeName = url => { try { return retailerFor(url).name; } catch { return host(url); } };
const itemName = name => String(name).replace(/\s+·\s+([^·]+)$/, ' in $1');

// One stated count per store and watched size. Copies that disagree are not evidence.
export function stockCounts(checks, sizes, urls) {
  const keys = new Set(sizes.map(sizeKey)), seen = new Map(), conflicts = new Set();
  for (const check of checks ?? []) {
    const rows = [...(check.offers ?? []).filter(o => Number.isInteger(o.quantity)), ...(check.counts ?? [])];
    for (const row of rows) {
      if (!urls.includes(row.url) || !keys.has(row.key) || !Number.isInteger(row.quantity) || row.quantity < 0) continue;
      // A count on a size the store won't sell is not a count of what's left to buy.
      if (row.quantity > 0 && row.available !== true) continue;
      const id = row.url + '\u0000' + row.key, prior = seen.get(id);
      if (prior && prior.quantity !== row.quantity) conflicts.add(id);
      if (!prior) seen.set(id, { url: row.url, size: row.size, key: row.key, quantity: row.quantity, source: row.quantity_source ?? 'store_page', checked_at: row.checked_at ?? null });
    }
  }
  return [...seen.entries()].filter(([id]) => !conflicts.has(id)).map(([, row]) => row);
}

// The episode a previous check opened, if any. One opened while texts were off (step 1's read-only
// release) never produced a text, so it doesn't hold back the first real one.
export const openEpisode = alert => { const episode = alert.last_result?.low_stock?.episode; return episode && !episode.dry_run ? episode : null; };

export function decideLowStock(alert, checks, { sizes, urls, readable, now = new Date().toISOString() }) {
  const previous = openEpisode(alert);
  if (!readable) return { state: 'unknown', reason: 'check_failed', evidence: [], episode: previous, would_send: false };
  const evidence = stockCounts(checks, sizes, urls);
  const low = evidence.filter(c => c.quantity >= 1 && c.quantity <= LOW_STOCK_MAX).sort((a, b) => a.quantity - b.quantity || urls.indexOf(a.url) - urls.indexOf(b.url));
  if (low.length) {
    const [lowest] = low;
    if (previous) return { state: 'low', reason: 'episode_already_open', evidence, lowest, episode: { ...previous, last_quantity: lowest.quantity, last_seen_at: now }, would_send: false };
    return { state: 'low', reason: 'verified_low_stock', evidence, lowest, would_send: true,
      episode: { id: randomUUID(), started_at: now, url: lowest.url, size: lowest.size, key: lowest.key, quantity: lowest.quantity, last_quantity: lowest.quantity, last_seen_at: now } };
  }
  if (previous) {
    // Only the store that was low can close the episode, and only with a verified reading.
    const same = evidence.find(c => c.url === previous.url && c.key === previous.key);
    const soldOut = !same && checks.some(c => (c.offers ?? []).some(o => o.url === previous.url && o.key === previous.key && o.available === false))
      && !checks.some(c => (c.offers ?? []).some(o => o.url === previous.url && o.key === previous.key && o.available === true));
    if (same?.quantity > LOW_STOCK_MAX) return { state: 'not_low', reason: 'episode_ended_restocked', evidence, episode: null, would_send: false };
    if (same?.quantity === 0 || soldOut) return { state: 'sold_out', reason: 'episode_ended_sold_out', evidence, episode: null, would_send: false };
    return { state: 'unknown', reason: 'episode_open_low_store_unconfirmed', evidence, episode: previous, would_send: false };
  }
  if (!evidence.length) return { state: 'unknown', reason: 'no_stated_quantity', evidence, episode: null, would_send: false };
  if (evidence.every(c => c.quantity === 0)) return { state: 'sold_out', reason: 'stated_sold_out', evidence, episode: null, would_send: false };
  return { state: 'not_low', reason: 'above_threshold', evidence, episode: null, would_send: false };
}

const oneSize = size => sizeKey(size) === sizeKey('One size');
// The text a verified reading sends on its own.
export function lowStockMessage(alert, lowest) {
  const size = oneSize(lowest.size) ? '' : `, size ${lowest.size}`;
  return [`heads up: ${storeName(lowest.url)} shows only ${lowest.quantity} left of your saved ${itemName(alert.name)}${size}.`, lowest.variant_url ?? lowest.url].join('\n');
}
// Added to a price-drop or restock text from the same check, so the person gets one text, not two.
export function withLowStock(body, lowest) {
  const [lead, ...rest] = String(body).split('\n');
  return [`${lead} ${storeName(lowest.url)} shows only ${lowest.quantity} left${oneSize(lowest.size) ? '' : ` in ${lowest.size}`}.`, ...rest].join('\n');
}
const DELIVERED = ['sent', 'uncertain', 'sending'];

// What a check records and logs. Store names and counts only; no user text.
// turned_off: the person turned off low-stock texts on this alert. delivery: the status of the text that
// carried it (its own, or the price-drop/restock text it joined); none when it wasn't sent.
export function lowStockRecord(decision, { event = null, delivery = null, turned_off = false, now = new Date().toISOString() } = {}) {
  let { reason, episode } = decision, sent = null;
  if (decision.would_send) {
    if (turned_off) { reason = 'turned_off'; episode = { ...episode, skipped: 'turned_off' }; }
    else if (DELIVERED.includes(delivery)) { sent = delivery; episode = { ...episode, notified_at: now, ...(event ? { with: event } : {}) }; }
    // Not delivered (failed, blocked, alert changed): no episode, so the next check can try again.
    else { reason = `not_delivered_${delivery ?? 'skipped'}`; episode = null; }
  }
  return {
    state: decision.state, reason, checked_at: now,
    would_send: decision.would_send, sent, ...(decision.would_send && event ? { combine_with: event } : {}),
    evidence: decision.evidence.map(({ url, size, quantity, source }) => ({ url, size, quantity, source })),
    episode,
  };
}

// For the wishlist and admin: the last verified low reading, when the latest check found one.
// Older than three days (one check interval) it is shown as history, not as the current state.
export const LOW_STOCK_FRESH_MS = 3 * 24 * 60 * 60 * 1000;
export function lowStockSummary(alert, now = Date.now()) {
  const record = alert?.last_result?.low_stock;
  if (!alert?.active || record?.state !== 'low') return null;
  const lowest = [...(record.evidence ?? [])].filter(e => e.quantity >= 1 && e.quantity <= LOW_STOCK_MAX).sort((a, b) => a.quantity - b.quantity)[0];
  if (!lowest) return null;
  const checked = Date.parse(record.checked_at);
  return { quantity: lowest.quantity, size: lowest.size, store: storeName(lowest.url), checked_at: record.checked_at, fresh: Number.isFinite(checked) && now - checked < LOW_STOCK_FRESH_MS };
}
