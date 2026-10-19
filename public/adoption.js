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
let data = null, refreshedAt = null;

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

async function load() {
  $('loader').hidden = false; $('notice').textContent = ''; $('notice').className = '';
  try { data = await adminJson('/api/admin?view=adoption'); refreshedAt = Date.now(); render(); }
  catch (error) { $('notice').className = 'error'; $('notice').textContent = `Could not load adoption: ${error.message} Try Refresh.`; }
  finally { $('loader').hidden = true; }
}
$('refresh').onclick = load;
setInterval(() => { if (refreshedAt) $('refreshed').textContent = `Refreshed ${ago(refreshedAt)}`; }, 30000);
load();
