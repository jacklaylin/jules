import { clothingRange } from './relevance.js';

// Some retailers entity-encode JSON-LD. Decode only after ordinary JSON fails,
// so valid product names containing literal entities retain their original meaning.
export function decodeHTML(value) {
  return value.replace(/&(?:quot|apos|amp|lt|gt|#\d+|#x[0-9a-f]+);/gi,entity=>{
    const named={'&quot;':'"','&apos;':"'",'&amp;':'&','&lt;':'<','&gt;':'>'};
    if(named[entity.toLowerCase()])return named[entity.toLowerCase()];
    const code=entity.toLowerCase().startsWith('&#x')?parseInt(entity.slice(3,-1),16):parseInt(entity.slice(2,-1),10);
    return code>0&&code<=0x10ffff?String.fromCodePoint(code):entity;
  });
}
export function structuredJSON(value) {
  try{return JSON.parse(value);}catch{return JSON.parse(decodeHTML(value));}
}

export function productShoppingRange(html,url,product) {
  const signals=[];
  const audience=product.audience;
  signals.push(product.name,product.gender,audience?.suggestedGender,audience?.gender);
  // Only the primary product heading and its adjacent subtitle, never global navigation.
  const heading=html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>\s*<h2\b[^>]*>([\s\S]*?)<\/h2>/i);
  const compact=value=>decodeHTML(String(value??'').replace(/<[^>]*>/g,'')).toLowerCase().replace(/[^a-z0-9]/g,'');
  if(heading&&compact(heading[1]).length>=3&&compact(product.name).includes(compact(heading[1])))signals.push(decodeHTML(heading[2].replace(/<[^>]*>/g,'')));
  const page=new URL(url);
  signals.push(page.pathname.split('/').join(' '));
  const walk=value=>{
    if(Array.isArray(value))return value.forEach(walk);
    if(!value||typeof value!=='object')return;
    if([].concat(value['@type']??[]).includes('BreadcrumbList')){
      const entries=value.itemListElement??[];
      // Ignore global navigation; only breadcrumbs bound to this product page.
      const last=entries.at(-1)?.item;
      try{if(new URL(last?.['@id']??last?.url??last,page).pathname!==page.pathname)return;}catch{return;}
      for(const entry of entries.slice(0,-1)){
        const item=entry.item;
        if(item&&typeof item==='object'){
          try{const link=new URL(item['@id']??item.url,page);if(link.origin===page.origin)signals.push(item.name,link.pathname.split('/').join(' '));}catch{}
        }
      }
    }
    if(value['@graph'])walk(value['@graph']);
  };
  for(const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){try{walk(structuredJSON(match[1]));}catch{}}
  const ranges=[...new Set(signals.map(clothingRange).filter(Boolean))];
  return ranges.length===1?ranges[0]:null;
}

export function pradaProductDetails(html,url,product) {
  const page=new URL(url);
  if(!['prada.com','www.prada.com'].includes(page.hostname)||!page.pathname.includes('/p/'))return {};
  const sku=String(product.sku??product.mpn??'');
  if(!sku||!page.pathname.endsWith('/'+sku))return {};
  const attributes=tag=>Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*["']([^"']*)["']/g)].map(m=>[m[1],decodeHTML(m[2])]));
  const colors=[];
  for(const match of html.matchAll(/<a\b([^>]*)>/gi)){
    const attrs=attributes(match[1]);
    if(attrs['data-element']!=='colorpicker-dot'||!attrs.title||attrs.title.length>80)continue;
    try{
      const link=new URL(attrs.href,page);
      const candidate=link.pathname.split('/').at(-1);
      const identity=s=>s.split('_').filter((_,i)=>i!==2).join('_');
      if(link.origin!==page.origin||!link.pathname.includes('/p/')||identity(candidate)!==identity(sku))continue;
      if(!colors.some(c=>c.url===link.href))colors.push({color:attrs.title,url:link.href});
    }catch{}
  }
  const color=colors.find(c=>c.url===page.href)?.color??null;
  // The page's explicit currency configuration is data, not a guess from '$'.
  const currencies=new Set();
  const data=html.match(/<script\b[^>]*id=["']__NUXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if(data){try{
    const values=JSON.parse(data[1]);
    if(Array.isArray(values))for(const value of values){
      if(value&&typeof value==='object'&&Number.isInteger(value.currentIso)&&/^[A-Z]{3}$/.test(values[value.currentIso]??''))currencies.add(values[value.currentIso]);
    }
  }catch{}}
  return {color,color_options:colors.slice(0,8),currency:currencies.size===1?[...currencies][0]:null};
}
