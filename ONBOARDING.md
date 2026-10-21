**October 12 entry-flow update:** See [ENTRY-FLOW.md](ENTRY-FLOW.md). Login now uses a code texted to the invited phone, Gmail analysis continues in background requests, and all post-import questions happen in Messages. The email-login and browser-driven import descriptions below describe the earlier implementation.

**October 21 update:** after a Gmail import, the tester now gets the count, then straight away the "who you are" summary (or early read), then the receipt and style questions, which sharpen it, then the style report link. The summary no longer waits for the questions, outfit photos or a 24-hour fallback. Details in [ENTRY-FLOW.md](ENTRY-FLOW.md#october-21-update-the-first-style-result-comes-first).

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
2. In Supabase **Table Editor → conversations**, find the tester’s conversation. (Since October 21, **Set up** in Admin › People › New signups does this step and the next; see [Setting up a new tester from Admin](#setting-up-a-new-tester-from-admin-october-21).) For a tester who has never texted Jules, create a row with `sender_id` set to their phone in international format and `line` set to `shared` (the value every inbound message uses with this project's shared Photon token; any other value makes their first text open a second, waitlisted conversation). Leave generated fields at their defaults. Copy the resulting conversation `id`.
3. In **wishlist_members**, add the tester’s invited email and that `conversation_id`, using the existing companion-access setup. In **onboarding_sessions**, add that same `conversation_id`; leave `state` as `invited`. Keep phone numbers and emails in Supabase, never in SQL committed to the repository. Only one invited conversation may match a signup phone; ambiguous matches send no text.
4. In Vercel **Settings → Environment Variables**, enable `ONBOARDING_ENABLED=true`, `PUBLIC_SIGNUP_ENABLED=true`, and `WISHLIST_ENABLED=true`. Keep the existing AI, memory, image and search configuration enabled for the shopping portion. `SITE_ORIGIN` must be the actual site URL. Photon, Supabase and OpenAI credentials stay in Vercel’s secret settings. No new API key is needed.
5. Deploy the code and settings. Have the tester open `/signup` and submit their own number and consent. Jules sends the first message only for a provisioned onboarding invitation. Uninvited numbers remain early-access signups.

The configured Supabase Auth redirect allowlist must permit `SITE_ORIGIN/onboarding` as well as the existing wishlist/style destinations. Add that exact URL in **Authentication → URL Configuration → Redirect URLs** so the invited-email sign-in returns to the demo. This is authentication only, not a Gmail connection.

The existing public-launch/provider-review notes in LANDING-PAGE.md remain relevant for broad public outreach. This change does not implement universal messaging unsubscribe or general public account enrollment. Declining this demo cancels its onboarding progression, not existing shopping alerts.

## Setting up a new tester from Admin (October 21)

You no longer add a `conversations` row in Supabase by hand. For each new signup:

1. **Photon:** in the [Photon Dashboard](https://app.photon.codes/), enroll the tester's number. This stays manual: Photon's SDK (`@spectrum-ts`) has no call to enroll a number or assign a line, so Jules can't do it for you. Do this first, or the welcome can't reach them.
2. **Admin › People › New signups** (the link in your new-signup text opens it). It lists signups whose number has no conversation yet, with their name, the last four digits of their number and when they signed up. The full number is never shown.
3. Click **Set up** on their row, read the confirmation, which quotes the exact text Jules will send, and click **Set up and text them**. There is no line to type.

That one click saves their conversation, approves them, sets up their account and invite (as **Approve** does), and texts the welcome and then the contact card. Their gender from the signup form is added to their profile, as it would be if they had texted first. They then move from New signups to Testers.

**Why there's no line to type (fixed October 21).** This project uses one shared Photon token, so every message that reaches Jules arrives on the line `shared`, whichever Photon number the tester texted, and their conversation is found by their number plus `shared`. The first version of Set up saved the number you typed instead, so the tester's first text opened a second, waitlisted conversation without their account. Set up now saves `shared`, the same as every tester who texted first.

The contact card uses `JULES_PUBLIC_LINE` (below), as it already does for every other tester, because `shared` isn't a phone number. If Photon gives testers different numbers, the card shows `JULES_PUBLIC_LINE` for all of them.

It is safe to click again. A number that already has a conversation (for example because they texted Jules before you set them up) reuses it, a second one is never created, and someone already approved gets no second text. Nothing is changed or sent when:
- the number texted STOP to Jules;
- the number already has a conversation on a line other than `shared`, or on several lines. Use **Approve** in Testers instead;
- Jules's newest conversation isn't on `shared` (Photon was switched to dedicated lines). Set up would guess the line, so it refuses; tell Claude so Set up can be changed.

Vercel logs: `admin_tester_set_up` (`created`, `changed`, `text`, `account`). If the welcome ends **may not have been delivered**, look for `imessage_send_failed` just before it: `name`, `code` and `status` say what Photon's send threw (for example an expired token or an unknown recipient). The message text, numbers and the error's own wording are never logged. No migration is needed.

## New-signup text to the owner

On Photon's Free plan each tester needs their own line, so a signup can't start until you enroll them in Photon and set them up in Admin (below). Jules texts you when someone signs up at `/signup`, so you don't have to wait to be told:

> new signup: Sam R., •••-0123, from podcast. set them up: https://textjules.com/admin?view=signups

- It goes to your own Jules conversation, set by the Vercel variable `OWNER_ALERT_CONVERSATION_ID`. Find your id in **Admin › People**: open yourself; the id is the last part of the page address (`/admin/people/<id>`). Add the variable in Vercel **Settings → Environment Variables** (Production), then redeploy. No phone number is stored anywhere new.
- Only the first name, last initial and last four digits are shown. "from" is the signup link's `ref`, else how they arrived (utm source or referring site), and is left out when unknown.
- Once per signup: a retried submit never texts again (ledger operation `signup-alert:<request id>`). No text when the number already has an approved conversation, or when the onboarding welcome went because you had already invited them. Your STOP status applies like any other Jules text.
- The text is sent after the signup is answered; a failed text never fails or slows a signup.
- It is shown in Admin as a "System message (alert or test)" and kept out of the chat context Jules reads, so it never looks like something Jules said to you.
- Vercel logs: `signup_alert` (status `sent`, `uncertain` or `blocked`; `duplicate`), `signup_alert_skipped` (reason `not_configured`, `invalid_setting`, `invited`, `approved` or `owner_conversation_missing`), `signup_alert_failed`.

## Jules's contact card

Right after the welcome is delivered, Jules sends “save me so you know it’s me:” and a contact card, `jules.vcf`: name **Jules**, note **Personal shopper**, the Jules number, the site link and the still-orb photo (`public/brand/contact-photo-512.jpg`). Tapping it on iPhone opens **Create New Contact** with everything filled in. The card is built at send time by `lib/contact-card.js` from two Vercel settings, so no phone number lives in the repository:

- The number is the line this person texts (stored on their conversation). On Photon's Free plan each tester has their own line, so each card carries that tester's number.
- `JULES_PUBLIC_LINE`: the Photon line in international format, e.g. `+14155550100`. Used only when the person's line isn't a phone number. With neither, the welcome goes alone and no card is sent.
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

## One reminder for people who haven't connected (October 21)

Someone who got the welcome but tapped **Not now, go to Messages**, or never opened the link, gets one text about a day later: “whenever you’re ready, here’s your link to connect your shopping accounts: …/onboarding” (Jules may reword it in its voice; the link is signed so they land logged in).

- **Who gets it:** onboarding still `offered` or `accepted`, welcome delivered 24 to 48 hours ago, and nothing connected or started (no Gmail sign-in, no import, no Shop connection, including one waiting for approval in Shop). Someone who declined in chat, finished onboarding, or texted STOP gets nothing; the message ledger blocks opted-out numbers.
- **Once per person, ever:** it is the ledger entry `onboarding:<conversation>:reminder`. Repeated sweeps never send it twice, and an uncertain send is never retried. **Reset onboarding** in Admin removes it with the other onboarding texts, so a re-test can receive it again.
- **When:** the existing once-a-minute Supabase sweep (`jules-gmail-sweep`) checks `onboarding_reminders_due()` and calls Vercel only when someone is due. The 48-hour edge means turning it on never texts people welcomed long ago.
- **Not now** still just opens Messages; nothing on the page changes and the onboarding state stays the same. The tap is saved as `onboarding_sessions.not_now_at`. It does not stop the reminder (it is exactly who the reminder is for).
- **Admin › People › person** shows “Tapped Not now · date” and “Reminder sent · date” beside the name; the reminder also appears in the Conversation tab.
- **Logs (Vercel):** `onboarding_not_now` (state, whether it was saved), `onboarding_reminder_sent`, `onboarding_reminder_not_sent` (status, e.g. `blocked` or `uncertain`), `onboarding_reminder_failed`. The sweep's `gmail_sweep` line counts `reminders`. Model cost shows as **Onboarding reminder** under the Import restart sweep job.

**Turn it on:**

1. In Supabase **SQL Editor**, run `db/046_onboarding_reminder.sql` (after 045). It adds the Not now column, the “who is due” check, and teaches the sweep to wake for it. No credential is produced. Re-running is safe.
2. In Vercel **Settings → Environment Variables**, add `ONBOARDING_REMINDER_ENABLED` = `true` (Production). It also needs `GMAIL_IMPORT_ENABLED=true` and `SITE_ORIGIN`, which are already set. Set it to `false` (and redeploy) to stop reminders; nothing else changes.
3. Redeploy so the setting takes effect.

To check it with one phone: reset your own onboarding in Admin, sign up again, tap **Not now**, and confirm Admin shows the tap. The reminder arrives about 24 hours after the welcome.

## Failure and retry behavior

Outbound messages use the existing persisted reservation/delivery ledger. Concurrent signup submissions and repeated demo clicks cannot send the same stage twice. An uncertain send is not retried automatically because it may already have reached the tester. The browser reports uncertainty and retains a wishlist link. Stage state survives reloads. Account access is checked on every request; the client cannot choose another conversation. The demo POST checks the site origin. Consent to a product save or alert cannot be reused as acceptance of the style-reading offer.

## Acceptance check before sharing

With a real provisioned tester, verify the entire flow above, including the invited-email sign-in return. Send a product link or photo, explicitly ask Jules to save the intended item, and confirm it appears in that tester’s wishlist. Decline the offer in a separate test; confirm normal shopping still works. Reload/double-click and confirm no duplicate onboarding texts. Check the private messages ledger for actual `sent` or `uncertain` outcomes.

Local automated tests use synthetic conversations and messaging providers. Browser checks use mocked API replies at desktop and phone widths. These do not prove a deployed Photon delivery, a configured Supabase redirect, or a real first wishlist save. No deployment or real tester messages were performed during implementation.
