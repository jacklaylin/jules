const normalized=value=>String(value??'').normalize('NFKC').toLocaleLowerCase().trim();

export function wishlistStores(items){
 return [...new Set(items.flatMap(item=>item.retailers??[]))].sort((a,b)=>a.localeCompare(b));
}

// Literal filtering of saved fields, not interpretation of conversational intent.
export function matchesWishlistFilters(item,{search='',store='',alert=''}={}){
 const terms=normalized(search).split(/\s+/).filter(Boolean);
 const text=normalized([item.name,...(item.retailers??[])].join(' '));
 return terms.every(term=>text.includes(term))
  && (!store||(item.retailers??[]).includes(store))
  && (!alert||(alert==='on'?Boolean(item.price_alert?.active):!item.price_alert?.active));
}
