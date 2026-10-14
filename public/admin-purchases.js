// Admin People: browse and correct a person's imported purchase history. Every correction
// carries a "what was wrong" label; the server records it as correction evidence.
const $ = id => document.getElementById(id);
const el = (tag, props = {}, ...children) => { const node = Object.assign(document.createElement(tag), props); node.append(...children.filter(c => c != null)); return node; };
const day = at => at ? new Date(at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'date unknown';
const REASONS = [
  ['correct', 'Looks right'], ['not_a_purchase', 'Not a purchase'], ['not_apparel', 'Not clothing or accessories'],
  ['wrong_details', 'Wrong details'], ['duplicate', 'Duplicate'], ['recipient', 'Who it was for'], ['returned', 'Returned']
];
const FIELDS = [['brand', 'Brand'], ['product', 'Product'], ['color', 'Colour'], ['size_label', 'Size'], ['size_system', 'Size system'], ['quantity', 'Quantity']];
const RECIPIENTS = { self: 'For them', other: 'For someone else', unknown: 'Recipient unknown' };
const OUTCOMES = { returned: 'Returned', return_requested: 'Return requested', cancelled: 'Cancelled' };
const KINDS = { purchased: 'Purchase', shipped: 'Shipped', return_requested: 'Return requested', returned: 'Returned', cancelled: 'Cancelled', refunded: 'Refunded' };
const REASON_LABEL = Object.fromEntries(REASONS);

let api, conversation = null, data = null, busy = false, version = 0;
const notice = text => { $('purchases-notice').textContent = text; };
const title = item => [item.brand, item.product].filter(Boolean).join(' · ') || 'Unnamed item';
const reviewed = item => item.reviews.some(r => r.source === 'operator_review');
const statusOf = item => item.duplicate_of ? 'duplicate' : item.removed ? 'removed' : reviewed(item) || item.confirmed ? 'reviewed' : 'review';

export function mountPurchases(request) {
  api = request;
  for (const id of ['purchases-search', 'purchases-status', 'purchases-store']) $(id).addEventListener('input', render);
  $('purchases-reload').onclick = () => conversation && loadPurchases(conversation);
  $('missed-form').onsubmit = async event => {
    event.preventDefault();
    const ok = await send({ action: 'missed', store: $('missed-store').value, when: $('missed-when').value, description: $('missed-what').value }, 'Saving missed purchase…');
    if (ok) $('missed-form').reset();
  };
}

export async function loadPurchases(id) {
  conversation = id; data = null; const mine = ++version;
  $('purchases-count').textContent = ''; $('purchases-list').replaceChildren(); notice('Loading purchase history…');
  try {
    const result = await api(`/api/admin?view=purchases&conversation=${encodeURIComponent(id)}`);
    if (mine !== version) return;
    data = result; notice(''); render();
  } catch (error) { if (mine === version) notice(error.message); }
}

async function send(body, message) {
  if (busy || !conversation) return false;
  busy = true; notice(message);
  const buttons = [...$('purchases-panel').querySelectorAll('button')]; buttons.forEach(b => { b.disabled = true; });
  try {
    const id = conversation, result = await api('/api/admin', { method: 'POST', body: JSON.stringify({ conversation: id, ...body }) });
    if (id === conversation) { data = result; render(); notice('Saved.'); }
    return true;
  } catch (error) { notice(error.message); return false; }
  finally { busy = false; buttons.forEach(b => { b.disabled = false; }); }
}

function render() {
  if (!data) return;
  const items = data.items, count = s => items.filter(i => statusOf(i) === s).length;
  $('purchases-count').textContent = items.length ? `(${items.length})` : '';
  $('purchases-summary').textContent = data.status === 'not_started' && !items.length ? 'No Gmail import for this person yet.' :
    `${items.length} items · ${count('review')} to review · ${count('reviewed')} reviewed · ${count('removed')} removed · ${count('duplicate')} duplicates` +
    `${data.pending.length ? ` · ${data.pending.length} unlinked events` : ''} · import ${data.status.replace('_', ' ')}`;
  const stores = [...new Set(items.map(i => i.merchant).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const chosen = $('purchases-store').value;
  $('purchases-store').replaceChildren(el('option', { value: '', textContent: 'All stores' }), ...stores.map(s => el('option', { value: s, textContent: s })));
  $('purchases-store').value = stores.includes(chosen) ? chosen : '';
  const query = $('purchases-search').value.trim().toLowerCase(), status = $('purchases-status').value, store = $('purchases-store').value;
  const shown = items.filter(i => (!status || statusOf(i) === status) && (!store || i.merchant === store) &&
    (!query || [i.brand, i.product, i.merchant, i.color, i.size_label, i.order_reference].some(v => v && v.toLowerCase().includes(query))));
  const open = new Set([...$('purchases-list').querySelectorAll('details[open]')].map(d => d.dataset.item));
  $('purchases-list').replaceChildren(...(shown.length ? shown.map(i => itemRow(i, open.has(i.id))) : [el('p', { className: 'muted', textContent: items.length ? 'No items match these filters.' : 'No purchases found yet.' })]));
  $('purchases-pending').hidden = !data.pending.length;
  $('purchases-pending-count').textContent = `(${data.pending.length})`;
  $('purchases-pending-list').replaceChildren(...data.pending.map(p => el('div', { className: 'evidence' },
    el('p', { className: 'meta', textContent: `${KINDS[p.kind] ?? p.kind} · ${p.merchant ?? 'store unknown'} · ${p.order_reference ? `order ${p.order_reference} · ` : ''}${day(p.at)}` }),
    p.evidence ? el('blockquote', { textContent: p.evidence }) : null)));
  $('missed-list').replaceChildren(...[...data.missed].reverse().map(m => el('p', { className: 'fact-row', textContent: `${m.store}${m.when ? ` · ${m.when}` : ''} — ${m.description}` })));
}

function itemRow(item, open) {
  const facts = [item.merchant, item.size_label && `size ${item.size_label}${item.size_system ? ` (${item.size_system})` : ''}`, item.color, item.quantity > 1 && `×${item.quantity}`,
    day(item.events.find(e => e.kind === 'purchased')?.at), RECIPIENTS[item.recipient.value] + (item.recipient.basis === 'receipt_evidence' ? ' (receipt)' : ''), OUTCOMES[item.outcome]].filter(Boolean);
  const badges = [item.removed && !item.duplicate_of && 'Removed', item.duplicate_of && 'Duplicate', item.confirmed && 'Confirmed', item.confirmed_fields.length && 'Edited', reviewed(item) && 'Reviewed'].filter(Boolean);
  const details = el('details', { className: `purchase ${statusOf(item)}`, open },
    el('summary', {}, el('strong', { textContent: title(item) }), el('span', { className: 'meta', textContent: facts.join(' · ') }),
      badges.length ? el('span', { className: 'badges' }, ...badges.map(b => el('span', { className: 'tag', textContent: b }))) : null),
    el('div', { className: 'purchase-body' }, evidence(item), history(item), reviewForm(item)));
  details.dataset.item = item.id;
  return details;
}

function evidence(item) {
  const emails = new Map(item.emails.map(e => [e.id, e]));
  return el('div', {}, el('h4', { textContent: 'Evidence from email' }),
    ...item.events.map(event => {
      const email = emails.get(event.source_id);
      const link = el('a', { href: `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(event.source_id)}`, target: '_blank', rel: 'noopener noreferrer', textContent: 'Open in Gmail' });
      return el('div', { className: 'evidence' },
        el('p', { className: 'meta' }, `${KINDS[event.kind] ?? event.kind} · ${day(event.at ?? email?.date)}${email?.sender_domain ? ` · ${email.sender_domain}` : ''} · `, link),
        event.evidence ? el('blockquote', { textContent: event.evidence }) : null);
    }),
    item.order_reference || item.sku ? el('p', { className: 'meta', textContent: [item.order_reference && `Order ${item.order_reference}`, item.sku && `SKU ${item.sku}`].filter(Boolean).join(' · ') }) : null,
    item.confirmed_fields.length ? el('p', { className: 'meta', textContent: `Originally read as: ${item.confirmed_fields.filter(f => f in item.original).map(f => `${f.replace('_label', '')} ${item.original[f] ?? 'blank'}`).join(', ')}` }) : null);
}

function history(item) {
  if (!item.reviews.length) return null;
  return el('div', {}, el('h4', { textContent: 'Corrections' }), ...item.reviews.map(r => el('p', { className: 'meta',
    textContent: `${day(r.at)} · ${r.source === 'operator_review' ? `Admin: ${REASON_LABEL[r.reason] ?? r.action}` : `From chat: ${r.action.replace(/_/g, ' ')}`}${r.note ? ` — ${r.note}` : ''}` })));
}

function reviewForm(item) {
  if (item.duplicate_of) {
    const target = data.items.find(i => i.id === item.duplicate_of);
    return el('p', { className: 'muted', textContent: `Duplicate of ${target ? title(target) : 'another item'}. Correct that item instead.` });
  }
  const name = `reason-${item.id}`, form = el('form', { className: 'review-form' });
  const chips = el('fieldset', {}, el('legend', { textContent: 'What’s wrong?' }), ...REASONS.map(([value, label]) =>
    el('label', { className: 'chip' }, el('input', { type: 'radio', name, value, required: true }), label)));
  const extra = el('div', { className: 'review-extra' });
  const note = el('textarea', { maxLength: 500, rows: 2, placeholder: 'Optional: what should Jules have read instead?' });
  form.append(chips, extra, el('label', {}, 'Note', note), el('button', { type: 'submit', className: 'primary', textContent: 'Save correction' }));
  chips.addEventListener('change', () => { extra.replaceChildren(...extraFields(item, form[name].value)); });
  form.onsubmit = event => {
    event.preventDefault();
    const reason = form[name].value, body = { action: 'review', item_ids: [item.id], reason, note: note.value.trim() || null };
    if (reason === 'wrong_details') {
      body.values = {};
      for (const [field] of FIELDS) { const input = form.elements[`field-${field}`]; const value = input.value.trim(); if (value !== String(item[field] ?? '')) body.values[field] = value || null; }
      if (!Object.keys(body.values).length) { notice('Change at least one detail first.'); return; }
    } else if (reason === 'duplicate') body.target_item_id = form.elements.duplicate.value;
    else if (reason === 'recipient') { body.recipient = form.elements.recipient.value; body.recipient_label = form.elements.recipient_label?.value || null; }
    send(body, 'Saving correction…');
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
