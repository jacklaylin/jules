# Go-to-market plan

Status: working draft, started October 19, 2026. Captures founder decisions and open ideas; nothing here is a commitment yet. Product backlog lives in [BACKLOG.md](BACKLOG.md).

## Launch plan: step by step (October 24, 2026)

**Goal:** the first 1,000 users by December 31, 2026, on about $1,000 of marketing spend, judged on cost per person who sends a first shopping request. The December push rides Spotify Wrapped season, when people are already sharing cards about themselves.

Each step lists what must be true before it starts. Don't start a step until its prerequisites are checked off: a spike that lands on a broken flow is wasted, and it can't be repeated.

| # | Step | When | Prerequisites | Done when | Status |
|---|---|---|---|---|---|
| 1 | **Launch readiness** | Oct 23 | — | The share funnel is fixed, reports come from any source (#435), spending caps are on with the founder exempt (#443), and Photon capacity is understood | Done, except one open question for Photon: is Auto Scale billed per line? |
| 2 | **End-to-end test as a stranger** | By Oct 31 | Step 1 deployed | From a phone that has never texted Jules: sign up from a shared report link → text Jules → send one outfit photo → get the report link → share a card → a friend signs up and is credited to that share in Admin › People. Every step works with no help from the founder | Open |
| 3 | **Seed the Jules social account** | Oct 24 – Nov 7 | Step 1 | At least 6–9 posts that show the product (a real find, a report card, a savings moment), so a creator who checks the account sees something real. Run in the thread "Put Jules social posting on autopilot" | In progress (separate thread) |
| 4 | **Creator outreach** | DMs Nov 3–7; follow-ups Nov 10–12; posts land through Nov 21 | Steps 2 and 3. Ref codes ready ([Creator outreach: first 20](https://claude.ai/artifact/JSRrgkGg9TMjsXCh1xof9x)). The founder's personal bio says "founder of Jules" and links the Jules account | DMs sent from the founder's personal account; log of replies, joins, posts and sign-ups by ref | Ready to start after steps 2 and 3 |
| 5 | **Founder posts and Reddit** | Nov 10–30, alongside step 4 | Step 3 has a few posts. `/faq` and the landing definition line are live (answer-engine step 3 below), because Reddit readers click through | Weekly founder posts in the "where's it from" and savings formats; 2–3 disclosed Reddit posts (r/findfashion, r/frugalmalefashion, r/sneakers) | Open |
| 6 | **$200 paid boost** | Nov 17–30 | A creator post (step 4) or founder post (step 5) that clearly beats the others on sign-ups by ref, and the creator's permission to boost it | The boost brings sign-ups at a lower cost per first request than unpaid posts, or it's stopped after $100 | Open |
| 7 | **Choose the December channel** | Dec 1 | At least two weeks of data from steps 4–6, and the weekly review (step 10) running | One channel gets most of the December budget, chosen by cost per first shopping request | Open |
| 8 | **Upgrade Photon to Business** | When active users near 80, and no later than Nov 28 | Photon's answer on Auto Scale billing. Budget check: about $250 per line per month, and roughly 2–3 lines for 1,000 users | The dedicated line is live, and `CONTACT_CARD_ENABLED` is turned on (the card then matches the line people text) | Open |
| 9 | **Wrapped-season push** | Dec 1–31 (Spotify Wrapped usually lands in the first week of December) | Steps 7 and 8. Spending caps reviewed against current spend. The waitlist copy feels like a start, not a wall. A product decision: is the current style report the "shopping Wrapped" card, or is a Wrapped-style card ([WRAPPED.md](WRAPPED.md)) built first? | Remaining budget on the chosen channel, a Product Hunt launch, and creators re-engaged with a Wrapped hook | Open |
| 10 | **Weekly review** | Every Monday from Nov 3 | Sign-ups by ref (Admin › People) and the share loop (Admin › Adoption) | Each week: sign-ups, first shopping requests and spend per channel, and where next week's money goes | Open |

**Budget (about $1,000 total):** creator thank-yous about $100 (step 4), paid boost $200 (step 6), and the December push about $700 (step 9). Photon's Business plan is separate and is the largest new cost (about $500–750 a month at 1,000 users).

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

## Viral moves to test

Two moves, tested side by side with current testers before any public push. Measure each as shares → new texts → first shopping request.

1. **Style card sharing.** The shareable artifact. People post a card (Instagram Story image) or send the `/r/` link to a group chat; the viewer sees "What would yours say?" and a sign-up button. Sending cards into group chats is how Jules spreads through group chats today. "Jules inside the group chat" (taking part in the decision) remains a separate, unbuilt hypothesis.
2. **Savings screenshots.** "Jules found my $300 jacket for $140." Less explosive than cards, but it proves the product works, and it's the moment someone becomes willing to pay. To make it easy to share: a savings moment should be clear in the thread (original price, found price, store) so a screenshot tells the story on its own. Depends on accurate prices (PRs #187, #191).

Supporting habits:
- **"Text it to Jules."** A one-line behavior people tell each other in comment sections and group chats. Works only if the answers are right: a wrong price or a sold-out link becomes a screenshot that spreads.
- **The landing-page demo** already shows the "forward it, Jules finds it and watches it" loop.

### Time to magic

- **Under a minute:** first useful reply. Someone texts a screenshot or photo; Jules identifies it and replies with a specific read or find.
- **Under five minutes:** first shareable card. Today the style report needs order history (Gmail or Shop import, which takes minutes and runs into the Gmail cap). A report built from what someone can send in the first five minutes (a few outfit photos, a couple of order screenshots, saved posts) is the missing piece for the viral path.

### After the card: low-pressure follow-up

The card is the hook; the follow-up turns it into a shopping conversation. Guidelines, not fixed copy (Jules writes it from context; see AGENTS.md):
- **One follow-up, built from something on their card.** For example a pattern Jules saw, turned into an offer: watch a favorite for a sale, find the thing their closet is missing, or check a price.
- **The easiest possible reply.** "Send me a screenshot of anything you're eyeing" asks for one tap and no thinking.
- **An offer, not a question they have to work at.** No "what are you shopping for?", which puts the effort on them.
- **Silence is an answer.** No second nudge unless they reply or a real event happens (a price drop on something they care about). Accurate over funny.
- **Never ask for Gmail** in the follow-up.

### Seeding creators

- **Who:** micro-creators (roughly 2K–50K followers) who already post outfits, thrift and resale hauls, or "where's it from" content. Their audiences already ask the question Jules answers.
- **Where to find them:** testers' friends and their networks first. Then TikTok and Instagram searches for those formats, college fashion clubs, and fashion and resale Discords.
- **The pitch:** their own style report and early access, no obligation to post. Give each a personal `?ref=` code (signup attribution already exists) and free Jules+ when it exists. Once affiliate links are live, consider a share of the revenue from people they bring in.
- **Disclosure:** creators who get something of value must disclose it (#gifted / #ad). Tell them.
- **Expectations:** reach out to ~20, expect a few posts. Watch which card types get posted.

### Word of mouth: what Daydream did

Daydream's growth came mostly from press and founder reputation (Julie Bornstein: Stitch Fix, Sephora, The Yes), coverage of its $50M round, and collaborations with stylists and influencers. There's no public referral program. Jules has none of those advantages, so its word of mouth has to come from the product: the card, the savings moment, and accurate answers.

## Search and answer-engine discovery (October 20, 2026)

How people find Jules without a referral: Google and Bing, and answer engines (ChatGPT, Perplexity, Google AI Overviews, Meta AI, Claude) that build their answers from the web.

### Where Jules can win

The main competitor in an answer engine is the answer engine itself: ask ChatGPT to find a jacket cheaper and it just answers. Jules gets recommended for what a chat window can't do:

- **Keep watching:** price drops and restocks in your size.
- **Remember you:** sizes and stores across conversations.
- **From anywhere:** forward a listing or screenshot from any app into a thread.

Target those questions ("app that texts me when a jacket restocks in my size"), not "AI personal shopper". This also keeps the no-AI-branding rule.

### What answer engines reward

- **Plain definitions over slogans:** what Jules is, who it's for, what it does, readable as page text (not images or script-loaded text).
- **The reader's question as the first subheading,** answered in under 100 words with an honest "it depends" (where Phia, Google Lens or ChatGPT is the better choice, say so).
- **Dated facts:** "as of October 2026" on prices, features and comparisons. Never invent a price, store count, user count or testimonial.
- **Fresh pages:** real "updated" dates, refreshed every 30–90 days. Never fake an update.
- **Mentions on other sites.** Reddit threads, roundup articles, Product Hunt and creator posts are what answer engines cite most. This is the biggest lever and it's founder work, not code.

### Steps

| # | Step | Status |
|---|---|---|
| 1 | Foundations: robots.txt (search, answer and Meta crawlers allowed; private pages blocked), sitemap, llms.txt, structured data, noindex on private and shared pages, machine-readable landing headline, sign-up source tracking (referrer and UTM) | Done, PR #247 |
| 2 | Google Search Console and Bing Webmaster Tools verified for textjules.com, sitemap read by both | Done, Oct 20 |
| 3 | Landing definition line, a question as the first subheading, "prices as of" on the demo, and a public `/faq` page (free during early access; iPhone/iMessage only; audience framed by job) | In progress |
| 4 | One page per job: find clothes from a screenshot, price alerts in your size, find a dupe, restock alerts. Real dated examples, short FAQ, honest comparison | After launch readiness |
| 5 | Off-site mentions: founder posts on Reddit with disclosure (r/findfashion, r/frugalmalefashion, r/sneakers), "apps like Phia" roundups, Product Hunt, creator posts with on-screen text people search for | After launch readiness |
| 6 | Review results: sign-up source in admin, Search Console Performance, Bing AI Performance (Copilot citations) | ~Nov 3, then monthly |
| 7 | Answer-engine visibility check ([docs/aeo](docs/aeo/README.md)): 15 shopper questions to ChatGPT, Perplexity and Claude with web search; mentions, citations, competitors, off-site gaps. Baseline Oct 20 (OpenAI only): mentioned in 0/15 | Built; scheduled run pending founder decision |

Steps 4–5 wait for the viral launch readiness list below. Search traffic that lands on a waitlist or a wrong price is wasted.

**Founder decision pending:** whether to allow AI training crawlers (GPTBot, ClaudeBot, Google-Extended). They are allowed today. Recommendation: keep allowing, because being known matters more than protecting a one-page site.

**Parked (BACKLOG):** a Jules app inside ChatGPT or Claude, so the assistants can hand off "keep watching this" to Jules. Real build; revisit after launch.

## Monetization

- **Not in the MVP.** With 5–10 testers, revenue teaches nothing; learning comes first (AGENTS.md priorities). Keep logging purchase intent, which is the future revenue signal.
- **First model: affiliate networks, P0 after beta.** Full plan and option comparison in [AFFILIATE-LINKS.md](AFFILIATE-LINKS.md); Sovrn Commerce recommended. Known catches:
  - Approval needs a public site with real clicks.
  - The network keeps roughly 25% of the commission (third-party figure, unconfirmed).
  - Wrapping happens at Jules' existing `/go/` redirect after the tap, so messages look the same and no new short links are needed.
  - FTC disclosure required.
  - Commission must never influence which product or store Jules recommends. Same neutrality rule as Shop ([SHOP.md](SHOP.md)).
- **Watch cost per active user.** Bootstrapped means model and search spend per user has to stay below what that user earns. Rough illustration: a $100 order at ~7% commission, after a ~25% network cut and ~30% of fashion orders returned (commissions are reversed on returns), is about $3.70. At one purchase every two months that's under $2 per user per month. Affiliate alone is probably marginal; direct payment from some users is likely needed.

### Free limits, then Jules+

- **Free:** everything that spreads Jules or proves it works: the style card, sharing, a first find, a first price check. Limits apply to what costs the most: searches per day or week and active watches.
- **Jules+ (paid):** more of the expensive things. Unlimited watches, size-specific hunting, "keep looking" requests. Most likely buyers: hunters, optimizers and avoidant shoppers. Younger viral users mostly won't pay; they're the marketing.
- **Paywall placement:** after the activation moment, at the point of wanting more. Activation hypothesis to confirm with data: the first time Jules finds something in your size for less, or the first alert that fires. The upgrade offer appears when someone hits a limit after that moment ("you've got 3 watches running; Jules+ keeps unlimited"). Never before they've seen value.
- **Limits are settings.** They build on the per-user caps (PR #188) and can change without a release as the activation moment becomes clear.
- **Test before building payments.** Fake-door test with testers: show a Jules+ offer at a limit and record who says yes and at what price ($5–10/month to start). Payment would go through the web (for example Stripe), not an app store.

## Viral launch readiness

Steps to be ready for a spike. Hitting a cost ceiling, or limiting new sign-ups when costs run high, is acceptable: that's a good problem to have. Anything that blocks the viral path is not.

1. **Know cost per active user.** Pull it from Admin › Costs once tracking is verified accurate (PR #188). This decides whether affiliate revenue can carry Jules and where free limits sit.
2. **Enforce ceilings.** Per-user and overall spending caps, with an honest in-thread message when someone hits one (PR #188). An overall cap may also hold new sign-ups on the waitlist.
3. **Take Gmail out of the viral path (non-starter).** An unverified app is capped at 100 new Gmail users ever (`gmail.readonly` is a restricted scope; verification needs a yearly CASA assessment, estimates from a few hundred dollars to $15–75K, unconfirmed). The first shareable card must not need Gmail, and the shared-card sign-up copy must not ask for order emails. Keep Gmail as an optional extra; get CASA quotes in parallel.
4. **Fix the share funnel** (see "Share funnel check" below).
5. **Make the waitlist feel like a start, not a wall.** Someone who signs up from a friend's card while sign-ups are held should hear honestly that they're on the list, and ideally still get something small (for example their first read) once capacity allows.
6. **Confirm messaging capacity with Photon.** How many new conversations a line can start per day before Apple's spam limits kick in, and how to add lines.
7. **Accuracy of prices, stock and images** (PRs #187, #191). A wrong answer is the thing that spreads.
8. **Self-serve onboarding** and **an alert when Jules goes silent** (tracked go-live items).

## Share funnel check (October 19, 2026)

Update, October 23, 2026: the fixes below have shipped (per-sharer `ref`, a "Get your style report" button at the start and end, end copy without order emails, "Text Jules" on exported images, the `/style` image pointing to sign-up). The report is now source agnostic (founder decision): it's built from whatever Jules has (Gmail, Shop, order screenshots or outfit photos in chat) and texted as soon as there's enough to say, so a friend who signs up from a card can get their own from one outfit photo.

What a friend sees today, and what to fix:

| Surface | Today | Gap |
|---|---|---|
| iMessage preview of a shared `/r/` link | Title "Name's style report · Jules", a description that ends in a question ("Who's your style icon?"), branded image | Works well |
| Shared report page | Cards say "What about you?". The end card asks "What would yours say?" with **Get your own report ↗** to `/signup?ref=shared-report` | The only tappable sign-up is at the very end; a friend who stops partway sees none. The end copy says "Get yours by connecting your order emails", which sends them to the Gmail path. Every share uses the same `ref`, so you can't tell which sharer brought whom |
| Instagram Story images (9:16) | The card, "What about you?" and the Jules wordmark. The link is copied for the link sticker | Nothing on the image itself says where to go if it's reposted or screenshotted, or if the sticker is skipped (TikTok has no link sticker) |
| Starter-pack share image (`/style`) | Prints the site address plus `/style` | `/style` asks a stranger to log in, a dead end. Should point to sign-up |
| After sign-up | The person may be held on the waitlist, and a report needs order history | The "get your own" promise can't be kept quickly |

Fixes, smallest first:
- A small persistent "Get yours" button on the shared page, not only at the end.
- End copy that doesn't mention order emails.
- A per-sharer `ref` (derived from the share link, not personal data) so every new person is credited to the share that brought them.
- A short "text Jules" line or address on exported images.
- Point the `/style` image at sign-up.
- The no-Gmail first card (see "Time to magic").

## Purchase history beyond Gmail

Younger shoppers buy on TikTok Shop, Shein, Depop, Vinted and Amazon, often with receipts scattered or missing from their inbox.

| Source | Status | Notes |
|---|---|---|
| Order-history screenshots in chat | Built (`lib/order-screenshots.js`); up to 6 screenshots read together | Good for a few recent orders, brittle for full history: list pages rarely show size, color or price, and detail pages need one screenshot per order |
| Shop app orders | Built, behind `SHOP_ORDERS_ENABLED` | Covers Shopify stores only |
| Gmail import | Built, invite-only | 100-user cap until verified; not part of the viral path |
| Receipt forwarding address | Backlog | Avoids the restricted Gmail scope; captures new purchases going forward |
| Store data exports (Amazon etc.) | Backlog | Slow and clunky |
| Forwarded listings | Natural byproduct | "Did you end up getting it?" turns a forward into purchase evidence |

## Open questions to test with current testers

- Do people hand off the search, or ask for options and browse themselves? (Decides how much "just handle it" vs. "forward it" to lead with.)
- Do testers forward listings unprompted?
- Do they share the style read?
- Do they come back within a week without a nudge?
- Who says yes to a Jules+ offer shown at a limit, and at what price?
- Which moment comes before people stick around: a find in their size for less, or an alert that fires?
