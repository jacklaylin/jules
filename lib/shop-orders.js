import {digest} from './gmail-client.js';
import {startShopSignIn,pollShopSignIn,listShopOrders} from './shop.js';
import {RECEIPT_PROMPT} from './receipt-extraction.js';
import {shopCandidates} from './order-media.js';

// Shop order history as a connected purchase-history source (lib/connected-sources.js). Shop's
// records cover Shopify checkouts and orders Shop detected in the buyer's email; missing data is unknown.
export const SHOP_CONSENT_VERSION='shop-orders-5y-100-v2';
const at=order=>Date.parse(order.created_at??order.placed_at??order.processed_at??order.ordered_at??order.date??'')||null;
// Shop's own identifiers (gid:// IDs, UUIDs) are not the store's order number. They are hidden from
// the text the model reads, so it cannot quote one as an order reference.
const INTERNAL=/^(gid:\/\/\S+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
// Technical key filter for the admin summary: shopping fields are kept; addresses, contact details,
// tracking numbers (which can reveal a delivery address) and other personal fields are dropped.
const PERSONAL=/address|email|phone|street|city|zip|postal|recipient|customer|buyer|first_?name|last_?name|billing|payment|card|tracking|carrier_?url|location/i;
const SHOPPING=/title|name|merchant|shop|store|seller|vendor|brand|order|number|product|variant|item|line|quantity|status|created|placed|date|price|total|amount|currency|size|colou?r|sku|kind|type/i;
function shoppingFields(value,depth=0){
 if(Array.isArray(value))return value.slice(0,20).map(v=>shoppingFields(v,depth+1)).filter(v=>v!==undefined);
 if(value&&typeof value==='object'){
  if(depth>5)return undefined;
  const kept=Object.entries(value).filter(([k])=>!PERSONAL.test(k)&&SHOPPING.test(k)).map(([k,v])=>[k,shoppingFields(v,depth+1)]).filter(([,v])=>v!==undefined);
  return kept.length?Object.fromEntries(kept):undefined;
 }
 return typeof value==='string'?(INTERNAL.test(value)?undefined:value.slice(0,120)):value;
}
// Each Shop record (an order or a standalone shipment) becomes one prepared record. Its ID is Shop's
// record ID when present; the text is the record itself, so every extracted field must quote it.
export function orderSource(order,kind='orders'){
 const id='shop:'+String(order.id??order.order_id??digest(JSON.stringify(order)).slice(0,24)).slice(0,120);
 const text=JSON.stringify(order,(_k,v)=>typeof v==='string'&&INTERNAL.test(v)?'[Shop internal ID]':v,1);
 if(text.length>40000)return null;
 // Line-item pictures and product links in the record, offered to the model by ref (lib/order-media.js).
 const candidates=shopCandidates(order);
 return {id,date:at(order),text,kind,summary:JSON.stringify(shoppingFields(order)??{}).slice(0,1500),...(candidates.length?{media:{source:'shop_order',candidates}}:{})};
}
export const SHOP_SOURCE={
 name:'shop',origin:'shop',source_type:'shop_order',label:'Shop',consent:SHOP_CONSENT_VERSION,
 enabled:env=>env.SHOP_ORDERS_ENABLED==='true',
 instructions:`The source is one record from the user's Shop account history (JSON): an order or a standalone shipment, not an email. merchant is the store or retailer that sold it (the record's shop, store or seller name), never a product name or brand-plus-product. order_reference is the store's own order number or name as shown in the record (for example "#1001" or "5M7KZR"); "[Shop internal ID]" values are not order references, so leave order_reference null when only those appear. A placed order's basis is order_confirmation, quoting the order number, order name or store name from the record. Read every line item: each clothing, footwear or accessory item is its own event. Shop records may omit prices, sizes or recipients; leave missing fields null.\n`+RECEIPT_PROMPT,
 // Same store, no shared order number: another source's item within this many days may be the same purchase.
 match_window_days:14,
 async start(fetcher){const s=await startShopSignIn(fetcher);return {secret:s.device_code,user_code:s.user_code,verification_url:s.verification_url,interval:s.interval,expires_at:s.expires_at};},
 async poll(secret,fetcher){const r=await pollShopSignIn(secret,fetcher);return r.status==='approved'?{status:'approved',credential:{access_token:r.access_token}}:{status:r.status};},
 // Shop has no revocation endpoint for this client; the user removes "Jules" in the Shop app.
 async list(credential,{fetcher,from,limit,stores}){
  const {records,listing}=await listShopOrders(credential.access_token,{fetcher,from,limit,stores});
  return {records:records.map(({kind,record})=>orderSource(record,kind)),listing};
 },
};
