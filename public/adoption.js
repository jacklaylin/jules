import {mountAdminShell,adminJson} from './admin-console.js';
import {ago} from './admin-people-view.js';
import {testerCells,weekCells,summaryCells} from './adoption-view.js';
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
  $('definitions').replaceChildren(...[...steps.map(s => [s.label, s.explain]), ...OTHER_TERMS].flatMap(([term, text]) => [el('dt', { textContent: term }), el('dd', { textContent: text })]));
  $('refreshed').textContent = refreshedAt ? `Refreshed ${ago(refreshedAt, now)}` : '';
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
