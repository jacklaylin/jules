import {mountAdminShell,adminJson,anchorMenus} from './admin-console.js';
import {browseKey} from './admin-review.js';
import {filterPeople,ago,countLine,metricCells,metricsNote} from './admin-people-view.js';
// Admin › People: the list of testers as a data view. Each row opens the person page.
mountAdminShell('people');
anchorMenus();
const $ = id => document.getElementById(id);
const el = (tag, props = {}, ...children) => { const node = Object.assign(document.createElement(tag), props); node.append(...children.filter(c => c !== null)); return node; };
const exact = at => new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
let people = [], refreshedAt = null, loading = false, failed = '';

function render() {
  const shown = filterPeople(people, $('people-search').value);
  const head = el('div', { className: 'dv-head', ariaHidden: 'true' }, el('span', { textContent: 'Identifier' }), el('span', { textContent: 'Source' }), el('span', { textContent: 'Last activity' }), el('span', { className: 'end' }));
  $('people').replaceChildren(head, ...shown.map(person => el('a', { className: 'dv-row', href: `/admin/people/${person.id}`, ariaLabel: `Open ${person.sender_id}` },
    el('span', {}, el('strong', { textContent: person.sender_id })),
    el('span', { className: 'muted', textContent: person.source ?? 'Direct', title: person.source ? `Signed up from a ?ref=${person.source} link` : 'No source on their signup link' }),
    el('span', { className: 'muted', textContent: ago(person.updated_at), title: exact(person.updated_at) }),
    el('span', { className: 'end', textContent: 'Open →' }))));
  if (!shown.length) $('people').append(el('p', { className: 'dv-empty', textContent: loading ? 'Loading…' : failed ? '' : !people.length ? 'No testers yet.' : 'No testers match this search.' }));
  $('people-count').textContent = people.length || refreshedAt ? countLine(shown.length, people.length, refreshedAt) : '';
  $('notice').className = failed ? 'error' : '';
  $('notice').textContent = failed;
}

async function load() {
  loading = true; failed = ''; render();
  try { people = (await adminJson('/api/admin')).conversations; refreshedAt = Date.now(); }
  catch (error) { failed = `Could not load people: ${error.message} Try Refresh in More.`; }
  finally { loading = false; render(); }
}

// The people list does not depend on metrics: if they fail, the strip stays hidden.
async function loadMetrics() {
  try {
    const trend = await adminJson('/api/admin?view=metrics');
    const cells = metricCells(trend);
    $('chat-metrics-strip').replaceChildren($('chat-metrics-strip').firstElementChild, ...cells.map(cell =>
      el('div', { className: 'dv-metric' }, el('span', { textContent: cell.label }), el('strong', { textContent: cell.value }),
        el('span', { className: `badge ${cell.tone}`, textContent: cell.verdict }), el('span', { className: 'dv-metric-was', textContent: `${cell.was} · ${cell.sample}` }))));
    $('chat-metrics-help').replaceChildren(...cells.flatMap(cell => [el('dt', { textContent: cell.label }), el('dd', { textContent: `${cell.explain} ${cell.better}` })]));
    $('metrics-note').textContent = metricsNote(trend.current);
    $('chat-metrics').hidden = false;
  } catch { /* Keep the list usable. */ }
}

function focusRow(step) {
  const rows = [...$('people').querySelectorAll('.dv-row')], at = rows.indexOf(document.activeElement);
  rows[at < 0 ? (step > 0 ? 0 : rows.length - 1) : Math.min(rows.length - 1, Math.max(0, at + step))]?.focus();
}

// / searches, J/K move between rows; Enter on a focused row opens it because each row is a link.
addEventListener('keydown', event => {
  const action = browseKey(event, { open: false, dialog: !!document.querySelector('dialog[open]'), menu: !!document.querySelector('.dv-pop:popover-open') });
  if (!action) return;
  event.preventDefault();
  if (action.type === 'search') $('people-search').focus();
  else if (action.type === 'row') focusRow(action.step);
});
$('people-search').oninput = render;
$('refresh').onclick = () => { $('people-more').hidePopover(); load(); loadMetrics(); };
// Keep "refreshed 3 min ago" honest while the page sits open.
setInterval(() => { if (refreshedAt) $('people-count').textContent = countLine(filterPeople(people, $('people-search').value).length, people.length, refreshedAt); }, 30000);
load();
loadMetrics();
