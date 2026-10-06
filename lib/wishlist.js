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
      checked_at: result.checked_at, source_image_id: source?.id ?? null, image, image_kind });
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
