import {coverage,readTasteInputs} from './coverage.js';
import {earlyReadText} from './early-read.js';
import {profileText,priceRange} from './receipt-notifications.js';
import {personalItems,keptItems} from './style-report.js';
import {CATEGORY_FOR,tagFingerprint} from './item-tags.js';
import {brandTasteOf} from './brand-taste.js';
import {storeTasteOf} from './store-taste.js';
import {DERIVED_FIELDS} from './user-context.js';

// Admin › person › Summary (design: "Admin person: summary + knowledge", October 22): one row per thing Jules
// weighs, merging taste coverage (lib/coverage.js), a plain summary of what is known and where it came from,
// plus what Jules would text now. Pure apart from personSummary, which reads. Nothing is sent or saved.

// Where a piece of knowledge came from. said: they told Jules (stated or confirmed); seen: counted from what
// they did (purchases, wardrobe, saves, likes, outfit photos); inferred: Jules's own reading (a fact it picked
// up without being told, the brand and store readings).
const SEEN=new Set(DERIVED_FIELDS.filter(f=>!['brand_taste','store_taste'].includes(f)));
export function kindOf(fact){
 if(SEEN.has(fact.field))return 'seen';
 if(['brand_taste','store_taste'].includes(fact.field)||fact.basis==='inferred')return 'inferred';
 return 'said';
}
const live=facts=>(facts??[]).filter(f=>f&&!f.deleted);
const text=v=>typeof v==='string'?v.trim():'';
const clip=(v,max=60)=>{const t=text(String(v??'')).replace(/\s+/g,' ');return t.length>max?t.slice(0,max-1).trimEnd()+'…':t;};
// A coverage note ("7 categories across 58 purchases") as a sentence.
const sentence=note=>note?note[0].toUpperCase()+note.slice(1)+'.':null;
const list=(items,n=4)=>items.filter(Boolean).slice(0,n).join(', ');
const counts=facts=>facts.reduce((m,f)=>{const k=kindOf(f);m[k]=(m[k]??0)+1;return m;},{said:0,seen:0,inferred:0});
const tagOf=(item,tags)=>{const t=tags?.[item.id];return t&&t.fp===tagFingerprint(item)?t:null;};
const top=(values,n)=>Object.entries(values.filter(Boolean).reduce((m,v)=>(m[v]=(m[v]??0)+1,m),{})).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,n);

const RANGE={men:'Men’s',women:'Women’s',unisex:'Unisex'};
const GENDER={man:'man',woman:'woman','non-binary':'non-binary'};
// What would fill a gap, per coverage dimension. Shown only while a dimension is weak or missing.
export const GAP_HINTS={
 categories:'Connect Gmail or Shop, or ask what they wear most.',
 silhouettes:'An outfit photo or two would fill this.',
 palette:'Receipts rarely name colours. Ask, or read outfit photos.',
 brands:'Ask which brands they like, or wait for saves.',
 sizes:'Ask their size in the categories still missing.',
 stores:'Ask where they like to shop.',
 price_band:'Ask what they usually spend.',
 channel:'Ask whether they buy secondhand.',
};

function sizeText(f){
 const [category,system,brand]=text(f.key).split('/');
 const sys=system&&system!=='unknown'?` (${system.replace(/_/g,' ')})`:'';
 return `${category}${brand?` at ${brand}`:''} ${clip(f.value,20)}${sys}`;
}

// rows: one per dimension plus clothing range, in the Summary's order.
// input: what readTasteInputs returns (facts, state, tags, wishlist, likedRows, outfits) plus context (the
// user context facts, with the brand and store readings) and coverage.
export function profileRows({facts=[],state=null,tags={},outfits={},context=[],coverage:cov}){
 const stated=live(facts),all=live(context.length?context:facts);
 const items=state?keptItems(personalItems(state)):[];
 const dim=d=>cov?.dimensions.find(x=>x.dimension===d)??{status:'missing',sources:{},note:null};
 const row=(topic,label,{summary=null,detail=null,from={},reading=false})=>{
  const d=topic==='range'?null:dim(topic);
  return {topic,label,status:d?.status??null,summary,detail:[detail,d&&d.status!=='known'?GAP_HINTS[topic]:null].filter(Boolean).join(' ')||null,note:d?.note??null,from:{said:0,seen:0,inferred:0,...from},reading};
 };
 const out=[];

 const range=stated.filter(f=>f.field==='shopping_range'),gender=stated.filter(f=>f.field==='gender');
 out.push(row('range','Clothing range',{summary:[RANGE[text(range[0]?.value)]??null,GENDER[text(gender[0]?.value)]??null].filter(Boolean).join(' · ')||null,from:counts([...range,...gender])}));

 const sizes=stated.filter(f=>f.field==='size'),sizeDim=dim('sizes');
 const open=Object.entries(sizeDim.categories??{}).filter(([,s])=>s==='weak').map(([c])=>sizeDim.bought?.[c]?`${c} (bought in ${sizeDim.bought[c]})`:c);
 out.push(row('sizes','Sizes',{summary:sizes.length?list(sizes.map(sizeText),5).replace(/, /g,' · '):null,
  detail:open.length?`No size stated for ${list(open)}.`:null,from:{...counts(sizes),seen:sizeDim.sources?.purchased_sizes??0}}));

 const brands=brandTasteOf(all)??[],avoid=stated.filter(f=>f.field==='avoid');
 const brandSaid=stated.filter(f=>f.field==='brand');
 const brandSeen=brands.reduce((n,b)=>n+(b.bought??0)+(b.wishlisted??0)+(b.liked??0),0);
 out.push(row('brands','Brands',{summary:brands.length?`${list(brands.map(b=>b.brand),3)} lead`:brandSaid.length?list(brandSaid.map(f=>f.key),3):null,
  detail:[brands.length>3?`Top 3 of ${brands.length} brands, by saves, likes and kept purchases.`:null,avoid.length?`Said to avoid ${list(avoid.map(f=>f.key),3)}.`:null].filter(Boolean).join(' ')||null,
  from:brands.length?{said:counts(brandSaid).said,seen:brandSeen,inferred:1}:counts(brandSaid),reading:brands.length>0}));

 const owned=stated.filter(f=>['category','owned'].includes(f.field));
 const groups=top(items.map(i=>tagOf(i,tags)?.group).filter(g=>g&&CATEGORY_FOR[g]!=='other'),4).map(([g])=>g.replace(/_/g,' '));
 out.push(row('categories','Categories',{summary:groups.length?list(groups):owned.length?list(owned.map(f=>clip(f.value,30))):null,
  detail:sentence(dim('categories').note),from:{...counts(owned),seen:dim('categories').sources?.purchases??0}}));

 const stores=storeTasteOf(all)??[],storeSaid=stated.filter(f=>f.field==='store');
 out.push(row('stores','Stores',{summary:stores.length?list(stores.map(s=>s.store),3):storeSaid.length?list(storeSaid.map(f=>f.key),3):null,
  detail:[sentence(dim('stores').note),...storeSaid.slice(0,1).map(f=>`Said about ${f.key}: ${clip(f.value,50)}.`)].filter(Boolean).join(' ')||null,
  from:{...counts(storeSaid),seen:dim('stores').sources?.purchases??0}}));

 const budget=stated.filter(f=>['budget','spending'].includes(f.field)),band=priceRange(items);
 out.push(row('price_band','Price band',{summary:budget.length?list(budget.map(f=>clip(f.value,30)),2):band?`${band} an item`:null,
  detail:budget.length&&band?`Receipts: ${band} an item.`:null,from:{...counts(budget),seen:dim('price_band').sources?.priced??0}}));

 const channel=dim('channel'),share=channel.resale_share;
 out.push(row('channel','New vs resale',{summary:share==null?null:share>=0.6?'Mostly secondhand':share<=0.2?'Mostly new':'A mix of secondhand and new',
  detail:sentence(channel.note),from:{seen:channel.sources?.purchases??0}}));

 const shape=stated.filter(f=>f.field==='fit'||(f.field==='style'&&f.key==='silhouette'));
 const looks=stated.filter(f=>['style','inspiration'].includes(f.field)&&!shape.includes(f)&&f.key!=='palette');
 const worn=(outfits.texts??[]).slice(0,2);
 out.push(row('silhouettes','Silhouettes',{summary:shape.length?list(shape.map(f=>clip(f.value,40)),2):worn.length?list(worn.map(t=>clip(t,50)),2):looks.length?`A style reference only: ${list(looks.map(f=>clip(f.value,40)),2)}`:null,
  detail:sentence(dim('silhouettes').note),from:{...counts([...shape,...looks]),seen:outfits.kept??0}}));

 const palette=stated.filter(f=>f.field==='style'&&f.key==='palette');
 const colours=top(items.map(i=>tagOf(i,tags)?.color_family).filter(c=>c&&!['unknown','multi'].includes(c)),3).map(([c])=>c);
 out.push(row('palette','Palette',{summary:palette.length?list(palette.map(f=>clip(f.value,40)),2):dim('palette').status==='known'&&colours.length?`Mostly ${list(colours)}`:null,
  detail:sentence(dim('palette').note),from:{...counts(palette),seen:dim('palette').sources?.purchases??0}}));
 return out;
}

// What Jules would text this person now: the early read while coverage is thin, the purchase summary once
// it is rich (lib/receipt-notifications.js profileText, from outfit observations already read: no model call),
// or nothing when a rich profile has no import to summarise.
export function textNow({facts=[],state=null,tags={},outfits={},likedRows=[],coverage:cov}){
 if(cov.level!=='rich'){
  const read=earlyReadText({facts,state,tags,outfits,likedRows,coverage:cov});
  return {kind:'early_read',text:read?.text??null};
 }
 if(!state)return {kind:'none',text:null};
 const body=profileText(state,(outfits.texts??[]).map(t=>({text:t})),{tags});
 return {kind:'purchases',text:body,open_questions:(state.questions??[]).filter(q=>q.status==='open').length};
}

export async function personSummary(store,owner){
 const inputs=await readTasteInputs(store,owner,{log:()=>{}});
 const cov=coverage({...inputs,liked:inputs.likedRows.length});
 return {coverage:{level:cov.level,known:cov.known,total:cov.dimensions.length,missing:cov.dimensions.filter(d=>d.status!=='known').map(d=>d.dimension)},
  rows:profileRows({...inputs,coverage:cov}),text_now:textNow({...inputs,coverage:cov})};
}
