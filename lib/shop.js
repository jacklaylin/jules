import SHOPIFY_STORES from './shopify-stores.json' with {type:'json'};

// Shop (Shopify's agent catalog, checkout links and order history) over its stateless MCP HTTP binding.
// Shop covers Shopify stores only, so it is one source among several: it supplies candidate URLs and
// structured variant facts; it never ranks merchants. Every candidate still passes the same listing check.
export const SHOP_ENDPOINT='https://mcp.shop.com/';
const PROTOCOL='2026-07-28';
const META={'io.modelcontextprotocol/protocolVersion':PROTOCOL,'io.modelcontextprotocol/clientInfo':{name:'jules',version:'1.0'},'io.modelcontextprotocol/clientCapabilities':{}};
export const shopEnabled=(env,feature)=>env[feature]==='true';

export async function shopCall(tool,args,{fetcher=fetch,token=null,timeout=15000}={}){
 const response=await fetcher(SHOP_ENDPOINT,{method:'POST',signal:AbortSignal.timeout(timeout),
  headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':PROTOCOL,'Mcp-Method':'tools/call','Mcp-Name':tool,...(token?{Authorization:'Bearer '+token}:{})},
  body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:tool,arguments:args,_meta:META}})});
 // 401: sign-in required and the tool was not run. 403 is request policy, not sign-in.
 if(response.status===401)throw Object.assign(Error('Shop sign-in required'),{code:'auth_required'});
 if(!response.ok)throw Object.assign(Error('Shop request failed'),{code:'http',status:response.status});
 const data=await response.json();
 if(data.error)throw Object.assign(Error('Shop protocol error'),{code:'protocol'});
 // Tool results carry structuredContent; the same JSON is also in the text content.
 const result=data.result??{},content=result.structuredContent??(()=>{try{return JSON.parse(result.content?.find(c=>c.type==='text')?.text??'');}catch{return null;}})();
 if(result.isError||!content)throw Object.assign(Error('Shop tool error'),{code:'tool',messages:content?.messages??[]});
 return content;
}

// Registry stores that run on Shopify, from scripts/shopify-stores.js. A named brand whose official
// store is listed is searched inside that store first.
export function shopifyStoreFor(brand,stores=SHOPIFY_STORES.stores){
 const key=String(brand??'').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g,'');
 if(!key)return null;
 return Object.entries(stores).find(([,s])=>s.tier==='official'&&s.brands.some(b=>b.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g,'')===key))?.[0]??null;
}
// A filter Shop reports it ignored is surfaced, never treated as applied.
export const ignoredFilters=messages=>(messages??[]).filter(m=>m?.code==='not_found'&&String(m.path??'').startsWith('$.filters')).map(m=>({path:m.path,message:String(m.content??'').slice(0,200)}));
const context=env=>({address_country:env.SHOPPING_COUNTRY??'US',currency:env.SHOPPING_CURRENCY??({US:'USD',CA:'CAD',GB:'GBP',AU:'AUD'}[env.SHOPPING_COUNTRY??'US']??'USD')});

export function shopOffer(product){
 const variant=product?.variants?.[0];
 if(!variant?.url)return null;
 return {product_id:product.id,variant_id:variant.id,url:variant.url,title:product.title??variant.title??null,
  seller:{name:variant.seller?.name??null,domain:variant.seller?.domain??null,url:variant.seller?.url??null},
  price:Number.isInteger(variant.price?.amount)&&variant.price?.currency?{amount:variant.price.amount,currency:variant.price.currency}:null,
  available:variant.availability?.available??null,options:(product.options??[]).map(o=>({name:o.name,labels:(o.values??[]).map(v=>v.label)}))};
}
// Catalog search. Results are candidates for the normal listing check, not verified offers.
export async function searchShop(query,{env,fetcher=fetch,shops=[],limit=6}={}){
 const args={catalog:{query:String(query).slice(0,300),context:context(env),...(shops.length?{filters:{shops}}:{}),pagination:{limit}}};
 const content=await shopCall('search_catalog',args,{fetcher,timeout:10000});
 return {offers:(content.products??[]).map(shopOffer).filter(Boolean),ignored_filters:ignoredFilters(content.messages),next:(content.next??[]).slice(0,4),shops};
}
// Resolves a store page to Shop's product, or null when Shop doesn't carry it. The lookup lists every
// option value the store uses; its variants are only the featured one.
export async function lookupShopProduct(url,{env,fetcher=fetch}={}){
 return (await shopCall('lookup_catalog',{catalog:{ids:[url],context:context(env)}},{fetcher})).products?.[0]??null;
}
const label=value=>String(value??'').normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
const isColor=name=>/colou?r/i.test(name);
// Picks the variant for a size label exactly as the store writes it. The store's size list comes from
// the product's options (Shop may return only in-stock variants). Never converts sizes: a label the
// store doesn't use returns the store's own labels; a listed size without a returned variant needs a
// selection request, and is unavailable if Shop still doesn't return it.
export function shopVariant(product,size,color=null){
 const variants=product?.variants??[];
 const sizeOption=(product?.options??[]).find(o=>!isColor(o.name)&&o.values?.length);
 const colorMatch=v=>!color||!(v.options??[]).some(o=>isColor(o.name))||(v.options??[]).some(o=>isColor(o.name)&&label(o.label)===label(color));
 const candidates=variants.filter(colorMatch);
 if(!sizeOption)return candidates.length===1&&!size?{variant:candidates[0]}:{variant:null,sizes:[],needs_size:Boolean(size)};
 const sizes=sizeOption.values.map(v=>v.label);
 const wanted=size??(sizes.length===1?sizes[0]:null);
 if(!wanted)return {variant:null,sizes,needs_size:true};
 const listed=sizes.find(s=>label(s)===label(wanted));
 if(!listed)return {variant:null,sizes,needs_size:true,unmatched:size};
 // The variant must carry the exact listed size: Shop can silently drop a requested option.
 const match=candidates.find(v=>(v.options??[]).some(o=>o.name===sizeOption.name&&label(o.label)===label(listed)));
 if(match)return {variant:match};
 const colorOption=(product.options??[]).find(o=>isColor(o.name));
 const colorLabel=color?colorOption?.values?.find(v=>label(v.label)===label(color))?.label:null;
 return {variant:null,sizes,select:[{name:sizeOption.name,label:listed},...(colorLabel?[{name:colorOption.name,label:colorLabel}]:[])]};
}
// shop limits the answer to the seller the user chose; Shop groups one product across sellers.
export async function selectShopVariant(product,selected,{env,shop=null,fetcher=fetch}={}){
 return (await shopCall('get_product',{catalog:{id:product.id,selected,context:context(env),...(shop?{filters:{shops:[shop]}}:{})}},{fetcher})).product??null;
}

// Orders: OAuth device flow with Shop's public agent client, then search_orders as the signed-in buyer.
const ACCOUNTS='https://accounts.shop.app/oauth/';
export const SHOP_CLIENT_ID='5c733ab2-1903-400a-891e-7ba20c09e2a3';
export async function startShopSignIn(fetcher=fetch){
 const response=await fetcher(ACCOUNTS+'device',{method:'POST',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/x-www-form-urlencoded'},
  body:new URLSearchParams({client_id:SHOP_CLIENT_ID,resource:'https://mcp.shop.com',scope:'openid email personal_agent',device_name:'Jules'})});
 if(!response.ok)throw Error('Shop sign-in could not start');
 const data=await response.json();
 if(typeof data.device_code!=='string'||typeof data.user_code!=='string')throw Error('Invalid Shop sign-in response');
 const verification=data.verification_uri_complete??data.verification_uri;
 if(!/^https:\/\//.test(verification??''))throw Error('Invalid Shop sign-in response');
 return {device_code:data.device_code,user_code:data.user_code,verification_url:verification,interval:Math.max(5,Number(data.interval)||5),expires_at:Date.now()+(Number(data.expires_in)||600)*1000};
}
// One token request. pending/slow_down mean wait; anything else ends the attempt.
export async function pollShopSignIn(deviceCode,fetcher=fetch){
 const response=await fetcher(ACCOUNTS+'token',{method:'POST',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/x-www-form-urlencoded'},
  body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:device_code',client_id:SHOP_CLIENT_ID,device_code:deviceCode})});
 const data=await response.json().catch(()=>({}));
 if(typeof data.access_token==='string'&&data.access_token)return {status:'approved',access_token:data.access_token};
 if(['authorization_pending','slow_down'].includes(data.error))return {status:data.error==='slow_down'?'slow_down':'pending'};
 return {status:data.error==='access_denied'?'denied':data.error==='expired_token'?'expired':'failed'};
}
// Bounded order listing for the import window. Shop pages "orders and standalone shipments
// together" in an unpublished shape, so every record list in a page is read and each page's shape is
// reported (list sizes, next-page signal, why listing stopped). Throttled searches are not retried.
const NOT_RECORDS=new Set(['pagination','messages','next','ucp']);
export function pageRecords(content){
 return Object.fromEntries(Object.entries(content??{}).filter(([key,value])=>!NOT_RECORDS.has(key)&&Array.isArray(value)&&value.every(v=>v&&typeof v==='object')));
}
const nextCursor=content=>{const p=content.pagination??{};return p.cursor??p.next_cursor??p.nextCursor??p.end_cursor??p.endCursor??content.next_cursor??content.cursor??null;};
const placedAt=r=>Date.parse(r.placed_at??r.created_at??r.processed_at??r.ordered_at??r.date??'')||null;
const recordKey=r=>String(r.id??r.order_id??JSON.stringify(r));
// Shop returns only recent orders to a search without words, so history is listed in passes: recent;
// then earlier windows (orders placed before the oldest found so far) while each finds new records;
// then one search per known store (for example stores from Gmail history). Every pass is reported.
// A failed or throttled search ends listing with what was found; it is not retried.
export async function listShopOrders(token,{fetcher=fetch,from,limit=100,stores=[],maxCalls=40}={}){
 const records=[],seen=new Set(),pages=[],passes=[];let calls=0,stop='end';
 const day=ms=>new Date(ms).toISOString().slice(0,10);
 async function pass(name,extra){
  const report={name,...(extra.query?{query:extra.query}:{}),...(extra.date_to?{date_to:extra.date_to}:{}),records:0,new:0,earliest:null,stop:'end'};passes.push(report);
  let cursor=null;
  for(;;){
   if(calls>=maxCalls){report.stop=stop='call_cap';return report;}
   if(records.length>=limit){report.stop=stop='limit';return report;}
   calls++;
   let content;
   try{content=await shopCall('search_orders',{activity:'all',...(from?{date_from:from}:{}),...extra,pagination:{limit:25,...(cursor?{cursor}:{})}},{fetcher,token});}
   catch(error){if(error.code==='auth_required'&&!records.length)throw error;report.stop=stop=error.status===429?'throttled':'search_failed';return report;}
   const lists=pageRecords(content),more=content.pagination?.has_next_page;
   for(const [kind,list]of Object.entries(lists))for(const record of list){
    report.records++;const at=placedAt(record);if(at&&(!report.earliest||at<report.earliest))report.earliest=at;
    const key=recordKey(record);if(seen.has(key))continue;seen.add(key);report.new++;records.push({kind,record});
   }
   cursor=nextCursor(content);
   pages.push({pass:name,lists:Object.fromEntries(Object.entries(lists).map(([k,v])=>[k,v.length])),has_next_page:more??null,cursor:Boolean(cursor),
    pagination_keys:Object.keys(content.pagination??{}),messages:(content.messages??[]).map(m=>String(m.content??m.code??'').slice(0,160)).slice(0,3)});
   if(more===false||!cursor){report.stop=more===true?'next_page_without_cursor':'no_more_pages';return report;}
  }
 }
 const recent=await pass('recent',{});
 // Earlier windows: keep asking for orders placed before the oldest one found.
 let earliest=recent.earliest;
 for(let n=0;earliest&&n<12&&!['call_cap','limit','throttled','search_failed'].includes(stop);n++){
  const before=day(earliest-86400000);
  if(from&&before<from)break;
  const earlier=await pass('earlier',{date_to:before});
  if(!earlier.new||!earlier.earliest||earlier.earliest>=earliest)break;
  earliest=earlier.earliest;
 }
 // Store searches use sellers Shop has already returned, plus any stores the caller supplies.
 const sellers=records.map(r=>r.record.seller?.name??r.record.shop?.name??r.record.merchant?.name).filter(v=>typeof v==='string');
 for(const query of [...new Set([...stores,...sellers].filter(Boolean).map(s=>String(s).slice(0,100)))].slice(0,15)){
  if(['call_cap','limit','throttled','search_failed'].includes(stop))break;
  await pass('store',{query});
 }
 if(!['call_cap','limit','throttled','search_failed'].includes(stop))stop=passes.at(-1)?.stop??'end';
 return {records:records.slice(0,limit),listing:{from:from??null,pages,passes,calls,stop,total:records.length}};
}
