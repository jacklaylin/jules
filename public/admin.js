import {mountAdminShell,adminJson,anchorMenus} from './admin-console.js';
import {browseKey} from './admin-review.js';
import {filterPeople,accessSegments,accessChange,accessResult,ago,countLine,metricCells,metricsNote,filterSignups,setupLines,setupResult} from './admin-people-view.js';
import {normalizeSignupPhone} from './signup-phone.js';
import {closeDialog} from './design-system.js';
// Admin › People: the list of testers as a data view. The name opens the person page; Status changes waitlist access in place.
// New signups lists signups with no conversation yet; Set up saves their Photon line and approves them.
mountAdminShell('people');
anchorMenus();
const $ = id => document.getElementById(id);
const el = (tag, props = {}, ...children) => { const node = Object.assign(document.createElement(tag), props); node.append(...children.filter(c => c !== null)); return node; };
const exact = at => new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
let signups = [], signupsFailed = '', view = new URLSearchParams(location.search).get('view') === 'signups' ? 'signups' : '';
let people = [], refreshedAt = null, loading = false, failed = '', accessFilter = '', waitlist = { allowance: 3, approvalText: null }, done = '';
const shownPeople = () => filterPeople(people, $('people-search').value, accessFilter);

function render() {
  const onSignups = view === 'signups';
  for (const button of $('people-views').querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.view === view));
  $('signups-count').textContent = signups.length || '';
  $('people').hidden = onSignups; $('signups').hidden = !onSignups; $('signups-note').hidden = !onSignups; $('people-keys').hidden = onSignups;
  $('people-search').placeholder = onSignups ? 'Search name or last 4 digits' : 'Search name or number';
  if (onSignups) return renderSignups();
  const segments = accessSegments(people);
  if (!segments.length) accessFilter = '';
  $('people-access').hidden = !segments.length;
  $('people-access').replaceChildren(...segments.map(([value, label, n]) => {
    const button = el('button', { type: 'button' }, label, el('span', { className: 'count', textContent: n }));
    button.setAttribute('aria-pressed', String(accessFilter === value));
    button.onclick = () => { accessFilter = value; render(); };
    return button;
  }));
  const shown = shownPeople();
  const head = el('div', { className: 'dv-head', ariaHidden: 'true' }, el('span', { textContent: 'Name' }), el('span', { textContent: 'Phone' }), el('span', { textContent: 'Status' }), el('span', { textContent: 'Source' }), el('span', { textContent: 'Last activity' }), el('span', { className: 'end' }));
  $('people').replaceChildren(head, ...shown.map(person => {
    const href = `/admin/people/${person.id}`;
    return el('div', { className: 'dv-row' },
      el('a', { className: 'person-link', href, ariaLabel: `Open ${person.name ? `${person.name}, ` : ''}${person.sender_id}` },
        person.name ? el('strong', { textContent: person.name }) : el('span', { className: 'muted', textContent: 'No name' }),
        el('span', { className: 'muted person-phone-sub', textContent: person.sender_id })),
      el('span', { className: 'person-phone', textContent: person.sender_id }),
      person.access ? statusControl(person) : el('span', { className: 'muted', textContent: '—' }),
      sourceCell(person),
      el('span', { className: 'muted', textContent: ago(person.updated_at), title: exact(person.updated_at) }),
      el('a', { className: 'end', href, tabIndex: -1, ariaHidden: 'true', textContent: 'Open →' }));
  }));
  if (!shown.length) $('people').append(el('p', { className: 'dv-empty', textContent: loading ? 'Loading…' : failed ? '' : !people.length ? 'No testers yet.' : accessFilter ? `No ${accessFilter} testers match.` : 'No testers match this search.' }));
  $('people-count').textContent = people.length || refreshedAt ? countLine(shown.length, people.length, refreshedAt) : '';
  $('notice').className = failed ? 'error' : '';
  $('notice').textContent = failed || done;
}

// ---------- New signups ----------
function renderSignups() {
  $('people-access').hidden = true;
  const shown = filterSignups(signups, $('people-search').value);
  const head = el('div', { className: 'dv-head', ariaHidden: 'true' }, el('span', { textContent: 'Name' }), el('span', { textContent: 'Phone' }), el('span', { textContent: 'Signed up' }), el('span', { className: 'end' }));
  $('signups').replaceChildren(head, ...shown.map(signup => el('div', { className: 'dv-row' },
    el('span', { className: 'signup-name' }, signup.name ? el('strong', { textContent: signup.name }) : el('span', { className: 'muted', textContent: 'No name' }),
      el('span', { className: 'muted signup-sub', textContent: `${signup.phone} · ${ago(signup.signed_up_at)}` })),
    el('span', { className: 'muted', textContent: signup.phone }),
    el('span', { className: 'muted', textContent: ago(signup.signed_up_at), title: exact(signup.signed_up_at) }),
    el('button', { type: 'button', className: 'small quiet', textContent: 'Set up', ariaLabel: `Set up ${signup.name ?? signup.phone}`, onclick: () => confirmSetup(signup) }))));
  if (!shown.length) $('signups').append(el('p', { className: 'dv-empty', textContent: loading ? 'Loading…' : signupsFailed ? '' : !signups.length ? 'Nobody is waiting to be set up.' : 'No signups match this search.' }));
  $('people-count').textContent = signups.length || refreshedAt ? `${shown.length === signups.length ? '' : `${shown.length} of `}${signups.length} ${signups.length === 1 ? 'signup' : 'signups'}` : '';
  $('notice').className = signupsFailed ? 'error' : '';
  $('notice').textContent = signupsFailed || done;
}
for (const button of $('people-views').querySelectorAll('button')) button.onclick = () => {
  view = button.dataset.view; const url = new URL(location.href);
  if (view) url.searchParams.set('view', view); else url.searchParams.delete('view');
  history.replaceState(null, '', url); render();
};
let setupPending = null;
function confirmSetup(signup) {
  setupPending = signup;
  $('setup-title').textContent = `Set up ${signup.name ?? 'this tester'}?`;
  $('setup-person').textContent = `${signup.name ? `${signup.name} · ` : ''}${signup.phone} · signed up ${ago(signup.signed_up_at)}`;
  $('setup-lines').replaceChildren(...setupLines(waitlist.approvalText, waitlist.approvalAccount).map(line => el('p', { textContent: line })));
  $('setup-confirm').textContent = waitlist.approvalText ? 'Set up and text them' : 'Set up';
  $('setup-line').value = ''; lineError(''); $('setup-error').hidden = true;
  $('setup-dialog').showModal(); $('setup-line').focus();
}
function lineError(message) {
  $('setup-line-error').textContent = message; $('setup-line-error').hidden = !message;
  if (message) $('setup-line').setAttribute('aria-invalid', 'true'); else $('setup-line').removeAttribute('aria-invalid');
}
$('setup-line').oninput = () => lineError('');
$('setup-cancel').onclick = () => closeDialog($('setup-dialog'));
$('setup-form').onsubmit = async event => {
  event.preventDefault();
  const line = normalizeSignupPhone($('setup-line').value);
  if (!line) { lineError('Enter the line Photon assigned them as a phone number, with + and the country code outside the US or Canada.'); $('setup-line').focus(); return; }
  const signup = setupPending, label = $('setup-confirm').textContent, buttons = [$('setup-confirm'), $('setup-cancel')];
  buttons.forEach(b => { b.disabled = true; }); $('setup-confirm').textContent = 'Setting up…'; $('setup-error').hidden = true;
  try {
    const data = await adminJson('/api/admin', { method: 'POST', body: JSON.stringify({ action: 'set-up', signup: signup.signup, line, confirm: true }) });
    done = `${signup.name ?? signup.phone}: ${setupResult(data)}`;
    signups = signups.filter(s => s !== signup);
    closeDialog($('setup-dialog')); render(); load();
  } catch (error) { $('setup-error').textContent = error.message; $('setup-error').hidden = false; }
  finally { buttons.forEach(b => { b.disabled = false; }); $('setup-confirm').textContent = label; }
};

// ---------- Waitlist status ----------
// A compact select per row; a change asks for confirmation (approving texts them) before anything is saved.
// Where a signup came from: the ?ref= code, or the person whose shared style report they signed up from.
function sourceCell(person) {
  const by = person.referred_by;
  if (by) return el('a', { className: 'muted', href: `/admin/people/${by.id}`, textContent: `${by.name ?? 'A tester'}’s report`, title: `Signed up from ${by.name ?? 'a tester'}’s shared style report` });
  // Otherwise the ?ref= code, else the site or utm_source they arrived from (db/041).
  const arrival = person.arrival, from = arrival && (arrival.utm_source ?? arrival.referrer_host);
  const details = arrival && [arrival.referrer_host && `from ${arrival.referrer_host}`, ...['utm_source', 'utm_medium', 'utm_campaign'].filter(k => arrival[k]).map(k => `${k}=${arrival[k]}`)].filter(Boolean).join(' · ');
  const title = person.source ? `Signed up from a ?ref=${person.source} link` : from ? 'Arrived ' + details : 'No source on their signup link';
  return el('span', { className: 'muted', textContent: person.source ?? from ?? 'Direct', title: person.source && details ? `${title} · arrived ${details}` : title });
}

function statusControl(person) {
  const select = el('select', { className: 'dv-select', ariaLabel: `Waitlist status for ${person.name ?? person.sender_id}` },
    el('option', { value: 'waitlisted', textContent: 'Waitlisted' }), el('option', { value: 'approved', textContent: 'Approved' }));
  select.value = person.access; select.dataset.access = person.access;
  select.onchange = () => { const to = select.value; select.value = person.access; confirmAccess(person, to); };
  return el('span', {}, select);
}
let pending = null;
function confirmAccess(person, to) {
  const change = accessChange(person, to, waitlist);
  pending = { person, to };
  $('access-title').textContent = change.title;
  $('access-person').textContent = person.name ? `${person.name} (${person.sender_id})` : person.sender_id;
  $('access-lines').replaceChildren(...change.lines.map(line => el('p', { textContent: line })));
  $('access-confirm').textContent = change.confirm; $('access-error').hidden = true;
  $('access-dialog').showModal();
}
$('access-cancel').onclick = () => closeDialog($('access-dialog'));
$('access-confirm').onclick = async () => {
  const { person, to } = pending, label = $('access-confirm').textContent, buttons = [$('access-confirm'), $('access-cancel')];
  buttons.forEach(b => { b.disabled = true; }); $('access-confirm').textContent = 'Saving…';
  try {
    const data = await adminJson('/api/admin', { method: 'POST', body: JSON.stringify({ action: to === 'approved' ? 'approve' : 'waitlist', conversation: person.id, confirm: true }) });
    Object.assign(person, { access: data.access?.access ?? to, waitlist_replies: data.access?.waitlist_replies ?? person.waitlist_replies });
    done = `${person.name ?? person.sender_id}: ${accessResult(to, data)}`;
    closeDialog($('access-dialog')); render();
  } catch (error) { $('access-error').textContent = error.message; $('access-error').hidden = false; }
  finally { buttons.forEach(b => { b.disabled = false; }); $('access-confirm').textContent = label; }
};

async function load() {
  loading = true; failed = ''; signupsFailed = ''; render();
  // The signup list is its own read: if it fails, Testers still loads.
  const pendingSignups = adminJson('/api/admin?view=signups').then(data => { signups = data.signups; }, error => { signupsFailed = `Could not load new signups: ${error.message} Try Refresh in More.`; });
  try { const data = await adminJson('/api/admin'); people = data.conversations; waitlist = { allowance: data.waitlist_replies ?? 3, approvalText: data.approval_text ?? null, approvalAccount: data.approval_account === true }; refreshedAt = Date.now(); }
  catch (error) { failed = `Could not load people: ${error.message} Try Refresh in More.`; }
  finally { await pendingSignups; loading = false; render(); }
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
  const rows = [...$('people').querySelectorAll('.person-link')], at = rows.indexOf(document.activeElement);
  rows[at < 0 ? (step > 0 ? 0 : rows.length - 1) : Math.min(rows.length - 1, Math.max(0, at + step))]?.focus();
}

// / searches, J/K move between rows; Enter on a focused row opens it because J/K focus each row's name link.
addEventListener('keydown', event => {
  const action = browseKey(event, { open: false, dialog: !!document.querySelector('dialog[open]'), menu: !!document.querySelector('.dv-pop:popover-open') });
  if (!action) return;
  event.preventDefault();
  if (action.type === 'search') $('people-search').focus();
  else if (action.type === 'row' && view !== 'signups') focusRow(action.step);
});
$('people-search').oninput = render;
$('refresh').onclick = () => { $('people-more').hidePopover(); load(); loadMetrics(); };
// Keep "refreshed 3 min ago" honest while the page sits open.
setInterval(() => { if (refreshedAt && view !== 'signups') $('people-count').textContent = countLine(shownPeople().length, people.length, refreshedAt); }, 30000);
load();
loadMetrics();
