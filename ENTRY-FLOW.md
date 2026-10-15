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
  3. **Who you are:** sent when no questions remain, or 24 hours after the last unanswered question. It lists the top 4 brands, top 3 stores and the most-bought sizes from the person's own purchases (gifts and removed items excluded; legal suffixes like "Retail ApS" dropped). Sizes are purchased sizes, never a confirmed fit. It sends nothing with fewer than 2 purchases. No prices yet: receipts aren't read for prices (phase 2). No style-report link yet: the purchase-based report isn't built (phase 3).
- **24-hour fallback.** `db/024_gmail_profile_due.sql` adds `gmail_profiles_due()`, which reads timing from the message ledger for imports finished in the last 14 days. It also makes the once-a-minute sweep call Vercel when a summary is due. The sweep sends it.

## October 14 update: account page

Founder decision: onboarding does one job: link accounts, show progress, finish. Managing connections lives on **`/account`**, reached from the avatar at the right of the main navigation.

- **`/account`** (`account.html/js/css`, rewrite in `vercel.json`) shows Gmail (connected address, last import or live progress, a paused notice, **Import again**, **Disconnect Gmail**) and Shop (status, **Import again**, **Re-read all orders**, **Disconnect Shop**). **Delete imported history** removes Gmail and Shop learning and disconnects both; chat preferences and the wishlist stay. **Log out** is also here. Not-connected accounts link to `/onboarding` to connect. It uses the existing `/api/wishlist?gmail=1` actions; there is no new API.
- **Onboarding** keeps Connect Gmail, the consent, Shop connect and approval, progress, and the done screen (Open Jules in Messages, plus *Manage your connections* → `/account`). Start import appears only for a connected account that hasn't imported yet, and Resume only when an import has paused. Disconnect, delete, import again and the Shop re-import controls moved to `/account`.
- `GET /api/wishlist?gmail=1` also returns `last_import_at`. `/login?next=account` returns to the account page.
