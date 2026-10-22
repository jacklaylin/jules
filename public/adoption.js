import {mountAdminShell,adminJson} from './admin-console.js';
import {ago} from './admin-people-view.js';
import {testerCells,weekCells,summaryCells,qualitySummaryCells,qualityTesterCells,qualityWeekCells,usedKinds,missRow} from './adoption-view.js';
// Admin › Adoption: each tester's furthest step on the delegation ladder, and the ladder week by week.
mountAdminShell('adoption');
const $ = id => document.getElementById(id);
const el = (tag, props = {}, ...children) => { const node = Object.assign(document.createElement(tag), props); node.append(...children.filter(c => c !== null)); return node; };
// Cells carry their column name so phone layouts can show it beside the value.
const cell = (label, content, className = '') => { const td = el('td', { className }, content); td.dataset.label = label; return td; };
const OTHER_TERMS = [
  ['Last message', 'When the tester last texted Jules.'],
  ['Active days', 'Distinct days (UTC) in the last 7 on which the tester texted Jules.'],
  ['Results', 'Replies that carried product results.'],
  ['Shown', 'Product options linked in Jules’s replies, counted since this tracking began.'],
  ['Save rate', 'Wishlist saves made since tracking began, divided by product options shown. A save of something the tester found elsewhere also counts.'],
  ['Clicks', 'Taps on product links in Jules’s replies. Recorded only while link tracking (LINK_CLICK_TRACKING) is on; link previews are not counted.'],
  ['Price alerts', 'Alerts currently on, and every alert the tester has set.'],
  ['First results after', 'Time from the tester’s first message to their first reply with products.'],
  ['Cost', 'Estimated OpenAI and SerpApi spend caused by this tester, at list prices.'],
  ['Not tracked yet', 'Completed purchases. Jules never buys, so a purchase is only known when a receipt arrives later.'],
];
let data = null, nudges = null, alerts = null, refreshedAt = null;

function render() {
  if (!data) return;
  const { steps, summary, testers, weeks } = data, now = Date.now();
  $('summary').replaceChildren(...summaryCells(summary).map(c => el('div', { className: 'dv-metric' }, el('span', { textContent: c.label }), el('strong', { textContent: c.value }), el('span', { textContent: c.note }))));
  $('summary').hidden = false;
  $('testers').replaceChildren(...testers.map(t => {
    const c = testerCells(t, steps, now);
    return el('tr', {},
      cell('Tester', el('a', { className: 'tester-link', href: `/admin/people/${t.id}`, textContent: t.sender_id })),
      cell('Furthest step', el('span', { className: `badge ${c.stage.tone}`, textContent: c.stage.label })),
      cell('Last message', el('span', { textContent: c.last_active, title: t.last_active_at ? new Date(t.last_active_at).toLocaleString() : '' })),
      cell('Active days (last 7)', c.active_days), cell('Results', c.results, 'end num'), cell('Saves', c.saves, 'end num'),
      cell('Shown', c.shown, 'end num'), cell('Save rate', c.save_rate, 'end num'), cell('Clicks', c.clicks, 'end num'),
      cell('Price alerts', c.alerts), cell('First results after', c.first_results), cell('Cost', c.cost, 'end num'));
  }));
  if (!testers.length) $('testers').append(el('tr', {}, el('td', { colSpan: 12, className: 'dv-empty', textContent: 'No testers yet.' })));
  const heads = ['Week of', 'New', 'Active', ...steps.map(s => s.key === 'joined' ? 'Testers' : s.label)];
  $('ladder-head').replaceChildren(...heads.map(h => el('th', { textContent: h })));
  $('ladder').replaceChildren(...weeks.map(w => {
    const c = weekCells(w, steps);
    return el('tr', { className: w.current ? 'current' : '' }, cell('Week of', el('strong', { textContent: c.week })), cell('New', c.joined, 'num'), cell('Active', c.active, 'num'),
      ...c.steps.map(s => cell(s.key === 'joined' ? 'Testers' : s.label, s.value, 'num')));
  }));
  renderQuality(data.quality, testers);
  renderNudges(nudges, testers);
  renderAlerts(alerts, testers);
  const quality = data.quality ? [...data.quality.kinds.map(k => [`Miss: ${k.label}`, k.explain]), ...data.quality.photo_outcomes.map(o => [`Photo: ${o.label}`, o.explain])] : [];
  $('definitions').replaceChildren(...[...steps.map(s => [s.label, s.explain]), ...OTHER_TERMS, ...quality].flatMap(([term, text]) => [el('dt', { textContent: term }), el('dd', { textContent: text })]));
  $('refreshed').textContent = refreshedAt ? `Refreshed ${ago(refreshedAt, now)}` : '';
}

// Quality: misses, flags and photo outcomes. A null section (its reads failed) leaves the rest of the page as it is.
function renderQuality(q, testers) {
  $('quality').hidden = !q; $('quality-error').hidden = Boolean(q);
  if (!q) return;
  $('quality-summary').replaceChildren(...qualitySummaryCells(q).map(c => el('div', { className: 'dv-metric' }, el('span', { textContent: c.label }), el('strong', { textContent: c.value }), el('span', { textContent: c.note }))));
  $('quality-testers').replaceChildren(...testers.map(t => {
    const c = qualityTesterCells(t, q.per_tester[t.id] ?? { misses: 0, flags: 0, thumbs: 0, photos: 0, photos_identified: 0, photos_saved: 0 });
    return el('tr', {}, cell('Tester', el('a', { className: 'tester-link', href: `/admin/people/${t.id}`, textContent: t.sender_id })),
      cell('Results', c.results, 'end num'), cell('Misses', c.misses, 'end num'), cell('Miss rate', c.miss_rate, 'end num'), cell('Flags', c.flags, 'end num'),
      cell('Photos', c.photos, 'end num'), cell('Identified', c.identified, 'end num'), cell('Saved from photo', c.saved, 'end num'));
  }));
  const kinds = usedKinds(q);
  $('quality-week-head').replaceChildren(...['Week of', 'Results', 'Misses', ...kinds.map(k => k.label), 'Flags', 'Photos'].map(h => el('th', { textContent: h })));
  $('quality-weeks').replaceChildren(...q.weeks.map(w => {
    const c = qualityWeekCells(w, kinds, q.photo_outcomes);
    return el('tr', { className: w.current ? 'current' : '' }, cell('Week of', el('strong', { textContent: c.week })), cell('Results', c.results, 'num'), cell('Misses', c.misses, 'num'),
      ...c.kinds.map(k => cell(k.label, k.value, 'num')), cell('Flags', c.flags, 'num'), cell('Photos', c.photos));
  }));
  if (!q.weeks.length) $('quality-weeks').append(el('tr', {}, el('td', { colSpan: 5, className: 'dv-empty', textContent: 'Nothing recorded yet.' })));
  $('quality-photos').replaceChildren(...q.photo_outcomes.map(o => el('tr', {}, cell('Outcome', el('strong', { textContent: o.label })), cell('Photos', String(q.photos.outcomes[o.key] ?? 0), 'end num'), cell('Meaning', o.explain, 'muted'))));
  $('quality-photo-note').textContent = `${q.photos.total} photo messages in all. ${q.photos.saved} led to a wishlist save${q.photos.corrected ? `, ${q.photos.corrected} of them later corrected` : ''}. Owner test photos are left out.`;
  $('quality-misses').replaceChildren(...q.misses.map(m => {
    const c = missRow(m, q.kinds);
    return el('tr', {}, cell('Date', c.date), cell('Tester', el('a', { className: 'tester-link', href: c.href, textContent: c.tester, title: 'Open this message in the conversation' })),
      cell('Kind', el('span', { className: 'badge warn', textContent: c.kind })),
      cell('What happened', el('span', { className: 'miss-summary' }, c.summary, c.about ? el('small', { textContent: c.about }) : null)));
  }));
  if (!q.misses.length) $('quality-misses').append(el('tr', {}, el('td', { colSpan: 4, className: 'dv-empty', textContent: 'No misses recorded.' })));
}

// Purchase nudges (lib/nudges.js nudgeSummary). Loaded on its own; a failed read only hides this section.
const NUDGE_KIND = { goes_with: 'Goes with', fit_check: 'Fit check' };
const NUDGE_REASON = { quiet_hours: 'quiet hours', daily_cap: 'already texted today', weekly_cap: '3 this week', price_alert_today: 'price alert today', ignored_backoff: 'paused (2 ignored)',
  mid_conversation: 'mid-conversation', opted_out: 'texted STOP', texts_off: 'purchase texts off', not_clothing: 'not clothing', not_worth_a_text: 'not worth an offer', nothing_recent: 'nothing recent',
  accepted: 'said yes', declined: 'said no', not_now: 'not now', unrelated: 'other reply', stopped: 'turned texts off' };
const outcomeText = e => `${e.status}${e.reason ? ` · ${NUDGE_REASON[e.reason] ?? e.reason}` : ''}${e.test ? ' · test' : ''}`;
const pct = v => v == null ? '—' : `${Math.round(v * 100)}%`;
function renderNudges(n, testers) {
  if (n === undefined) return;
  $('nudges').hidden = !n; $('nudges-error').hidden = Boolean(n);
  if (!n) return;
  const name = id => testers.find(t => t.id === id)?.sender_id ?? id.slice(0, 8);
  const link = id => el('a', { className: 'tester-link', href: `/admin/people/${id}`, textContent: name(id) });
  const t = n.totals;
  $('nudges-summary').replaceChildren(...[['Offers sent', String(t.offers), `${t.fit_checks} fit checks`], ['Answered', pct(t.reply_rate), `${t.answered} of ${t.offers} offers`], ['Said yes', pct(t.yes_rate), `${t.yes} offers`], ['No reply', String(t.no_reply), `${t.unrelated} replied about something else`]]
    .map(([label, value, note]) => el('div', { className: 'dv-metric' }, el('span', { textContent: label }), el('strong', { textContent: value }), el('span', { textContent: note }))));
  $('nudge-testers').replaceChildren(...n.people.map(p => el('tr', {}, cell('Tester', link(p.id)), cell('Offers', String(p.offers), 'end num'), cell('Answered', String(p.answered), 'end num'),
    cell('Yes', String(p.yes), 'end num'), cell('No / not now', String(p.no + p.not_now), 'end num'), cell('Other reply', String(p.unrelated), 'end num'),
    cell('No reply', `${p.no_reply}${p.open ? ' (+1 open)' : ''}`, 'end num'), cell('Fit checks', String(p.fit_checks), 'end num'),
    cell('Held or skipped', Object.entries(p.held).map(([r, c]) => `${NUDGE_REASON[r] ?? r} ×${c}`).join(', ') || '—'),
    cell('Latest', p.latest ? `${ago(Date.parse(p.latest.at))}: ${NUDGE_KIND[p.latest.kind] ?? p.latest.kind} ${outcomeText(p.latest)}` : '—'))));
  if (!n.people.length) $('nudge-testers').append(el('tr', {}, el('td', { colSpan: 10, className: 'dv-empty', textContent: 'No nudges yet.' })));
  $('nudge-recent').replaceChildren(...n.recent.map(e => el('tr', {}, cell('When (UTC)', e.at.slice(0, 16).replace('T', ' ')), cell('Tester', link(e.id)), cell('Kind', NUDGE_KIND[e.kind] ?? e.kind), cell('Outcome', outcomeText(e)))));
  if (!n.recent.length) $('nudge-recent').append(el('tr', {}, el('td', { colSpan: 4, className: 'dv-empty', textContent: 'Nothing recorded yet.' })));
}

// Alert texts (lib/alert-metrics.js alertSummary), last 30 days. Loaded on its own; a failed read only hides this section.
const DELIVERY = { sent: 'Sent', uncertain: 'Uncertain', failed: 'Failed', blocked: 'Blocked (STOP)', sending: 'Sending' };
const ratio = (part, whole, r) => whole ? `${part} (${pct(r ?? part / whole)})` : '0';
function renderAlerts(a, testers) {
  if (a === undefined) return;
  $('alerts').hidden = !a; $('alerts-error').hidden = Boolean(a);
  if (!a) return;
  const name = id => testers.find(t => t.id === id)?.sender_id ?? String(id).slice(0, 8);
  const link = id => el('a', { className: 'tester-link', href: `/admin/people/${id}`, textContent: name(id) });
  const t = a.totals, delivered = t.sent + t.uncertain;
  $('alerts-summary').replaceChildren(...[['Alert texts', String(t.texts), `${t.people} people · last ${a.days} days`],
    ['Delivered', ratio(delivered, t.texts), `${t.failed + t.blocked} not delivered${t.uncertain ? ` · ${t.uncertain} uncertain` : ''}`],
    ['Tapped the link', a.tracking ? ratio(t.tapped, delivered, t.tap_rate) : 'Off', a.tracking ? 'within 7 days' : 'link tracking is off'],
    ['Replied', ratio(t.replied, delivered, t.reply_rate), 'within a day'], ['Bought', String(t.bought), 'marked bought within 14 days']]
    .map(([label, value, note]) => el('div', { className: 'dv-metric' }, el('span', { textContent: label }), el('strong', { textContent: value }), el('span', { textContent: note }))));
  $('alerts-note').textContent = `Price-drop, back-in-stock and nearly-sold-out texts from the last ${a.days} days. A tap is counted when the person opens the store link in that text (link previews don't count). Admin test texts are left out.${a.tracking ? '' : ' Link taps are not being recorded: set LINK_CLICK_TRACKING=true in Vercel to count them.'} Taps are only counted on texts sent after Oct 22, when alert links started going through Jules.`;
  $('alert-kinds').replaceChildren(...a.kinds.map(k => el('tr', {}, cell('Kind', el('strong', { textContent: k.label })), cell('Texts', String(k.texts), 'end num'),
    cell('Delivered', String(k.sent + k.uncertain), 'end num'), cell('Not delivered', String(k.failed + k.blocked), 'end num'), cell('People', String(k.people), 'end num'),
    cell('Tapped link', a.tracking ? ratio(k.tapped, k.sent + k.uncertain, k.tap_rate) : '—', 'end num'), cell('Replied', ratio(k.replied, k.sent + k.uncertain, k.reply_rate), 'end num'), cell('Bought', String(k.bought), 'end num'))));
  if (!a.kinds.length) $('alert-kinds').append(el('tr', {}, el('td', { colSpan: 8, className: 'dv-empty', textContent: 'No alert texts yet.' })));
  const kindLabel = Object.fromEntries(a.kinds.map(k => [k.kind, k.label]));
  $('alert-recent').replaceChildren(...a.recent.map(r => el('tr', {}, cell('When (UTC)', r.at.slice(0, 16).replace('T', ' ')), cell('Tester', link(r.id)), cell('Kind', kindLabel[r.kind] ?? r.kind),
    cell('Delivery', DELIVERY[r.status] ?? r.status), cell('What happened', [r.tapped && 'tapped link', r.replied && 'replied', r.bought && 'bought'].filter(Boolean).join(', ') || '—'))));
  if (!a.recent.length) $('alert-recent').append(el('tr', {}, el('td', { colSpan: 5, className: 'dv-empty', textContent: 'Nothing recorded yet.' })));
}

async function load() {
  $('loader').hidden = false; $('notice').textContent = ''; $('notice').className = '';
  const nudgesRead = adminJson('/api/admin?view=nudges-summary').catch(() => null), alertsRead = adminJson('/api/admin?view=alerts-summary').catch(() => null);
  try { data = await adminJson('/api/admin?view=adoption'); nudges = await nudgesRead; alerts = await alertsRead; refreshedAt = Date.now(); render(); }
  catch (error) { $('notice').className = 'error'; $('notice').textContent = `Could not load adoption: ${error.message} Try Refresh.`; }
  finally { $('loader').hidden = true; }
}
$('refresh').onclick = load;
setInterval(() => { if (refreshedAt) $('refreshed').textContent = `Refreshed ${ago(refreshedAt)}`; }, 30000);
load();
