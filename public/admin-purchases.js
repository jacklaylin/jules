import {adminFetch} from './admin-console.js';
import {REASONS,STATUSES,reviewed,statusOf,matches,neighbour,position,filterLabel,reviewKey} from './admin-review.js';
// Admin People: browse and correct a person's imported purchase history. Every correction
// carries a "what was wrong" label; the server records it as correction evidence.
// Opening a row shows the item review (?tab=purchases&item=<id>): the email evidence beside the
// correction form, with J/K, 1–7 and ⌘/Ctrl+Enter so a reviewer can work through a filter by keyboard.
const $ = id => document.getElementById(id);
const el = (tag, props = {}, ...children) => { const node = Object.assign(document.createElement(tag), props); node.append(...children.filter(c => c != null)); return node; };
const day = at => at ? new Date(at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'date unknown';
const FIELDS = [['brand', 'Brand'], ['product', 'Product'], ['color', 'Colour'], ['size_label', 'Size'], ['size_system', 'Size system'], ['quantity', 'Quantity']];
const RECIPIENTS = { self: 'For them', other: 'For someone else', unknown: 'Recipient unknown' };
const OUTCOMES = { returned: 'Returned', return_requested: 'Return requested', cancelled: 'Cancelled' };
const KINDS = { purchased: 'Purchase', shipped: 'Shipped', return_requested: 'Return requested', returned: 'Returned', cancelled: 'Cancelled', refunded: 'Refunded' };
const REASON_LABEL = Object.fromEntries(REASONS);
const SOURCE_LABEL = { gmail: 'Gmail', shop: 'Shop', screenshot: 'Chat screenshot' };
const sourceName = s => SOURCE_LABEL[s] ?? s;
const STOPS = { no_more_pages: 'the service said there were no more pages', next_page_without_cursor: 'the service said more pages exist but gave no way to request them', limit: 'the import limit was reached', page_cap: 'the page limit was reached', call_cap: 'the request limit was reached', throttled: 'the service asked Jules to slow down', search_failed: 'a search failed', end: 'listing ended' };

let api, conversation = null, data = null, busy = false, version = 0, statusFilter = '';
// The item review on screen: which item and which loaded data it was drawn from, so unrelated
// re-renders keep a half-filled form.
let shownReview = null;
const IMPORT_STATUS = { ready: 'Import complete', listing: 'Import running', extracting: 'Import running', questions: 'Import running', paused: 'Import paused', not_started: 'No import yet' };
const notice = text => { $('purchases-notice').textContent = text; };
const title = item => [item.brand, item.product].filter(Boolean).join(' · ') || 'Unnamed item';
const filter = () => ({ status: statusFilter, store: $('purchases-store').value, source: $('purchases-source').value, query: $('purchases-search').value });
const itemParam = () => new URLSearchParams(location.search).get('item');
const itemHref = id => { const url = new URL(location.href); url.searchParams.set('tab', 'purchases'); if (id) url.searchParams.set('item', id); else url.searchParams.delete('item'); return url; };
// Style-report tags (type, group, colour family, resale). Empty until the item is tagged.
const tagText = tags => tags ? ['Tags:', [tags.item_type, tags.group?.replace(/_/g, ' '), tags.color_family !== 'unknown' && tags.color_family, tags.resale && 'resale'].filter(Boolean).join(' · ')].join(' ') : null;

export function mountPurchases(request) {
  api = request;
  for (const id of ['purchases-search', 'purchases-store', 'purchases-source']) $(id).addEventListener('input', render);
  $('purchases-reload').onclick = () => conversation && loadPurchases(conversation);
  $('purchases-start').onclick = () => { const first = data && neighbour(data.items, null, filter()); if (first) openItem(first, true); };
  $('recheck-run').onclick = recheck;
  $('report-build').onclick = () => send({ action: 'build-report' }, 'Building the style report…');
  $('report-send').onclick = () => { if (confirm('Text this person a link to their style report?')) send({ action: 'send-report' }, 'Texting the link…'); };
  $('tags-run').onclick = () => send({ action: 'tag' }, 'Tagging purchases… this takes up to 20 seconds.');
  $('skipped-load').onclick = loadSkipped;
  $('missed-form').onsubmit = async event => {
    event.preventDefault();
    const ok = await send({ action: 'missed', store: $('missed-store').value, when: $('missed-when').value, description: $('missed-what').value }, 'Saving missed purchase…');
    if (ok) $('missed-form').reset();
  };
  document.addEventListener('keydown', onKey);
}
// The person page calls this whenever the URL changes tab (including Back), so the list or the item review matches it.
export const syncPurchaseView = render;

export async function loadPurchases(id) {
  conversation = id; data = null; shownReview = null; const mine = ++version;
  $('skipped-list').replaceChildren(); $('skipped-status').textContent = '';
  $('purchases-count').textContent = ''; $('purchases-list').replaceChildren(); notice('Loading purchase history…');
  render();
  try {
    const result = await api(`/api/admin?view=purchases&conversation=${encodeURIComponent(id)}`);
    if (mine !== version) return;
    data = result; notice(''); render();
  } catch (error) { if (mine === version) { notice(error.message); render(); } }
}

// Saves a review or missed report. Resolves to the HTTP outcome so the item review can tell a
// busy import (409) from a validation message.
async function send(body, message) {
  if (busy || !conversation) return false;
  // On the item review the Saving… badge says it; elsewhere the tab notice does.
  busy = true; if (!reviewing()) notice(message); reviewState('saving');
  const buttons = [...$('tab-purchases').querySelectorAll('button')]; buttons.forEach(b => { b.disabled = true; });
  try {
    const id = conversation, response = await adminFetch('/api/admin', { method: 'POST', body: JSON.stringify({ conversation: id, ...body }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { failed(response.status === 409 ? 'busy' : 'error', result.error ?? 'Could not save. Try again.'); return false; }
    if (id === conversation) { data = result; notice('Saved.'); }
    return true;
  } catch (error) { failed('error', error.message); return false; }
  finally { busy = false; buttons.forEach(b => { b.disabled = false; }); render(); }
}

function render() {
  const open = !$('tab-purchases').hidden && itemParam();
  for (const part of document.querySelectorAll('[data-browse]')) part.hidden = !!open;
  $('purchase-review').hidden = !open;
  if (open) renderReview(open); else shownReview = null;
  if (!data) return;
  const items = data.items, count = s => items.filter(i => statusOf(i) === s).length;
  $('purchases-count').textContent = items.length;
  $('purchases-summary').textContent = data.status === 'not_started' && !items.length ? 'No Gmail import for this person yet.' :
    `${IMPORT_STATUS[data.status] ?? `Import ${data.status.replace('_', ' ')}`} · Imported history is partial` +
    (data.connections?.length ? ` · ${items.filter(i => i.sources.length > 1).length} found by more than one source` : '');
  // The chips are the filter and the only place counts appear.
  $('purchases-chips').replaceChildren(...STATUSES.map(([value, label]) => {
    const chip = el('button', { type: 'button', textContent: `${label} ${value ? count(value) : items.length}` });
    chip.setAttribute('aria-pressed', String(statusFilter === value));
    chip.onclick = () => { statusFilter = value; render(); };
    return chip;
  }));
  const stores = [...new Set(items.map(i => i.merchant).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const chosen = $('purchases-store').value;
  $('purchases-store').replaceChildren(el('option', { value: '', textContent: 'All stores' }), ...stores.map(s => el('option', { value: s, textContent: s })));
  $('purchases-store').value = stores.includes(chosen) ? chosen : '';
  const current = filter(), shown = items.filter(i => matches(i, current));
  $('purchases-start').hidden = !shown.length;
  $('purchases-list').replaceChildren(...(shown.length ? shown.map(itemRow) : [el('p', { className: 'muted', textContent: items.length ? 'No items match these filters.' : 'No purchases found yet.' })]));
  $('purchases-pending').hidden = !data.pending.length;
  $('purchases-pending-count').textContent = data.pending.length;
  $('purchases-pending-list').replaceChildren(...data.pending.map(p => el('tr', {},
    el('td', { textContent: KINDS[p.kind] ?? p.kind }), el('td', { textContent: p.merchant ?? 'Unknown' }), el('td', { className: 'num', textContent: p.order_reference ?? '—' }),
    el('td', { className: 'num', textContent: day(p.at) }), el('td', { className: 'quote', textContent: p.evidence ? `“${p.evidence}”` : '' }))));
  renderTags();
  renderReport();
  renderConnections();
  $('missed-list').replaceChildren(...[...data.missed].reverse().map(m => el('p', { className: 'fact-row', textContent: `${m.store}${m.when ? ` · ${m.when}` : ''} — ${m.description}` })));
}

const facts = item => [item.merchant, item.size_label && `size ${item.size_label}${item.size_system ? ` (${item.size_system})` : ''}`, item.color, item.quantity > 1 && `×${item.quantity}`, item.price && item.price.text,
  day(item.events.find(e => e.kind === 'purchased')?.at), RECIPIENTS[item.recipient.value] + (item.recipient.basis === 'receipt_evidence' ? ' (receipt)' : ''), OUTCOMES[item.outcome]].filter(Boolean);
const statusText = (item, withReviewed) => [item.sources.map(sourceName).join(' + '), item.removed && !item.duplicate_of && 'Removed', item.duplicate_of && 'Duplicate', item.confirmed && 'Confirmed', item.confirmed_fields.length && 'Edited', withReviewed && reviewed(item) && 'Reviewed'].filter(Boolean).join(' · ');

function itemRow(item) {
  // Quiet status text on the right; "To review" rows show nothing because the filter says it.
  // "Reviewed" appears here only; the item review shows the correction history instead.
  const status = statusText(item, true);
  const row = el('a', { className: `purchase ${statusOf(item)}`, href: itemHref(item.id).search },
    el('span', { className: 'purchase-title' }, el('strong', { textContent: title(item) }), el('span', { className: 'meta', textContent: facts(item).join(' · ') }),
      item.tags ? el('span', { className: 'meta', textContent: tagText(item.tags) }) : null),
    status ? el('span', { className: 'purchase-status', textContent: status }) : null);
  row.onclick = event => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.button) return; event.preventDefault(); openItem(item.id, true); };
  return row;
}

function openItem(id, push = false) {
  const url = itemHref(id);
  if (push) history.pushState(null, '', url); else history.replaceState(null, '', url);
  render();
  if (id) { scrollTo({ top: 0 }); $('review-title')?.focus({ preventScroll: true }); }
}

// ---------- Item review ----------
function renderReview(id) {
  if (shownReview && shownReview.id === id && shownReview.data === data) return;
  shownReview = { id, data };
  const box = $('purchase-review');
  const back = el('a', { href: itemHref(null).search, className: 'review-back', textContent: '← All purchases' });
  back.onclick = event => { event.preventDefault(); openItem(null, true); };
  if (!data) { box.replaceChildren(el('div', { className: 'review-bar' }, back), el('p', { className: 'muted', role: 'status', textContent: 'Loading purchase…' })); return; }
  const item = data.items.find(i => i.id === id);
  if (!item) { box.replaceChildren(el('div', { className: 'review-bar' }, back), el('p', { className: 'empty-state', textContent: 'This item is no longer in their purchase history. Go back to all purchases.' })); return; }
  const current = filter(), { index, total } = position(data.items, id, current);
  const step = (label, dir) => { const button = el('button', { type: 'button', className: 'small', textContent: label }); button.onclick = () => move(dir); return button; };
  const kbd = text => el('span', { className: 'kbd', textContent: text });
  const bar = el('div', { className: 'review-bar' }, back,
    el('strong', { className: 'review-where', textContent: `Reviewing: ${filterLabel(current)} · ${index ? `${index} of ${total}` : `not in this filter (${total} ${total === 1 ? 'item' : 'items'})`}` }),
    el('span', { className: 'review-keys muted' }, el('span', {}, kbd('J'), ' next'), el('span', {}, kbd('K'), ' previous'), el('span', {}, kbd('1'), '–', kbd('7'), ' pick a label'), el('span', {}, kbd('⌘ ↵'), ' save and open next')),
    el('span', { className: 'review-steps' }, step('← Previous', -1), step('Next →', 1)),
    el('span', { id: 'review-state', role: 'status', ariaLive: 'polite' }));
  const status = statusText(item, false);
  const head = el('div', { className: 'review-head' },
    el('div', {}, el('h2', { id: 'review-title', tabIndex: -1, textContent: title(item) }), el('p', { className: 'muted', textContent: facts(item).join(' · ') }),
      item.tags ? el('p', { className: 'meta', textContent: tagText(item.tags) }) : null),
    status ? el('span', { className: 'purchase-status', textContent: status }) : null);
  box.replaceChildren(bar, el('section', { className: `review-item ${statusOf(item)}`, ariaLabel: 'Item' }, head,
    el('div', { className: 'review-columns' }, el('div', { className: 'review-evidence' }, evidence(item), corrections(item)), reviewForm(item))));
}

// Outside the item review (the missed-purchase form) a failure is shown in the tab notice instead.
const reviewing = () => !!$('review-state') && !$('purchase-review').hidden;
const failed = (kind, message) => { if (reviewing()) { notice(''); reviewState(kind, message); } else notice(message); };
function reviewState(kind, message = '') {
  const slot = $('review-state'); if (!slot) return;
  slot.replaceChildren(...(kind === 'saving' ? [el('span', { className: 'badge plain', textContent: 'Saving…' })]
    : kind === 'busy' ? [el('span', { className: 'badge fail', textContent: 'Busy' }), ` ${message}`]
    : kind === 'error' ? [el('span', { className: 'badge fail', textContent: 'Not saved' }), ` ${message}`] : []));
}

function move(dir) {
  if (!data) return;
  const id = itemParam(), target = neighbour(data.items, id, filter(), dir);
  notice('');
  if (target) openItem(target);
  else notice(dir > 0 ? 'That was the last item in this filter. Press K to go back or open All purchases.' : 'This is the first item in this filter.');
}

function onKey(event) {
  if ($('tab-purchases').hidden || !itemParam() || !data) return;
  const item = data.items.find(i => i.id === itemParam()), form = $('purchase-review').querySelector('form.review-form');
  const action = reviewKey(event, { open: !!item, busy, form: !!form, dialog: !!document.querySelector('dialog[open]') });
  if (!action) return;
  event.preventDefault();
  if (action.type === 'next') move(1);
  else if (action.type === 'previous') move(-1);
  else if (action.type === 'label') pickLabel(form, action.reason);
  else if (action.type === 'save-next') form.requestSubmit(form.querySelector('[data-next]'));
}

// A label picked by key moves focus to the field it opens, so the reviewer can type straight away.
function pickLabel(form, reason) {
  const radio = form.querySelector(`input[type=radio][value="${reason}"]`);
  radio.checked = true; radio.dispatchEvent(new Event('change', { bubbles: true }));
  (form.querySelector('.review-extra input, .review-extra select') ?? radio).focus();
}

function evidence(item) {
  const emails = new Map(item.emails.map(e => [e.id, e]));
  return el('div', { className: 'review-block' }, el('h3', { className: 'mono-label', textContent: 'Evidence from email · read-only' }),
    ...item.events.map(event => {
      const email = emails.get(event.source_id), gmail = event.source === 'gmail';
      // Only Gmail records can be opened; a connected service's record is summarised under Connected sources.
      const link = gmail ? el('a', { href: `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(event.source_id)}`, target: '_blank', rel: 'noopener noreferrer', textContent: 'Open in Gmail ↗' }) : el('span', { textContent: `${sourceName(event.source)} record` });
      return el('div', { className: 'evidence' },
        el('p', { className: 'meta' }, el('span', { className: 'evidence-kind', textContent: KINDS[event.kind] ?? event.kind }), ` ${day(event.at ?? email?.date)}${email?.sender_domain ? ` · ${email.sender_domain}` : ''} `, link),
        event.evidence ? el('blockquote', { textContent: event.evidence }) : null);
    }),
    item.order_reference || item.sku ? el('p', { className: 'meta', textContent: [item.order_reference && `Order ${item.order_reference}`, item.sku && `SKU ${item.sku}`].filter(Boolean).join(' · ') }) : null,
    item.confirmed_fields.length ? el('div', { className: 'original' }, el('span', { className: 'mono-label', textContent: 'Originally read as' }),
      el('p', { textContent: item.confirmed_fields.filter(f => f in item.original).map(f => `${f.replace('_label', '')} ${item.original[f] ?? 'blank'}`).join(', ') })) : null);
}

function corrections(item) {
  if (!item.reviews.length) return null;
  return el('div', { className: 'review-block' }, el('h3', { className: 'mono-label', textContent: 'Correction history' }), ...item.reviews.map(r => el('p', { className: 'meta',
    textContent: `${day(r.at)} · ${r.source === 'operator_review' ? `Admin: ${REASON_LABEL[r.reason] ?? r.action}` : `From chat: ${r.action.replace(/_/g, ' ')}`}${r.note ? ` — ${r.note}` : ''}` })));
}

function reviewForm(item) {
  if (item.duplicate_of) {
    const target = data.items.find(i => i.id === item.duplicate_of);
    const link = target ? el('a', { href: itemHref(target.id).search, textContent: 'Correct that item instead →' }) : null;
    if (link) link.onclick = event => { event.preventDefault(); openItem(target.id, true); };
    return el('p', { className: 'review-duplicate' }, `Duplicate of ${target ? title(target) : 'another item'}. `, link ?? 'Correct that item instead.');
  }
  const name = `reason-${item.id}`, form = el('form', { className: 'review-form' });
  const chips = el('fieldset', {}, el('legend', {}, 'What’s wrong? ', el('span', { className: 'muted', textContent: '(required)' })), ...REASONS.map(([value, label], n) =>
    el('label', { className: 'chip' }, el('input', { type: 'radio', name, value, required: true }), el('span', { className: 'kbd', textContent: String(n + 1) }), label)));
  const extra = el('div', { className: 'review-extra' });
  const note = el('textarea', { maxLength: 500, rows: 2, placeholder: 'Optional: what should Jules have read instead?' });
  const saveNext = el('button', { type: 'submit', textContent: 'Save and open next ' }, el('span', { className: 'kbd', textContent: '⌘ ↵' }));
  saveNext.dataset.next = '';
  form.append(chips, extra, el('label', {}, 'Note', note), el('div', { className: 'review-actions' },
    el('button', { type: 'submit', className: 'btn--butter', textContent: 'Save correction' }), saveNext,
    el('span', { className: 'muted', textContent: 'Saved edits sit on top; the email is never changed.' })));
  chips.addEventListener('change', () => { extra.replaceChildren(...extraFields(item, form[name].value)); });
  form.onsubmit = async event => {
    event.preventDefault();
    if (busy) return;
    const reason = form[name].value, body = { action: 'review', item_ids: [item.id], reason, note: note.value.trim() || null };
    if (reason === 'wrong_details') {
      body.values = {};
      for (const [field] of FIELDS) { const input = form.elements[`field-${field}`]; const value = input.value.trim(); if (value !== String(item[field] ?? '')) body.values[field] = value || null; }
      if (!Object.keys(body.values).length) { reviewState('error', 'Change at least one detail first.'); form.elements['field-brand'].focus(); return; }
    } else if (reason === 'duplicate') body.target_item_id = form.elements.duplicate.value;
    else if (reason === 'recipient') { body.recipient = form.elements.recipient.value; body.recipient_label = form.elements.recipient_label?.value || null; }
    // "Save and open next" follows the filter as it stood before saving: the saved item usually
    // leaves "To review", so the next item is found from its old place in the list.
    const next = event.submitter?.dataset.next != null, order = data.items, current = filter();
    if (!await send(body, 'Saving correction…')) return;
    if (!next) { $('review-title')?.focus({ preventScroll: true }); return; }
    const fresh = new Map(data.items.map(i => [i.id, i]));
    const target = neighbour(order.map(i => fresh.get(i.id)).filter(Boolean), item.id, current);
    if (target) openItem(target);
    else { openItem(null, true); notice(`Saved. That was the last item in “${filterLabel(current)}”.`); }
  };
  return form;
}

function extraFields(item, reason) {
  if (reason === 'wrong_details') return FIELDS.map(([field, label]) => el('label', {}, label,
    el('input', { name: `field-${field}`, value: item[field] ?? '', maxLength: 300, inputMode: field === 'quantity' ? 'numeric' : 'text' })));
  if (reason === 'duplicate') {
    const others = data.items.filter(i => i.id !== item.id && !i.duplicate_of && !i.removed);
    return [el('label', {}, 'Same purchase as', el('select', { name: 'duplicate', required: true }, ...others.map(i => el('option', { value: i.id, textContent: `${title(i)} · ${i.merchant ?? ''} · ${i.size_label ?? ''}` }))))];
  }
  if (reason === 'recipient') return [
    el('label', {}, 'Who it was for', el('select', { name: 'recipient', required: true }, ...Object.entries(RECIPIENTS).map(([value, label]) => el('option', { value, textContent: label, selected: item.recipient.value === value })))),
    el('label', {}, 'Who (optional, if someone else)', el('input', { name: 'recipient_label', maxLength: 100 }))];
  return [];
}

// Re-check: one request per labelled item (each re-reads up to a few emails), two at a time.
const REASON_SHORT = { missed_order: 'Skipped order', not_order: 'Skipped, not an order', correct: 'Looks right', not_a_purchase: 'Not a purchase', not_apparel: 'Not clothing', wrong_details: 'Wrong details', duplicate: 'Duplicate', recipient: 'Recipient', returned: 'Returned' };
async function recheck() {
  if (!data || busy) return;
  const labelled = [...data.items.filter(i => i.reviews.some(r => r.source === 'operator_review')),
    ...data.skipped_labels.map(l => ({ email: l }))].slice(0, 150);
  if (!labelled.length) { $('recheck-status').textContent = 'Label some items first.'; return; }
  const id = conversation, results = [], queue = [...labelled]; let done = 0;
  $('recheck-run').disabled = true; $('recheck-results').replaceChildren();
  const status = () => { $('recheck-status').textContent = `Re-checking ${done} of ${labelled.length}…`; };
  status();
  const worker = async () => {
    for (let item; (item = queue.shift());) {
      try {
        const body = item.email ? { conversation: id, action: 'skipped_recheck', email_id: item.email.id } : { conversation: id, item_id: item.id };
        const response = await adminFetch('/api/wishlist?gmail=recheck', { method: 'POST', body: JSON.stringify(body) });
        const result = await response.json().catch(() => ({}));
        results.push(response.ok ? { item, ...result } : { item, error: result.error ?? 'Could not re-check.' });
      } catch (error) { results.push({ item, error: error.message }); }
      done++; if (id === conversation) status();
    }
  };
  await Promise.all([worker(), worker()]);
  $('recheck-run').disabled = false;
  if (id !== conversation) return;
  const checked = results.filter(r => !r.error), agree = checked.filter(r => r.match);
  const byReason = Object.entries(checked.reduce((m, r) => { m[r.reason] ??= [0, 0]; m[r.reason][1]++; if (r.match) m[r.reason][0]++; return m; }, {}));
  $('recheck-status').textContent = `Current rules agree with ${agree.length} of ${checked.length} labels` + (results.length > checked.length ? ` (${results.length - checked.length} could not be checked)` : '') + '. ' +
    byReason.map(([reason, [ok, total]]) => `${REASON_SHORT[reason] ?? reason}: ${ok}/${total}`).join(' · ');
  const order = r => r.error ? 1 : r.match ? 2 : 0;
  $('recheck-results').replaceChildren(...results.sort((a, b) => order(a) - order(b)).map(r => el('div', { className: 'fact-row' },
    el('strong', { textContent: `${r.error ? 'Not checked' : r.match ? 'Agrees' : 'Disagrees'} · ${r.item.email ? `Skipped email from ${r.item.email.sender_domain ?? 'unknown sender'}` : title(r.item)}` }),
    el('p', { className: 'meta', textContent: r.error ? r.error : `${REASON_SHORT[r.reason] ?? r.reason} · ${r.explanation}` + (r.found?.length ? ` · Read as: ${r.found.map(f => [f.product, f.size_label, f.category].filter(Boolean).join(' / ')).join('; ')}` : '') + (r.withheld?.length ? ` · Rejected: ${r.withheld.map(w => `${w.product ?? 'event'} (${w.reason})`).join('; ')}` : '') }))));
}

// Skipped emails: the owner marks sampled skipped emails as missed orders or not orders.
const SKIPPED = [['missed_order', 'Missed order'], ['not_order', 'Not an order']];
async function loadSkipped() {
  if (!conversation) return;
  const id = conversation; $('skipped-load').disabled = true; $('skipped-status').textContent = 'Loading skipped emails from Gmail…';
  try {
    const result = await adminFetch('/api/wishlist?gmail=recheck', { method: 'POST', body: JSON.stringify({ conversation: id, action: 'skipped_list' }) });
    const sample = await result.json().catch(() => ({}));
    if (!result.ok) throw new Error(sample.error ?? 'Could not load skipped emails.');
    if (id !== conversation) return;
    const known = sample.emails.filter(e => e.group === 'known_store').length;
    $('skipped-status').textContent = `${sample.skipped_total} emails were skipped. Showing ${known} from stores you’ve bought from and ${sample.emails.length - known} at random. ${sample.labelled} labelled so far.`;
    $('skipped-list').replaceChildren(...sample.emails.map(skippedRow));
  } catch (error) { if (id === conversation) $('skipped-status').textContent = error.message; }
  finally { $('skipped-load').disabled = false; }
}
function skippedRow(email) {
  const name = `skipped-${email.id}`, row = el('div', { className: 'fact-row skipped-row' },
    el('strong', { textContent: email.unavailable ? 'Email unavailable' : email.subject || '(no subject)' }),
    el('p', { className: 'meta' }, `${email.from_name ?? ''}${email.sender_domain ? ` · ${email.sender_domain}` : ''} · ${day(email.date)} · ${email.group === 'known_store' ? 'Store you’ve bought from' : 'Random sample'} · `,
      el('a', { href: `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(email.id)}`, target: '_blank', rel: 'noopener noreferrer', textContent: 'Open in Gmail' })));
  const choices = el('fieldset', {}, el('legend', { className: 'visually-hidden', textContent: 'Was this an order?' }), ...SKIPPED.map(([value, label]) => {
    const input = el('input', { type: 'radio', name, value, checked: email.label === value });
    input.onchange = () => saveSkipped(email, value, row);
    return el('label', { className: 'chip' }, input, label);
  }));
  row.append(choices);
  return row;
}
async function saveSkipped(email, label, row) {
  const id = conversation; row.querySelectorAll('input').forEach(i => { i.disabled = true; });
  try {
    const response = await adminFetch('/api/wishlist?gmail=recheck', { method: 'POST', body: JSON.stringify({ conversation: id, action: 'skipped_label', email_id: email.id, label, sender_domain: email.sender_domain }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error ?? 'Could not save.');
    email.label = label;
    if (id === conversation && data) { data.skipped_labels = [...data.skipped_labels.filter(l => l.id !== email.id), { id: email.id, label, sender_domain: email.sender_domain }]; }
    $('skipped-status').textContent = `Saved · ${result.labelled} labelled so far.`;
  } catch (error) { $('skipped-status').textContent = error.message; row.querySelectorAll('input').forEach(i => { i.checked = i.value === email.label; }); }
  finally { row.querySelectorAll('input').forEach(i => { i.disabled = false; }); }
}

// Tags are added automatically after each import; the button tags anything left (older history,
// The style report as the person will see it (hidden lines marked), plus build and text actions.
function renderReport() {
  const report = data.report, card = report?.cards.find(c => c.type === 'receipt');
  $('report-status').textContent = report ? `Built ${day(report.built_at)}${card && !card.written ? ' · the joke line used the fallback' : ''}${data.report_sent ? ` · link ${data.report_sent}` : ''}.` : 'Not built yet.';
  $('report-preview').hidden = !card;
  if (card) $('report-preview').textContent = [...card.lines.map(l => `${l.hidden ? '(hidden) ' : ''}${l.label} ×${l.n}`), `TOTAL: ${card.total}`].join('\n');
  $('report-build').textContent = report ? 'Rebuild report' : 'Build report';
  $('report-send').hidden = !report;
  $('report-open').hidden = !report;
  $('report-open').href = `/report?person=${encodeURIComponent(conversation)}`;
}

// or items corrected since). Each click tags as many as fit in one request.
function renderTags() {
  const s = data.tag_status ?? { tagged: 0, pending: 0 }, run = data.tag_run;
  $('tags-status').textContent = !s.tagged && !s.pending ? '' :
    `Style tags: ${s.tagged} tagged${s.pending ? `, ${s.pending} still to tag` : ''}.` + (run ? ` Last run tagged ${run.tagged}.` : '');
  $('tags-run').hidden = !s.pending;
  $('tags-run').textContent = s.tagged ? 'Tag the rest' : 'Tag purchases';
}

// Connected sources: the listing report (why the history is as long as it is) and each record's outcome.
function renderConnections() {
  const connections = data.connections ?? [];
  $('purchases-sources').hidden = !connections.length;
  $('purchases-sources-count').textContent = connections.length || '';
  $('purchases-sources-list').replaceChildren(...connections.map(c => {
    const pages = c.listing?.pages ?? [];
    const lists = pages.flatMap(p => Object.entries(p.lists)).reduce((m, [k, n]) => { m[k] = (m[k] ?? 0) + n; return m; }, {});
    const nothing = c.reads.filter(r => r.status === 'read' && !r.purchases), failed = c.reads.filter(r => r.status === 'failed');
    return el('div', { className: 'evidence' },
      el('h4', { textContent: `${c.label} · ${c.status.replace('_', ' ')}${c.imported_at ? ` · imported ${day(c.imported_at)}` : ''}` }),
      el('p', { className: 'meta', textContent: c.listing ? `Returned ${c.listing.total} records in ${pages.length} ${pages.length === 1 ? 'page' : 'pages'} (${Object.entries(lists).map(([k, n]) => `${k.replace(/_/g, ' ')} ${n}`).join(', ') || 'none'}) since ${c.listing.from ?? 'any date'}; stopped because ${STOPS[c.listing.stop] ?? c.listing.stop}.` : 'No listing report yet. Re-read to record one.' }),
      ...(c.listing?.passes ?? []).map(p => el('p', { className: 'meta', textContent: `Pass: ${p.name}${p.query ? ` “${p.query}”` : ''}${p.date_to ? ` before ${p.date_to}` : ''} · ${p.records} returned · ${p.new} new${p.earliest ? ` · oldest ${day(p.earliest)}` : ''} · ${STOPS[p.stop] ?? p.stop}` })),
      ...pages.map((p, n) => el('p', { className: 'meta', textContent: `Page ${n + 1}${p.pass ? ` (${p.pass})` : ''}: ${Object.entries(p.lists).map(([k, v]) => `${k} ${v}`).join(', ') || 'no records'} · more pages: ${p.has_next_page ?? 'not stated'} · next-page cursor: ${p.cursor ? 'yes' : 'no'} · pagination fields: ${p.pagination_keys.join(', ') || 'none'}${p.messages.length ? ` · messages: ${p.messages.join(' | ')}` : ''}` })),
      el('p', { className: 'meta', textContent: `${c.processed} read · ${c.reads.filter(r => r.purchases).length} with purchases · ${c.reads.filter(r => r.linked).length} linked to another source · ${nothing.length} with nothing found · ${failed.length} failed · ${c.withheld} events withheld${c.error ? ` · ${c.error}` : ''}` }),
      ...c.reads.map(r => el('details', {}, el('summary', { className: 'meta', textContent: `${day(r.date)} · ${r.kind?.replace(/_/g, ' ') ?? 'record'} · ${r.status === 'failed' ? 'could not be read' : r.purchases ? `${r.purchases} ${r.purchases === 1 ? 'purchase' : 'purchases'}${r.linked ? `, ${r.linked} linked` : ''}` : 'nothing found'}${r.withheld ? ` · ${r.withheld} withheld` : ''}` }),
        el('blockquote', { textContent: r.summary ?? 'No summary.' }))));
  }));
}
