# Public Jules landing page

Implemented locally: `/` follows the supplied design brief with a pinned viewport and iMessage example that autoplays on load and hands playback to user scrolling, chapters, backward scrubbing, an accessible transcript, and reduced-motion behavior. `/signup` collects a number and explicit consent. `/login` uses the existing invited-email magic-link flow and takes signed-in users to the wishlist.

The demo uses a real, free-use Pexels sneaker photograph; source and license are recorded in `docs/assets/demo-sneakers.md`. It describes supported sourcing behavior without invented inventory, shipping, retailer prices, or purchasing claims. Its budget is an example user request, not a product price. The device dimensions remain fixed throughout the timeline; only the message area scrolls.

## Enable the signup form

1. In the existing Supabase project, open **SQL Editor**, create a new query, paste the contents of `db/014_public_signup.sql`, and run it once. This creates a private early-access signup ledger and a server-only submission function. No new database or messaging service is needed.
2. In Vercel, open this project's **Settings → Environment Variables** and set `PUBLIC_SIGNUP_ENABLED` to `true`. The existing `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SITE_ORIGIN` must already be configured. `SITE_ORIGIN` must exactly match the public website origin. Keep the service-role key in Vercel environment settings, never source code.
3. Optionally set `JULES_PUBLIC_LINE` in Vercel to the assigned Photon line, in international format starting with `+`. This adds an **Open Messages** button after successful signup. It does not send a message or prefill a recipient's number publicly.
4. Redeploy to apply the settings. Submit a signup with a number you own and check **Table Editor → public_signups** in Supabase for the number, consent version, disclosure and timestamp. Do not paste real signup records into Git or chat.

Submissions are rate-limited to five per protected connection identifier per hour. Request IDs make retries idempotent. Browser roles cannot read or write the ledger, and application logs omit phone numbers. Numbers remain unverified; submitting a number does not prove control of that number or enable companion login.

## First-message decision and public-launch gap

The founder prefers Jules sending the first message after website opt-in. This implementation records consent but does **not** send or schedule signup messages, and says so on the confirmation screen. A configured Open Messages link is a user-initiated alternative.

Before enabling Jules-first outreach, confirm the exact iMessage/SMS signup flow with Photon and review the disclosures for the launch jurisdictions. Publish messaging terms and a privacy policy, implement and test persisted consent revocation/suppression across replies and scheduled alerts, and ensure subsequent explicit consent is required for reactivation. Do not promise STOP handling until it is verified. A web checkbox is not a blanket compliance guarantee. CAN-SPAM primarily governs email; TCPA/FCC and provider requirements are relevant to automated texting, with channel-specific applicability requiring review.

Then add an idempotent welcome-message reservation and delivery outcome. Ambiguous delivery must remain uncertain rather than retrying blindly. No infrastructure for this unassigned follow-on has been added.

Public companion account creation is also separate: existing wishlist/style access remains invited-email-only. Signing up with a phone number does not claim to create that account.

## Verification

Automated API tests cover consent, stale versions, phone formatting, origins, disabled configuration, failed persistence, rate limits, optional Messages links, and timeline states. Local browser checks cover desktop, 390px and 320px phones, forward/back scrubbing, reduced motion, and no horizontal overflow or JavaScript errors. Use synthetic fixtures for form success/failure and private pages; do not send real texts to verify the landing design.

For the Photon confirmation, ask support: “For our iMessage personal-shopping agent, may we send one automated onboarding message after a user submits their mobile number and an unchecked consent checkbox on our website, without an inbound text first? What disclosure, number-verification, opt-out, and SMS-fallback requirements apply to our project?” Save the written response with launch documentation. No secret or new credential is produced by this step.
