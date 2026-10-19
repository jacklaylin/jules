import { readImage } from './images.js';
import { Spectrum, reaction, reply, attachment, richlink, read } from '@spectrum-ts/core';
import {splitLinkPreview} from './link-preview.js';
import { imessage } from '@spectrum-ts/imessage';
import { fetchProductPhoto, productPhotoURL } from './product-photos.js';

// The model's structured action determines acknowledgment, never message wording.
export function progressEmoji(intent) {
  if (intent?.action === 'selection' && ['interest','confirm'].includes(intent.decision)) return '👍';
  if (intent?.action === 'search') return '🔎';
  if (intent?.action === 'start') return '👀';
  return null;
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
    // iMessage marks the whole chat read, so the tester sees "Read" as soon as Jules starts working.
    await attempt('read_receipt', () => conversation.send(read(delivery.message)));
    await attempt('typing_start', () => conversation.startTyping());
    // Refresh without overlapping requests, including during longer visual searches.
    let refreshing = false;
    timer = setInterval(() => {
      if (stopped || refreshing) return;
      refreshing = true;
      pending = attempt('typing_refresh', () => conversation.startTyping()).finally(() => { refreshing = false; });
    }, 8000);
    timer.unref?.();
  } catch { log(JSON.stringify({ event: 'imessage_progress_failed', stage: 'connect' })); }
  const stop = async () => {
    stopped = true;
    clearInterval(timer);
    await pending;
    if (conversation) await attempt('typing_stop', () => conversation.stopTyping());
    if (app) await attempt('disconnect', () => app.stop());
  };
  let reacted = false;
  stop.react = async intent => {
    const emoji = progressEmoji(intent);
    if (!emoji || reacted || stopped || !conversation) return;
    reacted = true;
    await attempt('reaction', () => conversation.send(reaction(emoji, delivery.message)));
  };
  return stop;
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
    const preview=splitLinkPreview(greeting,env);
    const sent = await conversation.send(target ? reply(preview.body, target) : preview.body);
    if (!sent && target) throw new Error('Threaded reply not sent');
    if(preview.preview){try{const card=await conversation.send(richlink(preview.preview));if(!card)throw Error('Preview not sent');log(JSON.stringify({event:preview.kind==='wishlist'?'wishlist_rich_preview_sent':'link_rich_preview_sent',kind:preview.kind}));}catch{log(JSON.stringify({event:preview.kind==='wishlist'?'wishlist_rich_preview_failed':'link_rich_preview_failed',kind:preview.kind}));}}
    // Send cards and photos only after the main answer succeeds; failures never suppress its links.
    for (const [index, product] of products.slice(0, 3).entries()) {
      // A photo search's result is labelled as a possible match or alternative, never as the exact item.
      const label = product.caption ?? (productPhotoURL(product.candidate_image) ? `Option ${index + 1}: ${product.name}. ${product.match === 'similar' ? 'Similar alternative.' : 'Possible match.'}` : null);
      const card = product.preview_url ? await sendProductCard(conversation, sent, product.preview_url, label, index, log) : { sent: false, caption: null };
      if (card.sent || !productPhotoURL(product.candidate_image)) continue;
      let stage = 'download';
      try {
        const bytes = await loadPhoto(product.candidate_image);
        stage = 'send';
        // The composer writes the caption; the factual label is the fallback. A caption already sent above a failed card is reused.
        const photoTarget = card.caption ?? await conversation.send(reply(label, sent));
        if (!photoTarget) throw new Error('Photo label not sent');
        const photo = await conversation.send(reply(attachment(bytes, { name: `product-${index + 1}.jpg`, mimeType: 'image/jpeg' }), photoTarget));
        if (!photo) throw new Error('Photo not sent');
        log(JSON.stringify({ event: 'imessage_product_photo_sent', product_index: index + 1 }));
      } catch { log(JSON.stringify({ event: 'imessage_product_photo_failed', stage, product_index: index + 1 })); }
    }
    return sent;
  } finally {
    await app.stop();
  }
}

// A product's own preview card (its /go/ link), under its caption when there is one.
// When the card fails the caller sends the product photo instead, under the caption if it was already sent.
async function sendProductCard(conversation, sent, url, label, index, log) {
  let stage = 'caption', caption = null;
  try {
    if (label) { caption = await conversation.send(reply(label, sent)); if (!caption) throw new Error('Caption not sent'); }
    stage = 'card';
    const card = await conversation.send(caption ? reply(richlink(url), caption) : richlink(url));
    if (!card) throw new Error('Card not sent');
    log(JSON.stringify({ event: 'product_rich_preview_sent', product_index: index + 1, captioned: Boolean(caption) }));
    return { sent: true, caption };
  } catch {
    log(JSON.stringify({ event: 'product_rich_preview_failed', stage, product_index: index + 1 }));
    return { sent: false, caption };
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
      } catch (error) {
        const codes=['attachment_missing','unsupported_type','image_too_large','download_timeout','empty_image','invalid_heic','heic_conversion_failed','converted_image_too_large','invalid_image_bytes'];
        console.log(JSON.stringify({event:'image_attachment_failed',stage,reason:codes.includes(error?.code)?error.code:'provider_download_failed'}));
        throw new Error('Image download failed');
      }
    }
    return images;
  } finally { await app.stop(); }
}
