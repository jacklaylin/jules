# Jules — Milestone 1: iMessage loop

Current interface: **Photon iMessage**, replacing the original Twilio SMS plan.
The live acceptance test remains **pending**:

> A tester sends `hello` through iMessage and receives `Hello from your personal shopper.`

## Architecture

Photon sends a signed JSON event to Vercel at `POST /api/imessage`. The Node
function verifies the signature and five-minute timestamp window, accepts
inbound text in a direct iMessage conversation, and sends the fixed greeting
through Photon’s official SDK. It ignores outgoing messages, reactions,
attachments, receipts, and group chats. No AI, taste profiles, product search,
admin, database, or queue is implemented.

The reply is awaited before returning HTTP 200 so Vercel does not stop an
untracked background task. Failed sends return 502 for Photon to retry.
Photon’s delivery timeout is 30 seconds; unusually slow sends can cause
retries. Warm-instance deduplication handles repeated and concurrent events,
but resets on cold starts and is not shared between Vercel instances.
Duplicate greetings remain possible after an ambiguous send failure or restart.
For this fixed-greeting test we accept that limitation instead of adding a
persistent database. Revisit persistence with Milestone 2.

Application logs contain event and message ID, never phone numbers, message
bodies, or credentials. `imessage_reply_sent` means Photon accepted the send;
only the tester receiving it confirms delivery. SDK telemetry is disabled
and SDK logs are suppressed. No payment or retailer data is collected.

## Local verification

Requires Node.js 24 and pnpm. Run:

```sh
pnpm install
pnpm test
```

Dependencies are pinned in `package.json` and `pnpm-lock.yaml`. Tests use fake
credentials and mocked sending; they never contact Photon or send iMessages.
A `.env` file is ignored by Git; `.env.example` has placeholders only.

## Founder setup

### 1. Connect your test phone to Photon

Open [Photon Dashboard](https://app.photon.codes/) and select `jules`.
Use the Free plan for the initial test. In the avatar menu, add and verify the
phone you will use. Enter verification codes only in Photon. Return to
**Get started**, select iMessage, and follow its enrollment flow to obtain
an assigned line. Free uses shared, per-user lines, not a single public number.
Keep phone numbers in Photon rather than source files or Git.

### 2. Deploy the repository

Commit and push these changes to the GitHub repository linked to Vercel.
Keep framework preset **Other**, repository root, and default build/output
settings. Vercel will install the Node dependencies and create `/api/imessage`.
The production endpoint for this project is:

`https://jules-gamma.vercel.app/api/imessage`

Opening it in a browser should return HTTP 405 because it accepts POST.
The old `/api/sms` endpoint has been removed from this revision.

### 3. Store Photon credentials privately in Vercel

Find **Project ID** and **Secret Key** in your Photon project’s Settings.
They identify the project and authenticate sending. In Vercel’s project,
open **Environment Variables** and add these for **Production**:

| Variable | Value | Type |
| --- | --- | --- |
| `SPECTRUM_PROJECT_ID` | Photon Project ID | Config |
| `SPECTRUM_PROJECT_SECRET` | Photon Secret Key | Secret |
| `SPECTRUM_WEBHOOK_SECRET` | Signing secret from step 4 | Secret |

Store secrets only in Vercel or an ignored local environment file. Never put
secrets in chat, source code, shell commands, screenshots, or Git.
The old Twilio variables are no longer used; do not upgrade Twilio.

### 4. Register the webhook

In Photon’s **Webhooks** tab, register the production endpoint above.
Photon produces a per-webhook signing secret, shown only once. Immediately
store it as `SPECTRUM_WEBHOOK_SECRET` in Vercel. Losing it requires replacing
the webhook and its secret together. Redeploy Vercel after all three variables
are saved. The endpoint must be public HTTPS without a login or redirect.
Only register one endpoint for this test to avoid duplicate replies.

### 5. Run the live acceptance test

1. From the enrolled phone, send `hello` to the assigned Photon line using
   iMessage (blue bubble, not SMS fallback).
2. Confirm Vercel logs show `imessage_reply_sent` and HTTP 200.
3. Confirm the phone receives `Hello from your personal shopper.`
4. Record the deployment, date, message ID and pass/fail in a private note.

Milestone 1 is complete only when this live test passes. Then stop; no later
milestone is authorized yet.

Troubleshooting:
- **404:** deploy the revision containing `api/imessage.js`.
- **503/configuration_error:** save all three Production variables and redeploy.
- **401:** compare the webhook signing secret and confirm the server clock;
  a signature also fails if the body bytes changed before validation.
- **502/imessage_reply_failed:** check project credentials, enabled iMessage
  platform, enrolled user, and assigned line in Photon.
- **200 without a greeting:** ensure the event is an inbound text DM; receipts,
  attachments and groups are intentionally ignored. Check delivery on the phone.
- **No webhook invocation:** check Photon webhook registration, public HTTPS
  access, and user enrollment.

## References

This integration uses Photon **Stable** documentation and pinned SDK 10.0.0.
[Webhook events](https://photon.codes/docs/webhooks/events),
[signature verification](https://photon.codes/docs/webhooks/verifying-signatures),
[delivery semantics](https://photon.codes/docs/webhooks/delivery), and
[pricing](https://photon.codes/pricing).
