import {mountAdminShell,adminJson,adminFetch,adminToken,anchorMenus,skeletonRows} from './admin-console.js';
import {readView,saveView} from './list-cache.js';
import {mountPurchases,loadPurchases,syncPurchaseView} from './admin-purchases.js';
import {browseKey} from './admin-review.js';
import {approvalLines,accessResult,welcomeResult} from './admin-people-view.js';
// Admin › People › one person: Summary, Knowledge, Conversation, Purchase history and Wishlist tabs.
// The selected tab lives in the URL (?tab=) so every view can be linked.
mountAdminShell('people');
anchorMenus();
const $ = id => document.getElementById(id);
const el = (tag, props = {}, ...children) => { const node = Object.assign(document.createElement(tag), props); node.append(...children.filter(c => c != null && c !== false)); return node; };
const badge = (kind, text) => el('span', { className: `badge ${kind}`, textContent: text });
const when = at => at ? new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'date unknown';
const day = at => at ? new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'date unknown';
const notice = text => { $('notice').textContent = text; };
const api = (path, options) => adminJson(path, options);
const TABS = ['summary', 'knowledge', 'conversation', 'purchases', 'wishlist'];
const person = location.pathname.split('/')[3] ?? '';
const valid = /^[0-9a-f-]{36}$/i.test(person);

// ---------- Loading ----------
// Each view is drawn first from what it showed on the last visit (list-cache.js: kept for the signed-in owner,
// forgotten on sign-out), then refreshed; fresh data that matches what is drawn is not drawn again, so nothing
// flashes. Only the open tab's views are requested; another tab's load when it is first opened. The header's
// messages and facts load for every tab.
const drawn = new Map(), status = new Map();
async function load(view, path, draw) {
  const token = await adminToken().catch(() => null);
  if (!drawn.has(view)) {
    const saved = readView(localStorage, person, view, token);
    if (saved) { drawn.set(view, JSON.stringify(saved.data)); status.set(view, { at: saved.at, state: 'refreshing' }); draw(saved.data); }
  }
  if (drawn.has(view)) status.set(view, { ...status.get(view), state: 'refreshing' });
  showUpdated();
  try {
    const data = await api(path), text = JSON.stringify(data);
    if (drawn.get(view) !== text) draw(data);
    drawn.set(view, text); status.set(view, { at: Date.now(), state: 'fresh' }); saveView(localStorage, person, view, token, data);
    return data;
  } catch (error) {
    // With something drawn, the page keeps it and says it could not refresh; with nothing, the caller shows the failure.
    if (!drawn.has(view)) throw error;
    status.set(view, { ...status.get(view), state: 'failed', error: error.message });
  } finally { showUpdated(); }
}
// The open tab's quiet line: when what is shown loaded, and whether it is being refreshed.
const TAB_VIEW = { summary: 'summary', knowledge: 'summary', conversation: 'messages', purchases: 'purchases', wishlist: 'wishlist' };
const since = at => { const m = Math.round((Date.now() - at) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `on ${day(at)}`; };
function showUpdated() {
  const s = status.get(TAB_VIEW[new URLSearchParams(location.search).get('tab')] ?? 'summary');
  $('person-updated').textContent = !s ? '' : s.state === 'fresh' ? `Updated ${new Date(s.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
    : s.state === 'failed' ? `Could not refresh (${s.error}). Showing what loaded ${since(s.at)}.` : `Showing what loaded ${since(s.at)} · refreshing…`;
}
// What each tab needs beyond the header; each view loads once here and again only when an action changes it.
const TAB_DATA = { summary: ['summary', 'adoption'], knowledge: ['summary'], conversation: [], purchases: ['purchases'], wishlist: ['wishlist'] };
const LOADERS = { summary: () => loadSummary(), adoption: () => loadAdoption(), purchases: () => loadPurchases(person), wishlist: () => loadWishlist() };
const started = new Set();
function loadTab(tab) {
  if (!valid) return;
  for (const name of TAB_DATA[tab] ?? []) if (!started.has(name)) { started.add(name); LOADERS[name](); }
}

function showTab(tab, push = false) {
  if (tab === 'memory') tab = 'knowledge'; // Personal memory became Knowledge (October 22); old links still work.
  if (!TABS.includes(tab)) tab = 'summary';
  for (const link of document.querySelectorAll('.tabs a')) { if (link.dataset.tab === tab) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); }
  for (const panel of document.querySelectorAll('[data-panel]')) panel.hidden = panel.dataset.panel !== tab;
  // On phones the tab strip scrolls sideways; keep the selected tab in view.
  const active = document.querySelector('.tabs a[aria-current]'), strip = active.parentElement;
  strip.scrollLeft = Math.max(0, active.offsetLeft - strip.offsetLeft - 16);
  // ?item= names the purchase under review and ?view= the Purchase history view; choosing a tab (push) returns it to its list.
  const url = new URL(location.href); url.searchParams.set('tab', tab); if (tab !== 'purchases' || push) { url.searchParams.delete('item'); url.searchParams.delete('view'); }
  if (push) history.pushState(null, '', url); else history.replaceState(null, '', url);
  syncPurchaseView();
  loadTab(tab); showUpdated();
}
for (const link of document.querySelectorAll('.tabs a')) link.onclick = event => { event.preventDefault(); showTab(link.dataset.tab, true); };
addEventListener('popstate', () => showTab(new URLSearchParams(location.search).get('tab')));
// The More menu is the same on every tab; an action that belongs to another tab (re-check, tag purchases) opens that
// tab first, so its progress and result show. Capture runs before the action's own click handler.
$('person-more').addEventListener('click', event => {
  const tab = event.target.closest('[data-opens-tab]')?.dataset.opensTab;
  if (tab && tab !== new URLSearchParams(location.search).get('tab')) showTab(tab, true);
}, true);

// ---------- Conversation ----------
let messages = [], cursor = null, imageURLs = [];
const SOURCES = { ai: 'Jules AI', greeting: 'Automatic greeting', ai_fallback: 'AI failed; fallback reply', operator: 'System message (alert or test)' };
const DELIVERY = { sent: 'Accepted by Photon', generating: 'AI preparing reply', sending: 'Send started', uncertain: 'Delivery uncertain', received: 'Received' };
function problems(message) {
  return [
    message.source === 'ai_fallback' && ['fail', 'AI failed'],
    message.status === 'uncertain' && ['warn', 'Delivery uncertain'],
    message.search_result && message.search_result.status !== 'found' && ['warn', 'Sourcing review needed'],
    message.image_status === 'failed' && ['fail', 'Image failed'],
    message.memory_status === 'failed' && ['fail', 'Memory update failed'],
  ].filter(Boolean);
}
function messageView(message) {
  const issues = problems(message), inbound = message.direction === 'inbound';
  const bubble = el('div', { className: 'bubble', textContent: message.body });
  for (const image of message.message_images ?? []) {
    const preview = el('img', { alt: 'Photo sent in this message', className: 'inspiration' });
    bubble.append(preview);
    adminToken().then(token => fetch(`/api/image?id=${encodeURIComponent(image.id)}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }))
      .then(async response => { if (!response.ok) throw new Error(); return response.blob(); })
      .then(blob => { if (!preview.isConnected) return; const url = URL.createObjectURL(blob); imageURLs.push(url); preview.src = url; })
      .catch(() => { if (preview.isConnected) preview.replaceWith(el('p', { className: 'muted', textContent: 'Image unavailable. Reload or sign in again.' })); });
  }
  const products = [];
  for (const product of message.search_result?.products ?? []) {
    try {
      const url = new URL(product.url); if (url.protocol !== 'https:') continue;
      products.push(el('a', { className: 'product-card', href: url.href, target: '_blank', rel: 'noopener noreferrer' },
        el('strong', { textContent: [product.brand, product.name].filter(Boolean).join(' ') || url.hostname }),
        el('span', { className: 'muted', textContent: url.hostname.replace(/^www\./, '') }),
        product.match === 'likely_match' ? badge('warn', 'Likely match; unconfirmed') : badge('plain', 'Similar alternative')));
    } catch {}
  }
  const details = el('details', { className: 'message-details' }, el('summary', { textContent: 'Details' }),
    el('dl', {}, el('dt', { textContent: 'Delivery' }), el('dd', { textContent: DELIVERY[message.status] ?? message.status ?? 'Received' }),
      !inbound && el('dt', { textContent: 'Reply' }), !inbound && el('dd', { textContent: SOURCES[message.source] ?? message.source ?? 'Unknown' }),
      message.search_result?.checked_at && el('dt', { textContent: 'Checks' }), message.search_result?.checked_at && el('dd', { textContent: `Search checked ${when(message.search_result.checked_at)}` }),
      message.developer_feedback != null && el('dt', { textContent: 'Feedback' }), message.developer_feedback != null && el('dd', { textContent: message.developer_feedback || 'Developer feedback' })));
  return el('article', { id: `message-${message.id}`, className: `message ${inbound ? 'inbound' : 'outbound'}${issues.some(([k]) => k === 'fail') ? ' failed' : ''}` },
    bubble, ...products,
    el('div', { className: 'message-meta' }, el('span', { className: 'muted', textContent: when(message.created_at) }), ...issues.map(([kind, text]) => badge(kind, text)),
      inbound && message.image_status === 'failed' && !message.message_images?.length && el('button', { type: 'button', className: 'small', textContent: 'Re-read photo…', onclick: () => openReread(message.id) }), details));
}
function renderMessages() {
  imageURLs.forEach(url => URL.revokeObjectURL(url)); imageURLs = [];
  const onlyProblems = $('convo-filter').value === 'problems';
  const shown = onlyProblems ? messages.filter(m => problems(m).length) : messages;
  $('messages').replaceChildren(...(shown.length ? shown.map(messageView) : [el('p', { className: 'dv-empty', textContent: onlyProblems ? 'No problems in the loaded messages.' : 'No messages yet.' })]));
  $('older').hidden = !cursor;
  const total = `${messages.length}${cursor ? '+' : ''}`;
  $('convo-count').textContent = onlyProblems ? `${shown.length} with problems, of ${total} loaded` : `${total} messages`;
  $('count-conversation').textContent = total; $('stat-messages').textContent = total;
  $('stat-active').textContent = messages.length ? when(messages.at(-1).created_at) : '—';
  const counts = {};
  for (const [kind, text] of messages.flatMap(problems)) counts[text] = { kind, n: (counts[text]?.n ?? 0) + 1 };
  const worst = Object.entries(counts).sort(([, a], [, b]) => (a.kind === 'fail' ? 0 : 1) - (b.kind === 'fail' ? 0 : 1)).slice(0, 2);
  $('person-badges').replaceChildren(...worst.map(([text, { kind, n }]) => badge(kind, n > 1 ? `${text} ×${n}` : text)));
}
// The latest page (cached first, with the header) or, with earlier, the page before the oldest loaded.
async function loadMessages(earlier = false) {
  const query = new URLSearchParams({ conversation: person });
  if (earlier && cursor) {
    query.set('before', JSON.stringify(cursor));
    const data = await api(`/api/admin?${query}`);
    messages = [...data.messages, ...messages]; cursor = data.before; renderMessages();
    return;
  }
  await load('messages', `/api/admin?${query}`, data => {
    showName(data.name, data.conversation.sender_id); showAccess(data.access?.access ?? null, data.approval_text ?? null, data.approval_account === true); showOnboarding(data.onboarding); resendText = data.resend_welcome ?? null; $('resend-welcome').hidden = !resendText; $('welcome-card').hidden = data.contact_card_enabled !== true;
    messages = data.messages; cursor = data.before; renderMessages();
  });
}
$('convo-filter').onchange = renderMessages;
$('older').onclick = async () => { $('older').disabled = true; try { await loadMessages(true); } catch (error) { notice(error.message); } finally { $('older').disabled = false; } };
async function openMessage(id) {
  showTab('conversation', true); $('convo-filter').value = 'all';
  try { while (!messages.some(m => m.id === id) && cursor) await loadMessages(true); } catch (error) { notice(error.message); }
  renderMessages();
  const target = document.getElementById(`message-${id}`);
  if (target) { target.classList.add('highlight'); target.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
}

// ---------- Summary ----------
// The name (signup, else told to Jules) as the title with the number beside it; the number alone when there's no name.
function showName(name, phone) {
  $('person-name').textContent = name || phone;
  $('person-phone').textContent = phone; $('person-phone').hidden = !name;
  document.title = `Jules admin · ${name || phone}`;
}
// One row per thing Jules weighs (lib/person-summary.js): coverage, a plain summary and where it came from.
// Said: they told Jules; Seen: counted from what they did; Inferred: Jules's own reading.
const STATUS_KIND = { known: 'ok', weak: 'warn', missing: 'fail' };
const KINDS = [['said', 'Said'], ['seen', 'Seen'], ['inferred', 'Inferred']];
const kindTag = (kind, label) => el('span', { className: `kind kind-${kind}` }, el('i', { ariaHidden: 'true' }), label);
function fromCell(row) {
  if (row.reading) return el('td', {}, kindTag('inferred', 'Inferred'), el('span', { className: 'muted', textContent: ` from ${row.from.said} said, ${row.from.seen} seen` }));
  const parts = KINDS.filter(([k]) => row.from[k]).map(([k, label]) => kindTag(k, `${label} ${row.from[k]}`));
  return el('td', {}, ...(parts.length ? parts.flatMap((part, i) => i ? [' · ', part] : [part]) : [el('span', { className: 'muted', textContent: '—' })]));
}
function summaryRow(row) {
  const status = row.status ? badge(STATUS_KIND[row.status], row.status[0].toUpperCase() + row.status.slice(1)) : el('span', { className: 'muted', textContent: '—' });
  return el('tr', {}, el('th', { scope: 'row', textContent: row.label }), el('td', {}, status),
    el('td', {}, row.summary ?? el('span', { className: 'muted', textContent: 'Nothing yet.' }), row.detail ? el('div', { className: 'muted summary-detail', textContent: row.detail }) : null),
    fromCell(row));
}
const TEXT_KIND = { early_read: 'Early read · thin profile', purchases: 'Purchase summary · rich profile', none: 'Nothing to send' };
// Summary and Knowledge come from one server read of what Jules knows (view=summary carries both). Calls made
// while one is in flight share it. Failures show in both tabs; it never rejects.
let summaryRead = null;
const loadSummary = () => summaryRead ??= load('summary', `/api/admin?view=summary&conversation=${encodeURIComponent(person)}`, data => {
  renderSummary(data); knowledge = data.knowledge; knowledgeReady = true; renderFacts();
}).catch(error => {
  summaryFailed(error); knowledgeReady = true; renderFacts();
  $('profile-notice').textContent = `Could not load what Jules derived from purchases, saves and likes: ${error.message}`;
}).finally(() => { summaryRead = null; });
function renderSummary(data) {
  const c = data.coverage;
  $('strip-coverage').textContent = `${{ rich: 'Rich', empty: 'Empty' }[c.level] ?? 'Thin'} · ${c.known} of ${c.total} known`;
  const open = data.rows.filter(r => ['silhouettes', 'palette'].includes(r.topic) && r.status !== 'known').map(r => r.label.toLowerCase());
  $('strip-coverage-note').textContent = c.level === 'rich' ? 'Silhouettes and palette known' : open.length ? `Rich needs ${open.join(' and ')} known` : `Rich needs 5 of ${c.total} known`;
  $('summary-rows').replaceChildren(...data.rows.map(summaryRow));
  $('summary-status').textContent = 'Profile loaded.';
  document.querySelector('.summary-profile').removeAttribute('aria-busy');
  const now = data.text_now;
  $('summary-text-kind').textContent = TEXT_KIND[now.kind]; $('summary-text-kind').hidden = false;
  $('summary-text').textContent = now.text ?? (now.kind === 'none' ? 'No import to summarise. The purchase summary goes out after a Gmail or Shop import.' : 'Nothing to say yet: no stated answers, orders, outfit photos or saved items.');
  $('summary-text').classList.toggle('muted', !now.text);
  $('summary-text-note').textContent = now.kind === 'early_read' && now.text ? 'Before Jules puts it in its own voice.' : now.open_questions ? `${now.open_questions} receipt question${now.open_questions === 1 ? '' : 's'} would follow it.` : '';
}
function summaryFailed(error) {
  $('summary-status').textContent = '';
  document.querySelector('.summary-profile').removeAttribute('aria-busy');
  $('summary-rows').replaceChildren(el('tr', {}, el('td', { colSpan: 4, className: 'error', textContent: `Could not load their profile: ${error.message}` })));
}
// Adoption and Chat quality (lib/person-adoption.js), loaded on their own so a failure leaves the profile as it is.
const WEEK_WORDS = { win: 'a win', asked: 'asked, nothing liked', quiet: 'quiet' };
const ENDING_WORDS = { positive: 'positive: saved, picked, clicked, asked to buy or reacted', neutral: 'refined or moved on', negative: 'turned down, missed or flagged', silent: 'no reply' };
const weekLabel = w => new Date(w.week_of + 'T12:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
const ago = at => { const days = Math.floor((Date.now() - Date.parse(at)) / 86400000); return days < 1 ? 'Today' : days === 1 ? 'Yesterday' : `${days} days ago`; };
const loadAdoption = () => load('adoption', `/api/admin?view=person-adoption&conversation=${encodeURIComponent(person)}`, renderAdoption).catch(adoptionFailed);
function renderAdoption(data) {
  $('strip-wins').textContent = `${data.wins} of the last 4`; $('adoption-wins').textContent = `${data.wins} of 4`;
  const last = data.last_positive;
  $('strip-last').textContent = last ? ago(last.at) : 'None yet';
  $('strip-last-note').textContent = last ? `${last.did}${last.products_shown ? ` of ${last.products_shown} shown` : ''}` : 'No request with a positive reaction in 8 weeks';
  $('adoption-weeks').replaceChildren(...data.weeks.map(w => el('span', { className: `week ${w.status}` }, el('i', { ariaHidden: 'true' }), w.current ? 'This week' : weekLabel(w))));
  $('adoption-weeks').setAttribute('aria-label', 'Last four weeks: ' + data.weeks.map(w => `${w.current ? 'this week' : weekLabel(w)} ${WEEK_WORDS[w.status]}`).join(', '));
  const r = data.requests, trend = r.started_per_week === r.before_per_week ? 'same as the 4 weeks before' : `${r.started_per_week > r.before_per_week ? 'up' : 'down'} from ${r.before_per_week}`;
  $('adoption-requests').textContent = `${r.started_per_week} a week`;
  $('adoption-requests-note').textContent = [trend, r.replies_to_jules ? `plus ${r.replies_to_jules} repl${r.replies_to_jules === 1 ? 'y' : 'ies'} to Jules’s texts` : null].filter(Boolean).join(' · ');
  $('adoption-cost').textContent = `$${data.lifetime_cost_usd.toFixed(2)}`;
  const q = data.quality;
  $('quality-share').textContent = q.requests ? `${Math.round(q.positive / q.requests * 100)}%` : '—';
  $('quality-label').textContent = q.requests ? 'of shopping requests got a positive reaction' : 'No settled shopping requests in the last 4 weeks';
  $('quality-count').textContent = q.requests ? `${q.positive} of ${q.requests}${q.waiting ? ` · ${q.waiting} waiting` : ''}` : '';
  const endings = Object.entries(q.endings).filter(([, n]) => n);
  // Widths through the style object: the CSP blocks inline style attributes.
  $('quality-bar').replaceChildren(...endings.map(([k, n]) => { const part = el('span', { className: `ending ${k}` }); part.style.flexGrow = String(n); return part; }));
  $('quality-bar').setAttribute('aria-label', q.requests ? `${q.requests} requests: ` + endings.map(([k, n]) => `${n} ${ENDING_WORDS[k].split(':')[0]}`).join(', ') : 'No settled requests');
  $('quality-bar').hidden = !q.requests;
  $('quality-legend').replaceChildren(...endings.map(([k, n]) => el('span', {}, el('i', { className: `ending-key ${k}`, ariaHidden: 'true' }), el('strong', { textContent: String(n) }), ` ${ENDING_WORDS[k]}`)));
  renderReport(data.report);
  for (const id of ['summary-adoption', 'summary-quality']) $(id).removeAttribute('aria-busy');
}
// Style report: opens, shares, friends opening the link, signups and votes (all time).
const CHANNEL_WORDS = { story: 'Story', download: 'download', copy: 'copy link', share_sheet: 'share sheet' };
const times = n => `${n} time${n === 1 ? '' : 's'}`;
function renderReport(r) {
  $('summary-report').removeAttribute('aria-busy');
  $('report-facts').hidden = $('report-foot').hidden = !r?.built;
  if (!r?.built) {
    $('report-opened').textContent = r?.error ? '—' : 'No report yet';
    $('report-opened-label').textContent = r?.error ? 'Could not load their report. Reload to try again.' : '';
    $('report-last').textContent = '';
    return;
  }
  $('report-opened').textContent = String(r.opened);
  $('report-opened-label').textContent = r.opened === 1 ? 'time they opened it' : 'times they opened it';
  $('report-last').textContent = r.last_opened_at ? `last ${day(r.last_opened_at)}` : '';
  const channels = Object.entries(r.channels).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${CHANNEL_WORDS[k] ?? k}`).join(' · ');
  const votes = r.votes.up + r.votes.down;
  const fact = (label, value, note) => [el('dt', {}, label, note ? el('small', { textContent: note }) : null), el('dd', { textContent: value })];
  $('report-facts').replaceChildren(
    ...fact('Started a share', times(r.shared), channels || null),
    ...fact('Friends opened', times(r.link_opened), r.share_link_at ? 'their shared link, first open per browser' : 'no share link yet'),
    ...fact('Signups from their links', String(r.signups), 'report and style card share the same link code'),
    ...fact('Votes on cards', votes ? `${r.votes.up} up · ${r.votes.down} down` : 'None yet', votes ? `${Math.round(r.votes.up / votes * 100)}% up, latest vote per card` : null));
  // Opens, shares and link opens were first recorded on October 22, 2026 (db/049); votes go back further.
  $('report-foot').textContent = [`Built ${day(r.built_at)}`, r.share_link_at ? `share link made ${day(r.share_link_at)}` : null, 'opens and share taps counted since Oct 22, 2026'].filter(Boolean).join(' · ');
}
function adoptionFailed(error) {
  for (const id of ['summary-adoption', 'summary-quality']) { $(id).removeAttribute('aria-busy'); }
  renderReport({ error: true });
  $('adoption-weeks').replaceChildren(el('p', { className: 'error', textContent: `Could not load their requests: ${error.message}` }));
  $('quality-label').textContent = 'Could not load their requests. Reload to try again.';
  $('strip-wins').textContent = '—'; $('strip-last').textContent = '—';
}
$('summary-ask').onclick = () => $('ask-style').click();
$('summary-learn').onclick = async () => {
  $('summary-learn').disabled = true; notice('Reading existing messages…');
  try { await changeProfile({ action: 'import' }); notice($('profile-notice').textContent); await loadSummary(); }
  catch (error) { notice(error.message); }
  finally { $('summary-learn').disabled = false; }
};

// ---------- Knowledge ----------
// Everything Jules knows in one table: the person's own facts (from /api/profile, editable in place) and one
// read-only row per derived source (lib/person-knowledge.js). Kind: Said (stated or confirmed), Inferred (Jules's
// reading, including facts it picked up without being told) or Seen (counted from what they did).
let profileVersion = 0, facts = [], profileBusy = false, knowledge = { rows: [], notes: {} }, kindFilter = '', sortBy = 'topic', sortDir = 1;
// Until their facts load the table shows placeholder rows; until the derived rows load, placeholders follow the facts.
let factsReady = false, knowledgeReady = false;
const dirty = new Map(), factKey = fact => `${fact.field}|${fact.key}`;
// Same shape check as lib/relevance.js sizeKeyShape: a size key is category/system[/brand].
const malformedSize = fact => { const parts = String(fact.key ?? '').split('/'); return fact.field === 'size' && !(parts.length >= 2 && parts.length <= 3 && parts.every(p => p.trim())); };
// Date-only values (2026-10-06) are calendar days: read at local noon so no time zone moves them a day.
const onDay = value => value ? (/^\d{4}-\d{2}-\d{2}$/.test(value) ? day(value + 'T12:00:00') : day(value)) : '';
// Every field a fact can have and how to enter it, from /api/profile (lib/memory.js FIELD_FORMS): the add form and
// the table's labels follow it, so a new field needs no change here.
let fieldForms = [];
const formOf = field => fieldForms.find(f => f.field === field);
const fieldLabel = field => formOf(field)?.label ?? label(field);
const TOPICS = ['Person', 'Sizes', 'Brands', 'Style', 'Budget and stores', 'Saved and liked', 'Other'];
const KIND_ORDER = { said: 0, inferred: 1, seen: 2 };
const label = text => String(text ?? '').replace(/_/g, ' ');
// What a fact is about, in words: "Bottoms · levis" for a size key, "Avoid · acne studios", "Clothing range".
function aboutOf(fact) {
  if (fact.field === 'size') { const [category, , brand] = String(fact.key).split('/'); return [label(category), brand].filter(Boolean).join(' · ') || fact.key; }
  if (['brand', 'store', 'retailer'].includes(fact.field)) return fact.key;
  if (fact.field === 'budget') { const [category, currency] = String(fact.key).split('/'); return `Budget · ${label(category)}${currency && currency !== 'unknown' ? ` (${currency.toUpperCase()})` : ''}`; }
  return fact.key === formOf(fact.field)?.key || ['identity', 'department', 'summary'].includes(fact.key) ? fieldLabel(fact.field) : `${fieldLabel(fact.field)} · ${label(fact.key)}`;
}
const sourceOf = fact => fact.source === 'signup' ? 'Signup form' : fact.source === 'operator' ? 'Owner edit' : fact.source === 'message' ? 'Chat' : 'Learned from messages';
function allRows() {
  const own = facts.filter(f => !f.deleted).map(f => {
    const note = knowledge.notes[factKey(f)] ?? {};
    return { id: 'fact:' + factKey(f), fact: f, topic: note.topic ?? formOf(f.field)?.topic ?? 'Other', about: aboutOf(f), value: f.value, kind: f.basis === 'inferred' ? 'inferred' : 'said',
      source: sourceOf(f), when: f.updated_at ?? null, weight: note.weight ?? null, seen: note.seen ?? null, needsLook: malformedSize(f) };
  });
  return [...own, ...knowledge.rows];
}
const weightValue = w => w === 'last' ? -1 : typeof w === 'number' ? w : -2;
function compare(a, b) {
  const by = { topic: () => TOPICS.indexOf(a.topic) - TOPICS.indexOf(b.topic), about: () => a.about.localeCompare(b.about), value: () => String(a.value ?? '').localeCompare(String(b.value ?? '')),
    weight: () => weightValue(a.weight) - weightValue(b.weight), kind: () => KIND_ORDER[a.kind] - KIND_ORDER[b.kind], source: () => a.source.localeCompare(b.source),
    when: () => (Date.parse(a.when ?? '') || 0) - (Date.parse(b.when ?? '') || 0) }[sortBy];
  // Ties: kind (said first), then the stronger brand, then name.
  return by() * sortDir || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || weightValue(b.weight) - weightValue(a.weight) || a.about.localeCompare(b.about);
}
// A brand's or store's weight as a small ring, full for their strongest in that topic (brands and stores score apart).
function weightCell(weight, top) {
  if (weight === 'last') return el('td', { className: 'muted knowledge-weight', textContent: 'Ranked last' });
  if (typeof weight !== 'number') return el('td');
  const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg'), ring = (stroke, dash) => {
    const c = document.createElementNS(ns, 'circle'); for (const [k, v] of Object.entries({ cx: 10, cy: 10, r: 8, fill: 'none', stroke, 'stroke-width': 3, ...(dash ? { 'stroke-dasharray': dash, 'stroke-linecap': 'round', transform: 'rotate(-90 10 10)' } : {}) })) c.setAttribute(k, v); return c; };
  const length = 2 * Math.PI * 8;
  for (const [k, v] of Object.entries({ width: 20, height: 20, viewBox: '0 0 20 20', 'aria-hidden': 'true' })) svg.setAttribute(k, v);
  svg.append(ring('var(--line)'), ring('var(--ink)', `${top ? (weight / top) * length : 0} ${length}`));
  return el('td', { className: 'knowledge-weight' }, el('span', { className: 'weight', title: `Weight ${weight}${top ? ` (their strongest is ${top})` : ''}` }, svg, el('strong', { textContent: String(weight) })));
}
function factRow(row, top) {
  const fact = row.fact, keyId = factKey(fact), input = el('input', { value: dirty.get(keyId) ?? fact.value, maxLength: 500 });
  input.setAttribute('aria-label', `${row.about}: what Jules knows`);
  const save = el('button', { type: 'button', className: 'small btn--butter', textContent: 'Save', hidden: !dirty.has(keyId) });
  const remove = el('button', { type: 'button', className: 'small quiet', textContent: 'Remove' });
  const quote = fact.evidence && fact.source === 'message' ? ` · “${fact.evidence}”` : '';
  const tr = el('tr', { className: dirty.has(keyId) ? 'dirty' : '' },
    el('td', { className: 'muted', textContent: row.topic }),
    el('th', { scope: 'row' }, row.about, row.needsLook ? el('span', { className: 'badge warn', title: 'Size keys need the item it is for: category/system[/brand]. Remove this and add the correct one.', textContent: 'Needs category' }) : null),
    el('td', {}, input, row.seen ? el('div', { className: 'muted knowledge-seen', textContent: `Seen: ${row.seen}` }) : null),
    weightCell(row.weight, top), el('td', {}, kindTag(row.kind, KIND_LABEL[row.kind])),
    el('td', { className: 'muted knowledge-source', title: row.source + quote }, el('div', { className: 'dv-clip' },
      fact.source_id ? el('button', { type: 'button', className: 'dv-cell-link', textContent: row.source, ariaLabel: `${row.source}: open the message in Conversation`, onclick: () => openMessage(fact.source_id) }) : row.source, quote)),
    el('td', { className: 'muted', textContent: onDay(row.when) }), el('td', { className: 'end knowledge-actions' }, save, remove));
  input.oninput = () => {
    if (input.value === fact.value) dirty.delete(keyId); else dirty.set(keyId, input.value);
    save.hidden = !dirty.has(keyId); tr.classList.toggle('dirty', dirty.has(keyId)); renderDirty();
  };
  save.onclick = () => changeProfile({ action: 'set', field: fact.field, key: fact.key, value: input.value }, keyId);
  remove.onclick = () => changeProfile({ action: 'remove', field: fact.field, key: fact.key, value: '' }, keyId);
  return tr;
}
const derivedRow = (row, top) => el('tr', { className: `derived kind-row-${row.kind}` },
  el('td', { className: 'muted', textContent: row.topic }), el('th', { scope: 'row', textContent: row.about }),
  el('td', {}, row.value ?? el('span', { className: 'muted', textContent: 'Not built yet' })), weightCell(row.weight, top),
  el('td', {}, kindTag(row.kind, KIND_LABEL[row.kind])), el('td', { className: 'muted knowledge-source', title: row.source }, el('div', { className: 'dv-clip', textContent: row.source })),
  el('td', { className: 'muted', textContent: onDay(row.when) }), el('td'));
const KIND_LABEL = { said: 'Said', seen: 'Seen', inferred: 'Inferred' };
function fillSelect(select, values, all) {
  const current = select.value;
  select.replaceChildren(el('option', { value: '', textContent: all }), ...values.map(v => el('option', { value: v, textContent: v })));
  select.value = values.includes(current) ? current : '';
}
// Kind chips (with counts), topic, source and search narrow the table; unsaved values survive filtering.
function renderFacts() {
  if (!factsReady) return;
  const rows = allRows(), live = facts.filter(f => !f.deleted);
  $('count-memory').textContent = knowledgeReady ? rows.length : ''; $('stat-facts').textContent = live.length;
  const counts = { '': rows.length, said: 0, seen: 0, inferred: 0, look: rows.filter(r => r.needsLook).length };
  for (const r of rows) counts[r.kind]++;
  if (kindFilter === 'look' && !counts.look) kindFilter = '';
  $('knowledge-kinds').replaceChildren(...[['', 'All'], ['said', 'Said'], ['seen', 'Seen'], ['inferred', 'Inferred'], ...(counts.look ? [['look', 'Needs a look']] : [])].map(([value, text]) => {
    const button = el('button', { type: 'button' }, ['said', 'seen', 'inferred'].includes(value) ? kindTag(value, text) : text, el('span', { className: 'count', textContent: knowledgeReady ? counts[value] : '' }));
    button.setAttribute('aria-pressed', String(kindFilter === value));
    button.onclick = () => { kindFilter = value; renderFacts(); };
    return button;
  }));
  fillSelect($('knowledge-topic'), TOPICS.filter(t => rows.some(r => r.topic === t)), 'All topics');
  fillSelect($('knowledge-source'), [...new Set(rows.map(r => r.source))].sort(), 'All sources');
  const q = $('knowledge-search').value.trim().toLowerCase(), topic = $('knowledge-topic').value, source = $('knowledge-source').value;
  const shown = rows.filter(r => (!kindFilter || (kindFilter === 'look' ? r.needsLook : r.kind === kindFilter)) && (!topic || r.topic === topic) && (!source || r.source === source)
    && (!q || [r.about, r.value, r.source, r.seen, r.fact?.evidence, r.fact && dirty.get(factKey(r.fact))].some(v => v && String(v).toLowerCase().includes(q)))).sort(compare);
  const tops = {};
  for (const r of rows) if (typeof r.weight === 'number') tops[r.topic] = Math.max(tops[r.topic] ?? 0, r.weight);
  for (const th of document.querySelectorAll('.knowledge-table th[aria-sort], .knowledge-table thead th')) th.removeAttribute('aria-sort');
  document.querySelector(`.knowledge-table [data-sort="${sortBy}"]`).parentElement.setAttribute('aria-sort', sortDir > 0 ? 'ascending' : 'descending');
  const empty = rows.length ? 'Nothing matches these filters.' : 'Jules knows nothing about them yet. Add what they said, or use More › Learn from existing messages.';
  const waiting = knowledgeReady ? [] : skeletonRows(3, 8);
  $('profile-facts').replaceChildren(...(shown.length ? shown.map(r => r.fact ? factRow(r, tops[r.topic]) : derivedRow(r, tops[r.topic])) : waiting.length ? [] : [el('tr', {}, el('td', { colSpan: 8, className: 'muted', textContent: empty }))]), ...waiting);
  renderDirty();
}
for (const button of document.querySelectorAll('.knowledge-table [data-sort]')) button.onclick = () => {
  if (sortBy === button.dataset.sort) sortDir = -sortDir; else { sortBy = button.dataset.sort; sortDir = ['weight', 'when'].includes(sortBy) ? -1 : 1; }
  renderFacts();
};
$('knowledge-topic').onchange = renderFacts; $('knowledge-source').onchange = renderFacts;
function renderDirty() {
  const n = [...dirty.keys()].filter(k => facts.some(f => !f.deleted && factKey(f) === k)).length;
  $('memory-dirty').hidden = !n; $('memory-dirty').textContent = `${n} unsaved edit${n === 1 ? '' : 's'}`;
}
async function loadProfile() {
  await load('profile', `/api/profile?conversation=${encodeURIComponent(person)}`, data => {
    profileVersion = data.version; facts = data.facts; factsReady = true;
    if (data.fields) { fieldForms = data.fields; renderFieldOptions(); }
    $('memory-conflict').hidden = true;
    renderFacts();
  });
}
async function changeProfile(change, keyId) {
  if (profileBusy) return;
  profileBusy = true;
  const buttons = [...$('tab-knowledge').querySelectorAll('button')]; buttons.forEach(b => { b.disabled = true; });
  $('profile-notice').textContent = change.action === 'import' ? 'Reading existing messages…' : 'Saving…';
  try {
    const response = await adminFetch('/api/profile', { method: 'POST', body: JSON.stringify({ conversation: person, version: profileVersion, ...change }) });
    const data = await response.json().catch(() => ({}));
    if (response.status === 409) { $('memory-conflict').hidden = false; $('profile-notice').textContent = ''; return; }
    if (!response.ok) throw new Error(data.error ?? 'Could not save.');
    if (keyId) dirty.delete(keyId);
    profileVersion = data.version; facts = data.facts;
    loadSummary();
    $('profile-notice').textContent = data.limited ? 'Learned from the latest 100 incoming messages. Earlier history was not included.' : change.action === 'remove' ? 'Removed. Add it again below to restore it.' : 'Saved.';
    if (change.action === 'set' && !keyId) { $('profile-add').reset(); syncFactForm(); showAddFact(false); }
  } catch (error) { $('profile-notice').textContent = error.message; }
  finally { profileBusy = false; buttons.forEach(b => { b.disabled = false; }); renderFacts(); }
}
const reloadProfile = () => loadProfile().then(() => { $('profile-notice').textContent = dirty.size ? 'Reloaded. Your unsaved values are kept; save them again.' : 'Reloaded.'; }).catch(error => { $('profile-notice').textContent = error.message; });
$('conflict-reload').onclick = reloadProfile;
$('profile-import').onclick = () => changeProfile({ action: 'import' });
$('knowledge-search').addEventListener('input', renderFacts);
// The add form's type list, and for the chosen type its key (fixed, a short list, or a hint) and its values.
function renderFieldOptions() {
  const select = $('fact-field'), current = select.value;
  select.replaceChildren(...fieldForms.map(f => el('option', { value: f.field, textContent: f.label })));
  if (formOf(current)) select.value = current;
  syncFactForm();
}
function syncFactForm() {
  const form = formOf($('fact-field').value), key = $('fact-key'), value = $('fact-value');
  if (!form) return;
  if (form.key) key.value = form.key; else if (key.readOnly) key.value = '';
  key.readOnly = Boolean(form.key);
  key.placeholder = form.key ?? (form.keys ? form.keys.join(' or ') : form.key_hint);
  value.placeholder = form.values ? form.values.join(', ') : form.value_hint;
  $('fact-keys').replaceChildren(...(form.keys ?? []).map(k => el('option', { value: k })));
  $('fact-values').replaceChildren(...(form.values ?? []).map(v => el('option', { value: v })));
  $('fact-hint').textContent = [form.key ? null : `Key: ${form.keys ? `one of ${form.keys.join(', ')}` : form.key_hint}`, `Value: ${form.values ? `one of ${form.values.join(', ')}` : form.value_hint}`].filter(Boolean).join(' · ');
}
$('fact-field').onchange = syncFactForm;
function showAddFact(open) {
  $('tool-add-fact').hidden = !open; $('memory-add-open').setAttribute('aria-expanded', String(open));
  if (open) $('fact-field').focus();
}
$('memory-add-open').onclick = () => showAddFact($('tool-add-fact').hidden);
$('memory-add-close').onclick = () => showAddFact(false);
// "/" searches the open tab's list (Purchase history handles its own keys).
addEventListener('keydown', event => {
  if ($('tab-knowledge').hidden || document.querySelector('dialog[open], .dv-pop:popover-open')) return;
  if (browseKey(event, { open: false })?.type === 'search') { event.preventDefault(); $('knowledge-search').focus(); }
});
$('profile-add').onsubmit = event => { event.preventDefault(); changeProfile({ action: 'set', field: $('fact-field').value, key: $('fact-key').value, value: $('fact-value').value }); };

// ---------- Wishlist ----------
let wishlist = null;
const money = price => new Intl.NumberFormat(undefined, { style: 'currency', currency: price.currency }).format(price.amount);
function alertBadge(alert) {
  if (!alert) return badge('plain', 'No price alert');
  if (!alert.active) return badge('plain', 'Alert off');
  const low = alert.low_stock, check = alert.low_stock_check;
  return el('span', {}, badge('ok', `Alert on${alert.size ? ` · ${alert.size}` : ''}`),
    low ? badge('warn', `Only ${low.quantity} left · ${low.store}${low.fresh ? '' : ' (old)'}`) : null,
    alert.low_stock_alerts === false ? badge('plain', 'Low-stock texts off') : null,
    check ? el('span', { className: 'muted', textContent: ` low stock: ${check.reason.replaceAll('_', ' ')}${check.would_send ? ' · would text' : ''}` }) : null);
}
function storeLinks(item) {
  return el('ul', { className: 'store-links' }, ...item.links.map(link => el('li', {},
    el('a', { href: link.url, target: '_blank', rel: 'noopener noreferrer', textContent: link.retailer }),
    link.price ? el('span', { className: 'mono-label', textContent: ` ${money(link.price)}` }) : el('span', { className: 'muted', textContent: ' price unverified' }),
    link.verification_status === 'unverified' ? badge('warn', 'Unverified link') : null)));
}
function testForm(item) {
  const alert = item.price_alert, ref = alert.baselines[0];
  const form = el('form', { className: 'alert-test' });
  const field = (label, input) => el('label', {}, label, input);
  const storeSelect = el('select', { required: true }, ...alert.links.map(url => el('option', { value: url, textContent: new URL(url).hostname.replace(/^www\./, '') })));
  const size = el('input', { required: true, maxLength: 80, value: alert.size ?? '' });
  const price = el('input', { type: 'number', min: '0.01', step: '0.01', required: true, placeholder: ref ? `Reference ${ref.amount}` : '' });
  const currency = el('input', { required: true, maxLength: 3, pattern: '[A-Z]{3}', value: ref?.currency ?? 'USD' });
  const shipping = el('input', { type: 'number', min: '0', step: '0.01' });
  const available = el('input', { type: 'checkbox', checked: true });
  const quantity = el('input', { type: 'number', min: '0', max: '999', step: '1', placeholder: 'Not stated' });
  const episode = el('select', {}, el('option', { value: '', textContent: 'As last recorded' }), el('option', { value: 'none', textContent: 'None open' }), el('option', { value: 'open', textContent: 'Already open (texted)' }));
  const previous = el('select', {}, el('option', { value: '', textContent: 'As last recorded' }), el('option', { value: 'sold_out', textContent: 'Sold out (rehearse a restock)' }), el('option', { value: 'in_stock', textContent: 'In stock' }));
  const result = el('pre', { className: 'alert-result', role: 'status' });
  const preview = el('button', { type: 'submit', className: 'small', textContent: 'Preview message' });
  const send = el('button', { type: 'button', className: 'small btn--butter', textContent: 'Send test text', disabled: !wishlist.test_delivery });
  form.append(
    el('p', { className: 'muted', textContent: `Runs the real alert decision on a made-up price. Nothing is saved. Reference: ${alert.baselines.map(b => money(b)).join(', ') || 'none yet'} · last stock: ${(alert.stock ?? 'unknown').replace('_', ' ')}.` }),
    el('div', { className: 'add-fact-fields' }, field('Store', storeSelect), field('Size', size), field('Price', price), field('Currency', currency), field('Listed shipping (optional)', shipping), field('Previous stock', previous), field('Stated left in size (optional)', quantity), field('Low-stock episode', episode)),
    el('label', { className: 'check' }, available, 'Size in stock'),
    el('div', { className: 'toolbar' }, preview, send, !wishlist.test_delivery && el('span', { className: 'muted', textContent: 'Test texts only go to the designated test account.' })),
    result);
  const run = async deliver => {
    if (!form.reportValidity()) return;
    [preview, send].forEach(b => { b.disabled = true; }); result.textContent = deliver ? 'Sending test text…' : 'Running…';
    try {
      const data = await api('/api/price-checks', { method: 'POST', body: JSON.stringify({ alert_id: alert.id, deliver, previous_stock: previous.value || undefined, low_stock_episode: episode.value || undefined,
        offers: [{ url: storeSelect.value, size: size.value, amount: Number(price.value), currency: currency.value.toUpperCase(), available: available.checked, ...(shipping.value ? { shipping: Number(shipping.value) } : {}), ...(quantity.value ? { quantity: Number(quantity.value) } : {}) }] }) });
      result.textContent = `Outcome: ${data.status}${data.event ? ` (${data.event})` : ''}${data.delivery ? ` · Delivery: ${data.delivery}` : ''}\n\n${data.message ?? 'No text would be sent.'}${data.low_stock ? `\n\nLow stock: ${data.low_stock.state} (${data.low_stock.reason.replaceAll('_', ' ')})${data.low_stock.combined ? ' · included in the text above' : ''}` : ''}`;
    } catch (error) { result.textContent = error.message; }
    finally { preview.disabled = false; send.disabled = !wishlist.test_delivery; }
  };
  form.onsubmit = event => { event.preventDefault(); run(false); };
  send.onclick = () => run(true);
  return form;
}
function renderWishlist() {
  const items = wishlist.items;
  $('count-wishlist').textContent = items.length;
  $('wishlist-note').textContent = !wishlist.alerts_enabled ? 'Price alerts are turned off in this deployment, so alert status and tests are unavailable.'
    : wishlist.test_delivery ? 'This is the designated test account: Test alert can send a labelled test text.' : 'Test alert previews the message an alert would send. Test texts only go to the designated test account.';
  $('wishlist-list').replaceChildren(...(items.length ? items.map(item => {
    const test = item.price_alert && wishlist.alerts_enabled ? el('button', { type: 'button', className: 'small', textContent: 'Test alert', ariaExpanded: 'false' }) : null;
    const panel = el('div', { className: 'alert-panel', hidden: true });
    if (test) test.onclick = () => { const open = panel.hidden; panel.hidden = !open; test.setAttribute('aria-expanded', String(open)); if (open && !panel.firstChild) panel.append(testForm(item)); };
    return el('article', { className: 'wish-item' },
      el('div', { className: 'wish-head' }, el('div', {}, el('strong', { textContent: item.name ?? 'Saved item' }), el('p', { className: 'muted', textContent: `Saved ${day(item.sent_at)}` })),
        el('div', { className: 'badges' }, wishlist.alerts_enabled ? alertBadge(item.price_alert) : null, test)),
      item.links.length ? storeLinks(item) : el('p', { className: 'muted', textContent: 'No store links saved.' }), panel);
  }) : [el('p', { className: 'dv-empty', textContent: 'Nothing saved to this wishlist yet.' })]));
}
const loadWishlist = () => load('wishlist', `/api/admin?view=wishlist&conversation=${encodeURIComponent(person)}`, data => { wishlist = data; renderWishlist(); })
  .catch(error => { $('wishlist-list').replaceChildren(); $('wishlist-note').textContent = error.message; });

// ---------- Onboarding ----------
// Beside the name: a "Not now" tap on /onboarding and the one reminder text (db/046), when either happened.
const REMINDER = { sent: ['ok', 'Reminder sent'], uncertain: ['warn', 'Reminder uncertain'], blocked: ['plain', 'Reminder blocked (opted out)'], sending: ['warn', 'Reminder sending'] };
function showOnboarding(onboarding) {
  const [kind, label] = REMINDER[onboarding?.reminder?.status] ?? ['plain', 'Reminder'];
  const badges = [onboarding?.not_now_at && badge('plain', `Tapped Not now · ${when(onboarding.not_now_at)}`), onboarding?.reminder && badge(kind, `${label} · ${when(onboarding.reminder.at)}`)].filter(Boolean);
  $('person-onboarding').hidden = !badges.length; $('person-onboarding').replaceChildren(...badges);
}

// ---------- Waitlist ----------
// Status beside the name (none before db/035 runs); Approve shows only while they are waitlisted.
let approvalText = null, approvalAccount = false;
function showAccess(access, text, account = false) {
  approvalText = text; approvalAccount = account;
  $('person-access').hidden = !access;
  $('person-access').replaceChildren(...(access ? [badge(access === 'waitlisted' ? 'warn' : 'ok', access === 'waitlisted' ? 'Waitlisted' : 'Approved')] : []));
  $('approve-person').hidden = access !== 'waitlisted';
}
$('approve-person').onclick = () => {
  $('approve-person-name').textContent = $('person-name').textContent; $('approve-error').hidden = true;
  $('approve-text-note').replaceChildren(...approvalLines(approvalText, approvalAccount).slice(1).map(line => el('p', { textContent: line })));
  $('approve-dialog').showModal();
};
$('approve-cancel').onclick = () => $('approve-dialog').close();
$('approve-confirm').onclick = async () => {
  const buttons = [$('approve-confirm'), $('approve-cancel')]; buttons.forEach(b => { b.disabled = true; }); $('approve-confirm').textContent = 'Approving…';
  try {
    const data = await api('/api/admin', { method: 'POST', body: JSON.stringify({ action: 'approve', conversation: person, confirm: true }) });
    $('approve-dialog').close();
    showAccess(data.access?.access ?? 'approved', null);
    notice(accessResult('approved', data));
    loadMessages().catch(error => notice(`Conversation: ${error.message}`));
  } catch (error) { $('approve-error').textContent = error.message; $('approve-error').hidden = false; }
  finally { buttons.forEach(b => { b.disabled = false; }); $('approve-confirm').textContent = 'Approve'; }
};
// ---------- Resend welcome ----------
// Texts the onboarding welcome again (e.g. the first ended "may not have been delivered"); offered only while they're onboarding.
let resendText = null;
$('resend-welcome').onclick = () => { $('welcome-person').textContent = $('person-name').textContent; $('welcome-text').textContent = `“${resendText}”`; $('welcome-error').hidden = true; $('welcome-dialog').showModal(); };
$('welcome-cancel').onclick = () => $('welcome-dialog').close();
$('welcome-confirm').onclick = async () => {
  const buttons = [$('welcome-confirm'), $('welcome-cancel')]; buttons.forEach(b => { b.disabled = true; }); $('welcome-confirm').textContent = 'Sending…';
  try {
    const data = await api('/api/admin', { method: 'POST', body: JSON.stringify({ action: 'resend-welcome', conversation: person, confirm: true }) });
    $('welcome-dialog').close();
    notice(welcomeResult(data));
    loadMessages().catch(error => notice(`Conversation: ${error.message}`));
  } catch (error) { $('welcome-error').textContent = error.message; $('welcome-error').hidden = false; }
  finally { buttons.forEach(b => { b.disabled = false; }); $('welcome-confirm').textContent = 'Resend'; }
};
// ---------- Contact card ----------
// Re-sends the welcome's contact card on its own, without resetting onboarding or imported history.
$('contact-card').onclick = () => { $('card-person').textContent = $('person-name').textContent; $('card-error').hidden = true; $('card-dialog').showModal(); };
$('card-cancel').onclick = () => $('card-dialog').close();
$('card-confirm').onclick = async () => {
  const buttons = [$('card-confirm'), $('card-cancel')]; buttons.forEach(b => { b.disabled = true; }); $('card-confirm').textContent = 'Sending…';
  try {
    const data = await api('/api/admin', { method: 'POST', body: JSON.stringify({ action: 'send-contact-card', conversation: person, confirm: true }) });
    $('card-dialog').close();
    notice(data.contact_card === 'sent' ? 'Contact card sent.' : `Contact card not confirmed (${data.contact_card}); check their phone before sending again.`);
    loadMessages().catch(error => notice(`Conversation: ${error.message}`));
  } catch (error) { $('card-error').textContent = error.message; $('card-error').hidden = false; }
  finally { buttons.forEach(b => { b.disabled = false; }); $('card-confirm').textContent = 'Send'; }
};
// ---------- Style questions ----------
// Starts the gap-filling interview (lib/interview.js) for this person; the server refuses with the reason when it shouldn't.
$('ask-style').onclick = () => { $('ask-person').textContent = $('person-name').textContent; $('ask-error').hidden = true; $('ask-dialog').showModal(); };
$('ask-cancel').onclick = () => $('ask-dialog').close();
$('ask-confirm').onclick = async () => {
  const buttons = [$('ask-confirm'), $('ask-cancel')]; buttons.forEach(b => { b.disabled = true; }); $('ask-confirm').textContent = 'Sending…';
  try {
    const { interview } = await api('/api/admin', { method: 'POST', body: JSON.stringify({ action: 'start-interview', conversation: person, confirm: true }) });
    $('ask-dialog').close();
    notice(interview.status === 'sent' ? 'First style question sent. Their replies will show in Conversation.' : `Style question not confirmed (${interview.status}); check Conversation before sending again.`);
    loadMessages().catch(error => notice(`Conversation: ${error.message}`));
    loadSummary();
  } catch (error) { $('ask-error').textContent = error.message; $('ask-error').hidden = false; }
  finally { buttons.forEach(b => { b.disabled = false; }); $('ask-confirm').textContent = 'Send'; }
};
// ---------- Purchase nudges ----------
// The decision log for unprompted texts (lib/nudges.js) and, for the designated test conversation only, a
// test "goes with" offer about a chosen wardrobe item. Nothing is reset; a test can be sent again.
const NUDGE_REASONS = { quiet_hours: 'quiet hours', ignored_backoff: 'paused: last 2 went unanswered', daily_cap: 'already texted today', weekly_cap: '3 this week already', price_alert_today: 'price alert went out today',
  mid_conversation: 'mid-conversation', opted_out: 'texted STOP', texts_off: 'purchase texts off', not_clothing: 'not clothing', not_worth_a_text: 'model: not worth an offer', nothing_recent: 'nothing recent',
  accepted: 'said yes', declined: 'said no', not_now: 'not now', unrelated: 'replied about something else', stopped: 'turned purchase texts off' };
const NUDGE_KINDS = { goes_with: 'Goes with', fit_check: 'Fit check' };
let nudgeItems = [];
function renderNudges(data) {
  $('nudge-setting').textContent = `Texts about purchases are ${data.texts_on ? 'on' : 'off'} · time zone ${data.timezone ?? 'unknown (noon–8pm Eastern only)'}`;
  $('nudge-test').hidden = !data.test_delivery || !data.candidates.length; $('nudge-confirm').hidden = $('nudge-test').hidden;
  $('nudge-no-test').hidden = data.test_delivery;
  if (data.test_delivery && !data.candidates.length) { $('nudge-no-test').hidden = false; $('nudge-no-test').textContent = 'No clothing or accessories in their wardrobe yet.'; }
  nudgeItems = data.candidates;
  $('nudge-item').replaceChildren(...data.candidates.map(i => el('option', { value: i.id, textContent: `${i.name}${i.merchant ? ` · ${i.merchant}` : ''}${i.bought_at ? ` · ${i.bought_at.slice(0, 10)}` : ''}` })));
  $('nudge-draft').textContent = nudgeItems[0] ? `Draft: ${nudgeItems[0].draft}` : '';
  $('nudge-log').replaceChildren(...(data.log.length ? data.log.map(e => el('li', { textContent: `${e.at.slice(0, 16).replace('T', ' ')} UTC · ${NUDGE_KINDS[e.kind] ?? e.kind} · ${e.status}${e.reason ? ` (${NUDGE_REASONS[e.reason] ?? e.reason})` : ''}${e.test ? ' · test' : ''}` }))
    : [el('li', { className: 'muted', textContent: 'No nudge decisions yet.' })]));
}
$('nudge-item').onchange = () => { const item = nudgeItems.find(i => i.id === $('nudge-item').value); $('nudge-draft').textContent = item ? `Draft: ${item.draft}` : ''; };
$('nudges').onclick = async () => {
  $('nudge-person').textContent = $('person-name').textContent; $('nudge-error').hidden = true;
  $('nudge-log').replaceChildren(...skeletonRows(2).map(row => el('li', {}, row))); $('nudge-test').hidden = true; $('nudge-confirm').hidden = true; $('nudge-no-test').hidden = true;
  $('nudge-dialog').showModal();
  try { renderNudges(await api(`/api/admin?conversation=${person}&view=nudges`)); }
  catch (error) { $('nudge-error').textContent = error.message; $('nudge-error').hidden = false; }
};
$('nudge-cancel').onclick = () => $('nudge-dialog').close();
$('nudge-confirm').onclick = async () => {
  const buttons = [$('nudge-confirm'), $('nudge-cancel')]; buttons.forEach(b => { b.disabled = true; }); $('nudge-confirm').textContent = 'Sending…'; $('nudge-error').hidden = true;
  try {
    const data = await api('/api/admin', { method: 'POST', body: JSON.stringify({ action: 'send-test-nudge', conversation: person, item: $('nudge-item').value, confirm: true }) });
    renderNudges(data);
    notice(data.nudge.status === 'sent' ? `Test nudge about ${data.nudge.item} sent.` : `Test nudge not confirmed (${data.nudge.status}); check Conversation before sending again.`);
    loadMessages().catch(error => notice(`Conversation: ${error.message}`));
  } catch (error) { $('nudge-error').textContent = error.message; $('nudge-error').hidden = false; }
  finally { buttons.forEach(b => { b.disabled = false; }); $('nudge-confirm').textContent = 'Send test nudge'; }
};
// ---------- Re-read a failed photo ----------
// Reads the photo again from Photon (recompressing a large screenshot) and saves it to that message; no text is sent.
let rereadMessage = null;
function openReread(id) { rereadMessage = id; $('reread-error').hidden = true; $('reread-dialog').showModal(); }
$('reread-cancel').onclick = () => $('reread-dialog').close();
$('reread-confirm').onclick = async () => {
  const buttons = [$('reread-confirm'), $('reread-cancel')]; buttons.forEach(b => { b.disabled = true; }); $('reread-confirm').textContent = 'Reading…';
  try {
    const { image } = await api('/api/admin', { method: 'POST', body: JSON.stringify({ action: 'reread-image', conversation: person, message: rereadMessage, confirm: true }) });
    if (image.status === 'failed') throw new Error(`Still couldn’t read it (${image.reason}).`);
    $('reread-dialog').close();
    notice(image.status === 'saved' ? `Photo saved (${image.count}). Jules sees it from their next message.` : 'This photo was already saved.');
    loadMessages().catch(error => notice(`Conversation: ${error.message}`));
  } catch (error) { $('reread-error').textContent = error.message; $('reread-error').hidden = false; }
  finally { buttons.forEach(b => { b.disabled = false; }); $('reread-confirm').textContent = 'Re-read'; }
};
// ---------- Reset onboarding ----------
// Owner re-test of signup and onboarding with an existing number; the dialog lists what is removed.
$('reset-onboarding').onclick = () => { $('reset-person').textContent = $('person-name').textContent; $('reset-error').hidden = true; $('reset-dialog').showModal(); };
$('reset-cancel').onclick = () => $('reset-dialog').close();
$('reset-confirm').onclick = async () => {
  const buttons = [$('reset-confirm'), $('reset-cancel')]; buttons.forEach(b => { b.disabled = true; }); $('reset-confirm').textContent = 'Resetting…';
  try {
    const data = await api('/api/admin', { method: 'POST', body: JSON.stringify({ action: 'reset-onboarding', conversation: person, confirm: true }) });
    $('reset-dialog').close();
    const texts = `${data.texts_removed} onboarding text${data.texts_removed === 1 ? '' : 's'} removed`;
    notice(`Onboarding reset. ${texts}; ${data.history === 'cleared' ? 'imported history deleted and Gmail and Shop disconnected' : 'there was no imported history'}. Sign up again with this number to start over.`);
    // Everything the reset could change, for the tabs already loaded.
    loadMessages().catch(error => notice(`Conversation: ${error.message}`)); loadProfile().catch(() => {});
    for (const name of started) LOADERS[name]();
  } catch (error) { $('reset-error').textContent = error.message; $('reset-error').hidden = false; }
  finally { buttons.forEach(b => { b.disabled = false; }); $('reset-confirm').textContent = 'Reset onboarding'; }
};

// ---------- Start ----------
if (!valid) { showTab(new URLSearchParams(location.search).get('tab')); $('person-name').textContent = 'Person not found'; notice('This link does not name a person. Go back to People.'); }
else {
  mountPurchases(api, load);
  // Placeholders until the first data (or the last visit's copy) is drawn.
  $('summary-rows').replaceChildren(...skeletonRows(8, 4)); $('profile-facts').replaceChildren(...skeletonRows(6, 8));
  $('messages').replaceChildren(...skeletonRows(5)); $('wishlist-list').replaceChildren(...skeletonRows(3));
  // The open tab's data (showTab), and the header's messages and facts.
  showTab(new URLSearchParams(location.search).get('tab'));
  const fail = area => error => { notice(`${area}: ${error.message}`); };
  // ?message=<id> (linked from Admin › Adoption's misses) opens the conversation at that message.
  const linked = new URLSearchParams(location.search).get('message');
  loadMessages().then(() => { if (/^[0-9a-f-]{36}$/i.test(linked ?? '')) return openMessage(linked); }).catch(error => { $('messages').replaceChildren(); fail('Conversation')(error); });
  loadProfile().catch(error => { factsReady = true; renderFacts(); fail('Memory')(error); });
}
