# Gmail purchase-history pilot

Founder-authorized October 10, 2026. This replaces the Gmail onboarding demo when `GMAIL_IMPORT_ENABLED=true`. It uses the existing invited sign-in, Vercel application and Supabase database. Receipt import now uses bounded background requests in the existing Vercel function; no separate service, full closet UI or automatic ongoing inbox monitoring is added. See [ENTRY-FLOW.md](ENTRY-FLOW.md) for the October 12 entry-flow update.

## What the pilot does

The user signs in, reviews consent, connects their invited Gmail account, and imports up to 1,000 matching shopping emails from the last five years, with the last two years prioritized. Google grants read-only mailbox access; the application's retrieval query selects candidate shopping emails. This is a partial history, not a complete inbox scan or a guarantee that all purchases were found. Email selection terms are retrieval syntax, never conversational intent routing.

Both plain and HTML email bodies are retained for analysis, including tables and limited order/receipt link components. Digital PDFs are extracted locally, even when the attachment has no filename. Email addresses, raw links, labeled credentials and labeled payment/contact numbers are redacted from prepared text. Names, addresses and other fragments may remain. Prepared email/PDF text is sent to OpenAI Responses with `store:false`; original PDF bytes are not sent. The consent screen explains analysis, storage and shopping learning before connecting.

Evidence-backed clothing/accessory purchases have stable per-account item identities. Original evidence and user corrections stay distinct. Order/receipt identity and item variants must match before subsequent events attach. Shipping-only evidence and unlinked return/refund events remain pending, not invented purchases. Exact pending identities can link after purchase evidence arrives. Collection bookings and return requests do not imply refunds. Cancelled purchases cannot contribute personal shopping observations.

The model selects at most five consequential questions, ordered by impact. Unknown recipients do not teach personal tastes or sizes. Gifts stay in purchase history but not personal learning. Receipt-derived observations reach Jules's shopping context/ranking as `shopping_history`, separately from explicit preferences; purchased size is not a category default or confirmed fit. Independent facts are never overwritten. Follow-up questions and corrections happen in iMessage; the web page displays history and connection controls. The internal validated correction path remains shared. Unrelated chat continues normally.

## Setup for Jack's first account

Keep the pilot invite-only. Use the existing Jules Google Cloud project if appropriate; Gmail authorization is separate from Supabase sign-in.

1. **Enable Gmail API.** Open [Google Cloud API Library](https://console.cloud.google.com/apis/library/gmail.googleapis.com), select the Jules project, and click **Enable**. This lets the application retrieve shopping emails. No credential is produced.
2. **Configure Google Auth Platform.** In that project, open **Google Auth Platform → Branding** and complete the app name, support email and developer contact fields. In **Audience**, use **External**. Jules's app started in **Testing** (with your Gmail address under **Test users**) and is now **In production**, unverified, for up to 100 users (October 2026). In **Data Access**, add only `https://www.googleapis.com/auth/gmail.readonly`. This permits reading; it does not permit sending, changing or deleting email. Public expansion requires the applicable Google verification work. Testing-mode refresh tokens for these scopes can expire after seven days, requiring reconnection. [Google scope guidance](https://developers.google.com/workspace/gmail/api/auth/scopes), [OAuth testing guidance](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview).
3. **Create a Web application authorization client.** Open **Clients → Create client → Web application**. In **Authorized redirect URIs**, add your actual Jules `SITE_ORIGIN` followed by `/api/wishlist?gmail=callback` (for example, if the configured origin is `https://your-jules-domain.example`, the full URI is `https://your-jules-domain.example/api/wishlist?gmail=callback`). Use the exact deployed origin, including HTTPS; do not enter the example domain. Google produces a **Client ID** and **Client secret**. Store these in **Vercel → Jules project → Settings → Environment Variables** as `GOOGLE_GMAIL_CLIENT_ID` and `GOOGLE_GMAIL_CLIENT_SECRET`. Keep the secret out of chat and source files. [Google web authorization setup](https://developers.google.com/identity/protocols/oauth2/web-server).
4. **Add the encryption key.** Generate it once in Terminal with `openssl rand -base64 32`. This produces a private key for stored Gmail tokens. Copy it directly into Vercel's secret environment variable `GMAIL_TOKEN_KEY` and keep a secure backup. Do not paste it into chat, source code or Git. Changing this key makes existing stored connections unreadable and requires reconnecting those accounts.
5. **Create private storage.** In **Supabase → SQL Editor**, run `db/017_gmail_import.sql` after the existing migrations, including `016_onboarding.sql`. It creates one private table and atomic update functions. This produces no credential. Browser accounts have no table access; the server uses its existing service-role credential. Confirm your exact Gmail address maps to your conversation in `wishlist_members` and that an `onboarding_sessions` invitation exists. No phone numbers or email mappings belong in migration files.
6. **Enable and deploy.** Set `GMAIL_IMPORT_ENABLED=true`, `ONBOARDING_ENABLED=true`, and retain the existing wishlist, AI, memory, Supabase, Photon and OpenAI settings. The deployed `SITE_ORIGIN` must match the redirect URI exactly. Deploy the reviewed application changes. Do not enable Gmail on a deployment missing the migration or secrets. Existing Supabase sign-in must allow returning to `/onboarding`.
7. **Connect.** Open `/onboarding` on the deployed Jules site, sign in with your invited email, read the consent, and click **Connect Gmail and import**. Choose that same invited Gmail account in Google. No keys are entered on this screen.

## Operation and interruptions

One persisted step lists a page of candidate IDs or extracts one email. Steps are serialized with a database lease and revision check; stale/concurrent writes cannot replace newer feedback. A failed step leaves completed work intact. The browser advances steps while open. Closing the page pauses advancement; reopening resumes the persisted job. This version does not promise background completion or a completion text.

Repeat imports use a fresh bounded date window and skip unchanged source fingerprints. Prior feedback and evidence persist. If a processed source's fingerprint changes, the tool retains the changed text separately and continues rather than silently replacing evidence beneath a user correction. The page discloses held changes and supports direct corrections; automatic changed-source reconciliation is not yet implemented.

Limits are disclosed: 1,000 candidate emails per newly approved five-year import; 60,000 prepared characters per email; 4 MB per body/PDF, 8 MB total declared content, three externally fetched attachment/body parts, and 20 PDF pages. Image attachments, scanned PDFs needing OCR and unsupported documents produce warnings while retaining readable partial evidence. The tool never calls partial coverage complete inbox coverage. No prices, stock, discounts, policies or fit claims are inferred.

**Disconnect Gmail** revokes access and clears stored tokens; imported history remains. **Delete imported history** also disconnects, then removes receipt evidence, questions, corrections and receipt-derived learning. Independent chat/style preferences remain. Users can also revoke access through their Google account. No ongoing automatic sync exists.

## Verification and remaining live gate

Local tests exercise encrypted owner-bound tokens, browser-bound one-use authorization state, explicit consent, account matching/revocation, origin/invitation checks, PDF/HTML preparation, scoped evidence validation, variants, deduplication, return/cancellation semantics, interruption, repeat imports, questions, website/closet/iMessage feedback, replay and derived ranking context. Browser checks use synthetic data at 1440, 390 and 320 pixels and check consent, questions, answers, overflow and JavaScript errors. These do not establish model extraction accuracy.

Before declaring the pilot live, use the configured deployment and database:

- Connect your invited Gmail account and complete an import. Verify reported source counts, warning counts and pending events against selected actual receipts.
- Answer a question or correct an item; confirm the recipient/return/brand update persists after reload.
- Import again; verify no duplicate items, corrections remain, and new evidence is appended safely.
- Confirm a gift contributes no personal shopping observation; confirm the same supported self purchase does. Ask Jules for a shopping suggestion and verify it sees the observations without claiming favorite status or verified fit.
- Confirm the wrong Gmail account cannot connect, another invited user cannot read your history, denied consent reads no email, and stale/double callbacks cannot reconnect.
- Interrupt and resume an import; disconnect and confirm access is revoked. Delete imported history and verify receipt learning disappears while independent preferences remain.

External setup completed October 10, 2026: Gmail API enabled; Google app in External Testing with only `gmail.readonly` configured and the founder account allowlisted; Web client created with `https://jules-gamma.vercel.app/api/wishlist?gmail=callback`; the three Google/token settings saved as protected Production secrets in Vercel. Supabase migrations `016_onboarding.sql` and `017_gmail_import.sql` applied. Both new tables have RLS enabled, no SELECT permission for anon/authenticated roles, and server access verified. The founder's existing account has an onboarding invitation. The exact `https://jules-gamma.vercel.app/onboarding` sign-in return URL is allowlisted.

Production release completed October 12, 2026 from an isolated checkout of the deployed `main` branch, preserving unrelated workspace edits. Release commits: `9af2c2c` (import and feedback), `0b7309c` and `e068472` (PDF function packaging fixes). Vercel deployment `BjkRC39vfWsWT2qC8pkyi6HR4NCU` is Ready and assigned to `https://jules-gamma.vercel.app`. `GMAIL_IMPORT_ENABLED=true` and `ONBOARDING_ENABLED=true` are configured in Production. Reply-reference migration `015_message_threads.sql` is also installed and verified, so receipt feedback can resolve original message context. PDF assets use real pnpm dependency paths, and the specific wishlist function rule precedes the general rule.

Verification: all 439 isolated-release automated checks passed. The deployed `/onboarding` page and JavaScript return HTTP 200. Both Gmail and onboarding API routes return HTTP 401 without sign-in, confirming activation and preserving private access; the live page has no browser errors. Remaining gate: the real-account connect/import/correction/repeat-import acceptance above. No real Gmail import or new private-email API transfer has occurred.


## October 12 expansion: five years, 1,000 emails

New imports use versioned consent `gmail-receipts-5y-1000-v2`. Existing active jobs retain the 90-day/200-message scope previously approved. Existing connections need explicit approval of the new disclosure before a five-year import; original evidence and corrections remain intact.

Searches run in priority passes and extract each bounded page before continuing discovery: up to 50 recent receipt subjects, 25 recent return/refund/cancellation subjects, 15 related-order matches, then 10 broader recent matches. Unused early slots can be filled by later discovery. Broader recent discovery, older receipts, older outcomes and older discovery form the long tail, with a hard global cap of 1,000 unique emails. Related-order queries use evidenced references and valid sender domains. PDF expansion is scoped to senders producing shopping evidence; promotions are not excluded wholesale. Pagination queries remain fixed once a pass starts. Gmail searches happen before full-body/PDF downloads; the model interprets and validates shopping evidence.

Unchanged message fingerprints reuse extraction; overlapping searches cannot multiply purchases or analyzed emails. Extraction context is narrowed to items with literal order references present in the source, rather than sending the entire purchase history for every email. Original receipt events and exact variant linking remain authoritative.

The job records new purchase items and outcome-bearing items discovered by email 100, alongside final counts, excluding purchases already present when the import started. The page exposes partial purchase results after that checkpoint and reports later additions. These are yield measurements within the selected sample, not evidence of 90% recall across the inbox or proof of accurate extraction. No real expanded import or blind recall test has yet been run.

Shopping observations include their purchase evidence date and recent/historical classification. The last two years guide current recommendations more strongly; older purchases remain available and never imply disposal or current ownership. Browser-driven steps remain supported, as does the existing optional dispatch mechanism; this expansion adds no new durable queue service.

## October 12 update: evidence store

Receipt items, events and corrections no longer live in `gmail_imports`. Each validated receipt event and each correction is an immutable row in the shared `evidence` table (`db/019_evidence.sql`), written in the same transaction as the job update. Purchase history is rebuilt from those rows on read. `gmail_imports` keeps the token, consent, job progress, prepared source text and open questions. **Delete imported history** deletes all Gmail evidence and prunes any belief that relied only on it. Imports made before this change convert on their next write. Chat corrections now run through the agent's `update_purchase_history` skill instead of a separate pre-check. See [ARCHITECTURE.md](ARCHITECTURE.md).

**Setup:** in Supabase → SQL Editor, run `db/019_evidence.sql` after `018_signup_login.sql`, then deploy the matching code right away. No credential is produced.

## October 12 update: accuracy, speed and storage

This section supersedes the earlier storage, changed-source and recipient statements above.

- **Triage before download.** Each step reads Gmail metadata (sender, subject, short snippet) for the next 24 candidate emails and the model marks each one `extract` or `skip`. Only clearly irrelevant emails are skipped (marketing, account notices, non-apparel transactions). If triage fails or omits an email, that email is fully analyzed. Gmail's Purchases category is added to the broad discovery searches.
- **Parallel analysis.** Up to 6 emails are downloaded and analyzed at once per step, then reconciled in order. A batch that fails entirely is treated as a provider outage: the step fails and the background worker retries it after 5, 10 and 20 seconds before pausing for the user. An individual email that fails twice while others succeed is skipped for this import only and counted in `job.quality.failed`.
- **No email text is stored.** Prepared text is used only for analysis. Proof lives in the evidence quotes. Shopping emails keep small metadata (date, sender domain, fingerprint, warnings) for related-order search and change detection. Every other email keeps only its Gmail id in `scanned_ids`, so later imports never fetch it again. Changed sources keep only id, fingerprint and date. Older imports are compacted on their next write. No Gmail email is deleted; access remains read-only.
- **Less duplicated text.** A plain-text body is dropped when an equivalent HTML body exists, leaving more of the 60k budget for tables and PDFs.
- **More tolerant validation.** Quotes are compared after collapsing whitespace and table separators. A field whose quote cannot be verified becomes unknown instead of discarding the whole event; withheld fields are counted in `job.quality.withheld_fields`.
- **Purchases without order numbers.** A purchase with merchant and product but no labeled order reference becomes an item scoped to its email. Later returns cannot link to it by order reference, and the duplicate question can merge it if needed.
- **Receipt-stated recipients (founder-approved October 12, 2026).** The model reports a recipient only with a quote: `self` when the ship-to, bill-to or pickup name matches the person the email addresses; `other` for explicit gifts or a clearly different ship-to person. A receipt-stated `self` purchase now contributes soft shopping observations (`recipient_basis: receipt_evidence`); the page shows "likely for you". User answers always override it, conflicting receipts stay unknown, and it never establishes fit, ownership, favorites or a size default.
- **Forwarded orders (October 20, 2026).** A Gmail `self` claim is kept only when its quote contains every word of the addressee's name from the email's To header; otherwise it is withheld and the item stays unknown. This stops a forwarded order (whose greeting and ship-to name the original recipient, sometimes a relative with the same surname) from teaching the account holder its sizes. Tradeoff: a To header with no display name, or a ship-to using a nickname or initials, no longer counts as `self` automatically. Sources without a To header (Shop, screenshots) are not checked. Existing imported evidence is not re-read.
- **Observability.** `gmail_imports.data.job.quality` records triage extract/skip counts, withheld fields and events, failed emails and unanalyzed emails with warnings.

### Measuring accuracy (`scripts/receipt-eval.js`)

Automated tests use synthetic emails and do not establish real-world accuracy. To measure it:

1. **Label emails in Gmail.** Create a Gmail label named `jules-eval` and apply it to about 50 emails: clothing/accessory receipts, returns, gifts, shipping notices, and some non-clothing receipts and newsletters. No credential is produced.
2. **Prepare a private environment file** outside the repository (for example `~/jules-private/eval.env`) containing `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GMAIL_TOKEN_KEY`, `GOOGLE_GMAIL_CLIENT_ID`, `GOOGLE_GMAIL_CLIENT_SECRET` and `SITE_ORIGIN`, copied from Vercel/Google/your secure backup. Never commit it or paste it into chat.
3. **Create the label file:** `EVAL_CONVERSATION_ID=<your conversation id> node --env-file="$HOME/jules-private/eval.env" scripts/receipt-eval.js template "$HOME/jules-private/receipt-labels.json"`. Fill in each email's `expected` events by hand.
4. **Run an import** from `/onboarding`, then **score it:** the same command with `score` instead of `template`. It reports event recall and precision, per-field accuracy, recipient accuracy, and each missed email with the stage that missed it (search, triage/no extraction, or event extraction).

### Merchant and brand names

Linking events across emails, deduplicating items and grouping merchants/brands in the purchase summary compare a normalized name: case, accents, punctuation, web suffixes, legal-entity suffixes (ApS, Inc, Ltd, GmbH, AB…) and storefront words (Retail, Store, Shop, Online, Official) are ignored, so "MFPEN Retail ApS", "MFPEN" and "mfpen.com" are one merchant. Names that differ in substance stay separate ("H&M Hennes & Mauritz AB" and "H&M" are not merged); the stored merchant text is never rewritten. When a receipt comes from a brand's own store, extraction now records the brand from the legal entity or storefront name. Purchases imported before this change keep their stored fields; fix a missing brand by texting Jules a correction.

## October 13 update: stalled imports and stale skips

Found in the founder's live import: it stopped at 82 of 83 emails with no error, and 68 of those 82 were never analyzed because an earlier, weaker import version had marked them irrelevant.

- **One live background chain.** Each start, resume or completed step records a fresh `job.worker` id before dispatching the next step; a step carrying an older id stops. When the import is briefly locked (for example by a chat correction), the step retries after 5, 10, 20 and 40 seconds instead of ending the chain. A failed dispatch is retried twice before giving up.
- **Auto-resume.** If a running import has made no progress for 150 seconds and recorded no error, opening `/onboarding` resumes it. An import paused after repeated failures still waits for **Resume**. Nothing resumes an import while no page is open; a sweep would need a frequent cron.
- **Versioned skips.** `scanned_ids` are valid only for `SCAN_VERSION`. When triage or extraction changes materially, bump it: emails judged irrelevant earlier, including ones the running job already passed, are read again. `job.quality.rescanned` counts them.
- **Sender domain.** Taken from From, else Sender, Reply-To or Return-Path. A stored shopping email missing its domain is filled in when it is next seen, so related-order searches can use it.

### October 13 follow-up: Vercel loop protection and rejected quotes

The first live run after the fix above advanced three or four steps, then every hand-off failed instantly. No request reached Vercel. Vercel rejects a function that keeps calling its own URL ("508 Loop Detected") after a few hops, and the Hobby plan only allows daily crons.

- **Fewer hops.** One background invocation now runs steps back to back for up to 150 seconds (`WORK_BUDGET_MS`; `api/wishlist.js` `maxDuration` is 300), then hands off once. A single start should cover hundreds of emails within the few hops Vercel allows. Dispatch failures now log the HTTP status.
- **Faster recovery while the page is open.** Opening `/onboarding` resumes an import that has been quiet for 60 seconds with no lease (was 150). If the page is closed and the chain is stopped, the import waits until the page is next opened. A reliable unattended run needs a scheduler outside Vercel (for example Supabase `pg_cron`) or Vercel Pro.
- **Quote tolerance.** Quote checks ignore typographic differences: curly/straight quotes, dashes, non-breaking and zero-width spaces, and compatibility forms. Letters and digits must still match. If the event's own quote fails but its product or order quote verifies, that verified quote becomes the evidence and `evidence` is listed in `withheld_fields`. An event with no verified quote is still withheld; `gmail_event_withheld` logs the reason without email content.
- `SCAN_VERSION` is `2026-10-13b`, so emails whose purchases were rejected are read again.

## October 14 update: owner purchase review

Admin › People › **Purchase history** lists a person's imported items: product, store, size, colour, date, recipient and outcome. Each item shows its email evidence (quote, sender domain, date and an *Open in Gmail* link, which only the mailbox owner can open), its corrections, and a correction form. Search plus status (to review, reviewed, removed, duplicates) and store filters keep long histories browsable. Shipping and return emails that couldn't be linked to a purchase are listed separately.

Every correction requires a **What's wrong?** label: looks right, not a purchase, not clothing or accessories, wrong details, duplicate, who it was for, or returned. A note is optional. The label maps to the existing structured correction (restore, dispute, correct fields, duplicate, recipient, return) and is recorded as `correction` evidence with `source.type = operator_review`, `recorded_by = operator`, and `data.review = {reason, note}`. Original evidence is never changed. The labels form the measurement set for Gmail reading: corrections give precision and field accuracy. **Report a missed purchase** (store, roughly when, what was bought) is stored in `gmail_imports.data.missed_reports` and gives recall. Deleting imported history removes both. Notes are free text for people reading them; code never interprets them.

The panel reads `GET /api/admin?view=purchases&conversation=…` and writes through `POST /api/admin` (`action: review | missed`). Both are owner-only. Writes use the import lease, so an edit made while an import step is running returns a "busy" message and is retried by hand.

## October 14 update: reading fixes from the first labelled review

The founder labelled 21 of the 44 items found. Six weren't purchases: five SSENSE abandoned-cart emails and one Depop sale where the founder was the seller. Two weren't clothing (SoulCycle class packs, where "4 classes" was read as size 4). One was a duplicate line read from the same email, where a date was also taken as the order number. Changes:

- **Header bug.** Email headers were looked up case-sensitively (`'Subject'` against lowercased names), so analysis never saw the subject and triage saw only the snippet. Fixed. Prepared text now starts with the subject, the sender's name and domain, and the addressee's name (never their address), so a brand's own store and a ship-to name that matches the account holder can be recognized. `SCAN_VERSION` is `2026-10-14`, so emails skipped by the blind triage are read again on the next import.
- **Buyer transactions only.** Each event now carries a model-classified `basis` (order confirmation, receipt or invoice, shipping notice, return or refund notice, cart or marketing, seller notification, other) and a quote proving it. Code keeps a purchase only when the basis is an order confirmation or receipt, the other events only for buyer bases, and only when the basis quote is in the email.
- **Category.** Each event carries a `category`. Code keeps clothing, footwear, bags, accessories, jewelry/watches and eyewear, and rejects `other_goods` (home goods, fragrance, beauty, tech) and `service` (classes, memberships, tickets, repairs).
- **Duplicates and dates.** A calendar date is never stored as an order reference. Two lines in one email whose product text contains the other's, with matching size, colour and SKU and compatible order references, become one item.
- **Order-level outcomes.** A refund or return that names no product or SKU stays unlinked when its order has several items, instead of marking every item.
- **Re-check labelled emails.** In Admin › People › Purchase history, this re-fetches (read-only) the emails behind each labelled item, analyzes them with the current rules without saving anything, and reports how many labels the rules now agree with, by label, along with what was read and what was rejected. It is served at `POST /api/wishlist?gmail=recheck` (owner-only) so PDF receipts use the bundled PDF reader.

Existing evidence is not rewritten. Items the founder already labelled stay corrected, and the new rules apply to future imports.

### October 14 follow-up: letter case in quotes

The first re-check agreed with 25 of 26 labels. The one disagreement was a Thom Browne order confirmation whose purchase was rejected with "Unverified transaction basis". The same email had earlier lost its brand and needed the quote fallback, which fits a receipt set in capitals being quoted in normal case. Quote checks now fold letter case; letters and digits must still match. If the transaction quote still doesn't match, a verified labelled order reference proves the order, and `basis` is listed in `withheld_fields`. Cart and marketing emails have no order reference, so they are still refused.
Receipt reading and triage now set `temperature: 0` for `gpt-4*` models. The second re-check showed a labelled John Elliott order switch from found to not found with no code change in between, because the default sampling read the same email differently on different runs. Reasoning models, which reject the setting, keep their default. Re-check failures now log a short error message.

## October 14 update: skipped-email review

After the reading fixes, the re-check agreed with 26 of 26 labels on two runs, but a full import found no new purchases while triage skipped 806 of 926 candidate emails. Labels on found items can't show what was skipped, so Admin › People › Purchase history › **Skipped emails** samples them for review. The sample takes every skipped email from a store the person has bought from (a Gmail search on the registrable sender domains of known shopping emails, filtered to `scanned_ids`), up to 60, plus a random 30 of the rest. The owner marks each as **Missed order** or **Not an order**. Labels are stored in `gmail_imports.data.triage_labels` as id, label, sender domain and time. Subjects and senders are fetched from Gmail when the sample loads and are never stored.

The review is available only when the import's Gmail account matches `ADMIN_EMAIL`: other testers' subject lines stay private even from the owner. **Re-check labelled emails** includes these labels. For each one it re-runs triage on the email's metadata and, where triage reads it, full reading. A missed order agrees only if triage reads it and a purchase is found; a "not an order" agrees if it is not read as a purchase. Routes: `POST /api/wishlist?gmail=recheck` with `action: skipped_list | skipped_label | skipped_recheck`, owner-only.

## October 14 update: imports finish with the page closed

Vercel rejects a function that keeps calling its own URL after a few hops, and the Hobby plan allows only daily crons, so a long import could stop when the page closed. A Supabase scheduled job now runs `gmail_sweep_tick()` every minute (`db/023_gmail_sweep.sql`). It calls Vercel only when an import is running and has written nothing for over a minute. `GET /api/wishlist?gmail=sweep` restarts each quiet import with a fresh worker chain. Each call is a new request, so Vercel's hop count starts over. The bearer secret is generated inside Supabase Vault by the migration; the server reads it through the service-role-only `gmail_sweep_secret()` function, so no secret is copied between services. An import paused after repeated step failures is retried after 5, 10, 20, 40 and 80 minutes, then left for review (`gmail_sweep` log line, `job.sweep_retries`). A successful step clears the retry count. The onboarding page's own resume still works when the page is open.

### Setup (once)

In Supabase → SQL Editor, run `db/023_gmail_sweep.sql`. It enables `pg_cron`, `pg_net` and `pgcrypto`, creates the secret in Vault and schedules the job. No credential is shown or copied. The production URL is written into the file; edit it if the domain changes. To confirm it works: start an import, close the page, then check Supabase → Integrations → Cron → `jules-gmail-sweep` runs or the Vercel `gmail_sweep` log lines.

## October 14 update: prices

- **Reading.** Each purchase line now returns `unit_price` and `currency` with quotes. The model is told to give the price for one unit exactly as printed on the line (after a discount shown on that line), and null for multi-unit totals or order totals. It never computes, converts or estimates.
- **Validation.** Code keeps the price only when the quote is in the email and contains the value. The amount is parsed technically (`parsePrice` handles `$1,234.50`, `2.450,00 DKK`, `CHF 1'250.00`). The currency is a three-letter code if printed, or €/£ mapped to EUR/GBP; an ambiguous `$`, `kr` or `¥` stays as written. A price with no currency printed is withheld. Items store `price: {amount, currency, text}`; prices are never converted between currencies.
- **Existing emails.** Shopping emails read before this change are re-read once for prices only (`PRICE_VERSION`, stored as `price_version` on each source). `priceRecords` matches each priced line to an item from the same email and adds only the price; it never creates items. An email whose content changed is skipped. New emails are marked as priced when first read. `job.quality.repriced` counts the added prices. Click **Import again** to price an existing history.
- **"Who you are" text.** It adds "what you usually spend: $X–$Y per item" when at least 3 purchases in one currency have prices. The range is the middle half (25th–75th percentile, interpolated), rounded to the nearest 10 under 200 and the nearest 50 above. It uses the currency with the most priced purchases and never converts.
- **Admin.** The Purchase history panel shows each item's price as printed.

## October 14 update: Open in Messages

The onboarding done screen shows **Open Jules in Messages** when `JULES_PUBLIC_LINE` (Jules's iMessage number in international format, also used after signup) is set. The link is `sms:<number>`, which opens the Messages thread on iPhone and Mac. Without the setting, the button stays hidden.

## October 15 update: order screenshots in chat

Gmail and Shop miss a lot of shopping (in-app orders, stores that don't email item details). Testers can now send a screenshot of an order history, an order's details or a receipt (Zara, Uniqlo, Nike, the Amazon app…) in the Jules chat, and Jules adds those purchases to the same history. There is no import button or keyword: the chat agent decides the image is a past order and calls `add_order_screenshot` (`lib/order-screenshots.js`); for a product the tester wants found it searches as before. The tool is only offered when the message has (or replies to) an image.

How it reads a screenshot:

1. One vision call transcribes the visible shopping text (store name, order number, statuses, items, colors, sizes, prices). Names, addresses, contact and card details are left out.
2. The transcript goes through the same receipt reader and validation as Gmail and Shop. Every kept field must quote text from the screenshot (or the message sent with it). A price, size or date that isn't shown stays unknown; the order date is used only when exactly one full date is visible.
3. Items link to ones Gmail, Shop or an earlier screenshot already found (same store and order number, or the same store and product within 14 days), so a purchase isn't counted twice. Linking ignores letter case ("WIDE-LEG JEANS" = "Wide-leg jeans").
4. Evidence rows use the origin `chat_screenshot` (source IDs `screenshot:<message>:<image>`). "Delete imported history" removes them with Gmail and Shop evidence, and the usual chat and admin corrections apply.

Jules confirms briefly ("got those, added 3 purchases from zara") and still answers anything else in the message. A replayed message is read once: the job data keeps a short note per screenshot (`gmail_imports.data.screenshots`, counts only, no transcript). If an email or Shop import is running, the screenshot waits in the same chat queue as history answers and is added before the import's next step.

**Before deploying**, run `db/029_chat_screenshots.sql` in the Supabase SQL editor (one row in `evidence_origins`). Without it the save is rejected and Jules says it couldn't save the screenshot. `node --env-file=.env.local scripts/schema-check.js` reports it if missed.

### Checking it in production

1. Text your Jules line a screenshot of an order from a retailer's app, for example "here's my zara order". Jules should say how many purchases it added and from which store.
2. Open Admin → People → you → Purchases and set "Found by" to "Chat screenshot". The new items are there; an order Gmail already had shows "Gmail + Chat screenshot" instead of a second card.
3. Send the same screenshot again: Jules should say they were already in your history, and no new card appears.
4. In Vercel logs, search `order_screenshot_imported` (counts of added, linked and withheld items) and `order_screenshot_read_failed` / `order_screenshot_write_failed` for failures. `order_screenshot_busy` means it was queued behind a running import.

### October 15 follow-up: order lists, long orders and the confirmation line

The first live test (SSENSE) showed three gaps: an order list has no items, an order with several items needs more than one screenshot, and the app often doesn't print the store name. Jules's reply also left out what happened to the screenshot.

- **Order lists count.** Each order or return row (number, date, status, total as shown) is kept as an `order_summary` evidence row under `chat_screenshot`. They are not items. The purchase summary the agent sees now has `store_orders` per store: orders (an order seen in email and in a list counts once), returns, first and last order, and order totals by currency (median, max; never converted). This shows how often and how much someone buys at a store.
- **Several screenshots, one order.** Screenshots sent together in one message are read as one. When the rest of an order arrives in a later message, the agent passes both messages' IDs. A read that includes screenshots read earlier replaces those earlier reads (their evidence is deleted by source ID), so nothing is counted twice and no half-read item is left behind.
- **Store not written.** The reader never guesses a store from layout. When items or order rows have no store, Jules asks which store it is. The answer re-reads the same screenshots with `store_named_by_user`, and that read replaces the earlier one.
- **Personal details.** The reader marks lines with names, addresses, contact or card details as personal, and code drops them before anything is kept or queued.
- **Confirmation line.** The tool's result line ("got those. added 5 orders and 5 returns from ssense to your history.") is sent ahead of the model's message by code, so the agent can't leave it out when it also answers something else.

**Before deploying**, run `db/030_order_summaries.sql` (adds the `order_summary` evidence kind). The schema check can't see check constraints, so it won't report this one. Without it, a screenshot with order rows fails to save and Jules says so.

Checking it in production:

1. Send the order list screenshot again (a new message). Jules should say it can see the orders but not the store, and ask which store. Answer "ssense". It should say it added 5 orders and 5 returns from SSENSE.
2. Open one order, screenshot the top, scroll, screenshot the rest, and send both. Jules should add each item once, with the order number from the first screenshot.
3. Ask Jules "how often do I shop at ssense?" It should answer from the order counts.
4. Logs: `order_screenshot_imported` now includes `orders`, `returns`, `needs_store`, `store_named` and `replaced`.

## October 15 update: stores the import never reached

The founder has many MAAP (cycling apparel) order emails, but no MAAP purchase appeared. His production import data showed where they were lost: no MAAP email was ever read. There is no MAAP source, evidence row, withheld event or skipped-email label, so the emails never reached triage or reading. The import hit its 1,000-email limit with 7 of 8 searches cut off, about 94% of the emails it chose were not shopping emails, and the oldest purchase it found was from April 2024 even though the window is five years. A repeat import spent 989 of its 1,000 slots on emails earlier imports had already read and found irrelevant, so running it again could never reach further back. Store platforms such as Shopify also send subjects like "Order #1234 confirmed" or "A shipment from order #1234 is on the way". The receipt searches only matched the exact phrase "order confirmed", so they missed these.

- **Already-read emails don't count.** Emails that earlier imports read and found irrelevant (under the current `SCAN_VERSION`) are skipped during search without using any of the 1,000-email limit. Each repeat import now reaches emails it hasn't seen before, going further back. `job.already_read` and each search's `already_read` count them. When `SCAN_VERSION` changes, those emails are read again as before.
- **Subject words in any order.** Receipt searches also match `subject:(order confirmed)`, `(thank order)`, `(thanks order)`, `(thank purchase)`, `(order shipped)` and `(order shipment)`, which find those words anywhere in the subject. This is Gmail search syntax for choosing which emails to look at; the model still decides what an email means.
- **Known stores.** A new search runs after related orders (150 emails). It covers order, receipt, shipping, return and cancellation emails from every store that has already produced a purchase (the registrable domain, so `orders.store.com` covers `store.com`), across the whole five years. Finding one email from a store now leads to the rest of that store's orders. Personal mailbox domains (gmail.com, outlook.com…) are never searched this way, and the PDF search excludes them too, so a forwarded receipt can't open someone's personal mail.

No database migration and no new consent are needed. The limits (1,000 emails per import, five years) are unchanged.

### October 15 follow-up: any order word in the subject

After the change above, a re-import found 46 new purchases but still no MAAP. A MAAP order email (September 2025) has the subject "MAAP Order Summary", which none of the receipt searches matched, and the body-word searches ran out of room before reaching it. Listing exact wordings can't keep up with how stores phrase subjects, so:

- **Receipt searches match the word itself.** Any subject containing order, orders, ordered, purchase, purchased, receipt, invoice, facture, commande, bestellung, pedido or ordine is found, wherever the word sits. This replaces the earlier phrase and word-pair list, which it covers. Marketing that uses one of these words is left to triage, which skips it cheaply from the subject and sender.
- **Order subjects come first.** A new `recent_receipts_backlog` search (250 emails) takes the rest of the last two years' order-subject emails before the body-word searches, which mostly return other mail.

Limits are unchanged (1,000 emails per import, five years). No migration.

### October 15 follow-up: one search per store, including stores found mid-import

With the order-subject change, a re-import found one MAAP order (June 2026) but not the others. The known-store search ran only at the start of the import, before MAAP had been found. It also shared one 150-email allowance across all 41 stores, newest emails first, so it would have reached MAAP's older orders only on a later import, if at all.

- **One store at a time.** Store searches now run per store (`from:<store> <order words>` over the whole five years). Each store has its own 40-email allowance, so a store with many emails can't crowd out the others. The most recently found stores go first. `job.stores_searched` lists stores finished in this import; `job.stores_capped` lists stores that had more emails than their allowance.
- **Stores found during the import.** Two more store stages run: `new_stores` after the recent searches, and `later_stores` before the last broad search. A store first found partway through an import has its other orders found in the same run. Each store is searched once per import. A store cut short by a stage's allowance is continued by the next store stage.
- **Purchase emails already read don't use the limit either.** Shopping emails already read and priced under the current rules are skipped during search, like irrelevant ones. Re-imports spend the 1,000-email limit only on new emails. The trade-off: a store email whose content changed after it was read is no longer re-checked for changes.

Limits are unchanged. No migration.

### October 15 follow-up: getting past already-read emails quickly

On the next re-import, progress sat at 226 emails checked for several minutes. The import was working: it was paging through thousands of emails earlier imports had already read, 50 per page. Each page admitted nothing and still took a search step plus an empty reading step. Now:

- Searches ask Gmail for 500 ids per page when there are already-read emails to skip (50 otherwise).
- A page with nothing new goes straight to the next page or search, with no empty reading step.
- The account and onboarding pages show the skipped count: "Checked 226 so far, skipped 2,582 already checked."

## October 15 update: order photos and product links

The wardrobe (PRD section 29) can show the picture the receipt itself contained.

- **Collecting candidates.** While preparing an email, each https `<img>` is kept with its alt text and the link around it (or the one link in its table row), with tracking parameters removed. Pixel, icon, hidden, `http:` and inline images are dropped. Text links are kept too. The email text marks each picture in place as `[image N: alt]`. Shop records offer image fields next to a line item's title the same way (`shopCandidates`).
- **Choosing.** The model gets refs, alt text and link paths only (`media_candidates`), never a URL. Each event may set `photo_ref` and `link_ref`. Code (`orderMedia`) keeps a ref only if it names a candidate of the right kind in that same source and its URL is https; anything else is withheld. One picture pointed at by two different line items goes to neither (`exclusiveMedia`).
- **Storing.** Items record `order_photo: {url, source: order_email | shop_order, source_id}` and `product_link`, set once and never replaced. Each item that gains a photo has it downloaded once through the safe public fetch, checked (at least 40px a side, not banner-shaped), resized to a JPEG and stored as one `photo_observation` evidence row with id `order_photo:<item id>`. Re-imports insert the same id, which is a no-op. No migration: the `evidence` table already allows that kind. Purchase-history loads skip these rows; the wardrobe asks only which items have one. Deleting history or re-reading Shop removes them with the rest of that source's evidence.
- **Existing emails.** Shopping emails read before this change are re-read once for photos and links only (`PHOTO_VERSION`, stored as `photo_version`), as prices were. Click **Import again** to add photos to an existing history. A photo that fails to download is not retried in this step; the item keeps its outline.
- **Logs.** `gmail_order_photos` / `shop_order_photos` per step (due, stored, failed); `gmail_order_media` / `shop_order_media` when an import finishes (items, with an order photo, with a product link, with neither).

## October 18 update: daily purchase check and purchase texts

Once a day (17:00 UTC, about 10am Pacific / 1pm Eastern) Jules checks every connected Gmail for purchases since the last check and texts the person about anything new. The code is in `lib/purchase-texts.js`.

- **Reading.** Three small searches (order subjects, return subjects, receipt words) limited to mail since the last check, with one day of overlap, at most 50 emails a person, using the same reading rules as the import. Emails already read are skipped. Most days nothing matches, so there are no model calls. The check has its own job in `data.refresh`. `data.job` stays the last full import, so the account card, the import texts and the restart sweep are unaffected. While a full import or Shop read is running, the check waits until the next day.
- **Wardrobe.** New purchases go into the purchase history like any import, so they show up in the wardrobe. New items are tagged so the wardrobe can file them.
- **The text.** At most one a day per person (message key `gmail:<owner>:purchases:<date>`). Only the person's own new purchases from the last 7 days count: no gifts, returns, cancellations or duplicates. Several purchases share one text. The model picks the angle: styling ideas using items they own, something new for them, a pattern in what they buy, or plain "added to your wardrobe". The model may also decide a purchase is not worth a text, such as a restock of basics. Code checks every item the choice names against the actual purchase history and falls back to the plain text otherwise. The usual composer then writes it in Jules's voice. Replies such as "it was a gift" go through the existing purchase-history tool.
- **Holding.** If the person messaged, or was messaged, in the last 15 minutes, the text waits for the next day's check.
- **Not yet.** Price-watch offers (alerts are not set up to watch an item that has already been bought). The fit check after delivery is described below.
- **Logs and costs.** `gmail_refresh` per person (check status, emails, items found, text status, angle) and `gmail_refresh_run` per run. Costs appear as "Daily purchase check" on the costs page.

### Setup (once)

1. In Vercel → Settings → Environment Variables, add `PURCHASE_TEXTS_ENABLED=true` (Production). `CRON_SECRET` and `GMAIL_IMPORT_ENABLED` are already set for price alerts and the import.
2. Redeploy. The new daily job appears under Vercel → Settings → Cron Jobs as `/api/wishlist?gmail=refresh`. Click **Run** there to try it straight away, then check the logs for `gmail_refresh_run`.

No database migration is needed.

### October 19 follow-up: purchase text quality

- **The text went out unpolished.** The composer's claim checks read "added it to your wardrobe" as a wishlist save, so every rewrite was rejected and the plain draft was sent (reproduced 3 of 3 times). The purchase text now passes `facts.wardrobe_added`, and both the composer and its independent check are told that a wardrobe entry is not a wishlist save. With that, rewrites passed 3 of 3 times.
- **Observations must be true of the wardrobe.** The picker first lists the wardrobe items of the same kind as the new purchase (`similar_owned_item_ids`), then picks an angle. Code refuses "first of its kind" when that list isn't empty, and refuses "another one" without it. Only similar items in the same wardrobe category count. Observations may not state numbers, counts or dates, because the model miscounted them. They may not just describe the item either. The examples in the prompt are deliberately from other categories, because the model copied a cargo example word for word.

## October 19 update: fit checks after delivery

A few days after something the person bought for themselves arrives, Jules asks how it fits in the size they bought. The code is in `lib/fit-checks.js`. It runs in the same daily job as the purchase text.

- **Delivery.** Receipt reading now records a `delivered` event when an email says the package arrived. An expected delivery date or "out for delivery" does not count. The daily searches also look for `delivered` in subjects. If no delivery email is found, delivery is taken as about 5 days after the shipping email. If neither email exists (an in-store receipt, for example), there is no fit check. Order screenshots and Shop never date a delivery, because their dates are order dates.
- **Which items.** Only items in the wardrobe: no gifts, returns, return requests, cancellations, or items they no longer own. The item must have a recorded size label, must not be a bag, must not have a fit report yet, and must not have been asked about before. Jules asks 3 to 21 days after delivery, oldest delivery first, one item per text. The text names the item and its size label exactly as recorded.
- **One text a day.** The purchase text and the fit check share the day (message keys `gmail:<owner>:purchases:<date>` and `gmail:<owner>:fit-check:<date>`): a new purchase comes first, and the fit check waits for a day with no purchase text. Like the purchase text, it waits if the person messaged or was messaged in the last 15 minutes. The item is marked as asked (`data.refresh.fit_checks`) before the text goes out, so a failure can miss a check but never repeat one.
- **Replies.** Replies go through the existing chat agent and its purchase-history tool. The model reads the reply as structured actions, with no keyword matching. A new action, `report_fit` (`true_to_size`, `runs_small`, `runs_large`), records how that one item fits. It never changes the item's size label or any general size. A return mentioned in the reply is recorded as `report_return`, so the item leaves the wardrobe. Uncertain replies such as "haven't tried them yet" record nothing. A later correction replaces the earlier fit report.
- **Learning.** Fit reports appear as `confirmed_fit` on that item's shopping-history observation and as `fit_notes` (brand, product, size, fit) in the purchase summary that the agent and search see. They apply to that brand only: a category size still applies to other brands, and Jules never converts a fit note into a different size.
- **Logs.** `fit_check` for every person on each daily run: status (`sent`, `held`, `nothing_due`, `skipped`), the reason (`texted_today`, `mid_conversation`, `disabled`), whether the delivery came from an email or the shipping estimate, how many more items are waiting, and counts of skipped items by reason (gift, returned, too_early, no_size, no_delivery…). `gmail_refresh` now includes `fit_check`, and `gmail_refresh_run` counts `fit_checks`. `purchase_history_updated` lists the fit values recorded.
- **Turning it off.** Fit checks are on wherever purchase texts are on, and a person who turns purchase texts off in chat gets no fit checks either. To stop only the fit checks, set `FIT_CHECKS_ENABLED=false` in Vercel and redeploy.

No setup and no database migration are needed.

## October 19 update: turning purchase texts off from chat

- **What testers can say.** Any wording works: "stop texting me about my orders", "turn those back on", "are you still going to text me when i buy stuff?". The chat agent picks the `manage_purchase_texts` tool (turn_off / turn_on / status) from the meaning of the message, not from keywords. It's offered only when `PURCHASE_TEXTS_ENABLED` is on and the person has purchase history. STOP still stops every text.
- **Stored** in `gmail_imports.data.purchase_texts` (`enabled`, `changed_at`, the message that changed it). No migration is needed. It's on unless the person turned it off.
- **While off,** the daily check still adds purchases to the wardrobe, and settles them without a text (`texts_off` in `gmail_refresh` logs). Turning texts back on never sends a backlog. Future texts about purchases, such as the fit check, must check `purchaseTextsOn(data)`.
- **Reply checks.** The turn records `purchase_texts: turned_off | turned_on | unchanged`. The independent claim audit has its own field for this change. Without it, "no more texts about your purchases" was read as price alerts turned off (6 of 6 times), which would have replaced every reply with the plain draft. Now 6 of 6 pass.
- **Logs:** `purchase_texts_setting` (action, changed, on, busy).
- **Evals:** 7 routing cases in the `purchase_texts` category: stop, stop with no earlier text, resume, status, price alerts that are not this, a gift answer that is not this, and a reaction that is not this. All passed twice against the real model.

## October 20 update: expired or removed Gmail sign-ins

Google can refuse to renew the stored Gmail sign-in: it answers `400 invalid_grant` when the sign-in expired (only sign-ins given while the app was in Testing: 7 days after connecting; the app is In production now, so a reconnect gives a sign-in that does not expire) or was removed (the person removed Jules in their Google account, changed their Google password, or Jules revoked it on Disconnect, Delete history or the admin onboarding reset), and `401` when Google refuses the app's own client. Retrying cannot fix either, so:

- **Recorded once.** `lib/gmail-client.js` `accessToken` marks the error `reconnect`. Wherever it happens (background import, the daily purchase check, an owner re-check, the extract comparison) the row gets `data.gmail_auth = {status:'reconnect', at, http, google_error, where}` and a running import is paused. No migration: it lives in `gmail_imports.data`. Vercel logs one `gmail_reconnect_needed` event with Google's error code (never a token).
- **Shown as not connected.** `gmailLinked(row)` (token stored and no mark) replaces "a token is stored" everywhere connection status is decided. Account page: "Reconnect needed" with the date and a Connect Gmail button. Onboarding: "Your Gmail sign-in expired. Connect Gmail again". Admin person page, Purchases tab: "Gmail needs reconnecting (Google refused the sign-in <date>; daily purchase check paused)". The style report's end card offers Gmail again.
- **Never retried.** The background worker, the restart sweep and the daily check skip a marked person without calling Google. The daily check's run record (Costs → Recurring jobs) counts them as `reconnect`, and now counts other per-person check failures as `failed` (before, they were counted as neither).
- **Cleared by reconnecting.** A successful Google sign-in on the account or onboarding page removes the mark and stores the new sign-in. Disconnect also removes it. Everything already found stays.

## October 21 update: the "goes with" offer and shared nudge rules (step 1)

The daily purchase text is now one offer: "saw your new <item> from <store> in your email. want me to find a couple of things that go with it?" It replaces the October 18 angles (styling, new direction, pattern, just added). The rules are in PRD "Proactive nudges" and `lib/nudges.js`.

- **Which purchases.** As before (own, new since the first import, last 7 days, no gifts/returns/duplicates), now only clothing, shoes, bags and accessories (`GOES_WITH_CATEGORIES`; an untagged item is left to the model). The model picks one lead item and may decide none suits an offer (`not_worth_a_text`). A failed pick offers about the first new item.
- **Shared rules.** One unprompted text a day (local day) and three a week across the offer and fit checks. None on a day a price alert went out. Only 9am–8pm local (noon–8pm Eastern when the time zone is unknown). STOP or purchase texts turned off settle the purchases without a text. Quiet hours, the limits and a price alert hold the purchases for the next day's check. The ledger query is `store.unpromptedSince`; test texts (`nudge-test:`, `price-alert-test:`) never count.
- **Fit checks** use the same rules. Their old `texted_today` reason is now `daily_cap`.
- **Log.** `nudge` events (kind, status, reason, item count, test, delivery) and `data.nudges.log` on the row. `gmail_refresh` reports `text_item` instead of `angle`.
- **Admin test.** Person page › **Purchase nudges…**. It needs `PRICE_ALERT_TEST_CONVERSATION_ID` (already set for price alerts) to be the person's conversation.

No setup and no database migration are needed.

## October 21 update: replies to the "goes with" offer (step 2)

- **Open offer.** A sent offer (real or admin test) is kept as `data.nudges.open`: the ledger operation, when it went out, and the item as the purchase named it (`lib/goes-with.js`). It counts only while its text is `sent` in the ledger and for 48 hours. Each turn reads it with `store.nudgeState` (just `data->nudges`, not the purchase history).
- **The agent.** While an offer is open, the agent sees `goes_with_offer` and is offered `answer_goes_with_offer` (accepted / declined / not_now), which doesn't reply on its own. Accepted returns a brief, and the agent then calls `find_products` in the same turn. The search is for other kinds of pieces that go with the item, in saved sizes, never the bought size as a general size. No new search path; the usual ranking and store rules apply.
- **Outcome.** The first reply settles the offer once (`settleOffer`) after the reply is written, in the background. Its source is the agent's answer, else `stopped` when purchase texts were turned off, else an independent model reading for the log only (`readOfferReply`, feature `chat`). If the reading fails, the outcome is `unrelated` (source `fallback`). Logs: `nudge` with status `replied`, the outcome as reason, `source` and `replied_after_ms`. Admin › Purchase nudges… shows them.
- **Evals.** There are 8 multi-turn cases in the `goes_with` agent category: yes, yes with their own brief, "what would go with them", no, not now, an unrelated request, a gift correction and stop. All passed 3 of 3 against the real model (24/24), and the purchase_texts cases still pass (21/21). The reader classified 7 of 7 sample replies correctly.

No setup and no database migration are needed.

## October 21 update: back-off and the nudge overview (step 3)

- **Back-off.** `lib/nudges.js` `backoffUntil`: take the nudges (offers and fit checks; not price alerts, not test texts, not failed sends) sent since the person's last message. With 2 or more, and the newest at least 2 days old, nudges pause until 16 days after the newest (2 days to reply plus 14). Any message from the person ends it. The check reads the last inbound message (`store.lastInbound`) and 20 days of the ledger. Held offers keep their purchases pending, as with the other holds, so a purchase still within 7 days can go out once the pause ends. Logged as `held` / `ignored_backoff`.
- **Overview.** Admin › Adoption › Purchase nudges reads every row's `data.nudges` (`store.nudgeLogs`, `view=nudges-summary`, `nudgeSummary`). It shows totals (offers, answered %, yes %, no reply), a row per tester, and recent decisions. It loads on its own, so a failure only hides that section.

No setup and no database migration are needed.
