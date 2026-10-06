import sharp from 'sharp';

export function productPhotoURL(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      /^encrypted-tbn\d*\.gstatic\.com$/.test(url.hostname) && url.href.length <= 1200 ? url.href : null;
  } catch { return null; }
}

// Only already-compared Lens thumbnails, never model-generated or arbitrary retailer URLs.
export async function fetchProductPhoto(url, fetcher = fetch) {
  const safe = productPhotoURL(url);
  if (!safe) throw new Error('Unsupported product photo');
  const response = await fetcher(safe, { redirect: 'error', signal: AbortSignal.timeout(5000) });
  if (!response.ok || !/^image\/(jpeg|png|webp)(;|$)/i.test(response.headers.get('content-type') ?? '')) throw new Error('Invalid product photo');
  if (Number(response.headers.get('content-length')) > 1000000) throw new Error('Product photo too large');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 1000000) throw new Error('Product photo too large');
    chunks.push(Buffer.from(chunk));
  }
  const bytes = await sharp(Buffer.concat(chunks), { limitInputPixels: 10000000 })
    .rotate().resize(1000, 1000, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  if (bytes.length > 1000000) throw new Error('Product photo too large');
  return bytes;
}
