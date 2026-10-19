# Product-fact accuracy audit (price, stock, size, images)

October 19, 2026. This audit is read-only: no code changes and nothing sent to testers.

## What I measured

- **Data:** every product Jules showed or saved between Oct 6 and Oct 19. That is 123 logged search results (`messages.search_result`), 24 wishlist items and 9 price alerts across the 2 tester conversations. After removing duplicates, that's **64 distinct products**.
- **Live re-check (today):** I re-opened every verified listing with Jules' own page checker, and fetched the store's own product data for 26 Shopify stores, which lists every size and its stock.
- **Images:** I looked at all 23 stored wishlist photos one by one.
- **Caveats:** this is a small sample (2 testers, 2 weeks). My re-check ran on a Mac without the hosted browser, so 9 pages (SSENSE, Shopbop and some small stores) wouldn't re-open locally. I count those as "not re-checked", not as errors.

## Headline numbers

| Fact | What Jules showed | Wrong | Missing |
|---|---|---|---|
| **Price** | 29 of 64 products had a verified price | **0 made up.** All 32 dollar amounts Jules texted match a price read from the store page. 2 of 20 re-checked prices have changed since (10%, over 4–10 days) | **35 of 64 (55%)** had no price. 21 pages never opened; 14 opened but no usable price was read |
| **Stock** | 25 of 64 had a product-level "in stock" | 1 listing showed as available but is now sold out in the colour Jules saved (JMM Romi 88 Black) | 39 of 64 had unknown stock |
| **Your size in stock** | **0 of 64.** The search step never checks the user's size | Product-level "in stock" can be misleading: **16 of 26** Shopify listings had some sizes or colours sold out. Example: the Phipps base layer showed as "in stock" with 4 of 5 sizes sold out | 4 of 9 price alerts can't read size stock either (Lemaire, JMM, Vitkac, Dover Street Market), and SSENSE fails today |
| **Sale price** | The sale price was shown as a plain price | Not wrong, but 4 of 26 listings were discounted (Bluefly, Found, Snow Xue Gao, Rockstar) and Jules never said "on sale, was $X" | — |
| **Image** | 42 of 43 verified products had a store photo | **1 of 21** stored product photos is wrong: Mr Porter brown Dries trousers show a model in a green jacket. 3 multi-colour listings had no colour pinned, so the photo is whatever colour is the default | 1 verified product had no photo |
| **Store type** | — | 5 of 64 were resale or aggregator sites (Poshmark, an eBay *search page*, StockX, Lyst, Editorialist). A tester complained on Oct 12 ("all from poshmark") | — |

**The good news:** the rule against inventing commerce facts holds. Every price was read from a real page, and nothing was made up. The problem is **coverage, not fabrication.** Jules often has nothing to show, and "in stock" doesn't mean "in your size".

## Root causes, by how many products they affect

1. **Some pages never open: 21 of 64 products.** 6 of these come from Oct 6–7, before page checks existed. The rest are Mr Porter (bot wall, always `check_failed`) and SSENSE (HTTP 403; it only works when the hosted browser succeeds). Dover Street Market, Satisfy and mfpen were "unsupported" at the time; those have since been added. These are exactly the stores a taste-driven audience forwards.
2. **Price not usable on pages that did open: 14 of 43 verified.**
   - **6 are EU-currency stores** (Trevise, Le Lunetier, Checkmate, fivefourfive, Afura, Our Legacy). Jules reads €320, but Shopify reports the market as "US", so the "EU store, €320" label never appears and the price silently disappears. **This is a bug.**
   - **3 have different prices per size or colour** (Russell's, Stanfield's, Ekouaer). Jules shows nothing instead of the price in the user's size.
   - **4 don't state a currency in their product data** (lillap, Visionary Optics, Decjuba, Moojimooji). For the Shopify ones, the store's own product data has the price.
   - **1 is StockX** (resale, search-index only).
3. **No size-level stock in search.** The search check reads one "available" flag for the whole product. Size readers already exist for alerts (`lib/price-alerts.js` reads Shopify variants, the SSENSE size selector, Prada inventory and Satisfy SKUs), but search doesn't use them. This is the gap that most threatens the "in your size" promise.
4. **Sale context is thrown away.** Shopify's `compare_at_price` is never read. Jules can't say "on sale", which is both the viral hook and the "best price" claim.
5. **Photo is the page's first image.** We trust the page's first image without checking that it shows the product, or the right colour. This is where the lifestyle-shot error comes from, and the risk on multi-colour listings without a selected variant.
6. **Staleness.** Prices are checked live at search time, so they're fresh when sent. Saved prices drift, about 10% over a week here. The wishlist already says "Price checked <date>", and alerts re-check every 3 days. This is fine for now.
7. **Minor:** once, Jules repeated a price the user had pasted ($875, Mr Porter) as if it were known.

## Ranked fixes

| # | Fix | Effect | Cost / tradeoff |
|---|---|---|---|
| **1** | **Size-aware stock in every recommendation.** When the user's size for that category is known, run the existing alert size readers during the search page check and show "in your size", "sold out in your size" or "size stock unknown". | Covers the core viral promise. Also fixes the 3 per-size-price cases (show the price for your size). Products sold out in your size get ranked down or labelled. | One extra small fetch per product on Shopify stores (<1s). Reuses tested code; no new services. Unknown stays unknown. |
| 2 | **Recover usable prices.** (a) When the price currency isn't USD, show "€320 · EU store" through the existing `marketLabel`/`foreign_price`, and rank USD stores higher for the same product. (b) For Shopify pages without a currency, take the price from the store's product data plus its currency. | Roughly 8 of 14 missing prices on verified pages become visible, and none are converted or guessed. | Small; it's in `lib/listings.js`. |
| 3 | **Read Shopify sale prices** (`compare_at_price`) and show "on sale: $221, was $260". | Gives the viral "best price" moment. | Small; it comes from the same fetch as fix 1. |
| 4 | **Blocked flagship stores (Mr Porter, SSENSE).** Options: (a) fall back to Google Shopping's indexed price, clearly labelled "indexed price; stock unconfirmed" (this already exists, is rarely triggered, and uses SerpApi credits); (b) a paid page-rendering/unblocking API. | Fixes most of the 21 pages that never open. | (a) is cheap but lower trust. (b) adds a vendor and roughly $50–100/month. Recommend (a) first and measure. |
| 5 | **Photo check.** Prefer the selected variant's image, and skip lifestyle shots by using structured product images over og:image, or by one cheap vision check that the photo shows the named item and colour before saving. | Fixes the ~5% wrong-photo rate, which is a highly shareable failure. | A vision call costs about $0.001 per save and adds a little latency. |
| 6 | **Label resale and aggregator sites** ("resale · Poshmark"), and never link a marketplace *search* page. | Fixes the trust issue testers have already flagged. | Small. |

## Recommended first fix

**Fix 1 (size-aware stock), done together with fix 3 (sale price),** because both come from the same per-product fetch. "Finds it in your size" is the promise the wedge sells, and today Jules can't say it at search time at all. The code that reads sizes already works in production for alerts, so this extends tested code instead of adding infrastructure. Fix 2a (EU-currency price label) is a one-line-scale bug fix and could go in the same PR or the next one.

How to check it's working: re-run this audit's script on the next 2 weeks of searches. The goal is that most products with a known user size show "in your size" or "sold out in your size", "price missing" falls below 30% on verified pages, and there are still 0 made-up facts.
