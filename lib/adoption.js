import { quality } from './adoption-quality.js';
import { windows, change } from './compare.js';
// Adoption dashboard (Admin › Adoption): how far each tester has climbed the delegation ladder
// (PRD §2, §22) and how the group moved week by week. Computation is pure (rows in, numbers out);
// rows hold ids, timestamps and counts only, with no message text: conversations, tester messages,
// sent replies that carried product results, wishlist saves, price alerts, metered cost and adoption
// events (db/032: product options shown, product-link clicks, purchase requests). Completed purchases
// are not recorded structurally, so the ladder stops at "Purchase intent".

export const STEPS = [
  { key: 'joined', label: 'Joined', explain: 'Has a Jules conversation.' },
  { key: 'messaged', label: 'Messaged', explain: 'Sent Jules at least one message.' },
  { key: 'results', label: 'Got results', explain: 'Received at least one reply with product results.' },
  { key: 'saved', label: 'Saved', explain: 'Saved at least one item to their wishlist (including ones removed later).' },
  { key: 'watching', label: 'Watching', explain: 'Set up at least one price alert.' },
  { key: 'intent', label: 'Purchase intent', explain: 'Asked Jules to buy something and got a checkout link (Jules never buys).' },
];
const DAY = 86400000, WEEKS = 8;
const ms = at => Date.parse(at);
const dayOf = at => new Date(at).toISOString().slice(0, 10);
const earliest = values => values.length ? values.reduce((a, b) => ms(a) <= ms(b) ? a : b) : null;
const latest = values => values.length ? values.reduce((a, b) => ms(a) >= ms(b) ? a : b) : null;
// Monday 00:00 UTC of the week containing `at`.
export function weekStart(at) {
  const d = new Date(at); d.setUTCHours(0, 0, 0, 0);
  return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY);
}
function group(rows, at) {
  const by = new Map();
  for (const row of rows) if (row.conversation_id && Number.isFinite(ms(row[at]))) by.set(row.conversation_id, [...(by.get(row.conversation_id) ?? []), row]);
  return by;
}

// One row per tester, plus the weekly ladder and a summary for the metric strip.
export function adoption({ conversations = [], inbound = [], results = [], saves = [], alerts = [], costs = [], events = [] }, now = Date.now()) {
  const messages = group(inbound, 'created_at'), replies = group(results, 'created_at'), saved = group(saves, 'saved_at'), watched = group(alerts, 'created_at');
  const kind = k => group(events.filter(e => e.kind === k), 'created_at'), shownBy = kind('results_shown'), clickedBy = kind('link_click'), intendedBy = kind('purchase_intent');
  // Save rate only counts saves made since results-shown tracking began (db/032), so earlier saves don't inflate it.
  const trackedSince = earliest([...shownBy.values()].flat().map(e => e.created_at));
  const quantity = rows => rows.reduce((n, e) => n + (Number(e.quantity) || 0), 0);
  const spend = new Map();
  for (const row of costs) spend.set(row.conversation_id, (spend.get(row.conversation_id) ?? 0) + Number(row.cost_usd ?? 0));
  const weekAgo = now - 7 * DAY;
  const testers = conversations.map(c => {
    const sent = messages.get(c.id) ?? [], got = replies.get(c.id) ?? [], kept = saved.get(c.id) ?? [], set = watched.get(c.id) ?? [];
    const shown = quantity(shownBy.get(c.id) ?? []), intents = intendedBy.get(c.id) ?? [];
    const keptSince = trackedSince ? kept.filter(r => ms(r.saved_at) >= ms(trackedSince)).length : 0;
    const reached = {
      joined: c.created_at,
      messaged: earliest(sent.map(r => r.created_at)),
      results: earliest(got.map(r => r.created_at)),
      saved: earliest(kept.map(r => r.saved_at)),
      watching: earliest(set.map(r => r.created_at)),
      intent: earliest(intents.map(r => r.created_at)),
    };
    const stage = [...STEPS].reverse().find(s => reached[s.key])?.key ?? 'joined';
    const lastActive = latest(sent.map(r => r.created_at));
    return {
      id: c.id, sender_id: c.sender_id, joined_at: c.created_at, reached, stage,
      last_active_at: lastActive,
      active_days_7: new Set(sent.filter(r => ms(r.created_at) >= weekAgo).map(r => dayOf(r.created_at))).size,
      active_days_total: new Set(sent.map(r => dayOf(r.created_at))).size,
      messages: sent.length, results: got.length, saves: kept.length,
      // Product options shown in replies, and saves (since tracking began) per option shown.
      shown, saves_tracked: keptSince, save_rate: shown ? keptSince / shown : null,
      clicks: (clickedBy.get(c.id) ?? []).length, intents: intents.length,
      alerts_active: set.filter(a => a.active).length, alerts_total: set.length,
      // Activation speed: hours from first message to first reply with products.
      hours_to_results: reached.messaged && reached.results ? Math.max(0, (ms(reached.results) - ms(reached.messaged)) / 3600000) : null,
      cost_usd: spend.has(c.id) ? Math.round(spend.get(c.id) * 100) / 100 : null,
    };
  });
  testers.sort((a, b) => STEPS.findIndex(s => s.key === b.stage) - STEPS.findIndex(s => s.key === a.stage) || (ms(b.last_active_at ?? b.joined_at) || 0) - (ms(a.last_active_at ?? a.joined_at) || 0));

  // Weekly ladder: for each of the last WEEKS weeks (Monday UTC), how many testers had reached each step by the
  // end of that week, how many joined during it, and how many messaged Jules during it. Newest first.
  const firstJoin = earliest(conversations.map(c => c.created_at).filter(at => Number.isFinite(ms(at))));
  const weeks = [];
  if (firstJoin) {
    const current = weekStart(now).getTime(), start = Math.max(weekStart(firstJoin).getTime(), current - (WEEKS - 1) * 7 * DAY);
    for (let from = current; from >= start; from -= 7 * DAY) {
      const until = from + 7 * DAY, inWeek = at => at && ms(at) >= from && ms(at) < until;
      weeks.push({
        week_of: new Date(from).toISOString().slice(0, 10), current: from === current,
        joined: testers.filter(t => inWeek(t.joined_at)).length,
        active: testers.filter(t => (messages.get(t.id) ?? []).some(r => inWeek(r.created_at))).length,
        reached: Object.fromEntries(STEPS.map(s => [s.key, testers.filter(t => t.reached[s.key] && ms(t.reached[s.key]) < until).length])),
      });
    }
  }
  const count = key => testers.filter(t => t.reached[key]).length;
  const summary = {
    testers: testers.length,
    active_7: testers.filter(t => t.last_active_at && ms(t.last_active_at) >= weekAgo).length,
    results: count('results'), saved: count('saved'),
    watching_now: testers.filter(t => t.alerts_active > 0).length,
    shown: testers.reduce((n, t) => n + t.shown, 0), saves_tracked: testers.reduce((n, t) => n + t.saves_tracked, 0),
    clicks: testers.reduce((n, t) => n + t.clicks, 0), clickers: testers.filter(t => t.clicks).length, intent: count('intent'),
  };
  summary.save_rate = summary.shown ? summary.saves_tracked / summary.shown : null;
  const periods = periodStrips({ conversations, inbound, saves, events, testers, trackedSince, summary }, now);
  return { generated_at: new Date(now).toISOString(), tracked_since: trackedSince, steps: STEPS, summary, periods, testers, weeks };
}

// The MetricStrip for each Compare choice (lib/compare.js): the same eight figures for the current window and the one
// before, with the change badge worked out here. Step counts (results, saved, intent) are everyone who had reached
// the step by the window's end; activity, save rate and clicks happen within it. Save rate and clicks only count
// once results-shown tracking began, so an earlier window says "New" rather than 0.
const share = (part, whole) => whole ? `${Math.round(part / whole * 100)}%` : '—';
export function periodStrips({ conversations = [], inbound = [], saves = [], events = [], testers = [], trackedSince = null, summary = {} }, now = Date.now()) {
  const tracked = ms(trackedSince ?? '') || Infinity, within = (at, [from, to]) => ms(at) >= from && ms(at) < to;
  const figures = ([from, to]) => {
    const by = key => testers.filter(t => t.reached[key] && ms(t.reached[key]) < to).length;
    const range = [Math.max(from, tracked), to];
    const shown = events.filter(e => e.kind === 'results_shown' && within(e.created_at, range)).reduce((n, e) => n + (Number(e.quantity) || 0), 0);
    const kept = saves.filter(r => within(r.saved_at, range)).length, clicks = events.filter(e => e.kind === 'link_click' && within(e.created_at, [from, to]));
    return {
      testers: conversations.filter(c => ms(c.created_at) < to).length, joined: conversations.filter(c => within(c.created_at, [from, to])).length,
      active: new Set(inbound.filter(m => within(m.created_at, [from, to])).map(m => m.conversation_id)).size,
      results: by('results'), saved: by('saved'), intent: by('intent'), shown, kept, save_rate: shown ? kept / shown : null,
      clicks: clicks.length, clickers: new Set(clicks.map(e => e.conversation_id)).size,
    };
  };
  return Object.fromEntries(Object.entries(windows(now)).map(([key, w]) => {
    const n = figures(w.current), b = figures(w.previous), t = w.previous[0] >= tracked;
    const step = (label, k) => ({ label, value: String(n[k]), detail: `${share(n[k], n.testers)} of testers`, ...change(n[k], b[k]), was: `was ${b[k]}` });
    return [key, { label: w.label, cells: [
      { label: 'Testers', value: String(n.testers), detail: `${n.joined} new`, ...change(n.testers, b.testers), was: `was ${b.testers}` },
      { label: 'Active', value: String(n.active), detail: `${share(n.active, n.testers)} of testers`, ...change(n.active, b.active), was: `was ${b.active}` },
      step('Got results', 'results'), step('Saved an item', 'saved'),
      { label: 'Watching now', value: String(summary.watching_now ?? 0), detail: `${share(summary.watching_now ?? 0, summary.testers)} of testers · now only`, change: null, tone: '', was: null },
      { label: 'Save rate', value: n.save_rate == null ? '—' : share(n.kept, n.shown), detail: n.shown ? `${n.kept} saved of ${n.shown} shown` : 'nothing shown',
        ...change(n.save_rate, b.save_rate, { tracked: t, points: true }), was: t && b.save_rate != null ? `was ${share(b.kept, b.shown)}` : null },
      { label: 'Link clicks', value: String(n.clicks), detail: n.clicks ? `from ${n.clickers} ${n.clickers === 1 ? 'tester' : 'testers'}` : 'none', ...change(n.clicks, b.clicks, { tracked: t }), was: t ? `was ${b.clicks}` : null },
      step('Purchase intent', 'intent'),
    ] }];
  }));
}

// Reads the rows from the store and computes the dashboard.
// The quality section reads its own rows; if they fail (for example before db/025 runs) the rest still loads.
export async function adoptionReport(store, now = Date.now()) {
  // The quality rows are read beside the adoption rows, not after them; a failed quality read still leaves the report.
  const qualityRows = Promise.resolve().then(() => store.adoptionQualityRows()); qualityRows.catch(() => {});
  const rows = await store.adoptionRows();
  const report = adoption(rows, now);
  try { report.quality = quality({ ...await qualityRows, conversations: rows.conversations, results: rows.results }, now); }
  catch (error) { console.error(JSON.stringify({ event: 'adoption_quality_failed', status: error.database_status ?? null })); report.quality = null; }
  return report;
}
