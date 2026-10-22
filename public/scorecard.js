import {mountAdminShell,adminJson} from './admin-console.js';
import {ago} from './admin-people-view.js';
import {TYPES,WHO,forWho,METRICS,metricCells,weekRows,worstTurns,agreement,turnRow} from './scorecard-view.js';
// Admin › Scorecard: weekly search and recommendation quality, and the turns most worth reading.
mountAdminShell('quality');
const $ = id => document.getElementById(id);
const el = (tag, props = {}, ...children) => { const node = Object.assign(document.createElement(tag), props); node.append(...children.filter(c => c !== null && c !== undefined)); return node; };
const cell = (label, content, className = '') => { const td = el('td', { className }, content); td.dataset.label = label; return td; };
let data = null, refreshedAt = null, type = 'all', who = 'testers';
try { const q = new URLSearchParams(location.search); type = q.get('type') ?? 'all'; who = q.get('who') ?? 'testers'; } catch {}
if (!TYPES.some(t => t.key === type)) type = 'all';
if (!WHO.some(w => w.key === who)) who = 'testers';
// The filters live in the address, so a reload or a shared link keeps them.
const remember = () => { const q = new URLSearchParams(); if (type !== 'all') q.set('type', type); if (who !== 'testers') q.set('who', who); history.replaceState(null, '', q.size ? `?${q}` : location.pathname); };

function render() {
  if (!data) return;
  const own = data.own_conversations ?? [], turns = forWho(data.turns, who, own), now = Date.now();
  $('who').replaceChildren(...WHO.map(w => el('button', { type: 'button', ariaPressed: String(w.key === who), onclick: () => { who = w.key; remember(); render(); } },
    w.label, el('span', { className: 'count', textContent: String(forWho(data.turns, w.key, own).length) }))));
  $('who').hidden = !own.length;
  $('own-missing').hidden = Boolean(data.own_configured);
  $('types').replaceChildren(...TYPES.map(t => el('button', { type: 'button', ariaPressed: String(t.key === type), onclick: () => { type = t.key; remember(); render(); } },
    t.label, el('span', { className: 'count', textContent: String(t.key === 'all' ? turns.length : turns.filter(x => x.request_type === t.key).length) }))));
  const cells = metricCells(turns, { type, now });
  $('metrics').replaceChildren(...cells.map(c => el('div', { className: 'dv-metric' }, el('span', { textContent: c.label }), el('strong', { textContent: c.value }),
      el('span', { className: `badge ${c.tone}`, textContent: c.verdict }), el('span', { className: 'dv-metric-was', textContent: `${c.was} · ${c.sample}` }))));
  $('metrics').hidden = false;
  $('judge-missing').hidden = data.judge_available;
  $('weeks-head').replaceChildren(...['Week of', 'Searches', ...METRICS.map(m => m.label)].map(h => el('th', { textContent: h })));
  const weeks = weekRows(turns, { type, now });
  $('weeks').replaceChildren(...weeks.map(w => el('tr', { className: w.current ? 'current' : '' }, cell('Week of', el('strong', { textContent: w.week_of })), cell('Searches', String(w.searches), 'num'),
    ...w.cells.map(c => cell(c.label, c.value, 'num')))));
  if (!weeks.length) $('weeks').append(el('tr', {}, el('td', { colSpan: METRICS.length + 2, className: 'dv-empty', textContent: 'No searches yet.' })));
  const a = agreement(turns);
  $('agreement').textContent = a.marked ? `You agreed with the judge on ${a.agree} of ${a.marked} marked turns (${Math.round(a.rate * 100)}%).` : 'Mark a few turns below to see how often you agree with the judge.';
  const scoped = type === 'all' ? turns : turns.filter(t => t.request_type === type);
  $('worst').replaceChildren(...worstTurns(scoped).map(t => turnLine(t)));
  if (!$('worst').children.length) $('worst').append(el('tr', {}, el('td', { colSpan: 8, className: 'dv-empty', textContent: 'Nothing to read: no judge failures, negative outcomes or failed searches.' })));
  $('definitions').replaceChildren(...METRICS.flatMap(m => [el('dt', { textContent: m.label }), el('dd', { textContent: m.explain })]));
  $('refreshed').textContent = refreshedAt ? `Refreshed ${ago(refreshedAt, now)}` : '';
}

function turnLine(t) {
  const r = turnRow(t, { senders: data.senders }), saved = Boolean(t.judged_at || t.verdict);
  const mark = verdict => el('button', { type: 'button', className: 'small quiet', ariaPressed: String(t.founder_verdict === verdict), disabled: !saved,
    title: saved ? '' : 'Available once the nightly judge has saved this turn', textContent: verdict === 'agree' ? 'Right' : 'Wrong',
    onclick: () => post({ action: 'judge-mark', operation: t.operation, conversation: t.conversation_id, verdict: t.founder_verdict === verdict ? null : verdict }, result => { t.founder_verdict = result.founder_verdict; render(); }) });
  const copy = el('button', { type: 'button', className: 'small quiet', textContent: 'Copy replay draft', disabled: !saved,
    onclick: () => post({ action: 'replay-draft', operation: t.operation, conversation: t.conversation_id }, async result => {
      try { await navigator.clipboard.writeText(JSON.stringify(result.draft, null, 2)); notice('Replay draft copied. Anonymise it before adding it to the repo.'); }
      catch { notice('Couldn’t copy to the clipboard. Allow clipboard access and try again.', true); }
    }) });
  return el('tr', {},
    cell('Date', el('a', { className: 'tester-link', href: r.href, textContent: r.date, title: 'Open this message in the conversation' })), cell('Tester', r.tester), cell('Type', r.type),
    cell('Result', r.result), cell('What happened next', r.labels || '—'),
    cell('Judge', el('span', { className: 'miss-summary' }, el('span', { className: `badge ${t.verdict === 'fail' ? 'fail' : t.verdict === 'pass' ? 'ok' : 'plain'}`, textContent: r.judge }),
      ...r.reasons.map(x => el('small', { textContent: `${x.label}: ${x.reason}` })))),
    cell('Judge right?', el('span', { className: 'badges' }, mark('agree'), mark('disagree'))), cell('Actions', copy));
}

function notice(text, error = false) { $('notice').className = error ? 'error' : ''; $('notice').textContent = text; }
async function post(body, done) {
  try { await done(await adminJson('/api/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })); }
  catch (error) { notice(`Couldn’t save that: ${error.message}`, true); }
}
async function load() {
  $('loader').hidden = false; notice('');
  try { data = await adminJson('/api/admin?view=scorecard'); refreshedAt = Date.now(); render(); }
  catch (error) { notice(`Could not load the scorecard: ${error.message} Try Refresh.`, true); }
  finally { $('loader').hidden = true; }
}
$('refresh').onclick = load;
setInterval(() => { if (refreshedAt) $('refreshed').textContent = `Refreshed ${ago(refreshedAt)}`; }, 30000);
load();
