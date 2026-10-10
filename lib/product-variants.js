import {publicURL} from './public-url.js';

// Read retailer product JSON as data; never execute embedded scripts.
export function shopifyProduct(html){
 for(const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)){
  const text=script[1];
  const starts=[0,...[...text.matchAll(/\bproduct\s*:\s*(?=\{)/g)].map(m=>m.index+m[0].length)];
  for(const start of starts){
   let end=start,depth=0,quoted=false,escape=false;
   for(;end<text.length;end++){const c=text[end];if(quoted){if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')quoted=false;}else if(c==='"')quoted=true;else if(c==='{')depth++;else if(c==='}'&&--depth===0){end++;break;}}
   try{const p=JSON.parse(text.slice(start,end).trim());if(Array.isArray(p.variants)&&Array.isArray(p.options)&&typeof p.title==='string')return p;}catch{}
  }
 }
 return null;
}
export function shopifyColorOptions(html,url,product){
 return colorOptionsFromProduct(shopifyProduct(html),url,product);
}
export function colorOptionsFromProduct(p,url,product){
 if(!p||!Array.isArray(p.options)||!Array.isArray(p.variants)||p.title!==product.name.split(' - ')[0])return [];
 const index=p.options.findIndex(o=>/^(?:color|colour)$/i.test(typeof o==='string'?o:o?.name));if(index<0)return [];
 const colors=new Map();
 for(const v of p.variants){const color=v.options?.[index]??v['option'+(index+1)];if(typeof color!=='string'||!Number.isSafeInteger(v.id))continue;
  if(colors.has(color)){colors.get(color).variant_ids.push(String(v.id));continue;}
  const variant=new URL(url);variant.searchParams.set('variant',String(v.id));
  const asset=v.featured_image?.src;const image=asset&&publicURL(new URL(asset,url).href);
  colors.set(color,{color,url:variant.href,image:image??null,variant_ids:[String(v.id)]});
 }
 return [...colors.values()].slice(0,24);
}

// Lemaire publishes colors as product-page swatch links, separate from size variants.
export function retailerColorSwatches(html,url){
 const base=new URL(url);if(!['lemaire.fr','www.lemaire.fr'].includes(base.hostname))return [];
 const values=new Map();
 for(const match of html.matchAll(/<a\b([^>]*)>/gi)){
  const attrs=Object.fromEntries([...match[1].matchAll(/([\w-]+)\s*=\s*["']([^"']*)["']/g)].map(m=>[m[1],m[2]]));
  if(!attrs.class?.split(/\s+/).includes('product-swatches__item')||!attrs.title?.trim()||attrs.title.length>100||!attrs.href)continue;
  try{const target=new URL(attrs.href.replaceAll('&amp;','&'),base);if(target.origin!==base.origin||!target.pathname.startsWith('/products/'))continue;
   for(const key of ['country','currency'])if(base.searchParams.has(key))target.searchParams.set(key,base.searchParams.get(key));
   values.set(target.href,{color:attrs.title.replaceAll('&amp;','&').trim(),url:target.href,image:null});
  }catch{}
 }
 return [...values.values()].slice(0,24);
}
