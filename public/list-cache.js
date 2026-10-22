// The last list each signed-in page showed, so a return visit draws it straight away and then
// refreshes from the server. Saved per person (the sign-in token's subject): a different sign-in on
// this browser never sees it, and signing out forgets it (wishlist-session.js clear()).
const KEYS={wishlist:'jules_cache_wishlist',wardrobe:'jules_cache_wardrobe',admin_adoption:'jules_cache_admin_adoption',admin_scorecard:'jules_cache_admin_scorecard',admin_costs:'jules_cache_admin_costs'};
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
// Admin report pages (Adoption, Scorecard, Costs): the last report, which one it was (key: Costs' period and date)
// and when it loaded, so a return visit draws it at once and says how old it is.
export function readPage(storage,name,token,key=''){
 const saved=readList(storage,name,token);return saved&&saved.key===key?{data:saved.data,at:saved.at}:null;
}
// Whether fresh data matches what is drawn, so it is not drawn again. A report's generated_at changes on every
// load and is never shown, so it does not count.
export function sameData(a,b){const text=v=>JSON.stringify(v,(k,x)=>k==='generated_at'?undefined:x);return text(a)===text(b);}
export function savePage(storage,name,token,data,key='',at=Date.now()){saveList(storage,name,token,{key,at,data});}
export function forgetLists(storage){
 for(const key of Object.values(KEYS))try{storage.removeItem(key);}catch{}
 for(const person of people(storage))try{storage.removeItem(PERSON+person);}catch{}
 try{storage.removeItem(PEOPLE_KEY);}catch{}
}

// Admin › People › person (admin-person.js): each tab's last data, per person, with when it loaded. It holds
// tester details, so it stays with the signed-in owner like the lists, keeps only the few people opened most
// recently (PEOPLE_KEY lists them, newest first) and is forgotten on sign-out.
const PERSON='jules_cache_admin_person:',PEOPLE_KEY='jules_cache_admin_people',KEEP=5;
const people=storage=>{try{const list=JSON.parse(storage.getItem(PEOPLE_KEY)||'[]');return Array.isArray(list)?list:[];}catch{return [];}};
export function readView(storage,person,view,token){
 try{
  const sub=tokenSubject(token),saved=JSON.parse(storage.getItem(PERSON+person)||'null'),hit=sub&&saved?.sub===sub?saved.views?.[view]:null;
  return hit?{data:hit.data,at:hit.at}:null;
 }catch{return null;}
}
export function saveView(storage,person,view,token,data,now=Date.now()){
 try{
  const sub=tokenSubject(token);if(!sub)return;
  let saved=null;try{saved=JSON.parse(storage.getItem(PERSON+person)||'null');}catch{}
  const entry=JSON.stringify({sub,views:{...(saved?.sub===sub?saved.views:{}),[view]:{data,at:now}}});
  const others=people(storage).filter(p=>p!==person);
  for(const old of others.slice(KEEP-1))storage.removeItem(PERSON+old);
  let kept=others.slice(0,KEEP-1);
  // Storage full: the other people's copies go first, then this one is tried once more.
  try{storage.setItem(PERSON+person,entry);}catch{for(const old of kept)storage.removeItem(PERSON+old);kept=[];storage.setItem(PERSON+person,entry);}
  storage.setItem(PEOPLE_KEY,JSON.stringify([person,...kept]));
 }catch{}
}
