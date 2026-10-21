# Landing, sign-in and Gmail onboarding

Updated October 12, 2026 from the supplied **Jules — Agentic Personal Shopper Identity.html** and **DESIGN_SYSTEM.md**. These files supply visual references; they do not authorize invented commerce facts or purchasing.

The landing has the reference's continuous headline, six-phrase ticker, frameless iMessage conversation, white background, colored glow and two entry buttons. Signup collects first/last name, birthday, gender and phone with the existing messaging consent. Login sends a code through the tester's existing Photon line and establishes the existing Supabase session. The reference's hypothetical stock, delivery and completed-purchase claims are not used in the demonstration.

Connecting Gmail starts receipt processing on the server. The browser displays persisted status; closing it does not drive or cancel the import. Each bounded background request persists one step and schedules the next using Vercel's supported background-task lifetime. Requests between workers are authenticated, short-lived and scoped to one conversation. A stalled/failed step exposes Resume without discarding completed analysis. No separate queue service or new recurring mailbox monitoring is introduced.

Jules sends the completion link and the first evidence-backed question through the existing message ledger. Follow-up questions are asked one at a time in the text conversation. Answers, uncertainty and corrections retain item scope and use the existing model interpretation and validated receipt feedback. Replayed delivery does not resend questions. The website has no question or correction forms. It retains purchase history, disconnection/deletion controls, and access to the existing style page. It does not claim that a photo-based Wrapped report was generated from Gmail alone.

## Deployment status and remaining steps

Deployed to https://jules-gamma.vercel.app on October 12, 2026. Vercel deployment `dpl_6hw5oqMyYppKymKkUHGqSSryhXzk` is READY. Public signup is enabled. Real-account Gmail import and message delivery acceptance remain pending.

1. **Database storage applied.** Migrations 014 and 018 were successfully run in the existing Jules Supabase project on October 12. Existing onboarding and Gmail tables were present. The additive migration creates private login challenges with logical expiry and signup profile storage; no new credential was created.
2. **Check the existing tester mapping.** Each of the maximum ten testers needs one unambiguous `conversations` row for their phone and Photon line, one `wishlist_members` email linked to it, and the existing onboarding invitation. Their connected Google account must match that invited email. Keep these personal details in Supabase, not in source files. Uninvited signups remain early-access registrations and cannot log in.
3. **Deploy the reviewed changes to the existing Jules Vercel project.** Retain the existing Supabase, Photon, OpenAI and Gmail secret settings. `SITE_ORIGIN` must equal the deployed public HTTPS origin. Keep `PUBLIC_SIGNUP_ENABLED`, `WISHLIST_ENABLED`, `ONBOARDING_ENABLED` and `GMAIL_IMPORT_ENABLED` enabled for the pilot. Install from the updated lockfile; it now includes `@vercel/functions`. No separate SMS provider is required.
4. **Run one real tester check.** Submit signup, receive the welcome in Messages, request and enter a login code, connect the invited Gmail account with explicit analysis consent, and close the browser. Confirm that the completion link and receipt question arrive in Messages. Reply with a scoped correction and check the saved purchase history. Also test declining Gmail, expiry/wrong login code, and disconnecting. These checks send real messages/read private mail, so they were not simulated as completed.

The workspace already contained numerous unrelated uncommitted changes when this work began. Review the combined release before deploying; this document does not establish that those unrelated changes have been verified for release.

## Verification

- Application suite: 459 passing automated tests, including login rate/expiry boundaries, signup fields, background persistence and question delivery deduplication.
- Browser: signup submission, consent gating, phone-code sign-in, Gmail connection/loading/completion at 1440, 390 and 320px. Synthetic API responses; no real texts or mailbox access. No browser exceptions or horizontal overflow in those flows.
- Browser preview is illustrative; it does not establish deployed OAuth or Photon delivery success.

Implementation references: [Vercel background-task support](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package), [Supabase generated login links](https://supabase.com/docs/reference/javascript/auth-admin-generatelink).

Publishing completed after normal Vercel sign-in. The release was staged from application files only, without local environment files. Entry pages returned HTTP 200; unsigned Gmail worker requests returned 401; the landing rendered without browser errors. See `HANDOFF-CHECK.md` for the scoped reference audit.

## October 14 update: results by text

Founder decision: import results are internal (Admin › People › Purchase history); testers hear them by text.

- **Page.** While reading, `/onboarding` shows one progress line ("Checked N emails so far") and "You can close this screen". This is now true because of the Supabase sweep (`GMAIL-IMPORT.md`). When finished it says "All done." and points to Messages. Disconnect, delete and import-again sit under *Manage your Gmail connection*. The purchase list, diagnostics, yield counts and `/style` link were removed from this page.
- **Texts** (`lib/receipt-notifications.js`, each sent once per import through the message ledger):
  1. **Completion:** "done reading your shopping emails. i found N clothing purchases and M returns." Removed, duplicate and cancelled items are excluded. If any questions are open, "a few quick questions…" is added. With nothing found, it explains that and invites a photo or link.
  2. **Questions:** the open questions, one at a time, as before.
  3. **Who you are:** sent when no questions remain, or 24 hours after the last unanswered question. It lists the top 4 brands, top 3 stores and the most-bought sizes from the person's own purchases (gifts and removed items excluded; legal suffixes like "Retail ApS" dropped). Sizes are purchased sizes, never a confirmed fit. It sends nothing with fewer than 2 purchases. No prices yet: receipts aren't read for prices (phase 2). No style-report link yet: the purchase-based report isn't built (phase 3). *(October 20: when coverage is thin and `INTERVIEW_ENABLED` is on, an "early read" replaces it: `lib/early-read.js`, `design/cold-start-taste-brief.md` step 3.)*
  4. **Style report link** *(October 21, behind `REPORT_AUTO_SEND_ENABLED`)*: "your style report is ready…" with the signed `/report` link, sent automatically right after the summary (or early read), never before it and never while a receipt or interview question is still open (it waits for the last one to close). If the report is still building, it goes out when the build finishes; with fewer than 3 purchase lines there is no report and nothing is sent. Only the first link: later new cards get their own text. It shares Admin's Send report ledger entry (`report:<person>:<report id>`), so the two never both text it, and STOP blocks it. With the switch off, Admin › People › Send report sends the first link, as before.
- **24-hour fallback.** `db/024_gmail_profile_due.sql` adds `gmail_profiles_due()`, which reads timing from the message ledger for imports finished in the last 14 days. It also makes the once-a-minute sweep call Vercel when a summary is due. The sweep sends it.

## October 14 update: account page

Founder decision: onboarding does one job: link accounts, show progress, finish. Managing connections lives on **`/account`**, reached from the avatar at the right of the main navigation.

- **`/account`** (`account.html/js/css`, rewrite in `vercel.json`) shows Gmail (connected address, last import or live progress, a paused notice, **Import again**, **Disconnect Gmail**) and Shop (status, **Import again**, **Re-read all orders**, **Disconnect Shop**). **Delete imported history** removes Gmail and Shop learning and disconnects both; chat preferences and the wishlist stay. **Log out** is also here. Not-connected accounts link to `/onboarding` to connect. It uses the existing `/api/wishlist?gmail=1` actions; there is no new API.
- **Onboarding** keeps Connect Gmail, the consent, Shop connect and approval, progress, and the done screen (Open Jules in Messages, plus *Manage your connections* → `/account`). Start import appears only for a connected account that hasn't imported yet, and Resume only when an import has paused. Disconnect, delete, import again and the Shop re-import controls moved to `/account`.
- `GET /api/wishlist?gmail=1` also returns `last_import_at`. `/login?next=account` returns to the account page.
- **Re-imports** (October 15): the "got it, i'm reading your shopping emails" text is sent only on a person's first import, before any email has been read. Question texts are keyed by import (`question:<started_at>:<id>`), so a question still unanswered from an earlier import is asked again once after the new completion text, instead of the completion promising questions that never arrive.

## October 14 update: consent and text opt-out

Founder-requested after the onboarding consent review. **The privacy wording is a draft that needs founder (and ideally lawyer) review before deploying.**

- **STOP / HELP / START** (`lib/sms-compliance.js`). A message that is only STOP, STOPALL, UNSUBSCRIBE, CANCEL, END or QUIT opts the person out and gets one confirmation. HELP gets a short description, the opt-out instructions and the privacy link. START (or UNSTOP) turns texts back on after an opt-out; from someone who never opted out it is an ordinary message. These carrier keywords are legally required controls checked before the agent, not conversational routing. Longer messages ("cancel my price alert") still go to the agent.
- **The block lives in the message ledger** (`db/025_sms_opt_out.sql`). While opted out, `reserve_reply` records every send (replies, onboarding, receipt texts, price alerts) as `blocked` and sends nothing; `claim_ai_reply` refuses, and sign-in codes are not texted. Blocked texts are never sent later, even after START. Incoming messages are still stored.
- **New pages:** `/privacy` (draft) and `/terms` (placeholder for the founder to write). Replace every `[bracketed]` item, including the contact email, before deploying.
- **New consent wording.** Signup SMS consent (`2026-10-14-v2`) adds STOP/HELP, policy links and "I am 18 or older"; the server rejects birthdays under 18. Gmail (`gmail-receipts-5y-1000-v3`) and Shop (`shop-orders-5y-100-v2`) use the shared connected-accounts wording. It says the Jules team can see imported purchase history and its quotes, that OpenAI doesn't train on the data (requests use `store:false`), that only short quotes are kept rather than full emails, and that data is kept until the person deletes it or closes their account. The version bump means an existing Gmail connection must approve the new wording before its next import.

**Setup, in this order:**
1. In Supabase **SQL Editor**, run `db/025_sms_opt_out.sql`. Deploy only after this succeeds: the new code reads `sms_opted_out_at`, and sign-in breaks without it. No credential is produced.
2. Fill in the `[bracketed]` items in `public/privacy.html` and `public/terms.html`.
3. Deploy. Check from a tester phone: text STOP (one confirmation, then nothing), HELP (description), START (confirmation, texts resume).

## October 15 update: outfit photos during the Gmail import

Founder decision: receipts show what someone buys; outfit photos show what they actually wear. While the first Gmail import runs, Jules asks for 2 or more outfit photos, and the "who you are" summary includes what the photos show.

- **The ask.** On a person's first import, the "reading your shopping emails" text is followed by its own text asking for 2 or more photos of outfits they actually wear (`OUTFIT_ASK` in `lib/outfit-photos.js`). It is sent once through the message ledger (`gmail:<owner>:outfits:<started_at>`). Without `STYLE_ENABLED=true` the old single text is sent and nothing below changes.
- **Keeping photos.** The chat agent has a new tool, `add_outfit_photos`. The model decides the photos are the person's own outfits (for example, a reply to the ask). It doesn't decide this from keywords. A photo of something to find still goes to search; when it's unclear, Jules asks. Kept photos go into the same private store as `/style` uploads (`style_sources`, kind `outfit`), normalized to JPEG with location data removed, so they also appear on `/style` and its reading can use them. Each photo is kept once per message, even if the message is delivered twice. Adding a photo clears an earlier `/style` report, as an upload there does.
- **The summary.** When this import asked for photos, the summary waits until 2 outfit photos have arrived. The chat sends it right after the reply that brings the count to 2, unless a purchase question is still open. If fewer arrive, the existing 24-hour fallback sends it with whatever came. Before sending, one model call reads the 10 most recent outfit photos into up to 3 short observations (palette, recurring pieces, fit and silhouette), each citing the photos it came from. They appear as a "what you wear:" line. With fewer than 2 purchases, the summary can be photos only. The reading is stored in `style_sessions.data.outfit_reading`. If the reading fails, the summary is sent from purchases alone. The reading never names a brand unless a label is readable, never describes bodies, and never mentions prices or sizes.
- **Cost.** One call to the chat model per summary with up to 10 images (resized to 1024 px). Recorded under the `style_reading` feature as `outfit-reading:<import>`.

**Setup:** none. No migration and no new credentials. It uses the existing `style_sources`/`style_sessions` tables and `STYLE_ENABLED=true`, which is already on in production.

**Check in production:** connect Gmail as a tester with a fresh import. Confirm the two texts arrive. Send 2–3 outfit photos at a time and confirm Jules acknowledges them without searching. After the 5th photo (and any receipt questions are answered), confirm the summary includes a "what you wear" line that matches the photos. Then open `/style` and confirm the photos are listed there. Also send a product photo with "find this" and confirm it still searches.

**Not done yet:** photo observations reach the summary text only. They are not yet used for search ranking or chat context. Using them there is a follow-up.
