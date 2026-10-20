// The stored text of a message that has images and no caption.
export const IMAGE_PLACEHOLDER = '[Inspiration images]';
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const HEIC_TYPES = ['image/heic', 'image/heif'];
// Fixed reasons an attachment can fail, safe to log and store in reply diagnostics.
export const IMAGE_FAILURE_CODES=['attachment_missing','unsupported_type','image_too_large','download_timeout','empty_image','invalid_heic','heic_conversion_failed','converted_image_too_large','recompress_failed','invalid_image_bytes'];
const imageError=code=>Object.assign(new Error('Image processing failed'),{code});
async function convertHEIC(bytes) {
  const {default:convert} = await import('heic-convert');
  return Buffer.from(await convert({buffer:bytes,format:'JPEG',quality:0.85}));
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
// Stored and sent images stay under MAX_IMAGE_BYTES. Larger downloads (full-screen and scrolling
// iPhone PNG screenshots are often 3-15 MB) are accepted up to MAX_DOWNLOAD_BYTES and recompressed.
// The download cap is bounded by function memory: sharp decodes at most MAX_INPUT_PIXELS.
export const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;
const MAX_INPUT_PIXELS = 60000000;
// The long edge kept when recompressing. A 1290x2796 iPhone screenshot keeps its full resolution;
// a long scrolling screenshot is scaled so its width stays readable rather than cropped.
export const MAX_LONG_EDGE = 3072;
const ATTEMPTS = [{ edge: 1, quality: 85 }, { edge: 1, quality: 72 }, { edge: 0.75, quality: 72 }, { edge: 0.55, quality: 68 }, { edge: 0.4, quality: 62 }];
// Re-encodes an oversized image as JPEG (transparency on white), stepping quality then size down
// until it fits. Returns the bytes and the dimensions that were kept.
export async function shrinkImage(bytes) {
  const { default: sharp } = await import('sharp');
  const source = sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, animated: false });
  const { width, height } = await source.metadata();
  if (!width || !height) throw imageError('invalid_image_bytes');
  const longEdge = Math.min(MAX_LONG_EDGE, Math.max(width, height));
  for (const { edge, quality } of ATTEMPTS) {
    const size = Math.round(longEdge * edge);
    const out = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, animated: false }).rotate()
      .resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' }).jpeg({ quality, mozjpeg: true }).toBuffer({ resolveWithObject: true });
    if (out.data.length <= MAX_IMAGE_BYTES) return { bytes: out.data, width: out.info.width, height: out.info.height, quality, source_width: width, source_height: height };
  }
  throw imageError('converted_image_too_large');
}
// Returns { mime_type, data } for storage and vision. Its non-enumerable `info` holds sizes and the
// conversion applied, for diagnostics; it is never stored with the image row.
export async function readImage(attachment, convert = convertHEIC, shrink = shrinkImage) {
  if (!attachment) throw imageError('attachment_missing');
  if (!IMAGE_TYPES.concat(HEIC_TYPES).includes(attachment.mimeType)) throw imageError('unsupported_type');
  const info = { original_mime: attachment.mimeType, declared_bytes: Number.isFinite(attachment.size) ? attachment.size : null, original_bytes: null, bytes: null, converted: null };
  const fail = code => Object.assign(imageError(code), { image_info: info });
  if (attachment.size > MAX_DOWNLOAD_BYTES) throw fail('image_too_large');
  const reader = (await attachment.stream()).getReader();
  const chunks = []; let size = 0, timedOut = false;
  const timer = setTimeout(() => { timedOut = true; reader.cancel().catch(() => {}); }, 20000);
  try {
    while (true) {
      const {done,value} = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_DOWNLOAD_BYTES) { info.original_bytes = size; throw fail('image_too_large'); }
      chunks.push(Buffer.from(value));
    }
    let bytes = Buffer.concat(chunks);
    info.original_bytes = size;
    if (timedOut) throw fail('download_timeout');
    if (!size) throw fail('empty_image');
    let mime = attachment.mimeType;
    if (HEIC_TYPES.includes(mime)) {
      if (bytes.length < 16 || bytes.toString('ascii',4,8) !== 'ftyp') throw fail('invalid_heic');
      try { bytes = await convert(bytes); } catch { throw fail('heic_conversion_failed'); }
      mime = 'image/jpeg'; info.converted = 'heic_to_jpeg';
    }
    // The declared type must match the bytes before anything is decoded.
    try { if (imageType(bytes) !== mime) throw imageError('invalid_image_bytes'); } catch { throw fail('invalid_image_bytes'); }
    if (bytes.length > MAX_IMAGE_BYTES) {
      const before = bytes.length;
      try {
        const shrunk = await shrink(bytes);
        bytes = shrunk.bytes;
        Object.assign(info, { converted: info.converted ? `${info.converted}+recompressed` : 'recompressed', pre_recompress_bytes: before,
          width: shrunk.width ?? null, height: shrunk.height ?? null, source_width: shrunk.source_width ?? null, source_height: shrunk.source_height ?? null, quality: shrunk.quality ?? null });
      } catch (error) { throw fail(error?.code === 'converted_image_too_large' ? 'converted_image_too_large' : 'recompress_failed'); }
      mime = 'image/jpeg';
      try { if (imageType(bytes) !== mime || bytes.length > MAX_IMAGE_BYTES) throw imageError('converted_image_too_large'); } catch { throw fail('converted_image_too_large'); }
    }
    info.bytes = bytes.length;
    return Object.defineProperty({ mime_type: mime, data: bytes.toString('base64') }, 'info', { value: info });
  } finally { clearTimeout(timer); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
