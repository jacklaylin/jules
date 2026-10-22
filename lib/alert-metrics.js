// Alert numbers for Admin › Adoption: for each kind of alert text (price drop, back in stock, nearly sold
// out, and combinations), how many went out, how many failed, and what people did next. Pure: rows in,
// numbers out. Rows hold ids, statuses and timestamps only, never message text.
//   texts   — sent alert texts (messages, operation price-alert:…; admin tests are price-alert-test:… and left out)
//   clicks  — link taps on those texts (adoption_events link_click, ref = the text's operation)
//   inbound — the testers' own messages
//   alerts  — price_alerts id → item_id, for texts sent before the item id was stored with the text
//   bought  — wishlist items marked "I bought this", with when

const HOUR = 3600000, DAY = 24 * HOUR;
export const TAP_WINDOW = 7 * DAY, REPLY_WINDOW = DAY, BOUGHT_WINDOW = 14 * DAY;
export const ALERT_KINDS = {
  price_drop: 'Price drop', restock: 'Back in stock', low_stock: 'Nearly sold out',
  'price_drop+low_stock': 'Price drop + nearly sold out', 'restock+low_stock': 'Back in stock + nearly sold out',
  earlier: 'Price or restock (before kinds were recorded)',
};
const DELIVERED = ['sent', 'uncertain'];
const ms = at => Date.parse(at);
const rate = (part, whole) => whole ? part / whole : null;

// A text's kind: stored with it since alert tracking began; earlier low-stock texts are named in their operation.
export function alertKind(text) {
  if (text.kind && ALERT_KINDS[text.kind]) return text.kind;
  return /:low-stock:/.test(text.operation_id ?? '') ? 'low_stock' : 'earlier';
}

export function alertSummary({ texts = [], clicks = [], inbound = [], alerts = [], bought = [] } = {}, { now = Date.now(), days = 30, tracking = false } = {}) {
  const since = now - days * DAY;
  const itemOf = new Map(alerts.map(a => [a.id, a.item_id]));
  const tapsBy = new Map();
  for (const c of clicks) if (c.ref) tapsBy.set(c.ref, [...(tapsBy.get(c.ref) ?? []), ms(c.created_at)]);
  const inboundBy = new Map();
  for (const m of inbound) inboundBy.set(m.conversation_id, [...(inboundBy.get(m.conversation_id) ?? []), ms(m.created_at)]);
  const boughtAt = new Map(bought.filter(b => b.item_id && Number.isFinite(ms(b.at))).map(b => [b.item_id, ms(b.at)]));

  const rows = texts.filter(t => (t.operation_id ?? '').startsWith('price-alert:') && ms(t.created_at) >= since).map(t => {
    const at = ms(t.created_at), delivered = DELIVERED.includes(t.status);
    const item = t.item_id ?? itemOf.get(String(t.operation_id).split(':')[1]) ?? null;
    const within = (list, window) => (list ?? []).some(x => x >= at && x - at <= window);
    return {
      at: t.created_at, id: t.conversation_id, kind: alertKind(t), status: t.status, delivered,
      tapped: delivered && within(tapsBy.get(t.operation_id), TAP_WINDOW),
      replied: delivered && within(inboundBy.get(t.conversation_id), REPLY_WINDOW),
      bought: delivered && item != null && boughtAt.has(item) && boughtAt.get(item) >= at && boughtAt.get(item) - at <= BOUGHT_WINDOW,
    };
  });
  const tally = list => {
    const delivered = list.filter(r => r.delivered), count = key => delivered.filter(r => r[key]).length;
    return {
      texts: list.length, sent: list.filter(r => r.status === 'sent').length, uncertain: list.filter(r => r.status === 'uncertain').length,
      failed: list.filter(r => r.status === 'failed').length, blocked: list.filter(r => r.status === 'blocked').length,
      people: new Set(delivered.map(r => r.id)).size,
      tapped: count('tapped'), tap_rate: tracking ? rate(count('tapped'), delivered.length) : null,
      replied: count('replied'), reply_rate: rate(count('replied'), delivered.length),
      bought: count('bought'),
    };
  };
  const kinds = Object.keys(ALERT_KINDS).map(kind => ({ kind, label: ALERT_KINDS[kind], ...tally(rows.filter(r => r.kind === kind)) })).filter(k => k.texts);
  return {
    days, tracking, totals: tally(rows), kinds,
    recent: [...rows].sort((a, b) => ms(b.at) - ms(a.at)).slice(0, 20),
  };
}
