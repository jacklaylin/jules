// One reading of the brands a person likes, from every source the user context layer reads (USER-CONTEXT.md):
// what they said in chat, what they bought, what they saved to their wishlist and what they liked.
// October 22 (founder): the saved "favorite brand" facts were three brands from one early message, copied
// again by the style pack, and the stylist read them as the person's fixed taste. Here a statement is one
// dated signal beside repeated, recent behaviour; the models that read this weigh it, nothing here filters.
// Code only groups by brand name and counts; it never reads what a statement means. Avoids and corrections
// stay their own facts and win (TASTE_GUIDE).

// Brand names compare without accents, case, punctuation, a source prefix (style-pack/prada) or Saint/St.
export const brandKey=value=>String(value??'').split('/').at(-1).normalize('NFKD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/^(?:saint|st)\s+/,'saint ').replace(/[^a-z0-9]/g,'');
const day=value=>{const at=Date.parse(value??'');return Number.isFinite(at)?new Date(at).toISOString().slice(0,10):null;};
const parse=value=>{try{return JSON.parse(value);}catch{return null;}};

// The wishlist as a source: distinct saved items per brand and the newest save. An item saved twice
// counts once; removed items are already left out by the store.
export function wishlistFact(entries=[]){
  const items=new Map();
  for(const e of entries??[]){
    const id=e.item_id??e.url;if(!id)continue;
    const at=e.messages?.created_at??null,prev=items.get(id);
    if(!prev||(Date.parse(at)||0)>(Date.parse(prev.at)||0))items.set(id,{brand:e.brand??null,name:e.display_name??e.name??null,at,bought:e.bought===true||e.bought==='true'});
  }
  if(!items.size)return null;
  const list=[...items.values()].sort((a,b)=>(Date.parse(b.at)||0)-(Date.parse(a.at)||0));
  return {field:'wishlist',key:'summary',basis:'inferred',value:JSON.stringify({items:list.length,
    recent:list.slice(0,10).map(i=>({brand:i.brand,item:i.name,saved:day(i.at),...(i.bought?{bought:true}:{})})),
    meaning:'Items the person saved to their wishlist: things they want, soft taste evidence; not purchases, stock or a size.'})};
}

// facts: stated profile facts. purchases: the purchase summary's top_brands ({name,count,recent}).
// closet: the closet summary's brands ({brand,items,recent,groups}): kept items only (no returns, gifts or
// basics). When present it gives every purchase count, and the receipt summary is not used.
// wishlist: wishlist entries. liked: the liked-items fact's brands ({name,count}).
export function brandTaste({facts=[],purchases=[],closet=null,wishlist=[],liked=[]}={}){
  const brands=new Map();
  const entry=name=>{const k=brandKey(name);if(!k)return null;if(!brands.has(k))brands.set(k,{brand:String(name).split('/').at(-1).trim(),said:null,bought:0,bought_recently:0,bought_as:null,wishlisted:0,last_wishlisted:null,liked:0});return brands.get(k);};
  // A statement and its copy under a source prefix (style-pack/prada) are one statement, dated by the
  // statement itself: a copy never makes it look newer. A later statement in chat does.
  const copy=f=>String(f.key).includes('/');
  for(const f of [...facts].sort((a,b)=>copy(a)-copy(b)))if(!f.deleted&&f.field==='brand'&&f.key){
    const e=entry(f.key);if(!e)continue;
    const said={value:String(f.value??'').slice(0,80),on:day(f.updated_at),...(f.source&&f.source!=='message'?{from:f.source}:{})};
    if(!e.said||!copy(f)&&(said.on??'')>(e.said.on??''))e.said=said;
  }
  if(Array.isArray(closet)){
    // The closet holds what they kept: returns, gifts and basics are left out, so it alone gives the counts.
    for(const b of closet){const e=entry(b?.brand);if(e){e.bought+=b.items??0;e.bought_recently+=b.recent??0;if(Object.keys(b.groups??{}).length)e.bought_as={...b.groups};}}
  }else for(const b of purchases??[]){const e=entry(b?.name);if(e){e.bought+=b.count??0;e.bought_recently+=b.recent??0;}}
  const seen=new Set();
  for(const w of wishlist??[]){
    const id=w.item_id??w.url,e=entry(w.brand);if(!e||!id)continue;
    if(!seen.has(id)){seen.add(id);e.wishlisted++;}
    const on=day(w.messages?.created_at);if(on&&on>(e.last_wishlisted??''))e.last_wishlisted=on;
  }
  for(const b of liked??[]){const e=entry(b?.name);if(e)e.liked+=b.count??0;}
  // Order by how much behaviour backs the brand. Saves and likes are choices, so each counts more than a
  // receipt line, and purchases are capped so a stack of gym kit or socks doesn't drown them out. Every
  // stated brand stays in the list (after those with evidence when nothing backs it).
  const weight=e=>e.wishlisted*3+e.liked*3+Math.min(e.bought,5)+Math.min(e.bought_recently,5);
  const ranked=[...brands.values()].map(e=>({...e,weight:weight(e)})).sort((a,b)=>b.weight-a.weight||(b.said?1:0)-(a.said?1:0)||a.brand.localeCompare(b.brand));
  return ranked.filter((e,i)=>i<20||e.said).map(({weight,...e})=>Object.fromEntries(Object.entries(e).filter(([,v])=>v!==null&&v!==0)));
}
export function brandTasteFact(input){
  const brands=brandTaste(input);
  if(!brands.length)return null;
  return {field:'brand_taste',key:'summary',basis:'inferred',value:JSON.stringify({brands,
    meaning:'The brands this person likes, from everything Jules knows: said (what they told Jules, with the date; from names another source, such as the style report), bought (items they kept: returns, gifts and basics left out; bought_recently in the last two years), wishlisted (distinct items saved, with the newest save) and liked. bought_as says what kinds of items those purchases were: a brand is strong context for requests of those kinds and much weaker for others (a gym brand informs gym clothes, not a shirt). Read them together: repeated and recent saves, likes and purchases show their taste now; a single old statement with nothing behind it is weaker. Purchases are not favourites. Soft taste, never a filter, a whitelist or a claim of loyalty. Avoids and corrections stated elsewhere win.'})};
}
// The parsed brand list from a facts array, or null when there is no brand_taste fact.
export function brandTasteOf(facts=[]){
  const f=facts.find(x=>!x.deleted&&x.field==='brand_taste');
  return f?parse(f.value)?.brands??null:null;
}
