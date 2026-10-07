export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const HEIC_TYPES = ['image/heic', 'image/heif'];
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
  return { text: caption || '[Inspiration images]', attachments };
}
export async function readImage(attachment, convert = convertHEIC) {
  if (!attachment || !IMAGE_TYPES.concat(HEIC_TYPES).includes(attachment.mimeType) || attachment.size > MAX_IMAGE_BYTES) throw new Error('Unsupported image');
  const reader = (await attachment.stream()).getReader();
  const chunks = []; let size = 0, timedOut = false;
  const timer = setTimeout(() => { timedOut = true; reader.cancel().catch(() => {}); }, 12000);
  try {
    while (true) {
      const {done,value} = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_IMAGE_BYTES) throw new Error('Image too large');
      chunks.push(Buffer.from(value));
    }
    let bytes = Buffer.concat(chunks);
    if (timedOut || !size) throw new Error('Invalid image bytes');
    let mime = attachment.mimeType;
    if (HEIC_TYPES.includes(mime)) {
      if (bytes.length < 16 || bytes.toString('ascii',4,8) !== 'ftyp') throw new Error('Invalid HEIC');
      bytes = await convert(bytes);
      mime = 'image/jpeg';
      if (bytes.length > MAX_IMAGE_BYTES) throw new Error('Converted image too large');
    }
    if (imageType(bytes) !== mime) throw new Error('Invalid image bytes');
    return { mime_type: mime, data: bytes.toString('base64') };
  } finally { clearTimeout(timer); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
