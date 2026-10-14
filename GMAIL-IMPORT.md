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
2. **Configure Google Auth Platform.** In that project, open **Google Auth Platform → Branding** and complete the app name, support email and developer contact fields. In **Audience**, use **External → Testing** and add your exact Gmail address under **Test users**. In **Data Access**, add only `https://www.googleapis.com/auth/gmail.readonly`. This permits reading; it does not permit sending, changing or deleting email. Public expansion requires the applicable Google verification work. Testing-mode refresh tokens for these scopes can expire after seven days, requiring reconnection. [Google scope guidance](https://developers.google.com/workspace/gmail/api/auth/scopes), [OAuth testing guidance](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview).
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
