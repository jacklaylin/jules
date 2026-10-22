import { publicURL } from './public-url.js';

// URLs are technical references, not intent. The model decides what to do with them.
export function messageLinks(text) {
  return [...new Set((String(text ?? '').match(/https:\/\/[^\s<>]+/g) ?? [])
    .map(value => publicURL(value.replace(/[),.;]+$/, ''))).filter(Boolean))].slice(0, 5);
}

// A link sent just before the newest message, with nothing sent back in between, belongs to the same
// split request: its own turn was set aside for the newer one (October 21: a linked sweater followed a
// second later by "find a dupe for a better price" was searched by the URL's words, never its page).
// Only timing and message order decide this, never wording; a threaded reply keeps its own target.
export const BURST_MS = 120000;
export function burstLinks(messages, current) {
  if (!current || current.reply_context) return [];
  const at = Date.parse(current.created_at);
  const earlier = messages.slice(0, messages.indexOf(current));
  for (let i = earlier.length - 1; i >= 0; i--) {
    const m = earlier[i];
    if (m.direction === 'outbound') { if (m.status === 'sent') return []; continue; }
    if (!(at - Date.parse(m.created_at) <= BURST_MS)) return [];
    const links = messageLinks(m.body);
    if (links.length) return links;
  }
  return [];
}

export function stateFromSearch(result) {
  if (!result) return null;
  // Explicitly cleared choices must never be revived from the result's products.
  if (Object.hasOwn(result, 'text_wishlist_state')) return result.text_wishlist_state;
  const options = (result.products ?? []).filter(p => publicURL(p.url)).slice(0, 5)
    .map(p => ({ ...p, reference_provenance: 'conversation_product' }));
  if(result.search_brief)return {stage:options.length?'reference':'search_clarification',options,search_brief:result.search_brief,visual_targets:result.visual_targets??[],search_plan:{continuation:false,mode:result.visual_targets?.every(t=>t.search_mode==='similar')?'discover':'identify',hard_constraints:[],guidance:[]}};
  return options.length ? { stage: 'reference', options } : null;
}

// set_at is when the pending state was written (lib/store.js textWishlistState); without it, unknown.
const withinPending = (reply, state) => {
  const set = Date.parse(state?.set_at ?? ''), referenced = reply.messages ?? [];
  return reply.resolved !== false && Number.isFinite(set) && referenced.length > 0
    && referenced.every(m => !m.search_result && Date.parse(m.created_at) >= set);
};

export function shoppingContext(messages, state, savedItems=[]) {
  const current = messages.findLast(m => m.direction === 'inbound');
  // Product sets belong to their referenced reply, not the most recent search. A reply under messages
  // that carry none (a question, a note) all sent since the pending state was set is about that state,
  // as an unthreaded message is (October 15: "Size 48 is fine" under a purchase-history question dropped
  // a save and alert waiting for the size). One under an older message keeps nothing pending.
  if (current?.reply_context && !withinPending(current.reply_context, state)) {
    const referenced = current.reply_context.messages?.findLast(m => m.search_result);
    state = current.reply_context.resolved === false ? null : stateFromSearch(referenced?.search_result);
  }
  const saved=savedItems.flatMap(item=>(item.links??[]).map(link=>({name:item.name,url:link.url,brand:'',reference_provenance:'conversation_product',saved_item_id:item.id,match:'unverified',sourcing_status:'saved_reference',merchant_options:[]}))).filter(p=>publicURL(p.url)).slice(0,5);
  // Saved items stand in only when nothing is pending. A reply under a message Jules cannot see is
  // about something unknown, never the saved list (October 20: a reply to a product card saved an old item).
  if(!state&&saved.length&&current?.reply_context?.resolved!==false)state={stage:'reference',options:saved};
  const links = messageLinks(current?.body);
  if (!links.length) links.push(...burstLinks(messages, current));
  if (!links.length) return state;
  const previous = [...(state?.options ?? state?.selected_set ?? []),...saved];
  const options = links.map(url => {
    const known = previous.find(p => publicURL(p.url) === url);
    return { ...(known ?? { name: `Item from ${new URL(url).hostname.replace(/^www\./, '')}`, brand: '',
      match: 'unverified', sourcing_status: 'store_not_found', merchant_options: [] }),
      url, reference_provenance: 'user_link' };
  });
  // A supplied URL identifies its own item, rather than every item in an old search.
  return { stage: 'reference', options, supplied_links: links };
}
