import {verifyListing,verifyWishlistRows} from '../lib/listings.js';
import { createStore } from '../lib/store.js';
import { wishlistUser, sessionHash, groupWishlist } from '../lib/wishlist.js';
import { authorize } from '../lib/auth.js';
import { json, readJson, uuid } from '../lib/http.js';

export const config = { api: { bodyParser: false }, maxDuration: 120 };
export function createWishlistHandler({ env = process.env, storeFactory = createStore, auth = wishlistUser, admin = authorize, fetcher = fetch, verify = verifyListing } = {}) {
  return async (req, res) => {
    try {
      if (env.WISHLIST_ENABLED !== 'true') return json(res, 503, { error: 'Wishlist is not available yet.' });
      const store = storeFactory(env);
      if (req.method === 'POST') {
        const input = await readJson(req, 16384);
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
            const response = await fetcher(`${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/otp?redirect_to=${encodeURIComponent(env.SITE_ORIGIN.replace(/\/$/, '') + '/wishlist')}`, {
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
      const access = await auth(req.headers, env, store, fetcher);
      if (access.status !== 200) return json(res, access.status, {error:'Please sign in with your invited email.'});
      const query = new URL(req.url, 'https://local.invalid').searchParams;
      const id = query.get('item');
      const groupId = query.get('group');
      if (groupId && !uuid(groupId)) return json(res,400,{error:'Invalid item.'});
      if (!id || groupId) {
        const groups = groupWishlist(await verifyWishlistRows(await store.wishlistEntries(access.conversation),fetcher,verify));
        if (groupId) {
          const item = groups.find(g=>g.id===groupId);
          return item ? json(res,200,{item}) : json(res,404,{error:'Item not found.'});
        }
        return json(res,200,{items:groups.map(({links,...group})=>group)});
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
      const [checked]=await verifyWishlistRows([item.product],fetcher,verify);
      const { image: bytes, additional_images: references, ...product } = checked;
      return json(res,200,{item:{id:item.id,saved_at:item.saved_at,product,encounters:await Promise.all(item.wishlist_encounters.map(async e=>{const [checked]=await verifyWishlistRows([e.product],fetcher,verify);return {source_image_id:e.source_image_id,found_at:e.messages?.created_at,links:checked.links,match:e.product.match,reason:e.product.reason};}))}});
    } catch { console.log(JSON.stringify({event:'wishlist_request_failed'})); return json(res,503,{error:'Could not load your wishlist. Please try again.'}); }
  };
}
function image(res, value) {
  if (!value || !['image/jpeg','image/png','image/webp'].includes(value.mime_type)) return json(res,404,{error:'Image unavailable.'});
  res.statusCode=200;res.setHeader('Content-Type',value.mime_type);res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.end(Buffer.from(value.data,'base64'));
}
export default createWishlistHandler();
