# Go-to-market plan

Status: working draft, started October 19, 2026. Captures founder decisions and open ideas; nothing here is a commitment yet. Product backlog lives in [BACKLOG.md](BACKLOG.md).

## Constraints

- **Bootstrapped.** No funding. Growth comes from word of mouth and marketing done well, not paid acquisition at scale.
- **No merchant onboarding.** No negotiating commissions or partnerships in the early days.
- **Consumer only.** Not enterprise, not a brand-side tool.

## Positioning principles

- **Sell the outcome, not the technology.** Don't brand Jules as an "AI stylist", "AI shopper" or "agent". People don't want AI-branded tools; they want the result. Lead with what Jules does for you (finds it, in your size, cheaper, and keeps watching). The public landing page already avoids "AI" wording; keep it that way.
- **Jobs, not demographics.** Several ICPs at once (PRD Section 3). Younger, taste-driven shoppers are one; avoidant shoppers, hunters and optimizers stay in scope. Positioning should name jobs that cut across them.
- **Shopping is fun; Jules should add to the fun.** For many people browsing TikTok, Pinterest, Depop and sales is entertainment. Jules doesn't replace that. It's what you send things to while you browse.
- **No curation team.** Taste quality comes from the model, the user's own evidence and the feedback loop. Because there's no human curation, taste quality is a core product investment, not polish: generic taste is easy to mock.

## Candidate jobs

| Job | Example | Who it serves | Main competitor | Jules' edge |
|---|---|---|---|---|
| **Forward it to Jules** | Share a listing or post from any app; Jules checks the price, finds it cheaper or in your size elsewhere (including resale), and watches it | Enthusiasts, optimizers, hunters | Phia ("Should I buy this?"), Google Lens | Works from any app's share sheet into a thread you already use; remembers your size and stores; follows up |
| **Where's it from?** | Screenshot of an outfit; Jules finds the pieces | Enthusiasts, younger shoppers | Daydream camera roll, Google Lens | Your size, verified availability, keeps looking when sold out |
| **Just handle it** | "I need something for a wedding in May" | Avoidant shoppers | ChatGPT, Daydream | Knows your taste from your own purchases; three opinionated picks, not a grid |
| **Keep looking** | "Tell me if these come back in a 48" | Hunters | Google price tracking, Amazon Rufus | Any store, size-specific, whole sets, by text |

"Single pane of glass" here means one thread you send things to from everywhere, not one feed that aggregates TikTok, Instagram and Depop. Those apps don't offer personal-feed APIs, and scraping them breaks and violates their terms. Jules can search those marketplaces' listings; it can't mirror your feeds.

## Viral and word-of-mouth mechanics

1. **Shareable style read (Wrapped).** The natural artifact to post. Today it depends on Gmail data, so it inherits the Gmail user cap (below). A version from a few screenshots would remove that dependency. See [WRAPPED.md](WRAPPED.md).
2. **"Text it to Jules."** A one-line behavior people can tell each other in comment sections and group chats. Works only if the answers are right: a wrong price or a sold-out link becomes a screenshot that spreads.
3. **Jules in the group chat.** Shopping decisions happen in group chats. Strongest spread mechanic, most complex; depends on Photon group support. Hypothesis only.
4. **The landing-page demo.** The illustrative iMessage conversation on `/` already shows the "forward it, Jules finds it and watches it" loop.

## Monetization

- **Not in the MVP.** With 5–10 testers, revenue teaches nothing; learning comes first (AGENTS.md priorities). Keep logging purchase intent, which is the future revenue signal.
- **First model: affiliate networks, P0 after beta.** Full plan and option comparison in [AFFILIATE-LINKS.md](AFFILIATE-LINKS.md); Sovrn Commerce recommended. Known catches:
  - Approval needs a public site with real clicks.
  - The network keeps roughly 25% of the commission (third-party figure, unconfirmed).
  - Wrapping happens at Jules' existing `/go/` redirect after the tap, so messages look the same and no new short links are needed.
  - FTC disclosure required.
  - Commission must never influence which product or store Jules recommends. Same neutrality rule as Shop ([SHOP.md](SHOP.md)).
- **Don't charge users** until retention is proven.
- **Watch cost per active user.** Bootstrapped means model and search spend per user has to stay below what that user earns. Rough illustration: a $60 order at ~8% commission with a 75% share is about $3.60.

## Before strangers can text Jules

- **Gmail verification.** Jules reads Gmail with `gmail.readonly`, a restricted scope. An unverified app is capped at 100 new users total; verifying generally requires a yearly CASA security assessment (estimates seen: a few hundred dollars to $15–75K a year, unconfirmed). Get real quotes from approved labs before launch, and keep Gmail optional so onboarding doesn't depend on it.
- **Self-serve onboarding**, **an alert when Jules goes silent**, and **per-user cost caps** (tracked go-live items).
- **Accuracy of prices, stock and images.** Must be reliable before any marketing push.

## Purchase history beyond Gmail

Younger shoppers buy on TikTok Shop, Shein, Depop, Vinted and Amazon, often with receipts scattered or missing from their inbox.

| Source | Status | Notes |
|---|---|---|
| Order-history screenshots in chat | Built (`lib/order-screenshots.js`) | Make it a named onboarding step per store ("send a screenshot of your TikTok Shop orders") |
| Shop app orders | Built, behind `SHOP_ORDERS_ENABLED` | Covers Shopify stores only |
| Gmail import | Built, invite-only | 100-user cap until verified |
| Receipt forwarding address | Backlog | Avoids the restricted Gmail scope; captures new purchases going forward |
| Store data exports (Amazon etc.) | Backlog | Slow and clunky |
| Forwarded listings | Natural byproduct | "Did you end up getting it?" turns a forward into purchase evidence |

## Open questions to test with current testers

- Do people hand off the search, or ask for options and browse themselves? (Decides how much "just handle it" vs. "forward it" to lead with.)
- Do testers forward listings unprompted?
- Do they share the style read?
- Do they come back within a week without a nudge?
