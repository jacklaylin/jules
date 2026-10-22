import {brandKey} from './brand-taste.js';
import {kindOf} from './person-summary.js';

// Admin › person › Knowledge (design: "Admin person: summary + knowledge", October 22): every piece of knowledge
// in one table. The person's own facts come from /api/profile (they stay editable there); this adds what the
// table needs beside them: a topic per fact, the brand weight, and one read-only row per derived source (what
// they did, Seen, and Jules's readings, Inferred). Pure: user context facts in, rows out.

// Each profile field's topic. An avoid joins Brands when it names a brand Jules knows of, else Style.
export const FIELD_TOPIC={shopping_range:'Person',gender:'Person',name:'Person',country:'Person',currency:'Person',size:'Sizes',brand:'Brands',
 style:'Style',fit:'Style',inspiration:'Style',occasion:'Style',category:'Style',owned:'Style',avoid:'Style',material:'Style',budget:'Budget and stores',spending:'Budget and stores',store:'Budget and stores',retailer:'Budget and stores'};
const parse=f=>{try{return f?JSON.parse(f.value):null;}catch{return null;}};
const of=(facts,field)=>parse(facts.find(f=>!f.deleted&&f.field===field));
const label=s=>String(s??'').replace(/_/g,' ');
const plural=(n,word)=>`${n} ${word}${n===1?'':'s'}`;
// What one brand's behaviour adds up to: "bought 7, 3 recent · saved 1 · liked 2".
export function brandCounts(b){
 return [b.bought?`bought ${b.bought}${b.bought_recently?`, ${b.bought_recently} recent`:''}`:null,b.wishlisted?`saved ${b.wishlisted}`:null,b.liked?`liked ${b.liked}`:null].filter(Boolean).join(' · ');
}

// facts: the user context facts (stated facts plus each derived source, lib/user-context.js).
// Returns rows (derived, read-only) and notes keyed "field|key" for the person's own facts: topic, weight
// (a number, or 'last' for an avoid) and what Jules saw of that brand.
export function knowledgeView(facts=[]){
 const live=facts.filter(f=>f&&!f.deleted),stated=live.filter(f=>kindOf(f)!=='seen'&&!['brand_taste','store_taste'].includes(f.field));
 const rows=[],notes={};
 const row=(topic,about,value,kind,source,group,extra={})=>rows.push({id:`${group}:${about}`,topic,about,value,kind,source,group,when:null,weight:null,...extra});
 const brands=of(live,'brand_taste')?.brands??[];
 const known=new Set([...brands.map(b=>brandKey(b.brand)),...stated.filter(f=>f.field==='brand').map(f=>brandKey(f.key))].filter(Boolean));
 for(const f of stated)notes[`${f.field}|${f.key}`]={topic:f.field==='avoid'&&known.has(brandKey(f.key))?'Brands':FIELD_TOPIC[f.field]??'Other',...(f.field==='avoid'?{weight:'last'}:{})};

 if(brands.length){
  const said=brands.filter(b=>b.said).length,sum=k=>brands.reduce((n,b)=>n+(b[k]??0),0);
  row('Brands','Brand taste',`${brands.slice(0,3).map(b=>b.brand).join(', ')} lead (${plural(brands.length,'brand')})`,'inferred',
   [`${said} said`,`${sum('bought')} bought`,`${sum('wishlisted')} saved`,`${sum('liked')} liked`].join(' · '),'reading');
  for(const b of brands){
   const fact=stated.find(f=>f.field==='brand'&&brandKey(f.key)===brandKey(b.brand));
   if(fact){notes[`brand|${fact.key}`]={...notes[`brand|${fact.key}`],weight:b.weight??null,seen:brandCounts(b)||null};continue;}
   if(!brandCounts(b))continue;
   const from=[b.bought?'Purchases':null,b.wishlisted?'Wishlist':null,b.liked?'Likes':null].filter(Boolean).join(', ');
   row('Brands',b.brand,brandCounts(b),'seen',from,b.bought?'purchases':b.wishlisted?'wishlist':'likes',{weight:b.weight??null,when:b.last_wishlisted??null});
  }
 }
 const stores=of(live,'store_taste')?.stores??[];
 if(stores.length)row('Budget and stores','Store taste',`${stores.slice(0,3).map(s=>s.store).join(', ')} lead (${plural(stores.length,'store')})`,'inferred',
  [`${stores.filter(s=>s.said).length} said`,`${stores.reduce((n,s)=>n+(s.ordered??0),0)} orders`,`${stores.reduce((n,s)=>n+(s.wishlisted??0),0)} saved`].join(' · '),'reading');

 const history=of(live,'shopping_history');
 if(history){
  const merchants=(history.top_merchants??[]).slice(0,3).map(m=>m.name);
  row('Budget and stores','Shopping history',`${plural(history.personal_items??history.items??0,'purchase')} for themselves${merchants.length?`; most from ${merchants.join(', ')}`:''}`,'seen','Purchases','purchases');
  const sizes=(history.purchased_sizes??[]).slice(0,4);
  if(sizes.length)row('Sizes','Bought in',sizes.map(s=>`${s.size}${s.system?` (${label(s.system)})`:''} ×${s.count}`).join(' · '),'seen',`${plural(sizes.reduce((n,s)=>n+s.count,0),'purchase')} with a size`,'purchases');
 }
 const wardrobe=of(live,'wardrobe');
 if(wardrobe?.items){
  const groups=wardrobe.groups??[];
  row('Style','Wardrobe',`${wardrobe.items} kept: ${groups.slice(0,4).map(g=>`${label(g.group)} ${g.items}`).join(' · ')}${groups.length>4?` · +${groups.length-4} more`:''}`,'seen','Purchases, closet edits','purchases');
 }
 const outfits=of(live,'outfit_photos');
 if(outfits?.kept)row('Style','Outfit photos',plural(outfits.kept,'photo')+' kept','seen','Outfit photos','outfits',{when:outfits.latest_at?.slice(0,10)??null});
 row('Style','Style reading',outfits?.reading?.length?outfits.reading.join('; '):outfits?.kept?'Not read yet':null,'inferred',outfits?.reading?.length?`From ${plural(outfits.reading_photos??outfits.kept,'outfit photo')}`:'Needs outfit photos','outfits');
 const wishlist=of(live,'wishlist');
 if(wishlist?.items){const newest=wishlist.recent?.[0];row('Saved and liked','Wishlist',`${wishlist.items} saved${newest?`; newest ${[newest.brand,newest.item].filter(Boolean).join(' ')}`:''}`,'seen','Wishlist','wishlist',{when:newest?.saved??null});}
 const liked=of(live,'liked_items');
 if(liked?.items){const kinds=(liked.categories??[]).slice(0,2).map(c=>c.name);row('Saved and liked','Liked',`${liked.items} liked${kinds.length?`; mostly ${kinds.join(' and ')}`:''}`,'seen','Shown options and screenshots','likes');}
 return {rows,notes};
}
