// Route a clear named-item desire consistently. Generic needs and follow-up
// selections still use the conversation model; this never saves an item.
export function namedWishlistQuery(text) {
 const match=String(text??'').trim().match(/^i\s+(?:really\s+)?want\s+(?:the\s+)?(.+?)\s*[.!]*$/i);
 if(!match)return null;
 const query=match[1].replace(/[.!]+$/,'').trim();
 if(!/\b(?:sneakers?|shoes?|boots?|loafers?|sandals?|jacket|coat|bag)\s*$/i.test(query))return null;
 const description=query.replace(/\b(?:sneakers?|shoes?|boots?|loafers?|sandals?|jacket|coat|bag)\s*$/i,'').trim();
 if(description.split(/\s+/).length<2||/^(?:a|some|new|something|pair|to)\b/i.test(description))return null;
 return query;
}
export function pendingColorChoices(text,state) {
 if(state?.stage!=='choice'||String(text??'').length>160)return [];
 const normalized=String(text??'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
 const colors=[...new Set((state.options??[]).map(p=>String(p.listing_check?.color??'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()).filter(Boolean))];
 let rest=' '+normalized+' ';
 const found=colors.filter(color=>{
  const token=' '+color+' ';
  if(!rest.includes(token))return false;
  const excluded=rest.includes(' not '+color+' ')||rest.includes(' no '+color+' ');
  rest=rest.split(token).join(' ');return !excluded;
 });
 // Interpret a short selection reply, not an unrelated sentence mentioning a color.
 return found.length&&rest.trim().split(/\s+/).every(w=>['i','like','love','prefer','or','and','either','one','the','think','maybe','probably','would','go','with','leaning','toward','towards','for','me','please','both','not','but','no','yes','it','is','my','favorite'].includes(w))?found:[];
}
