# Jules — Milestone 2: private inbox

Current interface: **Photon iMessage**, replacing the original Twilio SMS plan.
Milestone 1 passed on October 5, 2026: the founder confirmed receiving the greeting.
Milestone 2 passed on October 5, 2026: the founder’s fresh message appeared in `/admin`, the manual reply reached the phone, and history persisted after reloading. Owner sign-in and a live unauthenticated API rejection (HTTP 401) were verified. Both private tables have RLS enabled with no browser-role read privileges; only the server can invoke message RPCs. All 17 automated tests pass.

Milestone 1 acceptance test:

> A tester sends `hello` through iMessage and receives `Hello from your personal shopper.`

## Architecture

Photon sends a signed JSON event to Vercel at `POST /api/imessage`. The Node
function verifies the signature and five-minute timestamp window, accepts
inbound text in a direct iMessage conversation, and stores it in Supabase.
Only `hello` (case-insensitive, with surrounding whitespace ignored) triggers
the fixed greeting. Other texts wait for an operator’s reply. Reactions,
attachments and group chats remain outside this milestone.

`/admin` is a static HTML/CSS/JavaScript inbox. Server endpoints `/api/admin`
and `/api/session` handle private data and sign-in. Supabase sends an email
sign-in link; the server verifies every bearer token with Supabase and only
allows `ADMIN_EMAIL`. No custom accounts/passwords or frontend dependencies.
Browser sessions last until the token expires or the owner signs out of that
browser. Sign out is local; it does not revoke other existing sessions.

`db/001_admin.sql` adds only conversations and messages. RLS is enabled,
with no read/write grants for anonymous or authenticated browser roles.
Only the server service-role key can access the tables and RPC functions.
Phone numbers and message text are private database data, never source or logs.
The inbox shows the most recent 100 messages and can load earlier pages.
It refreshes on demand. It begins recording after this deployment; old Photon
messages are not backfilled.

Inbound message IDs are unique. Outbound replies reserve an operation ID in
Postgres before contacting Photon; duplicate submissions do not resend.
`sent` means Photon accepted the request, not proof of phone delivery.
A send error is `uncertain`: check the phone before composing a new reply.
An interrupted request may remain `sending`; it is also uncertain and must
not be automatically retried. This intentionally favors avoiding duplicates
rather than guaranteeing delivery after a crash. SDK telemetry/logs stay off.

No AI, taste profiles, product search, watches, or payment data are implemented.

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

Milestone 1 passed. Milestone 2 is now authorized; later milestones remain out of scope.

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

## Milestone 2 setup

1. In the existing Supabase project, open **SQL Editor**, paste
   `db/001_admin.sql`, and run it once. This produces private conversations and
   messages tables. The transaction prevents a partially applied schema.
2. In **Project Settings → API**, find the project URL, public `anon` key, and
   private legacy `service_role` key. Store these in Vercel Production as
   `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`.
   The service-role key must be Secret and must never reach browser code.
3. In Vercel Production, set `ADMIN_EMAIL` to the owner email (Config) and
   `SITE_ORIGIN` to the production origin, e.g. `https://your-project.vercel.app`.
4. In Supabase **Authentication → URL Configuration**, set Site URL to
   `https://your-project.vercel.app/admin` and add that exact URL to allowed
   redirects. Supabase needs this to return an email sign-in link to the inbox.
5. Supabase’s default email service may only send to organization members.
   Use the owner’s existing Supabase account email. Check spam if no link
   arrives; do not repeatedly request links because email is rate limited.
6. Deploy after the schema and all environment variables exist. The webhook
   now depends on the database and returns a retryable failure if storage fails.

### Milestone 2 acceptance

- Open `/admin` and request a sign-in link using the owner email.
- Open the link, then send a fresh text from the enrolled iPhone.
- Refresh the inbox. Confirm the inbound text appears, with no automatic
  greeting unless it was `hello`.
- Select the conversation, write a manual reply, and send it.
- Confirm the reply appears in history and arrives on the phone.
- Refresh/reopen the inbox and confirm history persists.
- Confirm `/api/admin` without a bearer token returns 401, and browser database
  roles cannot access the private tables.

Live acceptance passed on October 5, 2026 on deployment `4PmJp4XZHhG2S335xMFruyqVuAQR` (code commit `cfaaaa9`). The founder confirmed receipt of the manual test reply. Later milestones remain out of scope.
