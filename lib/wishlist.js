import { createHash } from 'node:crypto';
export const sessionHash = token => createHash('sha256').update(token).digest('hex');
import { fetchProductPhoto, fetchListingPhotos, fetchProductAssets } from './product-photos.js';
import {verifyListing} from './listings.js';
import { searchImage } from './lens.js';
import { publicURL } from './public-url.js';
import {sameProductURL,sameReferenceProductURL} from './indexed-product.js';

export async function wishlistProducts(result, body, sourceImages, store, photo = fetchProductPhoto,{env=process.env,fetcher=fetch}={}) {
  const textSave=result?.identification_policy==='text_wishlist'&&result?.user_confirmed===true;
  if (!textSave && !['visual_comparison', 'readable_identifier_required'].includes(result?.identification_policy)) return [];
  const entries = [];
  for (const candidate of result.products ?? []) {
    let p=candidate;
    if(textSave&&p.listing_check?.status!=='verified'){
      try{const check=await verifyListing(p.url,p.reference_provenance==='user_link'?null:p.name,fetcher,undefined,env);if(check.status==='verified'&&sameReferenceProductURL(p.url,check.url))p={...p,user_source_url:p.url,url:check.url,name:check.product_name,brand:check.product_brand??p.brand,listing_check:check,price_snapshot:check.price_snapshot&&sameProductURL(check.price_snapshot.source_url,check.url)?check.price_snapshot:null};}catch{}
    }
    const url = publicURL(p.url);
    if (!url || !textSave && p.sourcing_status!=='store_not_found' && !body.split(/\s+/).includes(url)) continue;
    const source = textSave ? (p.source_image_id?{id:p.source_image_id}:null) : sourceImages[p.source_image_index ?? 0];
    const verified=p.listing_check?.status==='verified';
    const links = !textSave&&p.sourcing_status==='store_not_found'?[]:[{ url, retailer: p.retailer?.name || new URL(url).hostname,price_snapshot:!textSave||verified?p.price_snapshot??null:null,availability:!textSave||verified?p.listing_check?.availability??null:null,verification_status:p.listing_check?.verification_basis==='search_index'?'indexed':verified?'verified':'unverified',...(textSave?{user_saved:true}:{}) }];
    for (const m of p.merchant_options ?? []) {
      const link = publicURL(m.url);
      if (link && (textSave ? m.listing_check?.status==='verified' : body.split(/\s+/).includes(link)) && !links.some(l => l.url === link)) links.push({ url: link, retailer: m.retailer?.name || new URL(link).hostname,price_snapshot:m.price_snapshot??null,availability:m.listing_check?.availability??null });
    }
    let listing=[];
    if(photo===fetchProductPhoto&&(!textSave||verified)){try{listing=p.listing_check?.product_images?.length?await fetchProductAssets(p.listing_check.product_images,p.url,fetcher):await fetchListingPhotos(p.photo_source_url??p.url,p.name,fetcher);}catch{}}
    let image = listing[0]??null, image_kind = 'product';
    try { if (!image && p.candidate_image) image = { mime_type: 'image/jpeg', data: (await photo(p.candidate_image)).toString('base64') }; } catch { /* Use source crop. */ }
    if (!image && source && p.source_box) {
      try { image = await searchImage(await store.image(source.id), p.source_box); image_kind = 'outfit_crop'; } catch { /* Placeholder remains usable. */ }
    }
    const additional_images=listing.slice(1,3);
    for(const reference of (listing.length?[]:p.reference_images??[]).filter(u=>u!==p.candidate_image).slice(0,2)){try{additional_images.push({mime_type:'image/jpeg',data:(await photo(reference)).toString('base64')});}catch{}}
    entries.push({ url,details_revision:3,market_country:p.listing_check?.market_country??env.SHOPPING_COUNTRY??'US',selected_color:p.selected_color,user_source_url:p.user_source_url,listing_check:p.listing_check,product_data:p.listing_check?.product_data,description:p.listing_check?.description,sourcing_status:textSave?(verified?'store_found':'saved_reference'):p.sourcing_status??'store_found',identity_sources:p.sourcing_status==='store_not_found'?(p.identity_sources??[]).filter(s=>publicURL(s.url)).slice(0,3):[],additional_images,photo_count:additional_images.length, brand: p.brand, name: p.name, match: p.match, reason: p.reason, links,
      text_origin:textSave&&!source, candidate_rank:entries.length, target:p.garment || null, item_description:p.item_description || null, source_box:p.source_box || null, checked_at: result.checked_at, source_image_id: source?.id ?? null, image, image_kind,photo_status:image?'ready':'retry_pending',photo_attempted_at:new Date().toISOString() });
  }
  return entries;
}

export async function wishlistUser(headers, env, store, fetcher = fetch) {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return { status: 503 };
  if (!/^Bearer [^\s]{1,8192}$/.test(headers.authorization ?? '')) return { status: 401 };
  if (await store.wishlistRevoked(sessionHash(headers.authorization))) return { status: 401 };
  const response = await fetcher(`${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: headers.authorization }, signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) return { status: response.status >= 500 ? 503 : 401 };
  const user = await response.json();
  if (!user.email_confirmed_at || !user.email) return { status: 403 };
  const member = await store.wishlistMember(user.email.toLowerCase());
  return member ? { status: 200, conversation: member.conversation_id } : { status: 403 };
}

function displayName(row,target) {
  if (row.display_name) return row.display_name;
  // The title describes the saved product; match confidence is a separate fact.
  if (row.name) return row.brand && !row.name.toLowerCase().startsWith(row.brand.toLowerCase()) ? `${row.brand} ${row.name}` : row.name;
  const description=row.item_description || target;
  return description.charAt(0).toUpperCase()+description.slice(1);
}
function targetName(row) {
  if (row.target) return row.target.trim().toLowerCase();
  const name = (row.name ?? '').toLowerCase();
  if (/jacket|coat|outerwear/.test(name)) return 'jacket';
  if (/bag|tote|purse/.test(name)) return 'bag';
  if (/shoe|sneaker|boot|loafer/.test(name)) return 'shoes';
  // Without a recorded target, avoid merging unrelated products in one image.
  return row.name || 'item';
}
export function groupWishlist(rows,{currency=null,country=null}={}) {
  const groups = new Map();
  for (const row of [...rows].sort((a,b)=>(Number(a.candidate_rank)||0)-(Number(b.candidate_rank)||0)||String(b.messages?.created_at??'').localeCompare(String(a.messages?.created_at??'')))) {
    const target = targetName(row);
    const key = row.text_origin==='true'||row.text_origin===true ? `text:${row.item_id}` : `${row.source_image_id || row.reply_id}:${target}`;
    if (!groups.has(key)) {
      const hash = createHash('sha256').update(key).digest('hex').slice(0,32);
      groups.set(key, {id:[hash.slice(0,8),hash.slice(8,12),hash.slice(12,16),hash.slice(16,20),hash.slice(20)].join('-'),
        name:displayName(row,target),sent_at:row.message_images?.messages?.created_at || row.messages?.created_at,
        image_item:row.item_id,image_kind:row.image_kind,photo_status:row.photo_status,has_image:Boolean(row.has_image),details_pending:Number(row.details_revision??0)<3||Boolean(country&&row.market_country!==country),source_image_id:row.source_image_id,sourcing_status:row.sourcing_status||'store_found',identity_sources:(row.identity_sources||[]).filter(s=>s.verified===true),photo_count:Number(row.photo_count)||0,entries:[],links:[]});
    }
    const group = groups.get(key);
    if((row.links??[]).some(l=>l.user_saved&&l.verification_status==='unverified'))group.details_pending=true;
    group.entries.push({item_id:row.item_id,reply_id:row.reply_id});
    if(row.sourcing_status!=='store_not_found')group.sourcing_status='store_found';
    if (row.has_image && (!group.has_image || group.image_kind!=='product' && row.image_kind==='product')) { group.has_image=true;group.image_item=row.item_id;group.image_kind=row.image_kind;group.photo_count=Number(row.photo_count)||0; }
    for (const entry of row.links ?? []) {
      const url = publicURL(entry.url);
      if (!url || group.links.some(link=>link.url===url)) continue;
      const price = entry.price_snapshot??row.price_snapshot;
      group.links.push({url,retailer:new URL(url).hostname.replace(/^www\./,''),name:displayName({...row,display_name:null},target),
        image_item:row.image_kind==='product' && row.has_image ? row.item_id : null,preview_image_url:publicURL(row.preview_image_url),availability:entry.availability??null,verification_status:entry.verification_status??'verified',
        price:(!currency||price?.currency===currency)&&price?.source_url===url && Number.isFinite(price.amount) && price.amount>=0 && /^[A-Z]{3}$/.test(price.currency??'') && price.checked_at ? price : null});
    }
  }
  return [...groups.values()].sort((a,b)=>String(b.sent_at).localeCompare(String(a.sent_at))).map(group=>{
    const prices = new Map();
    for (const {price} of group.links) if (price) {const values=prices.get(price.currency)||[];values.push(price.amount);prices.set(price.currency,values);}
    return {...group,price_context:'saved',price_checked_at:group.links.map(l=>l.price?.checked_at).filter(Boolean).sort()[0]??null,price_ranges:[...prices].map(([currency,values])=>({currency,min:Math.min(...values),max:Math.max(...values),...(group.links.some(l=>l.price?.currency===currency&&l.price?.evidence_level==='indexed')?{indexed:true}:{})}))};
  });
}
