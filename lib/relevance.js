export function clothingRange(value) {
  const text=String(value??'').toLowerCase();
  if(/\bunisex\b|all genders|gender neutral/.test(text))return 'unisex';
  const women=/\b(women'?s?|womenswear|female)\b/.test(text);
  const men=/\b(men'?s?|menswear|male)\b/.test(text);
  return women&&!men?'women':men&&!women?'men':null;
}
// Mentions in complaints or exclusions are not requests to change clothing range.
export function requestedClothingRange(value) {
  const text=String(value??'');
  if(/\b(?:sent|sending|showed|showing|gave|giving|recommended|recommending)\b[\s\S]*\b(?:women|men|female|male)/i.test(text)&&! /\b(?:instead|rather|want|looking for|find me)\b/i.test(text))return null;
  const positive=text.replace(/\b(?:not|no|never|avoid|exclude|without|aren[’']?t|isn[’']?t|don[’']?t want)\s+(?:the\s+|any\s+|more\s+)?(?:women[’']?s?|womenswear|female|men[’']?s?|menswear|male)\b/gi,'');
  return clothingRange(positive);
}
export function shoppingConstraints(facts=[],current='') {
  const explicit=requestedClothingRange(current);
  const otherPerson=/\b(?:gift|for my (?:wife|husband|partner|daughter|son|friend)|for someone else)\b/i.test(current);
  const active=facts.filter(f=>!f.deleted);
  const saved=active.filter(f=>f.field==='shopping_range').map(f=>clothingRange(f.value)).filter(Boolean);
  const gender=active.find(f=>f.field==='gender'&&f.key==='identity');
  const identity=String(gender?.value??'').toLowerCase();
  const fallback=/\b(man|male)\b/.test(identity)?'men':/\b(woman|female)\b/.test(identity)?'women':null;
  return {range:explicit??(otherPerson?null:saved.length===1?saved[0]:fallback),size_facts:otherPerson?[]:active.filter(f=>f.field==='size').map(({key,value})=>({key,value})),
    // Taste guides ranking; a named desired product may intentionally depart from it.
    taste:otherPerson?[]:active.filter(f=>['brand','category','style','budget'].includes(f.field)).map(({field,key,value})=>({field,key,value}))};
}
const wearable=p=>/sneaker|shoe|boot|loafer|sandal|jacket|coat|shirt|sweater|polo|trouser|pant|jean|dress|skirt|short|blazer/i.test(p.name??'');
export function relevanceCheck(product,constraints={}) {
  const actual=product.listing_check?.shopping_range;
  const expected=constraints.range;
  if(!expected||expected==='unisex'||!wearable(product))return {eligible:true,reason:'no_range_constraint'};
  if(actual===expected||actual==='unisex')return {eligible:true,reason:'range_match'};
  return {eligible:false,reason:actual?'range_mismatch':'range_unverified'};
}
export function relevantProducts(result,constraints) {
  const rejected=[];
  const products=(result.products??[]).flatMap(p=>{
    const check=relevanceCheck(p,constraints);
    if(!check.eligible){rejected.push({url:p.url,reason:check.reason});return [];}
    return [{...p,merchant_options:(p.merchant_options??[]).filter(m=>relevanceCheck({...p,listing_check:m.listing_check},constraints).eligible)}];
  });
  const rejections=[...(result.relevance_rejections??[]),...rejected];
  return {...result,products,relevance_rejections:rejections,...(!products.length&&rejections.length?{status:'needs_review',intro:'I found listings, but couldn’t verify one in your shopping range yet.'}:{})};
}
