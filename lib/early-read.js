import {merchantKey} from './receipt-extraction.js';
import {tagFingerprint} from './item-tags.js';
import {priceRange,withoutBasics} from './receipt-notifications.js';
import {personalItems,keptItems} from './style-report.js';
import {coverage,readTasteInputs} from './coverage.js';

// The early read (design/cold-start-taste-brief.md step 3): when coverage is thin, Jules sends an
// honest provisional summary instead of silence or a purchase list that says little. Every line names
// where it comes from: what the person told Jules, their orders, their outfit photos, or what they
// saved. Stated answers are their words, never something Jules saw them wear; orders are what they
// bought, never a favourite or a fit; saved items are what they like, never what they own. Plain
// observations only (no jokes). The reply composer puts it in Jules's voice.
const MAX_FACTS=5,MAX_LINE=90;
const TASTE=['style','fit','inspiration','avoid','occasion','owned','category','brand','store'];
const STATED=['stated','confirmed'];
const clip=(v,max=MAX_LINE)=>{const t=String(v??'').replace(/\s+/g,' ').trim();return t.length>max?t.slice(0,max-1).trimEnd()+'…':t;};
const list=items=>items.length>1?items.slice(0,-1).join(', ')+' and '+items.at(-1):items[0]??'';
const tagOf=(item,tags)=>{const t=tags?.[item.id];return t&&t.fp===tagFingerprint(item)?t:null;};
const GROUP_WORDS={suits_tailoring:'tailoring',jewelry_watches:'jewellery',underwear_basics:'basics',other:null};
const SIZE_LABEL={tops:'tops',bottoms:'bottoms',shoes:'shoes',dresses:'dresses',outerwear:'outerwear',suits:'suits',swimwear:'swimwear'};

// A size fact key is category/system[/brand]; the value is the label as they said it.
function sizeLine(f){
 const [category,system,brand]=String(f.key).split('/');
 const sys=system&&system!=='unknown'?` (${system.replace(/_/g,' ')})`:'';
 return `${clip(f.value,20)} in ${category}${sys}${brand?` at ${brand}`:''}`;
}
// A budget key is category/currency; the value is what they said.
function spendLine(f){
 const [category,currency]=String(f.key).split('/');
 return `${clip(f.value,30)}${currency&&currency!=='unknown'?' '+currency.toUpperCase():''}${category?` on ${category}`:''}`;
}
const top=(values,n)=>Object.entries(values.filter(Boolean).reduce((m,v)=>(m[v]=(m[v]??0)+1,m),{})).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,n);

// Returns {text, sources, lines} or null when there is nothing honest to say yet.
export function earlyReadText({facts=[],state=null,tags={},outfits={},likedRows=[],coverage:cov,outfitLines=null}={}){
 const live=facts.filter(f=>f&&!f.deleted&&STATED.includes(f.basis));
 const lines=[],sources=[];
 // What they told Jules: their own words, as saved.
 const taste=live.filter(f=>TASTE.includes(f.field)).slice(-MAX_FACTS);
 const sizes=live.filter(f=>f.field==='size'),spend=live.filter(f=>['budget','spending'].includes(f.field));
 if(taste.length)lines.push(`what you told me: ${taste.map(f=>clip(`${f.key}: ${f.value}`)).join('; ')}`);
 if(sizes.length)lines.push(`sizes you told me: ${list(sizes.slice(0,4).map(sizeLine))}`);
 if(spend.length)lines.push(`what you said you usually spend: ${list(spend.slice(0,2).map(spendLine))}`);
 if(taste.length||sizes.length||spend.length)sources.push('what you told me');
 // Their orders: what they bought, never a favourite.
 const items=state?keptItems(personalItems(state)):[];
 if(items.length){
  const parts=[];
  const typed=top(items.map(i=>tagOf(i,tags)?.group).filter(g=>g&&GROUP_WORDS[g]!==null).map(g=>GROUP_WORDS[g]??g),2).map(([g])=>g.replace(/_/g,' '));
  if(typed.length)parts.push(`mostly ${list(typed)}`);
  const channel=cov?.dimensions.find(d=>d.dimension==='channel');
  if(channel?.status==='known'&&channel.resale_share!=null)parts.push(channel.resale_share>=0.6?'mostly secondhand':channel.resale_share<=0.2?'mostly new':'a mix of secondhand and new');
  const stores=Object.values(withoutBasics(items,tags).filter(i=>i.merchant).reduce((m,i)=>{const k=merchantKey(i.merchant);if(k){m[k]??={name:i.merchant,n:0};m[k].n++;if(i.merchant.length<m[k].name.length)m[k].name=i.merchant;}return m;},{})).sort((a,b)=>b.n-a.n);
  if(stores[0]&&stores[0].n>=2)parts.push(`most often from ${stores[0].name}`);
  // Brands, the store and the spend leave basics out (underwear and sock restocks say little about taste).
  const telling=withoutBasics(items,tags);
  const brands=top(telling.filter(i=>i.brand).map(i=>i.brand),3).filter(([,n])=>n>=2).map(([b])=>b);
  if(parts.length)lines.push(`what you’ve ordered: ${parts.join(', ')}`);
  if(brands.length)lines.push(`brands you’ve bought more than once: ${list(brands)}`);
  const band=priceRange(telling,{outlier:true}),priceDim=cov?.dimensions.find(d=>d.dimension==='price_band');
  if(band&&!spend.length)lines.push(priceDim?.resale_band?`what you usually spend secondhand: ${band} per item`:`what you usually spend: ${band} per item`);
  if(parts.length||brands.length||band)sources.push('your orders');
 }
 // Their own outfit photos: the only source that shows what they wear.
 const worn=(outfitLines??outfits.texts??[]).filter(t=>typeof t==='string'&&t.trim()).slice(0,3);
 if(worn.length){lines.push(`from your outfit photos: ${worn.map(t=>clip(t)).join('; ')}`);sources.push('your outfit photos');}
 // What they saved: what they like, never what they own.
 const liked=likedRows.map(r=>r.data??{});
 if(liked.length){
  const kinds=top(liked.map(i=>i.category),2).map(([c])=>c),labels=top(liked.map(i=>i.brand),2).map(([b])=>b);
  const what=[kinds.length&&`lots of ${list(kinds)}`,labels.length&&`some ${list(labels)}`].filter(Boolean);
  if(what.length){lines.push(`from what you saved: ${what.join(', ')}`);sources.push('what you saved');}
 }
 if(!lines.length)return null;
 // What is still open, so the read says where it is unsure instead of guessing.
 const status=d=>cov?.dimensions.find(x=>x.dimension===d)?.status;
 const open=[];
 if(status('palette')==='missing')open.push('your colours');
 if(status('silhouettes')==='missing')open.push('the fits you like');
 const sizeDim=cov?.dimensions.find(d=>d.dimension==='sizes');
 for(const [c,s] of Object.entries(sizeDim?.categories??{}))if(s==='weak'&&SIZE_LABEL[c]&&open.length<3)open.push(`your size in ${SIZE_LABEL[c]}`);
 if(status('sizes')==='missing'&&!sizes.length&&open.length<3)open.push('your sizes');
 const head=`here’s my early read, from ${list(sources)}:`;
 const tail=[open.length&&`still learning: ${list(open.slice(0,3))}.`,
  (outfits.kept??0)<2?'a couple of photos of outfits you actually wear would sharpen it, whenever. tell me anytime if something’s off.':'it’ll get sharper as we go. tell me anytime if something’s off.'].filter(Boolean);
 return {text:[head,...lines,...tail].join('\n'),sources,lines};
}

// The early read for a person whose coverage is thin, or null (rich profile, nothing to say, or off).
// outfitLines: a fresh outfit reading when the caller has one; otherwise the stored reading is used.
export async function earlyReadFor(store,owner,env,{outfitLines=null,force=false,log=console.log}={}){
 if(!force&&env?.INTERVIEW_ENABLED!=='true')return null;
 const inputs=await readTasteInputs(store,owner,{log}),cov=coverage({...inputs,liked:inputs.likedRows.length});
 if(cov.level==='rich')return null;
 const read=earlyReadText({...inputs,coverage:cov,outfitLines});
 return read?{...read,level:cov.level}:null;
}

// Admin preview: what the early read would say now, without sending it.
export async function previewEarlyRead(store,owner){
 const inputs=await readTasteInputs(store,owner,{log:()=>{}}),cov=coverage({...inputs,liked:inputs.likedRows.length});
 const read=earlyReadText({...inputs,coverage:cov});
 return {level:cov.level,text:read?.text??null,used:cov.level!=='rich'};
}
