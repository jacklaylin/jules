import { publicURL } from './search.js';

// URLs are technical references, not intent. The model decides what to do with them.
export function messageLinks(text) {
  return [...new Set((String(text ?? '').match(/https:\/\/[^\s<>]+/g) ?? [])
    .map(value => publicURL(value.replace(/[),.;]+$/, ''))).filter(Boolean))].slice(0, 5);
}

export function stateFromSearch(result) {
  if (!result) return null;
  // Explicitly cleared choices must never be revived from the result's products.
  if (Object.hasOwn(result, 'text_wishlist_state')) return result.text_wishlist_state;
  const options = (result.products ?? []).filter(p => publicURL(p.url)).slice(0, 5)
    .map(p => ({ ...p, reference_provenance: 'conversation_product' }));
  return options.length ? { stage: 'reference', options } : null;
}

export function shoppingContext(messages, state, savedItems=[]) {
  const saved=savedItems.flatMap(item=>(item.links??[]).map(link=>({name:item.name,url:link.url,brand:'',reference_provenance:'conversation_product',saved_item_id:item.id,match:'unverified',sourcing_status:'saved_reference',merchant_options:[]}))).filter(p=>publicURL(p.url)).slice(0,5);
  if(!state&&saved.length)state={stage:'reference',options:saved};
  const current = messages.findLast(m => m.direction === 'inbound');
  const links = messageLinks(current?.body);
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
