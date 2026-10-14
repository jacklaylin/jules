import {digest} from './gmail-client.js';
import {startShopSignIn,pollShopSignIn,listShopOrders} from './shop.js';
import {RECEIPT_PROMPT} from './receipt-extraction.js';

// Shop order history as a connected purchase-history source (lib/connected-sources.js). Shop's
// records cover Shopify checkouts and orders Shop detected in the buyer's email; missing data is unknown.
export const SHOP_CONSENT_VERSION='shop-orders-5y-100-v1';
const at=order=>Date.parse(order.created_at??order.placed_at??order.processed_at??order.ordered_at??'')||null;
// Each order becomes one prepared record. Its ID is Shop's order ID when present; the text is the
// record itself, so every extracted field must quote it.
export function orderSource(order){
 const text=JSON.stringify(order,null,1);
 if(text.length>40000)return null;
 const id='shop:'+String(order.id??order.order_id??digest(text).slice(0,24)).slice(0,120);
 return {id,date:at(order),text};
}
export const SHOP_SOURCE={
 name:'shop',origin:'shop',source_type:'shop_order',label:'Shop',consent:SHOP_CONSENT_VERSION,
 enabled:env=>env.SHOP_ORDERS_ENABLED==='true',
 instructions:`The source is one order record from the user's Shop account history (JSON), not an email. The store's name is the merchant; its labeled order number or name is the order reference. A placed order's basis is order_confirmation, quoting its order number or name from the record. Shop records may omit prices, sizes or recipients; leave missing fields null.\n`+RECEIPT_PROMPT,
 async start(fetcher){const s=await startShopSignIn(fetcher);return {secret:s.device_code,user_code:s.user_code,verification_url:s.verification_url,interval:s.interval,expires_at:s.expires_at};},
 async poll(secret,fetcher){const r=await pollShopSignIn(secret,fetcher);return r.status==='approved'?{status:'approved',credential:{access_token:r.access_token}}:{status:r.status};},
 // Shop has no revocation endpoint for this client; the user removes "Jules" in the Shop app.
 async list(credential,{fetcher,from,limit}){return (await listShopOrders(credential.access_token,{fetcher,from,limit})).map(orderSource);},
};
