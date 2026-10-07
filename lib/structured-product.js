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
