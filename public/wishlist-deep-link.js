const key='jules_wishlist_open_item';
const valid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function rememberWishlistTarget(search,storage,now=Date.now()){
 const item=new URLSearchParams(search).get('item');
 if(valid(item))storage.setItem(key,JSON.stringify({item,expires:now+30*60*1000}));
}
export function consumeWishlistTarget(items,storage,now=Date.now()){
 const raw=storage.getItem(key);if(!raw)return null;storage.removeItem(key);
 let target;try{target=JSON.parse(raw);}catch{return null;}
 if(!valid(target.item)||!Number.isFinite(target.expires)||target.expires<now)return null;
 // Resolve only against the current authenticated account's collection.
 const item=items.find(i=>i.id===target.item||i.image_item===target.item||i.entries?.some(e=>e.item_id===target.item));
 return item?{id:item.id}:{missing:true};
}
// The open product page's id rides in the address bar (?item=), so a copied or reloaded link reopens it.
export function itemURL(href,id){const url=new URL(href);if(id)url.searchParams.set('item',id);else url.searchParams.delete('item');return url.pathname+url.search;}
