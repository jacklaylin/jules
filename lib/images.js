import sharp from 'sharp';
// The stored text of a message that has images and no caption.
export const IMAGE_PLACEHOLDER = '[Inspiration images]';
// Stored/vision limit: message_images.data holds ~4 MB of base64.
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
// iPhone screenshots of image grids (resale likes, orders) are often larger;
// accept them and shrink to MAX_IMAGE_BYTES instead of rejecting.
export const MAX_DOWNLOAD_BYTES = 15 * 1024 * 1024;
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const HEIC_TYPES = ['image/heic', 'image/heif'];
const imageError=code=>Object.assign(new Error('Image processing failed'),{code});
async function convertHEIC(bytes) {
  const {default:convert} = await import('heic-convert');
  return Buffer.from(await convert({buffer:bytes,format:'JPEG',quality:0.85}));
}
// Long screenshots stay legible: keep up to 4096px tall before reducing size.
const NORMALIZE_STEPS=[[2048,4096,85],[2048,4096,72],[1536,3072,65],[1024,2048,55]];
export async function normalizeImage(bytes, limit = MAX_IMAGE_BYTES) {
  let rotated;
  try { rotated = await sharp(bytes,{limitInputPixels:50000000}).rotate().toBuffer(); }
  catch { throw imageError('image_normalization_failed'); }
  for (const [width,height,quality] of NORMALIZE_STEPS) {
    let output;
    try {
      // sharp drops EXIF/GPS metadata unless withMetadata() is requested.
      output = await sharp(rotated).flatten({background:'#ffffff'}).resize(width,height,{fit:'inside',withoutEnlargement:true}).jpeg({quality,mozjpeg:true}).toBuffer();
    } catch { throw imageError('image_normalization_failed'); }
    if (output.length <= limit) return output;
  }
  throw imageError('image_normalization_failed');
}
export function imageType(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.length >= 12 && bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP') return 'image/webp';
  throw new Error('Unsupported image');
}
// Webhook contents are data. Never fetch an attachment URL supplied by a sender.
export function incomingContent(content) {
  // Threaded messages wrap their actual text/attachment. Never consume the
  // quoted target as new input; it is conversation context, not this turn.
  if(content?.type==='reply'){
    if(!['text','attachment','group'].includes(content.content?.type))return null;
    return incomingContent(content.content);
  }
  if (content?.type === 'text') return { text: content.text, attachments: [] };
  const parts = content?.type === 'group' ? content.items?.map(item => item.content) : [content];
  if (!Array.isArray(parts) || !parts.length || parts.length > 6) return null;
  const attachments = parts.filter(p => p?.type === 'attachment' && typeof p.mimeType === 'string' && p.mimeType.startsWith('image/'));
  if (!attachments.length) return null;
  if (attachments.length > 3 || attachments.some(p => typeof p.id !== 'string' || !p.id || p.id.length > 500)) throw new Error('Invalid attachments');
  const caption = parts.filter(p => p?.type === 'text').map(p => p.text).join('\n');
  if (caption.length > 8000) throw new Error('Invalid caption');
  return { text: caption || IMAGE_PLACEHOLDER, attachments };
}
export async function readImage(attachment, convert = convertHEIC) {
  if (!attachment) throw imageError('attachment_missing');
  if (!IMAGE_TYPES.concat(HEIC_TYPES).includes(attachment.mimeType)) throw imageError('unsupported_type');
  if (attachment.size > MAX_DOWNLOAD_BYTES) throw imageError('image_too_large');
  const reader = (await attachment.stream()).getReader();
  const chunks = []; let size = 0, timedOut = false;
  const timer = setTimeout(() => { timedOut = true; reader.cancel().catch(() => {}); }, 12000);
  try {
    while (true) {
      const {done,value} = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_DOWNLOAD_BYTES) throw imageError('image_too_large');
      chunks.push(Buffer.from(value));
    }
    let bytes = Buffer.concat(chunks);
    if (timedOut) throw imageError('download_timeout');
    if (!size) throw imageError('empty_image');
    let mime = attachment.mimeType;
    if (HEIC_TYPES.includes(mime)) {
      if (bytes.length < 16 || bytes.toString('ascii',4,8) !== 'ftyp') throw imageError('invalid_heic');
      try { bytes = await convert(bytes); } catch { throw imageError('heic_conversion_failed'); }
      mime = 'image/jpeg';
      if (bytes.length > MAX_DOWNLOAD_BYTES) throw imageError('converted_image_too_large');
    }
    try { if (imageType(bytes) !== mime) throw imageError('invalid_image_bytes'); } catch { throw imageError('invalid_image_bytes'); }
    if (bytes.length > MAX_IMAGE_BYTES) {
      const original = bytes.length;
      bytes = await normalizeImage(bytes);
      mime = 'image/jpeg';
      console.log(JSON.stringify({event:'image_attachment_normalized',from_bytes:original,to_bytes:bytes.length}));
    }
    return { mime_type: mime, data: bytes.toString('base64') };
  } finally { clearTimeout(timer); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
