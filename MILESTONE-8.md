# Milestone 8 — Automatic price alerts

Implemented locally October 6, 2026. Database migration, deployment, retailer-page coverage, and live phone acceptance remain pending.

## Founder-approved behavior

Each wishlist card has a bell toggle. Turning it on opens a required size picker built from the deduplicated union of sizes read from all of that item’s saved retailer links. Preserve sizing systems rather than guessing equivalence. Turning it off cancels monitoring. Successful activation shows exactly: “We'll text you if the price drops more than 10% and your size is available”.

Compare the lowest verified, available item price for the selected size across the provided retailer links with the lowest verified, available price saved at activation. Keep currencies separate. A higher-priced retailer dropping more than 10% against its own previous price is insufficient. Exactly 10% does not qualify. Example: initial offers $100 and $150; $150 → $120 sends nothing; a new lowest available offer below $90 qualifies. Taxes, shipping, and duties are excluded and described as additional unknown costs.

After an accepted notification, lower that currency’s reference to the checked new lowest price, so further alerts require another drop exceeding 10%. Price increases or disappearing cheap inventory never raise the reference. Watches remain active until switched off. An uncertain send is retained for operator investigation and never automatically resent.

## Implementation

Reuse Supabase, Vercel, the authenticated wishlist endpoint, the existing approved merchant URL restrictions, structured retailer Product/ProductGroup data, and Photon’s durable reply reservation. No new provider, AI call, or dependency. Only explicitly enabled items are checked.

A daily authenticated cron claims due alerts, with each alert normally checked every three days. Claims are atomic and limited to 50 watches per run, processed five at a time. Failed checks are logged and tried on the next due date. This initial bound matches the planned 10 testers × 5 watches; larger usage requires adjusting the scheduling budget.

Private `price_alerts` records reference both the existing wishlist item ID and its requested-piece group ID, with conversation ownership, size, saved listing names/URLs, per-currency lowest baseline, revision, active state, due date, last check evidence, and notification state. Server auth scopes reads and writes; database functions also check item ownership. An active enable retry preserves its original baseline. Reactivation makes a fresh revision and baseline.

Alerts require explicit size-bound offer price and InStock evidence. Generic product-level stock for multiple sizes is insufficient. Missing, blocked, unsupported, aggregate-price, or ambiguous retailer data cannot trigger a text. Sizes can include sold-out variants, but activation requires at least one verified available price for the chosen size. Existing merchant restrictions limit coverage; unfamiliar retailers need review before support is added. This is a conservative structured-data implementation, not universal browser scraping.

## Release setup

1. In the existing Supabase project, open SQL Editor → New query, paste `db/009_price_alerts.sql`, and Run. It creates private alert records and functions; no credential is produced.
2. In the existing Vercel project → Settings → Environment Variables, set `PRICE_ALERTS_ENABLED=true` after migration. Generate a long random secret in a password manager and save it as `CRON_SECRET` in Vercel. Vercel uses it to authorize scheduled requests. Store the secret only in environment settings or a private local environment file, never Git or chat.
3. Deploy the repository through the existing Vercel workflow. Confirm the `/api/price-checks` daily cron appears. Database credentials, Photon configuration, and wishlist login are reused.

## Acceptance

Automated tests cover variant parsing, ambiguous/shared stock, deduplication without size conversion, strict threshold, lowest-price comparison, currency boundaries, unsupported URLs, owner scope, scheduler auth, uncertain sends, cancelled watches, and send/persistence recovery. Browser verification uses fake local items only, exercising the required selection, enable confirmation, and disable toggle without sending texts.

Before calling the milestone complete, apply the migration in the actual database, verify size/stock parsing on tester retailer links, verify persisted state after browser reload, test another user’s access denial, and perform the later-notification phone loop with supported price/size evidence. Local tests do not establish live retailer coverage or iMessage receipt.
