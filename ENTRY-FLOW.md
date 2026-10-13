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
