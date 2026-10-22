import { readImage, incomingContent, IMAGE_FAILURE_CODES } from './images.js';
import { Spectrum, reaction, reply, attachment, richlink, read } from '@spectrum-ts/core';
import {splitLinkPreview,withoutPageLink} from './link-preview.js';
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
  let app, conversation, timer, pending = Promise.resolve(), stopped = false, healthy = true;
  const attempt = async (stage, task) => {
    try { await task(); }
    catch { if (stage === 'typing_refresh') healthy = false; log(JSON.stringify({ event: 'imessage_progress_failed', stage })); }
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
  // The open conversation, for sending the reply without a second connection (sendGreeting's open), while
  // the typing dots still refresh on it; none once stopped or after a failed refresh, so the reply connects afresh.
  stop.channel = () => !stopped && healthy && conversation ? conversation : null;
  let reacted = false;
  stop.react = async intent => {
    const emoji = progressEmoji(intent);
    if (!emoji || reacted || stopped || !conversation) return;
    reacted = true;
    await attempt('reaction', () => conversation.send(reaction(emoji, delivery.message)));
  };
  return stop;
}

// open: the conversation the turn's typing dots already hold (beginProgress's channel()). Sending over it
// skips a second Photon connection for the reply (SPEED.md change 5); its owner closes it afterwards.
export async function sendGreeting({ space, message }, greeting, env, { replyTarget, products = [], files = [], connect = Spectrum, provider = imessage, loadPhoto = fetchProductPhoto, log = console.log, open = null } = {}) {
  const app = open ? null : await connect({
    projectId: env.SPECTRUM_PROJECT_ID,
    projectSecret: env.SPECTRUM_PROJECT_SECRET,
    providers: [provider.config()],
    telemetry: false,
    options: { logLevel: 'silent' },
  });
  try {
    // The signed delivery provides the correct pooled or dedicated line.
    const conversation = open ?? await (async () => { const im = provider(app); return im.space.create(await im.user(message.sender.id), { phone: space.phone }); })();
    // Never retry an ambiguous threaded send as a loose message: it could duplicate the answer.
    const target = replyTarget?.id && replyTarget.content ? replyTarget : null;
    const preview=splitLinkPreview(greeting,env);
    // A product that gets its own preview card isn't also linked in the answer (founder, October 20):
    // its link leaves the text and the card carries it; a card that fails sends the link instead.
    // The same for a site page with its own card (the wishlist after a save of several items, the style page).
    const page=preview.preview&&preview.kind!=='wishlist'?withoutPageLink(preview.body,preview.preview):preview.body,pageMoved=page!==preview.body;
    const carded=products.slice(0,3).map(p=>p.preview_url).filter(Boolean),body=withoutLinks(page,carded);
    const moved=body===page?[]:carded;
    const sent = await conversation.send(target ? reply(body, target) : body);
    if (!sent && target) throw new Error('Threaded reply not sent');
    // When the answer's text went out; its cards and photos follow. The tester's wait ends here.
    const textSentAt = Date.now();
    // Every extra message of this answer (cards, captions, photos), so a reply threaded under one of
    // them resolves to this answer and the product it shows (store.context).
    const parts = [], part = (out, kind, index = null) => { if (out?.id) parts.push({ id: String(out.id), kind, ...(index === null ? {} : { option: index + 1 }) }); return out; };
    if(preview.preview){try{const card=part(await conversation.send(richlink(preview.preview)),'preview');if(!card)throw Error('Preview not sent');log(JSON.stringify({event:preview.kind==='wishlist'?'wishlist_rich_preview_sent':'link_rich_preview_sent',kind:preview.kind}));}catch{log(JSON.stringify({event:preview.kind==='wishlist'?'wishlist_rich_preview_failed':'link_rich_preview_failed',kind:preview.kind}));
      if(pageMoved){try{if(!part(await conversation.send(preview.preview),'link'))throw Error('Link not sent');log(JSON.stringify({event:'page_link_sent',kind:preview.kind}));}catch{log(JSON.stringify({event:'page_link_failed',kind:preview.kind}));}}}}
    // Files (e.g. Jules's contact card) follow their lead-in text; a failed file never unsends the text.
    for (const file of files) {
      try {
        const out = await conversation.send(attachment(file.bytes, { name: file.name, mimeType: file.mimeType }));
        if (!out) throw new Error('File not sent');
        log(JSON.stringify({ event: 'imessage_file_sent', name: file.name }));
      } catch { log(JSON.stringify({ event: 'imessage_file_failed', name: file.name })); }
    }
    // Send cards and photos only after the main answer succeeds; failures never suppress its links.
    for (const [index, product] of products.slice(0, 3).entries()) {
      // A photo search's result is labelled as a possible match or alternative, never as the exact item.
      const label = product.caption ?? (productPhotoURL(product.candidate_image) ? `Option ${index + 1}: ${product.name}. ${product.match === 'similar' ? 'Similar alternative.' : 'Possible match.'}` : null);
      const card = product.preview_url ? await sendProductCard(conversation, sent, product.preview_url, label, index, log, out => part(out, 'card', index)) : { sent: false, caption: null };
      if (!card.sent && moved.includes(product.preview_url)) {
        try { const link = part(await conversation.send(reply(product.preview_url, card.caption ?? sent)), 'link', index); if (!link) throw new Error('Link not sent'); log(JSON.stringify({ event: 'product_link_sent', product_index: index + 1 })); }
        catch { log(JSON.stringify({ event: 'product_link_failed', product_index: index + 1 })); }
      }
      if (card.sent || !productPhotoURL(product.candidate_image)) continue;
      let stage = 'download';
      try {
        const bytes = await loadPhoto(product.candidate_image);
        stage = 'send';
        // The composer writes the caption; the factual label is the fallback. A caption already sent above a failed card is reused.
        const photoTarget = card.caption ?? part(await conversation.send(reply(label, sent)), 'caption', index);
        if (!photoTarget) throw new Error('Photo label not sent');
        const photo = part(await conversation.send(reply(attachment(bytes, { name: `product-${index + 1}.jpg`, mimeType: 'image/jpeg' }), photoTarget)), 'photo', index);
        if (!photo) throw new Error('Photo not sent');
        log(JSON.stringify({ event: 'imessage_product_photo_sent', product_index: index + 1 }));
      } catch { log(JSON.stringify({ event: 'imessage_product_photo_failed', stage, product_index: index + 1 })); }
    }
    if (sent && parts.length) try { sent.parts = parts; } catch { /* A frozen provider object keeps no parts. */ }
    if (sent) try { sent.text_sent_at = textSentAt; } catch { /* A frozen provider object keeps no time. */ }
    return sent;
  } finally {
    await app?.stop();
  }
}

// The answer without the given links: a line that is only the link goes, an inline link is dropped with
// its leading space. Text that would be left empty is kept as written.
export function withoutLinks(body, urls) {
  if (!urls.length) return body;
  const escaped = urls.map(u => u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  let out = String(body);
  for (const u of escaped) out = out.replace(new RegExp(`^[ \\t]*${u}[ \\t]*$\\n?`, 'gm'), '').replace(new RegExp(`[ \\t]*${u}`, 'g'), '');
  out = out.replace(/\n{3,}/g, '\n\n').trim();
  return out ? out : body;
}

// A product's own preview card (its /go/ link), under its caption when there is one.
// When the card fails the caller sends the product photo instead, under the caption if it was already sent.
async function sendProductCard(conversation, sent, url, label, index, log, part = out => out) {
  let stage = 'caption', caption = null;
  try {
    if (label) { caption = part(await conversation.send(reply(label, sent))); if (!caption) throw new Error('Caption not sent'); }
    stage = 'card';
    const card = part(await conversation.send(caption ? reply(richlink(url), caption) : richlink(url)));
    if (!card) throw new Error('Card not sent');
    log(JSON.stringify({ event: 'product_rich_preview_sent', product_index: index + 1, captioned: Boolean(caption) }));
    return { sent: true, caption };
  } catch {
    log(JSON.stringify({ event: 'product_rich_preview_failed', stage, product_index: index + 1 }));
    return { sent: false, caption };
  }
}

// Downloads, checks and (when oversized) recompresses each attachment; logs sizes and failure reasons.
async function readAttachments(im, attachments, phone) {
  const images = [];
  for (const attachment of attachments) {
    let stage = 'metadata';
    try {
      const found = await im.getAttachment(attachment.id, phone);
      console.log(JSON.stringify({event:'image_attachment_metadata',found:!!found,mime:['image/jpeg','image/png','image/webp','image/heic','image/heif'].includes(found?.mimeType)?found.mimeType:'other',bytes:Number.isFinite(found?.size)?found.size:null}));
      stage = 'bytes';
      const image = await readImage(found);
      console.log(JSON.stringify({event:'image_attachment_read',...image.info}));
      images.push(image);
    } catch (error) {
      const reason=IMAGE_FAILURE_CODES.includes(error?.code)?error.code:'provider_download_failed';
      console.log(JSON.stringify({event:'image_attachment_failed',stage,reason,...(error?.image_info??{})}));
      throw Object.assign(new Error('Image download failed'),{image_reason:reason,image_info:error?.image_info??null});
    }
  }
  return images;
}
export async function fetchImages({ space, message }, env) {
  const app = await Spectrum({ projectId: env.SPECTRUM_PROJECT_ID, projectSecret: env.SPECTRUM_PROJECT_SECRET,
    providers: [imessage.config()], telemetry: false, options: { logLevel: 'silent' } });
  try { return await readAttachments(imessage(app), message.attachments, space.phone); }
  finally { await app.stop(); }
}
// Reads an earlier message's photos again from Photon by its provider ID (admin re-read of a failed
// image). The attachment IDs come from Photon's copy of that message, never from stored or sent text.
export async function refetchImages({ sender, line, providerId }, env) {
  const app = await Spectrum({ projectId: env.SPECTRUM_PROJECT_ID, projectSecret: env.SPECTRUM_PROJECT_SECRET,
    providers: [imessage.config()], telemetry: false, options: { logLevel: 'silent' } });
  try {
    const im = imessage(app);
    const space = await im.space.create(await im.user(sender), { phone: line });
    const message = await space.getMessage(providerId);
    if (!message) throw Object.assign(new Error('Image download failed'), { image_reason: 'message_not_found' });
    let content = null;
    try { content = incomingContent(message.content); } catch { /* treated as no attachments */ }
    if (!content?.attachments?.length) throw Object.assign(new Error('Image download failed'), { image_reason: 'no_attachments' });
    return await readAttachments(im, content.attachments, line);
  } finally { await app.stop(); }
}
