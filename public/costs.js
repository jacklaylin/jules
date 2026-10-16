import {mountAdminShell,adminJson,anchorMenus} from './admin-console.js';
import {viewOf,totalLine,coverageText,budgetText,providerLines,serviceRow,featureRows,meteredText,entryBody} from './costs-view.js';
// Admin › Costs as a data view: the day's total beside the title, views By service · By feature · Evals,
// the day picker in the toolbar and coverage/budget in the status line. Update an amount opens its form above the table.
mountAdminShell('costs');
anchorMenus();
const $ = id => document.getElementById(id);
const el = (tag, { dataset, ...props } = {}, ...children) => { const node = Object.assign(document.createElement(tag), props); Object.assign(node.dataset, dataset); node.append(...children.filter(c => c !== null)); return node; };
$('date').value = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const api = (options = {}) => adminJson(`/api/costs?date=${encodeURIComponent($('date').value)}`, options);
let version = 0, data = null, refreshedAt = null;

function showView() {
  const view = viewOf(location.search);
  for (const button of $('cost-views').querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.view === view));
  for (const panel of document.querySelectorAll('[data-view-panel]')) panel.hidden = panel.dataset.viewPanel !== view;
  summary();
}
// The metered estimate for the open view (By feature, Evals) joins the status line.
function summary() {
  const view = viewOf(location.search);
  $('view-summary').textContent = data && view ? meteredText(data.metered, view === 'evals') : '';
}
for (const button of $('cost-views').querySelectorAll('button')) button.onclick = () => {
  const url = new URL(location.href);
  if (button.dataset.view) url.searchParams.set('view', button.dataset.view); else url.searchParams.delete('view');
  history.replaceState(null, '', url); showView();
};

const emptyRow = (columns, text) => el('tr', {}, el('td', { colSpan: columns, className: 'muted', textContent: text }));
function render() {
  const { amount, label } = totalLine(data);
  $('total').textContent = amount; $('total-label').textContent = label ? `${$('date').value} (UTC) · ${label}` : '';
  $('refreshed').textContent = refreshedAt ? `Refreshed ${new Date(refreshedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : '';
  $('coverage').textContent = data ? coverageText(data) : '';
  const budget = data ? budgetText(data) : { text: '', over: false };
  $('budget-status').textContent = budget.text; $('budget-status').className = budget.over ? 'error' : '';
  summary();
  if (!data) return;
  $('rows').replaceChildren(...data.rows.map(serviceRow).map(row => el('tr', {},
    el('td', {}, el('a', { href: row.url, target: '_blank', rel: 'noopener noreferrer', className: 'service-name', textContent: row.name }), row.note ? el('small', { textContent: row.note }) : null),
    el('td', { className: 'end num', textContent: row.usage, dataset: { label: 'Usage today' } }), el('td', { className: 'end num', textContent: row.subscription, dataset: { label: 'Subscription / day' } }), el('td', { className: 'end num', textContent: row.total, dataset: { label: 'Recorded total' } }),
    el('td', {}, el('span', { className: `badge ${row.complete ? 'ok' : 'warn'}`, textContent: row.complete ? 'Recorded' : 'Incomplete' }), ' ', el('span', { className: 'muted', textContent: row.source })))));
  for (const [id, evals] of [['feature-rows', false], ['eval-rows', true]]) {
    const rows = featureRows(data.metered, evals);
    $(id).replaceChildren(...(rows.length ? rows.map(f => el('tr', {}, el('td', { textContent: f.label }), el('td', { className: 'end num', textContent: f.calls, dataset: { label: 'Calls' } }), el('td', { className: 'end num', textContent: f.cost, dataset: { label: 'Estimated cost' } })))
      : [emptyRow(3, data.metered?.features.length ? `No ${evals ? 'eval test runs' : 'user activity'} on this day.` : `${meteredText(data.metered, evals)}.`)]));
  }
  $('providers').replaceChildren(...providerLines(data.providers).flatMap(([name, text]) => [el('dt', { textContent: name }), el('dd', { textContent: text })]));
  if (!$('service').options.length) $('service').append(...data.rows.map(row => el('option', { value: row.id, textContent: row.name })));
}

async function load() {
  const request = ++version;
  $('loader').hidden = false; $('notice').textContent = ''; $('notice').className = '';
  try {
    const fresh = await api(); if (request !== version) return;
    data = fresh; refreshedAt = Date.now();
  } catch (error) {
    if (request !== version) return;
    data = null; $('rows').replaceChildren(emptyRow(5, 'Costs could not be loaded.'));
    $('notice').className = 'error'; $('notice').textContent = `Could not load costs: ${error.message} Try Refresh in More.`;
  } finally { if (request === version) { $('loader').hidden = true; render(); } }
}

function toggleEntry(open) {
  $('tool-entry').hidden = !open; $('entry-open').setAttribute('aria-expanded', String(open));
  if (open) { $('tool-entry').scrollIntoView({ block: 'nearest' }); $('service').focus(); } else $('entry-open').focus();
}
$('entry-open').onclick = () => toggleEntry($('tool-entry').hidden);
$('entry-close').onclick = () => toggleEntry(false);
$('entry').onsubmit = async event => {
  event.preventDefault(); $('save').disabled = true; $('entry-error').hidden = true;
  try {
    await api({ method: 'POST', body: JSON.stringify(entryBody({ kind: $('kind').value, service: $('service').value, date: $('date').value, amount: $('amount').value, note: $('note').value })) });
    $('amount').value = ''; $('note').value = '';
    await load(); $('notice').textContent = 'Amount saved.';
  } catch (error) { $('entry-error').textContent = `Not saved: ${error.message}`; $('entry-error').hidden = false; }
  finally { $('save').disabled = false; }
};
$('refresh').onclick = () => { $('costs-more').hidePopover(); load(); };
$('date').onchange = load;
// The service list does not apply to the all-services budget.
$('kind').onchange = () => { $('service').disabled = $('kind').value === 'budget'; };
addEventListener('popstate', showView);
showView();
load();
