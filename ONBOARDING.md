# Tester onboarding: Gmail demo and real import pilot

**Real import pilot:** With `GMAIL_IMPORT_ENABLED=true`, `/onboarding` uses the actual read-only Gmail connection, history and feedback flow described in [GMAIL-IMPORT.md](GMAIL-IMPORT.md). The following demo remains available only when that flag is false.

Demo flow: landing → signup with phone and consent → Jules texts an offer → tester accepts in Messages → private `/onboarding` page → invited-email sign-in if needed → **Connect Gmail — demo** → thinking screen → introductory shopping text → completion text → thinking interstitial → wishlist.

The Gmail button does not request OAuth access, fetch receipts, or create taste facts. All related pages and texts say this. The demo completes immediately on the server, so closing the browser does not cancel the two follow-up texts. There is no pretend background analysis or fabricated email report. Clarification questions and Wrapped are omitted. Existing photo/link shopping and wishlist-save consent continue normally; onboarding never silently saves an item or enables alerts.

## Try it without a phone

Open `/onboarding-preview` to walk through the flow with a demo tester. It uses no API calls, real texts, login, Gmail access, or real wishlist writes. Use the explicit simulated replies and completion button, then practice saving the first item. Restart preview resets only this tab’s simulated state. This checks the experience; it does not verify the live messaging backend.

## Setup for the first tester

This is deliberately invite-only, using the existing private wishlist sign-in. Phone signup alone does not grant account access. Provision each tester once (maximum ten for this experiment):

1. In Supabase **SQL Editor**, run `db/016_onboarding.sql` after the existing migrations, including `014_public_signup.sql`. It creates the private onboarding state table. No credential is produced.
2. In Supabase **Table Editor → conversations**, find the tester’s conversation. For a tester who has never texted Jules, create a row with `sender_id` set to their phone in international format and `line` set to the Photon line assigned to them. Leave generated fields at their defaults. Copy the resulting conversation `id`. Confirm the assigned line in Photon; do not guess a pooled line.
3. In **wishlist_members**, add the tester’s invited email and that `conversation_id`, using the existing companion-access setup. In **onboarding_sessions**, add that same `conversation_id`; leave `state` as `invited`. Keep phone numbers and emails in Supabase, never in SQL committed to the repository. Only one invited conversation may match a signup phone; ambiguous matches send no text.
4. In Vercel **Settings → Environment Variables**, enable `ONBOARDING_ENABLED=true`, `PUBLIC_SIGNUP_ENABLED=true`, and `WISHLIST_ENABLED=true`. Keep the existing AI, memory, image and search configuration enabled for the shopping portion. `SITE_ORIGIN` must be the actual site URL. Photon, Supabase and OpenAI credentials stay in Vercel’s secret settings. No new API key is needed.
5. Deploy the code and settings. Have the tester open `/signup` and submit their own number and consent. Jules sends the first message only for a provisioned onboarding invitation. Uninvited numbers remain early-access signups.

The configured Supabase Auth redirect allowlist must permit `SITE_ORIGIN/onboarding` as well as the existing wishlist/style destinations. Add that exact URL in **Authentication → URL Configuration → Redirect URLs** so the invited-email sign-in returns to the demo. This is authentication only, not a Gmail connection.

The existing public-launch/provider-review notes in LANDING-PAGE.md remain relevant for broad public outreach. This change does not implement universal messaging unsubscribe or general public account enrollment. Declining this demo cancels its onboarding progression, not existing shopping alerts.

## Failure and retry behavior

Outbound messages use the existing persisted reservation/delivery ledger. Concurrent signup submissions and repeated demo clicks cannot send the same stage twice. An uncertain send is not retried automatically because it may already have reached the tester. The browser reports uncertainty and retains a wishlist link. Stage state survives reloads. Account access is checked on every request; the client cannot choose another conversation. The demo POST checks the site origin. Consent to a product save or alert cannot be reused as acceptance of the style-reading offer.

## Acceptance check before sharing

With a real provisioned tester, verify the entire flow above, including the invited-email sign-in return. Send a product link or photo, explicitly ask Jules to save the intended item, and confirm it appears in that tester’s wishlist. Decline the offer in a separate test; confirm normal shopping still works. Reload/double-click and confirm no duplicate onboarding texts. Check the private messages ledger for actual `sent` or `uncertain` outcomes.

Local automated tests use synthetic conversations and messaging providers. Browser checks use mocked API replies at desktop and phone widths. These do not prove a deployed Photon delivery, a configured Supabase redirect, or a real first wishlist save. No deployment or real tester messages were performed during implementation.
