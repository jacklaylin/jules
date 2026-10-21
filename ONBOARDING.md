**October 12 entry-flow update:** See [ENTRY-FLOW.md](ENTRY-FLOW.md). Login now uses a code texted to the invited phone, Gmail analysis continues in background requests, and all post-import questions happen in Messages. The email-login and browser-driven import descriptions below describe the earlier implementation.

# Tester onboarding: Gmail demo and real import pilot

**Real import pilot:** With `GMAIL_IMPORT_ENABLED=true`, `/onboarding` uses the actual read-only Gmail connection, history and feedback flow described in [GMAIL-IMPORT.md](GMAIL-IMPORT.md). The following demo remains available only when that flag is false.

Demo flow: landing → signup with phone and consent → Jules texts an offer → tester accepts in Messages → private `/onboarding` page → invited-email sign-in if needed → **Connect Gmail — demo** → thinking screen → introductory shopping text → completion text → thinking interstitial → wishlist.

The Gmail button does not request OAuth access, fetch receipts, or create taste facts. All related pages and texts say this. The demo completes immediately on the server, so closing the browser does not cancel the two follow-up texts. There is no pretend background analysis or fabricated email report. Clarification questions and Wrapped are omitted. Existing photo/link shopping and wishlist-save consent continue normally; onboarding never silently saves an item or enables alerts.

## Try it without a phone

Open `/onboarding-preview` to walk through the flow with a demo tester. It uses no API calls, real texts, login, Gmail access, or real wishlist writes. Use the explicit simulated replies and completion button, then practice saving the first item. Restart preview resets only this tab’s simulated state. This checks the experience; it does not verify the live messaging backend.

## Setup for the first tester

**October 19 update: self-serve onboarding (in progress).** With `SELF_SERVE_ONBOARDING_ENABLED=true` (plus `ONBOARDING_ENABLED` and `GMAIL_IMPORT_ENABLED`), approving someone in Admin › People does steps 2–3 below automatically for anyone who has texted Jules. It creates a Supabase sign-in user with an internal address (`<conversation id>@members.jules.invalid`, never shown or mailed; they sign in by phone), adds the `wishlist_members` row and the onboarding invite, then texts the onboarding welcome. Testers you already provisioned keep their account. **October 21:** Gmail now connects with any Google account. The Google OAuth app is in Production publishing status (anyone can sign in; Google shows an "unverified app" warning until verification, and caps it at 100 users), and the connected Gmail is bound to the person who started the connection, whatever their member email. A Gmail address already connected to another Jules account, or invited as another tester's member email, is refused and its sign-in revoked.

This is deliberately invite-only, using the existing private wishlist sign-in. Phone signup alone does not grant account access. Provision each tester once (maximum ten for this experiment):

1. In Supabase **SQL Editor**, run `db/016_onboarding.sql` after the existing migrations, including `014_public_signup.sql`. It creates the private onboarding state table. No credential is produced.
2. In Supabase **Table Editor → conversations**, find the tester’s conversation. For a tester who has never texted Jules, create a row with `sender_id` set to their phone in international format and `line` set to the Photon line assigned to them. Leave generated fields at their defaults. Copy the resulting conversation `id`. Confirm the assigned line in Photon; do not guess a pooled line.
3. In **wishlist_members**, add the tester’s invited email and that `conversation_id`, using the existing companion-access setup. In **onboarding_sessions**, add that same `conversation_id`; leave `state` as `invited`. Keep phone numbers and emails in Supabase, never in SQL committed to the repository. Only one invited conversation may match a signup phone; ambiguous matches send no text.
4. In Vercel **Settings → Environment Variables**, enable `ONBOARDING_ENABLED=true`, `PUBLIC_SIGNUP_ENABLED=true`, and `WISHLIST_ENABLED=true`. Keep the existing AI, memory, image and search configuration enabled for the shopping portion. `SITE_ORIGIN` must be the actual site URL. Photon, Supabase and OpenAI credentials stay in Vercel’s secret settings. No new API key is needed.
5. Deploy the code and settings. Have the tester open `/signup` and submit their own number and consent. Jules sends the first message only for a provisioned onboarding invitation. Uninvited numbers remain early-access signups.

The configured Supabase Auth redirect allowlist must permit `SITE_ORIGIN/onboarding` as well as the existing wishlist/style destinations. Add that exact URL in **Authentication → URL Configuration → Redirect URLs** so the invited-email sign-in returns to the demo. This is authentication only, not a Gmail connection.

The existing public-launch/provider-review notes in LANDING-PAGE.md remain relevant for broad public outreach. This change does not implement universal messaging unsubscribe or general public account enrollment. Declining this demo cancels its onboarding progression, not existing shopping alerts.

## Jules's contact card

Right after the welcome is delivered, Jules sends “save me so you know it’s me:” and a contact card, `jules.vcf`: name **Jules**, note **Personal shopper**, the Jules number, the site link and the still-orb photo (`public/brand/contact-photo-512.jpg`). Tapping it on iPhone opens **Create New Contact** with everything filled in. The card is built at send time by `lib/contact-card.js` from two Vercel settings, so no phone number lives in the repository:

- `JULES_PUBLIC_LINE`: the Photon line in international format, e.g. `+14155550100`. Without it, the welcome goes alone and no card is sent.
- `SITE_ORIGIN`: already required above; it becomes the card's website.

The card is its own ledger entry (`onboarding:<conversation>:contact_card`), so it goes once, only after a welcome Photon accepted, never after an uncertain one. A failed card never changes the welcome's outcome; Vercel logs show `imessage_file_sent` or `imessage_file_failed`.

**Check it once (one phone is enough):** with both settings in Vercel, open **Admin › People**, pick yourself and click **Text them Jules’s contact card…**. You should get the lead-in and a contact bubble showing the orb; tap it and confirm the name, number and photo. This resets nothing (onboarding, Gmail and history stay as they are), and it is also how to send the card to testers who signed up before it existed. Each click sends it again.

### Set the same photo as the line's iMessage Name and Photo

The contact card covers people who save it. Separately, iMessage can show Jules's name and photo in the chat header for everyone, using the Photon line's own **Name and Photo** (the iMessage profile Apple shares with people you text). It lives on the Photon line's Apple account, not in this app, so it is a one-time setup outside the code:

1. Why: so the thread shows **Jules** and the orb even for testers who never save the card.
2. In [Photon Dashboard](https://app.photon.codes/), open the `jules` project and the line testers text, and look for the line's iMessage profile (**Name and Photo**). This repository can't confirm Photon exposes it; if it does, set the name to `Jules` (first name only) and upload `public/brand/contact-photo-1024.png` (iOS crops it to a circle). If there is a sharing choice, pick sharing automatically with **Anyone**, not **Contacts Only**, so it reaches testers who haven't saved Jules.
3. If the dashboard has no such setting, email Photon support: ask them to set the iMessage Name and Photo for the Jules line to “Jules” with that image attached, shared automatically, and to turn on contact sharing for the project (the iMessage SDK calls this the `imessageSynced` profile; it pushes the line's card to each chat once a day).
4. No credential or value is produced. Nothing goes into Vercel or the repository.

Then text the line from a phone that has never saved Jules. After Jules replies, the thread should offer or show the orb and “Jules” (iOS may show a banner to accept the updated name and photo).

## Failure and retry behavior

Outbound messages use the existing persisted reservation/delivery ledger. Concurrent signup submissions and repeated demo clicks cannot send the same stage twice. An uncertain send is not retried automatically because it may already have reached the tester. The browser reports uncertainty and retains a wishlist link. Stage state survives reloads. Account access is checked on every request; the client cannot choose another conversation. The demo POST checks the site origin. Consent to a product save or alert cannot be reused as acceptance of the style-reading offer.

## Acceptance check before sharing

With a real provisioned tester, verify the entire flow above, including the invited-email sign-in return. Send a product link or photo, explicitly ask Jules to save the intended item, and confirm it appears in that tester’s wishlist. Decline the offer in a separate test; confirm normal shopping still works. Reload/double-click and confirm no duplicate onboarding texts. Check the private messages ledger for actual `sent` or `uncertain` outcomes.

Local automated tests use synthetic conversations and messaging providers. Browser checks use mocked API replies at desktop and phone widths. These do not prove a deployed Photon delivery, a configured Supabase redirect, or a real first wishlist save. No deployment or real tester messages were performed during implementation.
