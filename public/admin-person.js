import {mountAdminShell,adminJson,adminFetch,adminToken,anchorMenus} from './admin-console.js';
import {mountPurchases,loadPurchases,syncPurchaseView} from './admin-purchases.js';
import {browseKey} from './admin-review.js';
// Admin › People › one person: Personal memory, Conversation, Purchase history and Wishlist tabs.
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
const TABS = ['memory', 'conversation', 'purchases', 'wishlist'];
const person = location.pathname.split('/')[3] ?? '';

function showTab(tab, push = false) {
  if (!TABS.includes(tab)) tab = 'memory';
  for (const link of document.querySelectorAll('.tabs a')) { if (link.dataset.tab === tab) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); }
  for (const panel of document.querySelectorAll('[data-panel]')) panel.hidden = panel.dataset.panel !== tab;
  // On phones the tab strip scrolls sideways; keep the selected tab in view.
  const active = document.querySelector('.tabs a[aria-current]'), strip = active.parentElement;
  strip.scrollLeft = Math.max(0, active.offsetLeft - strip.offsetLeft - 16);
  // ?item= names the purchase under review and ?view= the Purchase history view; choosing a tab (push) returns it to its list.
  const url = new URL(location.href); url.searchParams.set('tab', tab); if (tab !== 'purchases' || push) { url.searchParams.delete('item'); url.searchParams.delete('view'); }
  if (push) history.pushState(null, '', url); else history.replaceState(null, '', url);
  syncPurchaseView();
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
    el('div', { className: 'message-meta' }, el('span', { className: 'muted', textContent: when(message.created_at) }), ...issues.map(([kind, text]) => badge(kind, text)), details));
}
function renderMessages() {
  imageURLs.forEach(url => URL.revokeObjectURL(url)); imageURLs = [];
  const onlyProblems = $('convo-filter').value === 'problems';
  const shown = onlyProblems ? messages.filter(m => problems(m).length) : messages;
  $('messages').replaceChildren(...(shown.length ? shown.map(messageView) : [el('p', { className: 'empty-state', textContent: onlyProblems ? 'No problems in the loaded messages.' : 'No messages yet.' })]));
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
async function loadMessages(earlier = false) {
  const query = new URLSearchParams({ conversation: person });
  if (earlier && cursor) query.set('before', JSON.stringify(cursor));
  const data = await api(`/api/admin?${query}`);
  if (!earlier) { $('person-name').textContent = data.conversation.sender_id; document.title = `Jules admin · ${data.conversation.sender_id}`; }
  messages = earlier ? [...data.messages, ...messages] : data.messages; cursor = data.before;
  renderMessages();
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

// ---------- Personal memory ----------
const TYPES = { gender: 'gender', shopping_range: 'clothing range', size: 'size', brand: 'brand', category: 'category', style: 'style', budget: 'budget' };
let profileVersion = 0, facts = [], profileBusy = false, typeFilter = '';
const dirty = new Map(), factKey = fact => `${fact.field}|${fact.key}`;
// Same shape check as lib/relevance.js sizeKeyShape: a size key is category/system[/brand].
const malformedSize = fact => { const parts = String(fact.key ?? '').split('/'); return fact.field === 'size' && !(parts.length >= 2 && parts.length <= 3 && parts.every(p => p.trim())); };
function evidenceText(fact) {
  if (fact.source === 'operator') return `Owner edit · ${day(fact.updated_at)}`;
  const kind = fact.source === 'message' ? 'User statement' : 'Learned';
  return `${kind} · ${day(fact.updated_at)}${fact.evidence ? ` · “${fact.evidence}”` : ''}`;
}
// Type filter (the only counts) and search narrow the table; unsaved values survive filtering.
function renderTypes(live) {
  const counts = live.reduce((m, f) => m.set(f.field, (m.get(f.field) ?? 0) + 1), new Map());
  if (typeFilter && !counts.has(typeFilter)) typeFilter = '';
  $('memory-types').replaceChildren(...[['', 'All', live.length], ...Object.keys(TYPES).filter(t => counts.has(t)).map(t => [t, TYPES[t][0].toUpperCase() + TYPES[t].slice(1), counts.get(t)])].map(([value, label, n]) => {
    const button = el('button', { type: 'button' }, label, el('span', { className: 'count', textContent: n }));
    button.setAttribute('aria-pressed', String(typeFilter === value));
    button.onclick = () => { typeFilter = value; renderFacts(); };
    return button;
  }));
}
function renderFacts() {
  const live = facts.filter(f => !f.deleted);
  $('count-memory').textContent = live.length; $('stat-facts').textContent = live.length;
  renderTypes(live);
  const q = $('memory-search').value.trim().toLowerCase();
  const shown = live.filter(f => (!typeFilter || f.field === typeFilter) && (!q || [f.key, f.value, f.evidence, dirty.get(factKey(f))].some(v => v && v.toLowerCase().includes(q))));
  const rows = shown.flatMap(fact => {
    const keyId = factKey(fact), input = el('input', { value: dirty.get(keyId) ?? fact.value, maxLength: 500 });
    input.setAttribute('aria-label', `${TYPES[fact.field] ?? fact.field} ${fact.key}`);
    const save = el('button', { type: 'button', className: 'small btn--butter', textContent: 'Save', hidden: !dirty.has(keyId) });
    const remove = el('button', { type: 'button', className: 'small quiet', textContent: 'Remove' });
    const row = el('tr', { className: dirty.has(keyId) ? 'dirty' : '' },
      el('td', { className: 'fact-type', textContent: TYPES[fact.field] ?? fact.field }), el('td', { className: 'fact-key' }, fact.key, malformedSize(fact) ? ' ' : null, malformedSize(fact) ? el('span', { className: 'badge warn', title: 'Size keys need the item it is for: category/system[/brand]. Remove this and add the correct one.', textContent: 'Needs category' }) : null),
      el('td', {}, input), el('td', { className: 'fact-evidence', textContent: evidenceText(fact), title: evidenceText(fact) }), el('td', { className: 'fact-actions' }, save, remove));
    input.oninput = () => {
      if (input.value === fact.value) dirty.delete(keyId); else dirty.set(keyId, input.value);
      save.hidden = !dirty.has(keyId); row.classList.toggle('dirty', dirty.has(keyId)); renderDirty();
    };
    save.onclick = () => changeProfile({ action: 'set', field: fact.field, key: fact.key, value: input.value }, keyId);
    remove.onclick = () => changeProfile({ action: 'remove', field: fact.field, key: fact.key, value: '' }, keyId);
    if (!fact.source_id) return [row];
    const source = el('button', { type: 'button', className: 'small quiet', textContent: 'Source', ariaExpanded: 'false' });
    const message = () => messages.find(m => m.id === fact.source_id);
    const sourceRow = el('tr', { className: 'source-row', hidden: true }, el('td', { colSpan: 5 },
      el('span', { className: 'mono-label', textContent: 'Source' }), ' ',
      el('span', { className: 'source-text' }),
      el('button', { type: 'button', className: 'small', textContent: 'Open in Conversation →', onclick: () => openMessage(fact.source_id) })));
    source.onclick = () => {
      const open = sourceRow.hidden; sourceRow.hidden = !open; source.setAttribute('aria-expanded', String(open));
      const found = message();
      sourceRow.querySelector('.source-text').textContent = found ? `Inbound message · ${when(found.created_at)}${found.message_images?.length ? ' · with photo' : ''} · “${found.body.slice(0, 160)}”` : 'Inbound message (older than the loaded conversation)';
    };
    row.lastChild.prepend(source);
    return [row, sourceRow];
  });
  const empty = live.length ? 'No preferences match these filters.' : 'No saved preferences yet. Add one, or use More › Learn from existing messages.';
  $('profile-facts').replaceChildren(...(rows.length ? rows : [el('tr', {}, el('td', { colSpan: 5, className: 'muted', textContent: empty }))]));
  renderDirty();
}
function renderDirty() {
  const n = [...dirty.keys()].filter(k => facts.some(f => !f.deleted && factKey(f) === k)).length;
  $('memory-dirty').hidden = !n; $('memory-dirty').textContent = `${n} unsaved edit${n === 1 ? '' : 's'}`;
}
async function loadProfile() {
  const data = await api(`/api/profile?conversation=${encodeURIComponent(person)}`);
  profileVersion = data.version; facts = data.facts;
  $('memory-conflict').hidden = true;
  renderFacts();
}
async function changeProfile(change, keyId) {
  if (profileBusy) return;
  profileBusy = true;
  const buttons = [...$('tab-memory').querySelectorAll('button')]; buttons.forEach(b => { b.disabled = true; });
  $('profile-notice').textContent = change.action === 'import' ? 'Reading existing messages…' : 'Saving…';
  try {
    const response = await adminFetch('/api/profile', { method: 'POST', body: JSON.stringify({ conversation: person, version: profileVersion, ...change }) });
    const data = await response.json().catch(() => ({}));
    if (response.status === 409) { $('memory-conflict').hidden = false; $('profile-notice').textContent = ''; return; }
    if (!response.ok) throw new Error(data.error ?? 'Could not save.');
    if (keyId) dirty.delete(keyId);
    profileVersion = data.version; facts = data.facts;
    $('profile-notice').textContent = data.limited ? 'Learned from the latest 100 incoming messages. Earlier history was not included.' : change.action === 'remove' ? 'Removed. Add it again below to restore it.' : 'Saved.';
    if (change.action === 'set' && !keyId) { $('profile-add').reset(); showAddFact(false); }
  } catch (error) { $('profile-notice').textContent = error.message; }
  finally { profileBusy = false; buttons.forEach(b => { b.disabled = false; }); renderFacts(); }
}
const reloadProfile = () => loadProfile().then(() => { $('profile-notice').textContent = dirty.size ? 'Reloaded. Your unsaved values are kept; save them again.' : 'Reloaded.'; }).catch(error => { $('profile-notice').textContent = error.message; });
$('conflict-reload').onclick = reloadProfile;
$('profile-import').onclick = () => changeProfile({ action: 'import' });
$('memory-search').addEventListener('input', renderFacts);
function showAddFact(open) {
  $('tool-add-fact').hidden = !open; $('memory-add-open').setAttribute('aria-expanded', String(open));
  if (open) $('fact-field').focus();
}
$('memory-add-open').onclick = () => showAddFact($('tool-add-fact').hidden);
$('memory-add-close').onclick = () => showAddFact(false);
// "/" searches the open tab's list (Purchase history handles its own keys).
addEventListener('keydown', event => {
  if ($('tab-memory').hidden || document.querySelector('dialog[open], .dv-pop:popover-open')) return;
  if (browseKey(event, { open: false })?.type === 'search') { event.preventDefault(); $('memory-search').focus(); }
});
$('profile-add').onsubmit = event => { event.preventDefault(); changeProfile({ action: 'set', field: $('fact-field').value, key: $('fact-key').value, value: $('fact-value').value }); };

// ---------- Wishlist ----------
let wishlist = null;
const money = price => new Intl.NumberFormat(undefined, { style: 'currency', currency: price.currency }).format(price.amount);
function alertBadge(alert) {
  if (!alert) return badge('plain', 'No price alert');
  return alert.active ? badge('ok', `Alert on${alert.size ? ` · ${alert.size}` : ''}`) : badge('plain', 'Alert off');
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
  const previous = el('select', {}, el('option', { value: '', textContent: 'As last recorded' }), el('option', { value: 'sold_out', textContent: 'Sold out (rehearse a restock)' }), el('option', { value: 'in_stock', textContent: 'In stock' }));
  const result = el('pre', { className: 'alert-result', role: 'status' });
  const preview = el('button', { type: 'submit', className: 'small', textContent: 'Preview message' });
  const send = el('button', { type: 'button', className: 'small btn--butter', textContent: 'Send test text', disabled: !wishlist.test_delivery });
  form.append(
    el('p', { className: 'muted', textContent: `Runs the real alert decision on a made-up price. Nothing is saved. Reference: ${alert.baselines.map(b => money(b)).join(', ') || 'none yet'} · last stock: ${(alert.stock ?? 'unknown').replace('_', ' ')}.` }),
    el('div', { className: 'add-fact-fields' }, field('Store', storeSelect), field('Size', size), field('Price', price), field('Currency', currency), field('Listed shipping (optional)', shipping), field('Previous stock', previous)),
    el('label', { className: 'check' }, available, 'Size in stock'),
    el('div', { className: 'toolbar' }, preview, send, !wishlist.test_delivery && el('span', { className: 'muted', textContent: 'Test texts only go to the designated test account.' })),
    result);
  const run = async deliver => {
    if (!form.reportValidity()) return;
    [preview, send].forEach(b => { b.disabled = true; }); result.textContent = deliver ? 'Sending test text…' : 'Running…';
    try {
      const data = await api('/api/price-checks', { method: 'POST', body: JSON.stringify({ alert_id: alert.id, deliver, previous_stock: previous.value || undefined,
        offers: [{ url: storeSelect.value, size: size.value, amount: Number(price.value), currency: currency.value.toUpperCase(), available: available.checked, ...(shipping.value ? { shipping: Number(shipping.value) } : {}) }] }) });
      result.textContent = `Outcome: ${data.status}${data.event ? ` (${data.event})` : ''}${data.delivery ? ` · Delivery: ${data.delivery}` : ''}\n\n${data.message ?? 'No text would be sent.'}`;
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
  }) : [el('p', { className: 'empty-state', textContent: 'Nothing saved to this wishlist yet.' })]));
}
async function loadWishlist() { wishlist = await api(`/api/admin?view=wishlist&conversation=${encodeURIComponent(person)}`); renderWishlist(); }

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
    loadMessages().catch(error => notice(`Conversation: ${error.message}`)); loadProfile().catch(() => {}); loadPurchases(person);
  } catch (error) { $('reset-error').textContent = error.message; $('reset-error').hidden = false; }
  finally { buttons.forEach(b => { b.disabled = false; }); $('reset-confirm').textContent = 'Reset onboarding'; }
};

// ---------- Start ----------
showTab(new URLSearchParams(location.search).get('tab'));
if (!/^[0-9a-f-]{36}$/i.test(person)) { $('person-name').textContent = 'Person not found'; notice('This link does not name a person. Go back to People.'); }
else {
  mountPurchases(api);
  const fail = area => error => { notice(`${area}: ${error.message}`); };
  loadMessages().catch(fail('Conversation'));
  loadProfile().catch(fail('Memory'));
  loadPurchases(person);
  loadWishlist().catch(error => { $('wishlist-note').textContent = error.message; });
}
