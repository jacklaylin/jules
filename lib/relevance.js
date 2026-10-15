// Normalizes retailer listing metadata (breadcrumbs, audience); never applied to user messages.
export function clothingRange(value) {
  const text=String(value??'').toLowerCase();
  if(/\bunisex\b|all genders|gender neutral/.test(text))return 'unisex';
  const women=/\b(women'?s?|womenswear|female)\b/.test(text);
  const men=/\b(men'?s?|menswear|male)\b/.test(text);
  return women&&!men?'women':men&&!women?'men':null;
}
export const RANGES=['men','women','unisex'];
export const GENDERS=['man','woman','non-binary','prefer-not-to-say'];
const GENDER_RANGE={man:'men',woman:'women'};
// request is the agent's structured reading of the current message: department and recipient.
// Stored beliefs use fixed values, so nothing here interprets wording.
// A recipient the user has told Jules about (facts with that person label) brings their own sizes
// and taste; the user's own facts never apply to someone else.
export function shoppingConstraints(facts=[],request={}) {
  const otherPerson=request.for_someone_else===true;
  const explicit=RANGES.includes(request.department)?request.department:null;
  const recipient=otherPerson&&typeof request.recipient==='string'?request.recipient.trim().toLowerCase():null;
  if(recipient){
    const theirs=facts.filter(f=>!f.deleted&&f.person===recipient);
    return {range:explicit,size_facts:theirs.filter(f=>f.field==='size').map(({key,value})=>({key,value})),
      taste:theirs.filter(f=>['brand','category','style','budget'].includes(f.field)).map(({field,key,value})=>({field,key,value})),recipient};
  }
  const active=facts.filter(f=>!f.deleted&&!f.person);
  const saved=[...new Set(active.filter(f=>f.field==='shopping_range'&&RANGES.includes(f.value)).map(f=>f.value))];
  const fallback=GENDER_RANGE[active.find(f=>f.field==='gender'&&f.key==='identity')?.value]??null;
  return {range:explicit??(otherPerson?null:saved.length===1?saved[0]:fallback),size_facts:otherPerson?[]:active.filter(f=>f.field==='size').map(({key,value})=>({key,value})),
    // Taste guides ranking; a named desired product may intentionally depart from it.
    taste:otherPerson?[]:active.filter(f=>['brand','category','style','budget','shopping_history'].includes(f.field)).map(({field,key,value})=>({field,key,value}))};
}
const wearable=p=>/sneaker|shoe|boot|loafer|sandal|jacket|coat|shirt|sweater|polo|trouser|pant|jean|dress|skirt|short|blazer/i.test(p.name??'');
export function relevanceCheck(product,constraints={}) {
  const actual=product.listing_check?.shopping_range;
  const expected=constraints.range;
  if(!expected||expected==='unisex')return {eligible:true,reason:'no_range_constraint'};
  if(!actual&&constraints.allow_unknown_range)return {eligible:true,reason:'range_unknown'};
  if(!actual&&!wearable(product))return {eligible:true,reason:'no_range_constraint'};
  if(actual===expected||actual==='unisex')return {eligible:true,reason:'range_match'};
  return {eligible:false,reason:actual?'range_mismatch':'range_unverified'};
}
export function relevantProducts(result,constraints) {
  const rejected=[];
  const products=(result.products??[]).flatMap(p=>{
    // A failed page check is a sourcing failure, not evidence of a wrong department.
    if(p.sourcing_status==='store_not_found')return [p];
    const check=relevanceCheck(p,constraints);
    if(!check.eligible){rejected.push({url:p.url,reason:check.reason,listing_check:p.listing_check});return [];}
    return [{...p,merchant_options:(p.merchant_options??[]).filter(m=>relevanceCheck({...p,listing_check:m.listing_check},constraints).eligible)}];
  });
  const rejections=[...(result.relevance_rejections??[]),...rejected];
  return {...result,products,relevance_rejections:rejections,...(!products.length&&rejections.length?{status:'needs_review',intro:rangeFailure(rejections,constraints)}:{})};
}
export function rangeFailure(rejections=[],constraints={}) {
  const range=constraints.range==='men'?"men’s":constraints.range==='women'?"women’s":'your';
  return rejections.some(r=>r.reason==='range_unverified')?`The candidate listings don’t state a department. I haven’t confirmed a ${range} option or an exact match yet.`:`The listings I found were for a different department. I haven’t found a verified ${range} option yet.`;
}
