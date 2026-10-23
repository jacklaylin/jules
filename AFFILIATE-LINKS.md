# Affiliate links

Status: PRD, October 19, 2026. **P0 after beta**: the first item to build once the tester beta ends, before public launch. Not assigned for implementation yet. Research notes and sources are at the end; figures from third-party sites are marked unconfirmed.

## Why

Jules needs revenue that requires no merchant deals, no user payments and no change to what it recommends. Affiliate networks pay a commission when someone buys after tapping a link. One network approval covers tens of thousands of stores, so there's nothing to negotiate store by store.

This is not a growth or learning feature. With 5–10 testers revenue teaches nothing, which is why it waits until after beta.

## Goals

- Earn a commission on purchases made through the product links Jules already sends, across as many stores as possible, with one network account.
- Measure it: clicks, purchases, revenue per active user, next to cost per active user (Admin › Costs).
- Change nothing the user sees except a disclosure.

## Non-goals

- Negotiating rates or onboarding merchants.
- Using commission, earnings-per-click or network membership as a ranking signal, anywhere.
- Cashback or rewards to users.
- Affiliate product feeds as a data source (separate item; see PRD Section 28).
- Checkout.

## Rules

1. **Neutral recommendations.** Product and store selection never sees commission data. A store that isn't in the network ranks exactly as it would otherwise. Same principle as Shop's neutrality rules ([SHOP.md](SHOP.md)).
2. **Messages look the same.** Jules already sends product links as `/go/<token>` links on its own domain, with product preview cards (`lib/adoption-events.js`). Affiliate wrapping happens at that redirect, after the tap. No new short links, no network domain in the message.
3. **A tap always reaches the store.** If the network is down, misconfigured or slow, forward straight to the store.
4. **Only people tap affiliate links.** Link-preview bots already get a preview page instead of a redirect; keep it that way so previews don't generate fake clicks.
5. **No personal data to the network.** The tracking ID sent to the network is an opaque per-link value, never a phone number, email or user ID. Jules keeps the mapping.
6. **Disclose it.** See "Disclosure".
7. **Opted-in recipients only.** Jules only texts people who opted in, which matches the networks' rules for links sent by SMS or messaging.

## Options compared

| Option | Covers | Setup | Server-side API | Publisher share | Fit for Jules |
|---|---|---|---|---|---|
| **Sovrn Commerce** (formerly VigLink) | "Tens of thousands" of merchants, one approval | Self-serve signup; submit a campaign; send a few test clicks; review ~5 business days. Has onboarding guides for apps and for SMS/messaging. | Yes, documented: Redirect API (wraps any URL, optional custom tracking ID up to 32 characters), Link Check API (affiliatable? + estimated earnings per click), Transactions API (per-purchase reporting with the tracking ID) | Revenue share; split not published | **Best fit.** Server-side, self-serve, per-link tracking and reporting |
| **Skimlinks** | ~48,500 advertisers (third-party figure) | Manual approval, selective; favors content sites | Link Wrapper can run server-side, but full API access reportedly goes through an account manager | 75% to publisher, 25% to Skimlinks (Skimlinks support page); payouts reportedly ~90 days | Fallback if Sovrn says no |
| **Wildfire Systems** | 50,000+ merchant programs, mostly US | Enterprise sales; built for cashback apps and browser extensions | Yes (APIs, JSON feeds) | Not published | Overkill now; revisit only if Jules ever adds cashback |
| **Direct networks** (Rakuten Advertising, CJ, Awin, Impact) | Each network's brands; Rakuten is strong in premium and luxury fashion | Separate application per network **and per brand** | Varies; CJ has an open developer portal | Full commission, no aggregator cut | Contradicts "no merchant onboarding." Later, only for top stores where volume justifies it |
| **Amazon Associates** | Amazon only (aggregators generally don't cover Amazon; confirm) | Separate account; reportedly must make sales within the first 180 days | Product Advertising API | Amazon's category rates | Optional add-on. Current terms reportedly allow links in SMS only to opted-in recipients (third-party summary) |
| **AI link tools** (e.g. ChatAds) | Varies | Self-serve | Text in, links out | Claims 100% to publisher plus a per-request fee | Not needed: Jules already has the exact product URL |

## Recommendation

**Sovrn Commerce first.** It's the only option that is self-serve, has documented server-side APIs, supports a per-link tracking ID with matching per-purchase reporting, and has an explicit onboarding path for apps and SMS. Apply to Skimlinks only if Sovrn rejects the campaign. Add Amazon Associates later if a meaningful share of taps go to Amazon. Consider direct networks only once a few stores carry most of the revenue.

## How it works in Jules

### Phase 1: earn

- **Hook point.** The `/go/<token>` handler in `lib/adoption-events.js`. When a person (not a preview bot) taps, it already records the click and responds `302` to the store URL. With `AFFILIATE_ENABLED=true`, it responds with the Sovrn Redirect API URL wrapping the store URL instead.
- **Redirect API, not Link Check, at tap time.** The Redirect API is a URL Jules builds itself, so there's no network call while someone is waiting. It wraps stores Sovrn doesn't have; those simply forward with no commission.
- **Tracking ID.** An opaque value derived from the link token (for example a short hash of operation + index). Stored with the click event so a purchase can be matched to the reply and product later. Since October 23, 2026 each `link_click` event already records the tapped link's position (`link_index`, db/052), so taps per store can be counted before any affiliate work.
- **Scope.** Product links in chat replies and price-alert texts that go through `/go/`. Wishlist page links go through `/go/` too since October 23, 2026 (`lib/wishlist-go.js`; taps recorded with ref `wishlist:<item>`). Shop cart links (`CHECKOUT_LINKS_ENABLED`) stay unwrapped until a test purchase confirms wrapping doesn't break the cart.
- **Settings.** `AFFILIATE_ENABLED` (off by default) and `SOVRN_CAMPAIGN_KEY` in Vercel environment variables. Never in source code.
- **Built October 23, 2026** (`lib/affiliate.js`). The tap forwards to `https://redirect.viglink.com/?key=…&u=<store link>&cuid=<id>&utm_source=jules&utm_medium=sms|wishlist`. The `cuid` is a 24-character hash of the tap's link (reply operation and link position, or wishlist item and link), so it can be recomputed from a `link_click` row. Never `cp`: Sovrn's fallback to other retailers would change the store the person tapped. Wrapped taps send `Referrer-Policy: origin` so Sovrn can see they came from Jules (code of conduct §7.1) without the link token. Links already carrying `afsrc=1` aren't wrapped (§7.3).

### Phase 2: measure

- A daily job pulls Sovrn's Transactions API into an `affiliate_transactions` table (merchant, order value, commission, tracking ID, dates). Database migration required.
- Admin shows clicks, purchases, revenue and revenue per active user next to cost per active user.
- Purchases matched to a tracking ID can become purchase evidence ("did you end up getting it?"), but only with the user's confirmation and the same evidence rules as receipts.

## Disclosure

- **Where:**
  - First message or onboarding consent: a one-line disclosure.
  - Privacy page and landing page: a short paragraph.
  - On request: Jules answers honestly when asked how it makes money.
- **Draft wording:** "Jules may earn a commission when you buy through its links. It never changes what Jules recommends."
- **Open question:** the FTC expects disclosure that is clear and close to the endorsement. Whether a one-time disclosure in the thread is enough, or each product reply needs a short marker, needs a quick legal check before launch.

## Founder setup steps (when assigned)

1. **Prerequisites.** Beta has ended, the landing page and privacy page are public, and the disclosure wording is approved. Sovrn reviews what it can see, so the public pages must exist first.
2. **Sign up.** Create a publisher account at sovrn.com (Commerce), confirm your email and accept the terms. No credential yet.
3. **Submit a campaign.** Submit the Jules landing page as the campaign. In the description, explain that Jules sends product links by text to people who opted in, and how the disclosure is shown. Sovrn reviews each "location" separately; Jules is one location.
4. **Get the key.** Sovrn shows a campaign key for the Redirect API. Store it only in **Vercel → Jules → Settings → Environment Variables** as `SOVRN_CAMPAIGN_KEY`. Never paste it into chat, code or Git.
5. **Test clicks.** Sovrn won't start its review until it has seen a few clicks through the integration (its app and SMS onboarding guides say so). With the code deployed and `AFFILIATE_ENABLED=true`, tap a few Jules product links yourself. Only send a few: clicks aren't paid before approval.
6. **Wait for approval.** About 5 business days. If there's no status and no clicks after that, email Sovrn support.
7. **Payment and tax.** Add payout and tax details in the Sovrn account (stays in Sovrn, not in Jules).

## Acceptance criteria

- With the flag off, `/go/` behavior is byte-for-byte unchanged.
- With the flag on:
  - A person's tap reaches the store through the Sovrn redirect.
  - A preview bot gets the preview page.
  - An invalid or failing wrap still reaches the store.
- The same replay-suite cases produce identical products and store order with the flag on and off.
- No phone number, email or user ID appears in any outgoing affiliate URL.
- The disclosure appears in onboarding, the privacy page and the landing page.
- A real test purchase appears in Sovrn reporting with the expected tracking ID. Phase 2: it also appears in Admin.

## Open questions

- Does Sovrn approve an SMS/iMessage product like Jules, and under which campaign type?
- What share of Jules taps go to stores Sovrn covers? Measure by running Link Check against the last month of `link_click` targets once the campaign is approved.
- Amazon: how much traffic goes there, and is Associates worth a second account?
- Resale marketplaces (eBay, Depop, Grailed): which ones pay through Sovrn?
- FTC disclosure placement (see Disclosure).

## Research sources

- Sovrn: [API onboarding](https://knowledge.sovrn.com/kb/api-onboarding-guide-for-commerce), [mobile and software onboarding](https://knowledge.sovrn.com/kb/mobile-and-software-application-onboarding-guide-f), [email/SMS onboarding](https://knowledge.sovrn.com/kb/email-newsletter-sms-campaign-and-discord-group-on), [publisher code of conduct](https://www.sovrn.com/service-policies/commerce-publisher-code-of-conduct/)
- Skimlinks: [pricing and revenue share](https://support.skimlinks.com/hc/en-us/articles/223835508-How-much-does-Skimlinks-charge), [why there's an approval process](https://support.skimlinks.com/hc/en-us/articles/223835568-Why-is-there-an-approval-process-for-Skimlinks)
- Wildfire: [decision checklist](https://www.wildfire-corp.com/why-wildfire-decision-checklist), [AI recommendations](https://ai.wildfire-corp.com/)
- Network comparisons (vendor blogs, unconfirmed): [Shopify](https://www.shopify.com/blog/affiliate-networks), [Sales Theorem](https://salestheorem.com/field-notes/us-affiliate-network-comparison-international-brands), [NCZ Affiliates](https://www.nczaffiliates.com/blog/best-affiliate-networks-awin-cj-clickbank-impact-rakuten/)
- Amazon SMS terms (third-party summaries): [Geniuslink](https://geniuslink.com/blog/can-you-include-affiliate-links-in-emails/), [ConductAtlas](https://conductatlas.com/platform/amazon-associates/amazon-associates-program-policies/provision/CA-P-064496/email-sms-messaging-requires-opt-in-consent/)
- AI link tools (competitor-authored): [ChatAds comparison](https://www.getchatads.com/blog/seven-tools-for-inline-affiliate-link-wrapping-in-ai-chat/)
