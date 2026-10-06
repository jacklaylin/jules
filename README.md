# Jules — Milestone 4: personal memory

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

AI replies show an iMessage typing indicator while Jules processes the request, refreshed every eight seconds and stopped after the send attempt or an application error. Relevant incoming messages receive one acknowledgement reaction: 🔎 for identification/sourcing, 💭 for recommendations, or 👀 for an image without an explicit request. Ordinary conversation does not get a default reaction. Feedback starts only after the durable reply claim, so webhook retries do not add reactions twice. These are best-effort Photon SDK features; feedback errors are logged without private details and do not suppress the reply. A reaction acknowledges work, not a successful product identification. A platform-enforced function termination can prevent cleanup; progress is not a delivery guarantee.

Image replies thread to the incoming image. An explicit follow-up that searches a saved image threads to that image's stored provider ID. Visual-search answers send up to three candidate product thumbnails after the main text and links, each labeled with its product number and “Possible match” or “Similar alternative.” Photos are the same Google Lens thumbnails used for comparison, so resolution can be limited. Ordinary text search has no photo output yet. Downloads allow only HTTPS Google thumbnail hosts, reject redirects, validate image bytes, cap size/pixels, and time out after five seconds. Photo failures are logged separately and never retry the main answer. The webhook's 120-second limit matches `vercel.json` to accommodate search and media sends; it is still a synchronous prototype, not a durable background queue.

Live photo/thread acceptance: send a garment image with “Find the jacket in this image,” then verify the answer replies to that image, a numbered candidate photo appears when a match is found, and its label/link agree with the photo. Repeat with “Find links for the jacket in my last image” without reattaching it. Automated tests cover target IDs, bounded downloads, failed-photo behavior, and duplicate suppression; live acceptance remains pending.

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

Live acceptance passed on October 5, 2026. Run `db/003_memory.sql` in the existing Supabase SQL editor, set Vercel Production `MEMORY_ENABLED=true`, and deploy. No additional account, credential, dependency, or infrastructure is needed.

Each existing private conversation has one `taste_profiles` row with a versioned array of structured facts. Fact fields are gender, shopping_range, size, brand, category, style, and budget. A fact has a stable category/system/brand key, explicit value, supporting quote, source message ID, and timestamp. Gender is recorded only from self-identification, separately from clothing range. Sizing systems and brand exceptions are retained without conversion. Usual category budgets are distinguished from a specific request. Style attributes are explicit statements only for this milestone; inferred image taste is out of scope.

The extractor uses strict structured output and server validation of message IDs and verbatim quotes. Model instructions exclude temporary constraints, hypothetical statements, assistant suggestions, and inferred gender; semantic extraction can still be imperfect, so inspect and edit the profile in the inbox. Conservative server gates require general-budget wording and explicit sizing-system evidence; ambiguous facts are omitted. The readable taste summary is derived from saved facts rather than an independently generated summary that could contradict them.

New text is extracted before the shopper generates its reply. The persistent profile is loaded independently of the latest 20-message context. Atomic version checks merge concurrent updates without losing unrelated facts. Newer evidence replaces older values; deletions retain tombstones so importing old history does not resurrect removed preferences. Owner edits use a version check and reject stale edits. A later explicit user correction can update an owner edit.

In `/admin`, expand **Personal memory** to inspect facts, edit/add/remove preferences, jump to source messages, or **Learn from existing messages**. Import reads the latest 100 inbound texts; the UI reports if older history was excluded. Re-import preserves newer changes and edits. Profiles are keyed by the existing conversation (person + Photon line), so a changed line creates a separate profile in this small prototype.

Extraction failure leaves existing memory intact, marks the inbound message “Memory update failed,” and logs only a fixed event and provider ID. Jules may still reply using existing facts but is instructed not to claim that new information was remembered. Process interruptions can leave an in-progress reply as documented for Milestone 3. The extra extraction call adds latency and API usage; there is no background worker or queue.

### Acceptance

Import the founder's existing messages and verify gender/clothing range, sizes, brands, and lasting budgets against source quotes. A wedding-specific budget must not become a permanent budget. Confirm the profile survives reload and can be corrected from admin. Send a new request or ask what Jules remembers; then correct a size and verify the latest value is saved and recalled. Automated tests also verify memory is supplied even when the source is absent from recent chat, duplicate import preservation, concurrent updates, source validation, owner authorization, stale edits, and extraction failures. All 30 tests pass. Live acceptance passed on October 5, 2026: imported brand preferences and confirmed sizes survived reload, owner corrections persisted, and the founder confirmed Jules recalled the brands and shoe sizes over iMessage. The wedding-only budget was removed; conservative validation was added after live extraction errors. Database RLS and server-only table/RPC access were verified. Text correction ordering and recall without recent source messages are covered by automated tests. Milestone 5 and later remain out of scope.

### Milestone 5 — inspiration images (live image acceptance passed)

Apply `db/004_images.sql` in the existing Supabase SQL Editor, then set `IMAGES_ENABLED=true` in Vercel Production and redeploy. The existing Photon and OpenAI credentials are sufficient. Images sent through Photon are fetched by authenticated attachment ID, stored privately in the existing database, and sent to OpenAI as inline image inputs with `store:false`. Only the authenticated inbox owner can retrieve them; no public storage or signed image URLs are created.

Send JPG, PNG, WebP, or HEIC/HEIF images, up to three per message and 3 MB per image. HEIC/HEIF images are converted to JPEG on the server before storage and OpenAI processing; both input and converted output must fit the 3 MB limit. Unsupported formats or failed downloads produce a visible fallback. Jules describes visible silhouettes, colors, textures, and styling, then asks which details the tester likes. Images alone never update taste memory. Reply with an explicit preference such as “I like relaxed tailoring and muted colors” to confirm it. A bare “yes” is insufficient. Images and AI interpretations appear together in the inbox; preferences remain editable and removable using Personal memory.

For this small experiment image bytes live in a private Postgres table rather than adding separate storage infrastructure. They remain until their conversation/message is deleted; there is no automatic expiry. This is deliberately bounded, not a general photo library. No face identification, inferred gender or body size, product identification guarantees, or verified commerce facts.

Live image acceptance passed on October 5, 2026: a real HEIC image was converted, saved privately, interpreted with specific clothing details, rendered in the inbox, and the founder confirmed receiving the reply. A subsequent prompt correction treats standalone inspiration images as general style input rather than inheriting an earlier shopping occasion. Image-derived taste preferences still require an explicit user statement. Automated tests cover formats/limits, private endpoint authorization, vision requests, durable dedupe, failure fallback, and keeping image inferences out of memory.


### Milestone 6 — image recognition and product links (phone acceptance pending)

Apply `db/005_search.sql`, set `SEARCH_ENABLED=true` in Vercel Production, and redeploy. This reuses the existing OpenAI Responses API credential and hosted web search; no new provider or key is needed. Web search uses API credits.

An explicit request such as “Find the jacket in that image and send links” invokes sourcing. An inspiration image alone remains a style conversation. The sourcing step receives the actual current image, or the most recent image in the bounded conversation context for follow-up requests. Query briefs include relevant clothing attributes and ordinary preferences, not personal contact details.

The separate `lib/search.js` module searches live product listings, distinguishes likely matches from similar alternatives, and returns up to three sourced product URLs. The server rejects any link missing from the API's retrieved sources/citations, unsafe URLs, duplicates, and unbounded results. It saves results, source URLs, and the check time privately on the reply. The inbox shows clickable product links and marks failed or insufficient sourcing for manual review. Links are current search results, not guarantees that a product is the exact item in the photo.

This initial slice returns names, brands, match rationale and links. It does not confirm price, inventory, available sizes, shipping, duties, discounts, or policies. Those values are left unknown rather than inferred. No checkout or watches.

Acceptance: source a specified item from a real phone image, receive working product links with explicit match uncertainty, check the linked retailer pages, and verify source evidence/review status in the private inbox.

After a live false match, image identification requires a readable model/collaboration identifier shared by the image and the retrieved listing, with no reported construction contradictions. Generic resemblance is withheld; alternatives require an explicit request. This conservative rule reduces coverage: an outfit photo without identifying text normally needs a closer label photo or original product/post link. The server records rejected candidate counts and uses its own introduction so rejected product names cannot leak into the reply. Evidence extraction remains model-based and a likely match is still unconfirmed. Milestone 6 recognition acceptance remains pending.

### Visual identification experiment (Milestone 6)

`VISUAL_SEARCH_ENABLED=true` switches image-based sourcing to `lib/visual-search.js`; text-only searches keep the existing path. Store `SERPAPI_API_KEY` privately in Vercel Production. SerpApi uploads must be explicitly authorized because they share garment crops with SerpApi/Google Lens. The upload uses private bytes (no public inbox URL), converted to JPEG under 500 KB. SerpApi documents temporary image IDs expiring after ten minutes; this is not a promise that all provider records are deleted. The normal OpenAI image-sharing approval remains required. Model/search credits and extra calls increase cost and latency.

The model first selects the requested garment or up to three pieces of an explicitly requested whole outfit. Vague references across several garments ask for clarification without uploading to Lens. Normalized crop bounds are checked; Sharp rotates, crops, and resizes the stored image. Up to eight retrieved candidate thumbnails per garment are compared with the original and crop. Concrete contradictions reject identification; weak/generic/occluded evidence is insufficient. Readable model codes are not required in this path. Comparisons still use a model and low-resolution search thumbnails, so likely matches remain uncertain and live evaluation is essential. Candidate result titles are not a guarantee of a purchasable or currently available listing. Prices, availability, shipping, and returns remain unknown.

Product identity is selected before merchant preference. Equivalent brand/model/color results are grouped, with official brand domains first, then the experiment's preferred domains, then unreviewed stores. `lib/retailers.js` contains the editable domain registry. The registry expresses editorial preference, not verified trust, authorized-dealer status, price, inventory, or returns. An unfamiliar boutique such as Deecee Style is unreviewed rather than automatically considered bad. Exact hostname/subdomain matching prevents domain impersonation. Product evidence beats merchant priority, and unreviewed primary links have a user-facing note. Merchant options and comparison evidence are saved privately with the search result.

No new database schema or human queue is introduced. Whole-outfit searches are capped at three pieces, report omitted/unmatched pieces, and retain partial results if another piece fails. The existing durable reply reservation prevents duplicate sends. The Vercel function duration is 120 seconds on the existing Fluid compute project; individual provider calls have shorter deadlines.

See `evals/IDENTIFICATION.md` for the 12-case evaluation, independent answer labels, scoring, and release gate. Run outputs/photos live in Git-ignored `.eval-local/`, not the deployed app. Offline logic tests do not establish image recognition accuracy. Real-image evaluation and phone acceptance are pending.

## Simple cost dashboard

Run `db/006_costs.sql` in your existing Supabase project’s **SQL Editor → New query → Run**. This creates a private cost ledger; it produces no new credential. Keep your existing Supabase environment variables in Vercel. Deploy the updated application through the existing Vercel deployment workflow, sign in at `/admin`, and click **Costs** (or open `/costs.html`).

The dashboard covers OpenAI API, Photon, SerpApi, Vercel, Supabase, GitHub, and ChatGPT/Codex development expenses. OpenAI usage can be read automatically with the billing connection below. For other dollar costs, open each billing link, enter the selected day’s variable usage total, and enter the month’s fixed subscription fee. Enter explicit zeroes for free/inactive services. Missing values remain unknown. Every save replaces the service/date/type amount, so correcting entries does not duplicate charges. Monthly subscription amounts apply only to that month and must be entered again next month. Amounts are USD; convert other currencies yourself before entering them.

Subscription fees are divided by the actual number of days in the selected month. This is allocated cost, not a cash-payment statement. Credits covered by a subscription belong in the note, not another dollar charge; avoid counting both a prepaid top-up and its consumption. Costs from shared development subscriptions can be allocated manually to Jules. Connected OpenAI costs are read for the selected month through the selected date, including earlier reported costs. No credit-to-dollar conversion is claimed.

Choose **Daily warning budget** to set a dollar threshold for the selected month. This warns when recorded daily cost exceeds it, but does not block calls, enforce limits, or alert in the background. Check provider-side limits separately. The default day uses UTC; use the date matching your provider’s reporting period when recording charges. The page adds no paid service or recurring polling; refresh it manually.


### Automatic billing connection

OpenAI billing requires a separate organization Admin API key, not `OPENAI_API_KEY`. In the OpenAI Platform organization settings, open **Admin keys** and create a key for billing reads (restrict permissions to reading costs if the UI supports that). Save it only in **Vercel → Jules → Settings → Environment Variables → Production**, named `OPENAI_BILLING_ADMIN_KEY`. Do not paste it into chat or Git. Find the project ID for the Jules project in OpenAI project settings and save it as `OPENAI_BILLING_PROJECT_ID` in the same place. Both values are required to avoid including unrelated project spending. Redeploy after saving environment variables.

OpenAI billing refreshes when the owner opens the dashboard or clicks Refresh. It uses UTC days and shows both the selected day's reported spend and the month's reported total through that day. Align the project and date range with OpenAI before comparing a credit-spend figure. This is reported usage cost, not remaining prepaid balance or the amount paid for a top-up; recent costs can lag. Missing daily buckets remain unknown. A connected billing amount replaces the manual OpenAI daily entry in the displayed subtotal rather than adding it twice. On a billing error the OpenAI daily usage becomes unknown; its manual entry remains stored. No extra SQL migration is required.

SerpApi uses the existing server-side `SERPAPI_API_KEY` to read current account-wide used/remaining search credits without consuming search quota. It does not infer dollar spend from credit consumption or retroactively attribute credits to a day. Other service charges and subscriptions remain manual. Provider secrets and account details are never returned to the browser. No background job, polling loop, or additional paid service is added.

### GitHub and Vercel billing

GitHub: create a fine-grained token with account **Plan: Read** permission and no repository write permissions. Store it as `GITHUB_BILLING_TOKEN` in Vercel Production, with `GITHUB_BILLING_USER` and `GITHUB_BILLING_REPOSITORY` (`owner/repository`). The dashboard requests the repository-filtered daily usage summary and sums net metered charges. Fixed subscriptions remain manual. Account eligibility for enhanced billing and summary API access must be verified live.

Vercel: create a token scoped to the Jules team, save it as `VERCEL_BILLING_TOKEN` in Production, and configure `VERCEL_BILLING_TEAM_SLUG` plus `VERCEL_BILLING_PROJECT_ID` from project General settings. Its official FOCUS billing endpoint returns JSONL; only USD charges tagged with the exact Jules `ProjectId`, contained within the selected UTC day, enter the subtotal. Untagged team charges are shown separately; other projects are excluded. Charges spanning multiple days remain unknown rather than being allocated speculatively. Fixed fees remain manual. An empty successful provider report means no reported charges yet, not a guarantee of no later charges. Neither integration enforces spending limits. Redeploy after saving settings. No additional SQL or paid service is needed.

## Developer feedback in iMessage

Run `db/007_feedback.sql` in the existing Supabase SQL editor before deploying this change. It adds a feedback field to private messages; no new account or credential is needed.

Testers can send `DM the replies are too long` (case insensitive; `DM: feedback` also works). Each message is a separate report, and the next ordinary message resumes shopping. Jules saves the text after DM and confirms receipt. Bare `DM` returns usage instructions. Words such as “DMV” do not activate it. Feedback bypasses AI, images, and taste extraction and is excluded from subsequent AI context and memory imports.

In `/admin`, expand **Developer feedback** for the latest 100 reports across testers. Each shows its sender and time; click it to open the conversation and follow up. You can also ask Codex here to inspect developer feedback using the configured private database. Reports stay in the conversation history. Repeated webhook deliveries do not create additional reports or send another acknowledgment.

Acceptance: send a DM report, confirm the acknowledgment and admin entry, then send an ordinary shopping message and confirm normal behavior. Live acceptance requires the migration and deployment.


### Companion wishlist MVP — implemented, live acceptance pending

The consumer app is `/wishlist`: email login, a product grid, product detail, and logout. It reuses Supabase Auth, Vercel, and the private database; no new paid service or API key. Only new image-identification results are saved. No automatic historical import, price alerts, cutouts, item management, or owned-wardrobe features. The founder subsequently requested a one-time import of the three previously sent Barbour × Paul Smith candidates; those use a clearly labeled original outfit image because the earlier search did not retain product thumbnails.

#### Enable it

1. **Create the private wishlist tables:** open the existing Supabase project → SQL Editor, paste `db/008_wishlist.sql`, and run it once. This adds invited-email mappings, wishlist items/encounters, explicit session revocations, and an atomic save function. No credential is produced or needs to be copied.
2. **Associate each tester with their existing conversation:** open the private Jules `/admin` inbox and select the tester. Obtain that conversation's UUID from the authenticated `/api/admin` response in browser developer tools, or use Supabase Table Editor → `conversations`. In Table Editor → `wishlist_members`, insert the tester's lowercase email and that conversation UUID. This mapping grants access to that conversation's saved items and images. Confirm the identity with the tester; do not match conversations by guesswork. Keep personal email/phone values in Supabase only, never in Git or source files. Remove the mapping to revoke that tester's access.
3. **Allow the sign-in redirect:** Supabase → Authentication → URL Configuration → Redirect URLs, add `https://YOUR-EXISTING-JULES-DOMAIN/wishlist` (replace the domain with the actual production domain). Keep the existing admin redirect. Supabase's existing email sender delivers a one-use magic link; no password or new credential is required. Existing Auth email rate limits still apply.
4. **Enable deployment:** in the existing Vercel project's Production environment variables, set `WISHLIST_ENABLED=true`. Keep the existing `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `SITE_ORIGIN`; `SITE_ORIGIN` must equal the production HTTPS origin. Deploy this code through the project's normal Git/Vercel flow. Keep all secret values in Vercel, never paste them into source code. The example environment file contains placeholders only.
5. Open `/wishlist`, enter the invited email, and follow the email link in the same browser you want to use. The browser stores only the access token in session storage, not a refresh token. When the session expires, request another email link. Log out explicitly to revoke that token immediately for wishlist access; closing a tab clears its session-storage copy but is not server-side revocation.

#### Saving and repair

The app records a private, structured snapshot before attempting the iMessage send, then materializes it only after the reply is marked `sent` (accepted by Photon, not a read/delivery receipt). Only URLs actually included in the reply are saved. Alternative merchants stay under the same item. Repeated exact product URLs reuse a tile and retain previous source encounters; different URLs are conservatively kept separate if cross-request equivalence is uncertain. Database uniqueness and the atomic save function prevent retry duplicates.

Product thumbnails are downloaded through the existing bounded, allowlisted image loader and retained privately. If a thumbnail fails, the existing garment crop is used when available, otherwise a placeholder. The original source image remains privately associated with the saved item. Grid reads currently return the latest 200 items, an explicit prototype bound.

On the first saved collection and explicit “show my wishlist” / “open my wishlist” requests, Jules provides the `/wishlist` URL. This link is a navigation URL, not an access credential; email login is still required. It does not claim a save succeeded before persistence.

A failure after a successful send logs `wishlist_save_failed` with the reply operation ID. An owner-authenticated POST to `/api/wishlist` with JSON `{"action":"repair"}` saves up to 100 pending accepted replies from their snapshots, without sending any messages. For a single operation, the operator can instead call `select public.save_wishlist_reply('OPERATION_ID');` in Supabase SQL Editor, replacing the placeholder with the logged operation ID. Both are idempotent and ignore uncertain/failed sends. Do not change an uncertain reply to `sent` unless the operator has verified the actual send. A `wishlist_prepare_failed` log means the snapshot step failed before send; inspect the stored search result/reply for manual recovery rather than resending. No automatic repair scheduler is added.

#### Live acceptance

Invite two testers, sign in, and send an outfit with an explicit jacket/bag request. Verify the returned pieces appear separately, match labels remain uncertain, all sent links agree, and source outfits are correct. Try a partial result, reload, repeat a product request, and confirm one tile per exact product URL with multiple source encounters. Check a second tester cannot fetch the first tester's item ID or source image, and that a logged-out token is rejected. Check the phone-sized grid, product details, empty collection, missing-photo fallback, and retailer-link destinations. Existing identification accuracy/phone gates still apply: automated logic tests do not establish recognition quality.


Wishlist refinement: the consumer grid now groups the saved encounter metadata by source image and requested garment. Potential product matches become nested retailer preview cards. The UI shows the source message date and sourced price ranges; it omits internal identification evidence and uncertainty strings. Price snapshots require amount, currency, supporting source URL, and check time; currencies are never blended. The historical jacket links have manually sourced USD snapshots where available. This is not automatic price monitoring. Grid reads avoid selecting stored image bytes; images are separately authorized and cached in browser memory for reuse in details. No arbitrary third-party link-preview fetcher or new library is added.
