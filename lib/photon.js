import { readImage } from './images.js';
import { Spectrum, reaction } from '@spectrum-ts/core';
import { imessage } from '@spectrum-ts/imessage';

export function progressEmoji(message) {
  const text = message.content?.text ?? '';
  if (/\b(identify|identification|what (?:is|are)|find|track down|locate|links?)\b/i.test(text)) return '🔎';
  if (/\b(recommend|recommendations?|recs|suggest|suggestions?|should I|help me (?:choose|pick)|what (?:should|would))\b/i.test(text)) return '💭';
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

export async function sendGreeting({ space, message }, greeting, env) {
  const app = await Spectrum({
    projectId: env.SPECTRUM_PROJECT_ID,
    projectSecret: env.SPECTRUM_PROJECT_SECRET,
    providers: [imessage.config()],
    telemetry: false,
    options: { logLevel: 'silent' },
  });
  try {
    const im = imessage(app);
    // The signed delivery provides the correct pooled or dedicated line.
    const user = await im.user(message.sender.id);
    const conversation = await im.space.create(user, { phone: space.phone });
    await conversation.send(greeting);
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
