// Purchase item review: which item comes next, where the reviewer is in the current filter, and what a
// key press does. Pure functions so the keyboard flow is testable without a browser.
export const REASONS = [
  ['correct', 'Looks right'], ['not_a_purchase', 'Not a purchase'], ['not_apparel', 'Not clothing or accessories'],
  ['wrong_details', 'Wrong details'], ['duplicate', 'Duplicate'], ['recipient', 'Who it was for'], ['returned', 'Returned']
];
export const STATUSES = [['', 'All'], ['review', 'To review'], ['reviewed', 'Reviewed'], ['removed', 'Removed'], ['duplicate', 'Duplicates']];
export const reviewed = item => item.reviews.some(r => r.source === 'operator_review');
export const statusOf = item => item.duplicate_of ? 'duplicate' : item.removed ? 'removed' : reviewed(item) || item.confirmed ? 'reviewed' : 'review';

// filter: { status, store, source, query } as chosen in the Purchases toolbar.
export function matches(item, { status = '', store = '', source = '', query = '' } = {}) {
  const q = query.trim().toLowerCase();
  return (!status || statusOf(item) === status) && (!store || item.merchant === store) &&
    (!source || (source === 'multiple' ? item.sources.length > 1 : item.sources.includes(source))) &&
    (!q || [item.brand, item.product, item.merchant, item.color, item.size_label, item.order_reference, item.tags?.item_type, item.tags?.group, item.tags?.color_family].some(v => v && v.toLowerCase().includes(q)));
}

// The next (step 1) or previous (step -1) item in the filter, walking the full list from the current
// item. The current item may have left the filter (a "To review" item just saved), so its place in the
// full list is the anchor, not its place in the filtered list. No current item: the first or last match.
export function neighbour(items, id, filter, step = 1) {
  const at = items.findIndex(i => i.id === id);
  const start = at < 0 ? (step > 0 ? 0 : items.length - 1) : at + step;
  for (let n = start; n >= 0 && n < items.length; n += step) if (matches(items[n], filter)) return items[n].id;
  return null;
}

// "4 of 23": the current item's place among the matches; index 0 when it is not (or no longer) one.
export function position(items, id, filter) {
  const shown = items.filter(i => matches(i, filter));
  return { index: shown.findIndex(i => i.id === id) + 1, total: shown.length };
}

export function filterLabel(filter) {
  const status = STATUSES.find(([value]) => value === (filter.status ?? ''))?.[1] ?? 'All';
  const narrowed = [filter.query?.trim() && `“${filter.query.trim()}”`, filter.store, filter.source && (filter.source === 'multiple' ? 'more than one source' : filter.source)].filter(Boolean);
  return narrowed.length ? `${status} · ${narrowed.join(' · ')}` : status;
}

// Fields where letters and digits are typing, not shortcuts. Radio chips and buttons are not.
const typing = target => !!target && (target.isContentEditable || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' ||
  (target.tagName === 'INPUT' && !['radio', 'checkbox', 'button', 'submit', 'reset'].includes(target.type)));

// Keys that work on the whole list as well as the item review: / searches, Esc closes the open item, and with
// no item open J/K move between rows (Enter on a row then opens it, as a link). Menus and dialogs keep their keys.
export function browseKey(event, { open, dialog = false, menu = false } = {}) {
  if (dialog || menu || event.isComposing || event.repeat || event.metaKey || event.ctrlKey || event.altKey || typing(event.target)) return null;
  if (event.key === '/') return { type: 'search' };
  if (event.key === 'Escape') return open ? { type: 'close' } : null;
  if (open) return null;
  const key = event.key.toLowerCase();
  if (key === 'j') return { type: 'row', step: 1 };
  if (key === 'k') return { type: 'row', step: -1 };
  return null;
}

// Maps a keydown on the item review to an action, or null to leave the key alone.
// ⌘/Ctrl+Enter also works from inside the form's fields: it can't be typed, and a reviewer who has
// just corrected a detail should not have to leave the field to save.
export function reviewKey(event, { open, busy = false, form = true, dialog = false } = {}) {
  if (!open || busy || dialog || event.isComposing || event.repeat) return null;
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey) return form ? { type: 'save-next' } : null;
  if (event.metaKey || event.ctrlKey || event.altKey || typing(event.target)) return null;
  const key = event.key.toLowerCase();
  if (key === 'j') return { type: 'next' };
  if (key === 'k') return { type: 'previous' };
  if (form && /^[1-7]$/.test(event.key)) return { type: 'label', reason: REASONS[Number(event.key) - 1][0] };
  return null;
}
