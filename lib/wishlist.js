import { createHash } from 'node:crypto';
export const sessionHash = token => createHash('sha256').update(token).digest('hex');
import { fetchProductPhoto } from './product-photos.js';
import { searchImage } from './lens.js';
import { publicURL } from './search.js';

export async function wishlistProducts(result, body, sourceImages, store, photo = fetchProductPhoto) {
  if (!['visual_comparison', 'readable_identifier_required'].includes(result?.identification_policy)) return [];
  const entries = [];
  for (const p of result.products ?? []) {
    const url = publicURL(p.url);
    if (!url || !body.split(/\s+/).includes(url)) continue;
    const source = sourceImages[p.source_image_index ?? 0];
    const links = [{ url, retailer: p.retailer?.name || new URL(url).hostname }];
    for (const m of p.merchant_options ?? []) {
      const link = publicURL(m.url);
      if (link && body.split(/\s+/).includes(link) && !links.some(l => l.url === link)) links.push({ url: link, retailer: m.retailer?.name || new URL(link).hostname });
    }
    let image = null, image_kind = 'product';
    try { if (p.candidate_image) image = { mime_type: 'image/jpeg', data: (await photo(p.candidate_image)).toString('base64') }; } catch { /* Use source crop. */ }
    if (!image && source && p.source_box) {
      try { image = await searchImage(await store.image(source.id), p.source_box); image_kind = 'outfit_crop'; } catch { /* Placeholder remains usable. */ }
    }
    entries.push({ url, brand: p.brand, name: p.name, match: p.match, reason: p.reason, links,
      candidate_rank:entries.length, target:p.garment || null, item_description:p.item_description || null, source_box:p.source_box || null, checked_at: result.checked_at, source_image_id: source?.id ?? null, image, image_kind });
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
  if (['likely_match','exact_match'].includes(row.match) && row.name) return row.brand && !row.name.toLowerCase().startsWith(row.brand.toLowerCase()) ? `${row.brand} ${row.name}` : row.name;
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
export function groupWishlist(rows) {
  const groups = new Map();
  for (const row of [...rows].sort((a,b)=>(Number(a.candidate_rank)||0)-(Number(b.candidate_rank)||0))) {
    const target = targetName(row);
    const key = `${row.source_image_id || row.reply_id}:${target}`;
    if (!groups.has(key)) {
      const hash = createHash('sha256').update(key).digest('hex').slice(0,32);
      groups.set(key, {id:[hash.slice(0,8),hash.slice(8,12),hash.slice(12,16),hash.slice(16,20),hash.slice(20)].join('-'),
        name:displayName(row,target),sent_at:row.message_images?.messages?.created_at || row.messages?.created_at,
        image_item:row.item_id,has_image:Boolean(row.has_image),source_image_id:row.source_image_id,links:[]});
    }
    const group = groups.get(key);
    if (!group.has_image && row.has_image) { group.has_image=true;group.image_item=row.item_id; }
    for (const entry of row.links ?? []) {
      const url = publicURL(entry.url);
      if (!url || group.links.some(link=>link.url===url)) continue;
      const price = row.price_snapshot;
      group.links.push({url,retailer:new URL(url).hostname.replace(/^www\./,''),name:[row.brand,row.name].filter(Boolean).join(' '),
        image_item:row.image_kind==='product' && row.has_image ? row.item_id : null,preview_image_url:publicURL(row.preview_image_url),
        price:price?.source_url===url && Number.isFinite(price.amount) && price.amount>=0 && /^[A-Z]{3}$/.test(price.currency??'') && price.checked_at ? price : null});
    }
  }
  return [...groups.values()].sort((a,b)=>String(b.sent_at).localeCompare(String(a.sent_at))).map(group=>{
    const prices = new Map();
    for (const {price} of group.links) if (price) {const values=prices.get(price.currency)||[];values.push(price.amount);prices.set(price.currency,values);}
    return {...group,price_ranges:[...prices].map(([currency,values])=>({currency,min:Math.min(...values),max:Math.max(...values)}))};
  });
}
