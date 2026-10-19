// The last list each signed-in page showed, so a return visit draws it straight away and then
// refreshes from the server. Saved per person (the sign-in token's subject): a different sign-in on
// this browser never sees it, and signing out forgets it (wishlist-session.js clear()).
const KEYS={wishlist:'jules_cache_wishlist',wardrobe:'jules_cache_wardrobe'};
export function tokenSubject(token){
 try{return JSON.parse(atob(String(token).split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).sub||null;}catch{return null;}
}
export function readList(storage,name,token){
 try{const sub=tokenSubject(token),saved=JSON.parse(storage.getItem(KEYS[name])||'null');return sub&&saved?.sub===sub?saved.data:null;}catch{return null;}
}
// Storage can be full or blocked (private windows); the page then simply loads as before.
export function saveList(storage,name,token,data){
 try{const sub=tokenSubject(token);if(sub)storage.setItem(KEYS[name],JSON.stringify({sub,data}));}catch{}
}
export function forgetLists(storage){
 for(const key of Object.values(KEYS))try{storage.removeItem(key);}catch{}
}
