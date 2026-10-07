import { readImage } from './images.js';
import { Spectrum, reaction, reply, attachment } from '@spectrum-ts/core';
import { imessage } from '@spectrum-ts/imessage';
import { fetchProductPhoto, productPhotoURL } from './product-photos.js';

export function progressEmoji(message) {
  const text = message.content?.text ?? '';
  if (/\b(identify|identification|what (?:is|are)|find|track down|locate|links?)\b/i.test(text)) return '🔎';
  if (/\b(recommend|recommendations?|recs|suggest|suggestions?|should I|help me (?:choose|pick)|what (?:should|would))\b/i.test(text)) return '💭';
  if (/\b(?:i (?:really )?want|i[’']?d (?:really )?like|wishlist|wish list|price alert)\b/i.test(text)) return '👀';
  return message.attachments?.length ? '👀' : null;
}

// Progress is best effort: a failed tapback or typing signal must not block a reply.
export async function beginProgress(delivery, env, { connect = Spectrum, provider = imessage, log = console.log } = {}) {
  if (!env.SPECTRUM_PROJECT_ID || !env.SPECTRUM_PROJECT_SECRET) return async () => {};
  let app, conversation, timer, pending = Promise.resolve(), stopped = false;
  const attempt = async (stage, task) => {
    try { await task(); }
    catch { log(JSON.stringify({ event: 'imessage_progress_failed', stage })); }
  };
  try {
    app = await connect({ projectId: env.SPECTRUM_PROJECT_ID, projectSecret: env.SPECTRUM_PROJECT_SECRET,
      providers: [provider.config()], telemetry: false, options: { logLevel: 'silent' } });
    const im = provider(app);
    conversation = await im.space.create(await im.user(delivery.message.sender.id), { phone: delivery.space.phone });
    await attempt('typing_start', () => conversation.startTyping());
    const emoji = progressEmoji(delivery.message);
    if (emoji) await attempt('reaction', () => conversation.send(reaction(emoji, delivery.message)));
    // Refresh without overlapping requests, including during longer visual searches.
    let refreshing = false;
    timer = setInterval(() => {
      if (stopped || refreshing) return;
      refreshing = true;
      pending = attempt('typing_refresh', () => conversation.startTyping()).finally(() => { refreshing = false; });
    }, 8000);
    timer.unref?.();
  } catch { log(JSON.stringify({ event: 'imessage_progress_failed', stage: 'connect' })); }
  return async () => {
    stopped = true;
    clearInterval(timer);
    await pending;
    if (conversation) await attempt('typing_stop', () => conversation.stopTyping());
    if (app) await attempt('disconnect', () => app.stop());
  };
}

export async function sendGreeting({ space, message }, greeting, env, { replyTarget, products = [], connect = Spectrum, provider = imessage, loadPhoto = fetchProductPhoto, log = console.log } = {}) {
  const app = await connect({
    projectId: env.SPECTRUM_PROJECT_ID,
    projectSecret: env.SPECTRUM_PROJECT_SECRET,
    providers: [provider.config()],
    telemetry: false,
    options: { logLevel: 'silent' },
  });
  try {
    const im = provider(app);
    // The signed delivery provides the correct pooled or dedicated line.
    const user = await im.user(message.sender.id);
    const conversation = await im.space.create(user, { phone: space.phone });
    // Never retry an ambiguous threaded send as a loose message: it could duplicate the answer.
    const target = replyTarget?.id && replyTarget.content ? replyTarget : null;
    const sent = await conversation.send(target ? reply(greeting, target) : greeting);
    if (!sent && target) throw new Error('Threaded reply not sent');
    // Send photos only after the main answer succeeds; failures never suppress its links.
    for (const [index, product] of products.slice(0, 3).entries()) {
      if (!productPhotoURL(product.candidate_image)) continue;
      let stage = 'download';
      try {
        const bytes = await loadPhoto(product.candidate_image);
        stage = 'send';
        const label = `Product photo ${index + 1}: ${product.name}. ${product.match === 'similar' ? 'Similar alternative.' : 'Possible match.'}`;
        const photoTarget = await conversation.send(reply(label, sent));
        if (!photoTarget) throw new Error('Photo label not sent');
        const photo = await conversation.send(reply(attachment(bytes, { name: `product-${index + 1}.jpg`, mimeType: 'image/jpeg' }), photoTarget));
        if (!photo) throw new Error('Photo not sent');
        log(JSON.stringify({ event: 'imessage_product_photo_sent', product_index: index + 1 }));
      } catch { log(JSON.stringify({ event: 'imessage_product_photo_failed', stage, product_index: index + 1 })); }
    }
  } finally {
    await app.stop();
  }
}

export async function fetchImages({ space, message }, env) {
  const app = await Spectrum({ projectId: env.SPECTRUM_PROJECT_ID, projectSecret: env.SPECTRUM_PROJECT_SECRET,
    providers: [imessage.config()], telemetry: false, options: { logLevel: 'silent' } });
  try {
    const im = imessage(app);
    const images = [];
    for (const attachment of message.attachments) {
      let stage = 'metadata';
      try {
        const found = await im.getAttachment(attachment.id, space.phone);
        console.log(JSON.stringify({event:'image_attachment_metadata',found:!!found,mime:['image/jpeg','image/png','image/webp','image/heic','image/heif'].includes(found?.mimeType)?found.mimeType:'other',bytes:Number.isFinite(found?.size)?found.size:null}));
        stage = 'bytes';
        images.push(await readImage(found));
      } catch {
        console.log(JSON.stringify({event:'image_attachment_failed',stage}));
        throw new Error('Image download failed');
      }
    }
    return images;
  } finally { await app.stop(); }
}
