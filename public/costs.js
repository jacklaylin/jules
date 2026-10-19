import {mountAdminShell,adminJson,anchorMenus} from './admin-console.js';
import {viewOf,periodOf,apiDate,pickerValue,totalLine,coverageText,budgetText,serviceColumns,featureColumn,serviceRow,featureRows,meteredText,entryBody,jobColumns,jobRows,jobsAlert,jobsText} from './costs-view.js';
// Admin › Costs as a data view: a month by default (Day is an option, ?period=day), its total beside the title,
// views By service · By feature · Evals, the period and its picker in the toolbar, coverage/budget in the status line. Update an amount opens its form above the table.
mountAdminShell('costs');
anchorMenus();
const $ = id => document.getElementById(id);
const el = (tag, { dataset, ...props } = {}, ...children) => { const node = Object.assign(document.createElement(tag), props); Object.assign(node.dataset, dataset); node.append(...children.filter(c => c !== null)); return node; };
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const period = () => periodOf(location.search);
const reportDate = () => apiDate(period(), $('date').value || today(), today());
const api = (options = {}) => adminJson(`/api/costs?date=${encodeURIComponent(reportDate())}`, options);
let version = 0, data = null, refreshedAt = null;

// Month or Day: switches the picker between a month and a day, keeping the same month.
function showPeriod() {
  const p = period(), value = $('date').value || today();
  for (const button of $('cost-period').querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.period === p));
  $('date').type = p === 'day' ? 'date' : 'month'; $('date').max = p === 'day' ? today() : today().slice(0, 7);
  $('date').value = pickerValue(p, value, today()); $('date-label').textContent = p === 'day' ? 'Day (UTC)' : 'Month (UTC)';
}
for (const button of $('cost-period').querySelectorAll('button')) button.onclick = () => {
  const url = new URL(location.href);
  if (button.dataset.period === 'day') url.searchParams.set('period', 'day'); else url.searchParams.delete('period');
  history.replaceState(null, '', url); showPeriod(); load();
};

function showView() {
  const view = viewOf(location.search);
  for (const button of $('cost-views').querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.view === view));
  for (const panel of document.querySelectorAll('[data-view-panel]')) panel.hidden = panel.dataset.viewPanel !== view;
  summary();
}
// The metered estimate for the open view (By feature, Evals) joins the status line.
function summary() {
  const view = viewOf(location.search);
  $('view-summary').textContent = !data || !view ? '' : view === 'jobs' ? jobsText(data, period()) : meteredText(data, view === 'evals', period());
}
for (const button of $('cost-views').querySelectorAll('button')) button.onclick = () => {
  const url = new URL(location.href);
  if (button.dataset.view) url.searchParams.set('view', button.dataset.view); else url.searchParams.delete('view');
  history.replaceState(null, '', url); showView();
};

const emptyRow = (columns, text) => el('tr', {}, el('td', { colSpan: columns, className: 'muted', textContent: text }));
function render() {
  const p = period(), columns = serviceColumns(p, data), [featureKey, featureHeading] = featureColumn(p, data);
  const th = (text, end) => el('th', { textContent: text, className: end ? 'end' : '' });
  $('service-head').replaceChildren(th('Service'), ...columns.map(([, heading]) => th(heading, true)), th('How it’s known'), th('Last updated'));
  for (const [id, first] of [['feature-head', 'Feature'], ['eval-head', 'Eval']]) $(id).replaceChildren(th(first), th('AI calls (month)', true), th('Searches (month)', true), th(featureHeading, true));
  const { amount, label } = totalLine(data, p);
  $('total').textContent = amount; $('total-label').textContent = label;
  $('refreshed').textContent = refreshedAt ? `Refreshed ${new Date(refreshedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : '';
  $('coverage').textContent = data ? coverageText(data) : '';
  const budget = data ? budgetText(data, p) : { text: '', over: false };
  $('budget-status').textContent = budget.text; $('budget-status').className = budget.over ? 'error' : '';
  const jobsStatus = jobsAlert(data); $('jobs-status').textContent = jobsStatus.text; $('jobs-status').className = jobsStatus.over ? 'error' : '';
  summary();
  if (!data) return;
  const jobCols = jobColumns(p, data);
  $('jobs-head').replaceChildren(th('Job'), th('Runs this month', true), th('Last run'), th('Calls (month)', true), ...jobCols.map(([, heading]) => th(heading, true)), th('Monthly budget', true), th('Status'));
  $('jobs-rows').replaceChildren(...(data.jobs ? jobRows(data.jobs).map(j => el('tr', {},
    el('td', {}, el('span', { className: 'service-name', textContent: j.name }), el('small', { textContent: `${j.when} · ${j.where}` }), el('small', { textContent: `Spends on: ${j.spends}` })),
    el('td', { className: 'end num', textContent: j.runs, dataset: { label: 'Runs this month' } }),
    el('td', { className: 'num', textContent: j.lastRun, dataset: { label: 'Last run' } }),
    el('td', { className: 'end num', textContent: j.usage, dataset: { label: 'Calls (month)' } }),
    ...jobCols.map(([key, heading]) => el('td', { className: 'end num', textContent: j[key], dataset: { label: heading } })),
    el('td', { className: 'end num', textContent: j.budget, dataset: { label: 'Monthly budget' } }),
    el('td', {}, el('span', { className: `badge ${j.badge}`, textContent: j.status }), ...j.flags.map(text => el('small', { textContent: text })))))
    : [emptyRow(jobCols.length + 6, data.jobsNotice ?? 'Recurring job costs are unavailable.')]));
  $('rows').replaceChildren(...data.rows.map(serviceRow).map(row => el('tr', {},
    el('td', {}, el('a', { href: row.url, target: '_blank', rel: 'noopener noreferrer', className: 'service-name', textContent: row.name }), ...row.notes.map(note => el('small', { textContent: note }))),
    ...columns.map(([key, heading]) => el('td', { className: 'end num', textContent: row[key], dataset: { label: heading } })),
    el('td', {}, el('span', { className: `badge ${row.badge}`, textContent: row.basis }), el('small', { textContent: row.source })),
    el('td', { className: 'num', textContent: row.updated, dataset: { label: 'Last updated' } }))));
  for (const [id, evals] of [['feature-rows', false], ['eval-rows', true]]) {
    const rows = featureRows(data.features, evals);
    $(id).replaceChildren(...(rows.length ? rows.map(f => el('tr', {}, el('td', { textContent: f.label }), el('td', { className: 'end num', textContent: f.aiCalls, dataset: { label: 'AI calls' } }), el('td', { className: 'end num', textContent: f.searches, dataset: { label: 'Searches' } }), el('td', { className: 'end num', textContent: f[featureKey], dataset: { label: featureHeading } })))
      : [emptyRow(4, data.features?.features.length ? `No ${evals ? 'eval test runs' : 'user activity'} this month.` : `${meteredText(data, evals, p)}.`)]));
  }
  serviceOptions();
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
  if (open) { $('entry-date').max = today(); $('entry-date').value = reportDate(); entryKind(); $('tool-entry').scrollIntoView({ block: 'nearest' }); $('service').focus(); } else $('entry-open').focus();
}
$('entry-open').onclick = () => toggleEntry($('tool-entry').hidden);
$('entry-close').onclick = () => toggleEntry(false);
$('entry').onsubmit = async event => {
  event.preventDefault(); $('save').disabled = true; $('entry-error').hidden = true;
  try {
    await api({ method: 'POST', body: JSON.stringify(entryBody({ kind: $('kind').value, service: $('service').value, date: $('kind').value === 'usage' ? $('entry-date').value : reportDate(), amount: $('amount').value, note: $('note').value })) });
    $('amount').value = ''; $('note').value = '';
    await load(); $('notice').textContent = 'Amount saved.';
  } catch (error) { $('entry-error').textContent = `Not saved: ${error.message}`; $('entry-error').hidden = false; }
  finally { $('save').disabled = false; }
};
$('refresh').onclick = () => { $('costs-more').hidePopover(); load(); };
$('date').onchange = load;
// The service list does not apply to the all-services budget; only daily usage needs a day.
// A job budget picks a recurring job; every other amount picks a service.
let optionsFor = null;
function serviceOptions() {
  if (!data) return;
  const jobs = $('kind').value === 'job_budget';
  if (optionsFor === jobs) return;
  optionsFor = jobs; $('service-label').textContent = jobs ? 'Recurring job' : 'Service';
  $('service').replaceChildren(...(jobs ? data.jobs?.rows.filter(j => !j.unregistered).map(j => el('option', { value: 'job:' + j.id, textContent: j.name })) ?? [] : data.rows.map(row => el('option', { value: row.id, textContent: row.name }))));
}
function entryKind() { serviceOptions(); $('service').disabled = $('kind').value === 'budget'; $('entry-day').hidden = $('kind').value !== 'usage'; $('entry-date').disabled = $('kind').value !== 'usage'; }
$('kind').onchange = entryKind;
addEventListener('popstate', () => { showView(); showPeriod(); load(); });
showPeriod();
showView();
load();
