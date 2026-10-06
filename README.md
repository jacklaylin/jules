# Jules — Milestone 4: personal memory (live verification pending)

Current interface: **Photon iMessage**, replacing the original Twilio SMS plan.
Milestone 1 passed on October 5, 2026: the founder confirmed receiving the greeting.
Milestone 2 passed on October 5, 2026: the founder’s fresh message appeared in `/admin`, the manual reply reached the phone, and history persisted after reloading. Owner sign-in and a live unauthenticated API rejection (HTTP 401) were verified. Both private tables have RLS enabled with no browser-role read privileges; only the server can invoke message RPCs. All 17 automated tests pass.

Milestone 1 acceptance test:

> A tester sends `hello` through iMessage and receives `Hello from your personal shopper.`

## Architecture

Photon sends a signed JSON event to Vercel at `POST /api/imessage`. The Node
function verifies the signature and five-minute timestamp window, accepts
inbound text in a direct iMessage conversation, and stores it in Supabase.
With `AI_ENABLED=true`, each incoming text gets an AI reply using recent
conversation context. When disabled, only `hello` triggers the fixed greeting
and other texts wait for the operator. Reactions, attachments, and group chats
remain outside this milestone.

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

Milestone 3 adds AI conversation when enabled. Taste profiles, product search, watches, and payment data remain out of scope.

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

Milestones 1 and 2 passed. Milestone 3 passed on October 5, 2026: the founder received a natural AI reply and a relevant follow-up, and confirmed the agent acknowledged the live-search limitation.

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

Live acceptance passed on October 5, 2026 on deployment `4PmJp4XZHhG2S335xMFruyqVuAQR` (code commit `cfaaaa9`). The founder confirmed receipt of the manual test reply.


## Milestone 3 — AI conversation

OpenAI billing, the restricted Responses API key, Production environment settings, and the database migration are configured. Deployment `2H6PACrBmPQuRat8cNzPH9oqi4PH` is Ready and current; live conversation acceptance passed on October 5, 2026. The existing Vercel webhook stores incoming text, claims one durable AI reply per Photon message, calls the OpenAI Responses API, and sends the reply via Photon. No new runtime dependency or service is required.

### Setup

1. Run `db/002_ai.sql` once in the existing Supabase SQL editor. It extends message statuses/sources and adds a server-only AI reply reservation function; private-table permissions stay unchanged.
2. Set up API billing in the OpenAI Platform and create a project API key. Store it only as the secret `OPENAI_API_KEY` in Vercel Production. Never put it in Git or chat.
3. Set Production `OPENAI_MODEL=gpt-4.1-mini` and `AI_ENABLED=true`, then deploy. Set `AI_ENABLED=false` and redeploy to return to the Milestone 2 hello/manual mode.

### Behavior and limits

- Latest 20 messages through the triggering inbound message; each text capped at 2,000 characters. Only accepted outbound replies enter model context. No structured taste memory, image analysis, product search, watches, or purchases.
- Plain-text shopper prompt with short replies, relevant clarifying questions, and explicit prohibitions against fabricated commerce facts or claiming unavailable capabilities. These are model instructions, not a guarantee of perfect behavior; founder testing remains necessary.
- OpenAI requests use `store:false`; recent message text is sent to OpenAI, without recipient/line metadata. Existing inbox history stays in Supabase.
- Generation errors produce a saved fallback labeled “AI failed · manual review needed.” Sends with ambiguous outcomes remain uncertain and never auto-retry. A process interruption can leave a reply at generating/sending; inspect history and phone before replying manually.
- Separate incoming messages can be processed concurrently. Send the next test message after receiving the prior reply; strict conversation sequencing is outside this small prototype.
- AI replies also handle `hello` while enabled. The original fixed greeting returns when AI is disabled.

### Acceptance test

Text “I need shoes for a wedding.” Confirm that Jules asks a useful clarifying question. Send a follow-up including the dress code and budget; confirm a coherent response that uses that context. Check both turns in `/admin`, including AI labels. Test a request for current listings: it should acknowledge that live search is not connected rather than invent facts. Live acceptance passed on October 5, 2026: the founder confirmed both replies arrived, the navy-tux follow-up was relevant, and the agent acknowledged that live search was not connected. Milestones 4 and later remain out of scope.

All 22 automated tests pass, including bounded model context, incomplete-output rejection, duplicate/concurrent delivery, failure fallback, and no repeat send after an ambiguous outcome.


## Milestone 4 — Personal memory

Implementation ready; live acceptance pending. Run `db/003_memory.sql` in the existing Supabase SQL editor, set Vercel Production `MEMORY_ENABLED=true`, and deploy. No additional account, credential, dependency, or infrastructure is needed.

Each existing private conversation has one `taste_profiles` row with a versioned array of structured facts. Fact fields are gender, shopping_range, size, brand, category, style, and budget. A fact has a stable category/system/brand key, explicit value, supporting quote, source message ID, and timestamp. Gender is recorded only from self-identification, separately from clothing range. Sizing systems and brand exceptions are retained without conversion. Usual category budgets are distinguished from a specific request. Style attributes are explicit statements only for this milestone; inferred image taste is out of scope.

The extractor uses strict structured output and server validation of message IDs and verbatim quotes. Model instructions exclude temporary constraints, hypothetical statements, assistant suggestions, and inferred gender; semantic extraction can still be imperfect, so inspect and edit the profile in the inbox. Conservative server gates require general-budget wording and explicit sizing-system evidence; ambiguous facts are omitted. The readable taste summary is derived from saved facts rather than an independently generated summary that could contradict them.

New text is extracted before the shopper generates its reply. The persistent profile is loaded independently of the latest 20-message context. Atomic version checks merge concurrent updates without losing unrelated facts. Newer evidence replaces older values; deletions retain tombstones so importing old history does not resurrect removed preferences. Owner edits use a version check and reject stale edits. A later explicit user correction can update an owner edit.

In `/admin`, expand **Personal memory** to inspect facts, edit/add/remove preferences, jump to source messages, or **Learn from existing messages**. Import reads the latest 100 inbound texts; the UI reports if older history was excluded. Re-import preserves newer changes and edits. Profiles are keyed by the existing conversation (person + Photon line), so a changed line creates a separate profile in this small prototype.

Extraction failure leaves existing memory intact, marks the inbound message “Memory update failed,” and logs only a fixed event and provider ID. Jules may still reply using existing facts but is instructed not to claim that new information was remembered. Process interruptions can leave an in-progress reply as documented for Milestone 3. The extra extraction call adds latency and API usage; there is no background worker or queue.

### Acceptance

Import the founder's existing messages and verify gender/clothing range, sizes, brands, and lasting budgets against source quotes. A wedding-specific budget must not become a permanent budget. Confirm the profile survives reload and can be corrected from admin. Send a new request or ask what Jules remembers; then correct a size and verify the latest value is saved and recalled. Automated tests also verify memory is supplied even when the source is absent from recent chat, duplicate import preservation, concurrent updates, source validation, owner authorization, stale edits, and extraction failures. All 30 tests pass. Do not call Milestone 4 complete until the live test passes.
