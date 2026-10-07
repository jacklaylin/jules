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
