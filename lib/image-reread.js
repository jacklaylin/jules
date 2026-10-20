import { refetchImages } from './photon.js';

// Admin › person: read a photo that failed on arrival again from Photon, so the tester does not have
// to resend it. Non-destructive: it only adds the image rows the message is missing and marks the
// message's image as saved. It sends no text; the agent sees the photo from the tester's next message.
export async function rereadImage(store, conversation, messageId, env, { load = refetchImages } = {}) {
  const message = await store.conversationMessage(conversation.id, messageId);
  if (!message || message.direction !== 'inbound') throw Object.assign(new Error('That message isn’t in this conversation.'), { status: 400 });
  if (message.message_images?.length) return { status: 'already_saved', count: message.message_images.length };
  if (message.image_status !== 'failed' || !message.provider_id) throw Object.assign(new Error('Only a photo that failed to read can be read again.'), { status: 409 });
  let images;
  try { images = await load({ sender: conversation.sender_id, line: conversation.line, providerId: message.provider_id }, env); }
  catch (error) {
    const result = { status: 'failed', reason: error?.image_reason ?? 'provider_unavailable', ...(error?.image_info ? { image_info: error.image_info } : {}) };
    console.log(JSON.stringify({ event: 'admin_image_reread', message_id: message.id, ...result }));
    return result;
  }
  await store.saveImages(message.provider_id, images);
  const result = { status: 'saved', count: images.length, image_info: images.map(image => image.info ?? null) };
  console.log(JSON.stringify({ event: 'admin_image_reread', message_id: message.id, ...result }));
  return result;
}
