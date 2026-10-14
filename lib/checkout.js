import {lookupShopProduct,selectShopVariant,shopVariant} from './shop.js';

// Checkout links for items the user says they are ready to buy. Jules never pays or places an order:
// the user reviews and pays on the store's own checkout. A store that publishes structured checkout
// (today Shop's Universal Commerce Protocol catalog, which covers Shopify stores) gets a cart link with
// the exact size already in it; every other store gets its product page. Providers resolve a page;
// none of them changes which merchant was recommended.
export const CHECKOUT_PROVIDERS=[{name:'shop',resolve:(url,env)=>lookupShopProduct(url,{env}),select:(product,selected,env,shop)=>selectShopVariant(product,selected,{env,shop})}];

const host=url=>{try{return new URL(url).hostname.replace(/^www\./,'');}catch{return 'the store';}};
// Shop groups one product across merchants. A variant counts only when its cart is on the store the
// user chose; another seller's cart is never substituted.
const sameStore=(variant,url)=>Boolean(variant?.checkout_url)&&host(variant.checkout_url)===host(url);
// Shop amounts are integer minor units in the stated currency.
export function minorMoney({amount,currency}){
 const format=new Intl.NumberFormat('en-US',{style:'currency',currency});
 return format.format(amount/10**format.resolvedOptions().maximumFractionDigits);
}
export async function checkoutLink(target,{env,providers=CHECKOUT_PROVIDERS}={}){
 for(const provider of providers){
  let product=null;
  try{product=await provider.resolve(target.url,env);}
  catch{console.log(JSON.stringify({event:'checkout_provider_failed',provider:provider.name}));continue;}
  if(!product)continue;
  const own={...product,variants:(product.variants??[]).filter(v=>sameStore(v,target.url))};
  let pick=shopVariant(own,target.size,target.color);
  const store=own.variants[0]?.seller?.name??host(target.url);
  if(pick.select){
   // The store lists this size but Shop returned no variant for it: ask for that exact combination.
   let selected=null;
   try{selected=await provider.select(product,pick.select,env,own.variants[0]?.seller?.id??host(target.url));}catch{console.log(JSON.stringify({event:'checkout_provider_failed',provider:provider.name,stage:'select'}));}
   const chosen=selected?shopVariant({...selected,variants:(selected.variants??[]).filter(v=>sameStore(v,target.url))},target.size,target.color):null;
   if(!chosen?.variant)return {...target,status:selected?'unavailable':'product_page',provider:provider.name,store:selected?store:host(target.url)};
   pick=chosen;
  }
  if(pick.needs_size||!pick.variant)return {...target,status:'needs_size',provider:provider.name,store,sizes:pick.sizes??[]};
  if(pick.variant.availability?.available===false)return {...target,status:'sold_out',provider:provider.name,store};
  if(!/^https:\/\//.test(pick.variant.checkout_url??''))break;
  const size=(pick.variant.options??[]).find(o=>!/colou?r/i.test(o.name))?.label??null;
  return {...target,status:'cart',provider:provider.name,store,checkout_url:pick.variant.checkout_url,variant_id:pick.variant.id,size,
   price:Number.isInteger(pick.variant.price?.amount)&&pick.variant.price?.currency?pick.variant.price:null};
 }
 return {...target,status:'product_page',store:host(target.url)};
}
export function checkoutReply(links){
 const blocks=links.map(l=>{
  const item=l.name??'This item';
  if(l.status==='cart')return `${item}${l.size?', size '+l.size:''} at ${l.store}${l.price?' · '+minorMoney(l.price)+' before tax and shipping':''}. It’s in the cart; review and pay there:\n${l.checkout_url}`;
  if(l.status==='sold_out')return `${item}${l.size?' in size '+l.size:''} shows as sold out at ${l.store} right now.`;
  if(l.status==='unavailable')return `${item} in size ${l.size} isn’t showing as available at ${l.store} right now.`;
  if(l.status==='needs_size')return l.sizes.length?`${l.size?`I couldn’t match “${l.size}” exactly to ${l.store}’s sizes for ${item}.`:`Which size of ${item}?`} ${l.store}’s sizes: ${l.sizes.slice(0,12).join(', ')}.`:`I couldn’t match a size for ${item} at ${l.store}. Here’s the product page:\n${l.url}`;
  return `${item} at ${l.store}: choose your size and check out on the product page:\n${l.url}`;
 });
 const ask=links.some(l=>l.status==='needs_size'&&l.sizes.length)?'Tell me which one and I’ll put it in the cart.':links.some(l=>['sold_out','unavailable'].includes(l.status))?'Want me to look for it at other stores?':null;
 return [...blocks,ask,links.some(l=>l.status==='cart')?'Nothing is ordered until you pay.':null].filter(Boolean).join('\n\n');
}
