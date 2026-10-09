import {enrichWishlistItem} from '../lib/wishlist-details.js';
import {repairWishlistPhotos} from '../lib/wishlist-photos.js';
import {fetchListingPhotos,fetchProductAssets} from '../lib/product-photos.js';
import {verifyListing} from '../lib/listings.js';
import { inspectAlertLinks, baselineOffers, readSizeOffers, lowestAvailable } from '../lib/price-alerts.js';
import { createStore } from '../lib/store.js';
import { wishlistUser, sessionHash, groupWishlist } from '../lib/wishlist.js';
import { authorize } from '../lib/auth.js';
import { json, readJson, uuid } from '../lib/http.js';
import {createSignupHandler} from '../lib/public-signup.js';

export const config = { api: { bodyParser: false }, maxDuration: 120 };
export function createWishlistHandler({ env = process.env, storeFactory = createStore, auth = wishlistUser, admin = authorize, fetcher = fetch, verify = verifyListing, inspect = inspectAlertLinks, photos = fetchListingPhotos } = {}) {
  const signup=createSignupHandler({env,storeFactory});
  return async (req, res) => {
    try {
      if(new URL(req.url,'https://jules.invalid').searchParams.get('public_signup')==='1')return signup(req,res);
      if (env.WISHLIST_ENABLED !== 'true') return json(res, 503, { error: 'Wishlist is not available yet.' });
      const store = storeFactory(env);
      if (req.method === 'POST') {
        const input = await readJson(req, 16384);
        if(input.action==='recover-photos'){
          const access=await auth(req.headers,env,store,fetcher);if(access.status!==200)return json(res,access.status,{error:'Please sign in with your invited email.'});
          const rows=await repairWishlistPhotos(await store.wishlistEntries(access.conversation),{conversation:access.conversation,store,verify:(url,name)=>verify(url,name,fetcher,undefined,env),photos:(url,name)=>photos(url,name,fetcher),assets:(urls,url)=>fetchProductAssets(urls,url,fetcher)});
          return json(res,200,{items:groupWishlist(rows).map(({links,entries,...group})=>group)});
        }
        if(input.action==='enrich'){
          const access=await auth(req.headers,env,store,fetcher);if(access.status!==200)return json(res,access.status,{error:'Please sign in with your invited email.'});
          if(!uuid(input.item))return json(res,400,{error:'Invalid item.'});
          const {update,...result}=await enrichWishlistItem(store,access.conversation,input.item,{verify:(url,name)=>verify(url,name,fetcher,undefined,env),photos:(url,name)=>photos(url,name,fetcher),assets:(urls,url)=>fetchProductAssets(urls,url,fetcher)});
          return json(res,200,result);
        }
        if (['remove','restore'].includes(input.action)) {
          const access=await auth(req.headers,env,store,fetcher);
          if(access.status!==200)return json(res,access.status,{error:'Please sign in with your invited email.'});
          if(!uuid(input.group))return json(res,400,{error:'Invalid item.'});
          const groups=groupWishlist(await store.wishlistEntries(access.conversation,{includeRemoved:true}));
          const item=groups.find(group=>group.id===input.group);
          if(!item)return json(res,404,{error:'Item not found.'});
          // Stop alerts before hiding the item; restoring leaves alerts off.
          if(input.action==='remove')await store.disablePriceAlert(access.conversation,item.id);
          await store.setWishlistRemoved(access.conversation,item.entries,input.action==='remove');
          return json(res,200,{ok:true});
        }
        if (['alert-options','alert-enable','alert-disable'].includes(input.action)) {
          if(env.PRICE_ALERTS_ENABLED!=='true')return json(res,503,{error:'Price alerts are not enabled yet.'});
          const access=await auth(req.headers,env,store,fetcher);
          if(access.status!==200)return json(res,access.status,{error:'Please sign in with your invited email.'});
          if(!uuid(input.group))return json(res,400,{error:'Invalid item.'});
          const item=groupWishlist(await store.wishlistEntries(access.conversation)).find(g=>g.id===input.group);
          if(!item)return json(res,404,{error:'Item not found.'});
          if(input.action==='alert-disable'){await store.disablePriceAlert(access.conversation,item.id);return json(res,200,{active:false});}
          const {sizes,checks}=await inspect(item.links,link=>readSizeOffers(link,fetcher));
          if(input.action==='alert-options')return json(res,200,{sizes});
          if(typeof input.size!=='string'||!sizes.includes(input.size))return json(res,400,{error:'Select a size found on the retailer listings.'});
          const baselines=lowestAvailable(baselineOffers(checks,input.size));
          if(!baselines.length)return json(res,422,{error:'We couldn’t verify an available price for that size. Try another size or check back later.'});
          const alert=await store.enablePriceAlert({p_conversation:access.conversation,p_item:item.image_item,p_group:item.id,p_name:item.name,p_size:input.size,p_baselines:baselines,p_links:item.links.map(({url,name})=>({url,name}))});
          return json(res,200,{active:alert.active,size:alert.size});
        }
        if (input.action === 'refresh') {
          if(typeof input.refresh_token!=='string'||!input.refresh_token||input.refresh_token.length>8192)return json(res,400,{error:'Invalid session.'});
          const response=await fetcher(`${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/token?grant_type=refresh_token`,{method:'POST',headers:{apikey:env.SUPABASE_ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:input.refresh_token}),signal:AbortSignal.timeout(10000)});
          if(!response.ok)return json(res,[400,401,403].includes(response.status)?401:503,{error:'Please sign in again.'});
          const data=await response.json();
          if(!data.access_token||!data.refresh_token||!Number.isFinite(data.expires_in))return json(res,503,{error:'Could not renew session.'});
          return json(res,200,{access_token:data.access_token,refresh_token:data.refresh_token,expires_at:Math.floor(Date.now()/1000)+data.expires_in});
        }
        if (input.action === 'repair') {
          const access = await admin(req.headers, env, fetcher);
          if (access !== 200) return json(res, access, { error: 'Owner access required.' });
          const pending = await store.wishlistPending();
          for (const row of pending) await store.saveWishlist(row.operation_id);
          return json(res, 200, { repaired: pending.length });
        }
        if (input.action === 'login') {
          const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return json(res, 400, { error: 'Enter your email address.' });
          if (!env.SITE_ORIGIN) return json(res, 503, { error: 'Sign-in is not configured.' });
          if (await store.wishlistMember(email)) {
            const response = await fetcher(`${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/otp?redirect_to=${encodeURIComponent(env.SITE_ORIGIN.replace(/\/$/, '') + (input.destination==='style'?'/style':'/wishlist'))}`, {
              method: 'POST', headers: { apikey: env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
              body: JSON.stringify({ email, create_user: true }), signal: AbortSignal.timeout(10000),
            });
            if (!response.ok) return json(res, response.status === 429 ? 429 : 503, { error: 'Could not send a link. Please try again shortly.' });
          }
          return json(res, 200, { message: 'If you’re invited, a sign-in link is on its way. Check your email.' });
        }
        if (input.action === 'logout') {
          // Explicitly revoke this token locally: Supabase JWTs can outlive logout.
          if (!/^Bearer [^\s]{1,8192}$/.test(req.headers.authorization ?? '')) return json(res, 401, { error: 'Please sign in.' });
          await store.wishlistRevoke(sessionHash(req.headers.authorization));
          const response = await fetcher(`${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/logout`, { method:'POST', headers:{apikey:env.SUPABASE_ANON_KEY,Authorization:req.headers.authorization},signal:AbortSignal.timeout(10000) });
          if (!response.ok && response.status !== 401) return json(res, 503, { error:'Could not end the session. Try again.' });
          return json(res, 200, { ok: true });
        }
        return json(res, 400, { error: 'Unknown action.' });
      }
      if (req.method !== 'GET') { res.setHeader('Allow','GET, POST'); return json(res,405,{error:'Method not allowed.'}); }
      const authStarted=performance.now();
      const access = await auth(req.headers, env, store, fetcher);
      const authDuration=performance.now()-authStarted;
      if (access.status !== 200) return json(res, access.status, {error:'Please sign in with your invited email.'});
      const query = new URL(req.url, 'https://local.invalid').searchParams;
      const id = query.get('item');
      const groupId = query.get('group');
      if (groupId && !uuid(groupId)) return json(res,400,{error:'Invalid item.'});
      if (!id || groupId) {
        const started=performance.now();
        const [rows,alerts]=await Promise.all([store.wishlistEntries(access.conversation),env.PRICE_ALERTS_ENABLED==='true'?store.priceAlerts(access.conversation):Promise.resolve([])]);
        const groups = groupWishlist(rows);
        res.setHeader('Server-Timing',`auth;dur=${authDuration.toFixed(1)}, wishlist;dur=${(performance.now()-started).toFixed(1)}`);
        if(env.PRICE_ALERTS_ENABLED==='true'){
          for(const group of groups){const alert=alerts.find(a=>a.group_id===group.id);group.price_alert=alert?{active:alert.active,size:alert.size,last_checked_at:alert.last_checked_at,notified:alert.notified}:null;group.alerts_enabled=true;}
        }
        if (groupId) {
          const item = groups.find(g=>g.id===groupId);
          return item ? json(res,200,{item}) : json(res,404,{error:'Item not found.'});
        }
        return json(res,200,{items:groups.map(({links,entries,...group})=>group)});
      }
      if (!uuid(id)) return json(res,400,{error:'Invalid item.'});
      if(query.get('image')==='reference'){const index=query.get('index');if(!/^[01]$/.test(index??''))return json(res,400,{error:'Invalid photo.'});return image(res,await store.wishlistPhoto(access.conversation,id,Number(index)));}
      if (query.get('image') === 'product' && store.wishlistPhoto) return image(res,await store.wishlistPhoto(access.conversation,id));
      const item = await store.wishlistItem(access.conversation, id);
      if (!item) return json(res,404,{error:'Item not found.'});
      if (query.get('image') === 'product') return image(res,item.product.image);
      if (query.has('source')) {
        const source = query.get('source');
        if (!uuid(source) || !item.wishlist_encounters.some(e=>e.source_image_id===source)) return json(res,404,{error:'Image not found.'});
        return image(res,await store.image(source));
      }
      const { image: bytes, additional_images: references, ...product } = item.product;
      return json(res,200,{item:{id:item.id,saved_at:item.saved_at,product,encounters:item.wishlist_encounters.map(e=>({source_image_id:e.source_image_id,found_at:e.messages?.created_at,links:e.product.links,match:e.product.match,reason:e.product.reason}))}});
    } catch { console.log(JSON.stringify({event:'wishlist_request_failed'})); return json(res,503,{error:'Could not load your wishlist. Please try again.'}); }
  };
}
function image(res, value) {
  if (!value || !['image/jpeg','image/png','image/webp'].includes(value.mime_type)) return json(res,404,{error:'Image unavailable.'});
  res.statusCode=200;res.setHeader('Content-Type',value.mime_type);res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.end(Buffer.from(value.data,'base64'));
}
export default createWishlistHandler();
