import {retailerFor} from './retailers.js';
import {brandKey} from './brand-taste.js';

// The stores a person likes, read like brand_taste (founder, October 22): what they said about a store, how
// often they order there (returns counted apart), what they saved from it and the platforms of items they
// liked. Code only groups by store name and counts; the models that read it weigh it. Never a filter or a
// loyalty claim; avoids and corrections stated elsewhere win.
const day=value=>{const at=Date.parse(value??'');return Number.isFinite(at)?new Date(at).toISOString().slice(0,10):null;};
// A saved item's store: the registry's name for its domain, else the domain's own name (deeceestyle.ch → deeceestyle).
export function storeOf(url,brand=''){
  try{const r=retailerFor(url,brand),domain=r.domain?.split('.').at(-2)??null;return r.name&&r.name!==r.domain?r.name:domain;}
  catch{try{return new URL(url).hostname.replace(/^www\./,'').split('.').at(-2)??null;}catch{return null;}}
}
// facts: stated profile facts. orders: the purchase summary's store_orders ({store,orders,returns,last_order}).
// wishlist: wishlist entries. liked: liked-item rows' platforms ({name,count}).
export function storeTaste({facts=[],orders=[],wishlist=[],liked=[]}={}){
  const stores=new Map();
  const entry=name=>{const k=brandKey(name);if(!k)return null;if(!stores.has(k))stores.set(k,{store:String(name).trim(),said:null,ordered:0,returned:0,last_order:null,wishlisted:0,last_wishlisted:null,liked:0});return stores.get(k);};
  for(const f of facts)if(!f.deleted&&f.field==='store'&&f.key){const e=entry(f.key);if(e&&(!e.said||(day(f.updated_at)??'')>(e.said.on??'')))e.said={value:String(f.value??'').slice(0,80),on:day(f.updated_at)};}
  for(const o of orders??[]){const e=entry(o?.store);if(e){e.ordered+=Math.max(0,(o.orders??0)-(o.returns??0));e.returned+=o.returns??0;if((o.last_order??'')>(e.last_order??''))e.last_order=o.last_order;}}
  const seen=new Set();
  for(const w of wishlist??[]){
    const id=w.item_id??w.url;if(!id||!w.url)continue;const e=entry(storeOf(w.url,w.brand));if(!e)continue;
    if(!seen.has(id)){seen.add(id);e.wishlisted++;}
    const on=day(w.messages?.created_at);if(on&&on>(e.last_wishlisted??''))e.last_wishlisted=on;
  }
  for(const l of liked??[]){const e=entry(l?.name);if(e)e.liked+=l.count??0;}
  // The weight stays on each entry, as for brands, so Admin › Knowledge can show it.
  const weight=e=>e.wishlisted*3+e.liked*3+Math.min(e.ordered,10);
  return [...stores.values()].map(e=>({...e,weight:weight(e)})).sort((a,b)=>b.weight-a.weight||(b.said?1:0)-(a.said?1:0)||a.store.localeCompare(b.store))
    .filter((e,i)=>i<15||e.said).map(e=>Object.fromEntries(Object.entries(e).filter(([,v])=>v!==null&&v!==0)));
}
export function storeTasteFact(input){
  const stores=storeTaste(input);
  return stores.length?{field:'store_taste',key:'summary',basis:'inferred',value:JSON.stringify({stores})}:null;
}
export function storeTasteOf(facts=[]){
  const f=facts.find(x=>!x.deleted&&x.field==='store_taste');
  try{return f?JSON.parse(f.value).stores??null:null;}catch{return null;}
}
