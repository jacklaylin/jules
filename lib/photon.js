import { readImage } from './images.js';
import { Spectrum } from '@spectrum-ts/core';
import { imessage } from '@spectrum-ts/imessage';

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
