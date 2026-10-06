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
