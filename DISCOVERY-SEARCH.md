# Vague product discovery — October 10, 2026

Founder-authorized scope: adaptive clarification, taste-based ranking, a few verified results, and conversational acceptance/rejection/refinement.

Implemented a model-interpreted search plan (identify vs discover), a persisted clarification brief, request-scoped guidance, referenced exclusions across batches, and explicit topic/recipient resets. Requests without enough identifying detail may ask one or two useful questions. Exploration can proceed with a diverse first set instead of blocking on exhaustive constraints. Discovery skips exact-model color expansion and presents at most three distinct verified candidates with an invitation for feedback. Plausible identification candidates are not labeled an exact identification.

Personal taste and receipt/store evidence are soft ranking signals. A separate bounded model call can only permute verified candidates; it cannot invent facts or remove unfamiliar products. Invalid or unavailable ranking retains the verified order. Current explicit constraints belong in the search plan; historical budgets and favorite brands/stores do not become hard filters. Existing department, ownership, evidence and consent checks remain in force. This does not implement a separate per-merchant availability optimizer.

Selections preserve the brief and do not save or activate monitoring without consent. Model-interpreted feedback starts a refined query and excludes referenced rejected/seen products; failures preserve a retry brief without resurrecting old options. Temporary feedback is search state, not a new durable taste fact. Existing taste-learning logic remains separate.

Validation covers clarification dispatch without sourcing, unfamiliar-brand retention, three-result ranking, sequential rejection/more batches, new-topic exclusion reset, invalid references, failed-research retry state, ranking permutations/provider failure, and subset acceptance without saves/alerts. The full release suite passes 371 tests; the focused workspace conversation suite also passes. Added retained-subset plus new-options coverage, and a guard against returning excluded/unverified products when a discovery batch is exhausted. Production deployment has been verified; live-model/browser replay is not established: browser control timed out twice, and no local model credential was available for direct execution. These tests validate state/action safeguards, not actual model interpretation quality, source completeness, or taste accuracy.

## First founder replay and DM review

The Saint Laurent/Connor Storrie jacket report exposed a category-specific rejection template (hard-coded shoes), unknown-department rejection, and live planning errors: identify requests became discovery and unrelated saved shoe sizes polluted the brief. The planner now distinguishes particular seen items, gathers useful details, preserves category/corrected public names, and separates profile facts from the active query. Missing department remains uncertainty for planned search candidates; known mismatches still fail eligibility. Identification wording no longer assumes a pair or claims an exact identity.

Live simulator replay after 6c88a69: the first request used clarify_search in 2.8 seconds; the detail reply used identify mode with the corrected actor and jacket description, without shoe sizes. Retailer-page checks still failed (51.6 seconds); this was not a successful identification.

The newest DM report concerned Jacques Marie Mage Romi sunglasses. The deployed default still imposed official/preferred domain filters despite the founder's priority-only requirement. d8da89a changes default searches to the wider web immediately, retains the curated registry in source-preference instructions, accepts verified unlisted sources, and adds a bounded alternate-page retry. Direct indexed recovery can run for an empty wider-web batch. Planned identification avoids spending time expanding variants of an uncertain candidate. Tentative recollections belong in guidance rather than hard requirements.

Release tests: 378 passed, including unlisted-store retrieval without domain filters and jacket state/action safeguards. Live outcome of the wider-web fix is recorded below after deployment. Model mocks establish plumbing and safeguards, not interpretation quality or source completeness.

The wider-web jacket replay retained the correct category and completed in 26.3 seconds (initial clarification: 2.4 seconds), but the candidate retailer checks still failed; the exact jacket has not been established. The Romi replay returned retrieved unlisted stores in 15.8 seconds, then rejected their structured ProductGroup data. A read-only public-page inspection confirmed the canonical Romi page and two published color variants. a8bf5c2 recognizes a canonical multi-color group as product identity while leaving selected color and group-level offers unset; variant-specific offers remain separately attached to the group. All 379 tests pass, including unsupported variant isolation and original saved-link recovery.

7ca23d3 additionally reads exact same-origin color links from the published ProductGroup before optional secondary retrieval. The actual retrieved Romi HTML fixture now yields verified identity, two images, and the published `6D Agar Yellow` / `88 Black Black/gs-4a` colors. A base-page price remains unknown until a specific variant offer is checked. Cross-origin variant links and an unlisted selected variant are rejected.

Final live Romi replay after 7ca23d3: 11.4 seconds, state advanced to choice, verified retailer HTTP evidence for Romi Gold Dust from Mondello1962, USD 853 snapshot and two sourced product images. Collection recovery followed the retrieved collection's actual product link rather than constructing a URL. This unlisted retailer remains labeled unreviewed in diagnostics; product-page verification does not certify merchant reputation. No save, alert activation or phone message occurred. The exact Connor Storrie jacket remains unresolved, and these replays do not establish consistent tester readiness.

## Stylist directions — October 18, 2026

Founder review of a tester conversation: she described her taste in detail (Kate Moss at a festival, The Row, Cou Cou Intimates, Emily Dawn Long airbrush tops, vintage Diesel, a tall frame, nights out) and Jules returned dropship storefronts (CurveComfy, Rockstar Original) and generic blouses. The cause: a single adjective-heavy search phrase ("women's black structured going out tops… edgy luxe") matches keyword-stuffed store pages, and her words never reached sourcing.

Discovery now starts with a stylist step (`lib/stylist.js`, `STYLIST_MODEL`, default gpt-5.5, low reasoning). It reads the active brief, the search plan, saved taste facts and the shopper's last dozen messages, and names up to three distinct directions, each with a concrete query and real designers known for that kind of piece; a resale direction is included when the shopper mentions vintage, archive pieces or secondhand. Each direction runs its own web search in parallel; results go through the same listing checks, eligibility, exclusions and taste ranking as before, and the shown set takes one option per direction before a second from any. The reply names the directions searched but does not label each option with one, because finding a product under a direction is not evidence that it fits it. Named designers are inspiration, never filters. If the stylist is off (`STYLIST_ENABLED=false`), fails, or the request is identification, the single search runs unchanged. Directions are recorded in `text_wishlist_diagnostics.stylist_concepts`.

Also: the search step discarded an entire search when the model returned more than three products. It now keeps the first three valid ones.

Live replay of her "structured and luxe" request (local code, real search, no message sent): before, Farinaz Taghavi and Frank Lyman blouses and a $48 SEO-titled corset; after (14 seconds, all three directions succeeded): a L'agence structured corset, a $75 top from an independent label (shop-matte.com), and a KNWLS corset top from knwls.com. The KNWLS price ($618) is above her stated $400–500 range because budget is a soft signal. This is one replay, not a measure of taste quality; a taste evaluation set is a later step.

### Time cap and Shop catalog order — October 19, 2026

First production test (founder, base-layer tops): the first search took 73 seconds, and the follow-up search ran past the 105-second turn deadline, so the founder got the fallback "couldn’t prepare a reply". The same requests take about 14 seconds locally. The third option, a basic Stanfield’s top, came from the Shop catalog, not a stylist direction: the interleave gave the Shop list a turn alongside the directions.

Fixes: sourcing now counts the time left in the whole turn (`turnLeft` from the inbox) and keeps 20 seconds for the reply. The stylist runs only with at least 25 seconds of room (timeout 12 seconds; 20 seconds from October 20). The direction searches share one hard cap (at most 40 seconds); results finished by then are used and slow directions are left behind (`stylist_searches.timed_out`). After directions ran, the extra refinement, in-stock and replacement searches are skipped. Shop catalog results come after every direction’s results, so they only fill an empty slot. Vercel logs were not reachable, so the exact slow step in production is not established.

### Speed — October 19, 2026

Local runs skip the hosted browser (it only runs on Linux), which is why the same search took about 14 seconds locally and 64–90 in production: each store page that blocks a plain request launched and closed its own Chromium, and three parallel direction searches could launch up to nine. Now one browser is shared per function instance, each page check gets its own browser context (separate cookies), at most four pages render at once, and a stale browser from a frozen instance is replaced after 3 seconds. Discovery starts Chromium while the stylist thinks. Once the directions have three verified, unshown products, the rest get a 4-second grace instead of the full cap. Each result now records `timing` (stylist, directions, each direction, shop, rank, total) in `text_wishlist_diagnostics`. The shared-browser path could not be run locally (no Linux runtime); the first production searches confirm it.

## Price stance — October 19, 2026

Tester feedback: Jules didn't understand what she was willing to pay, and showed cheap fast fashion. On October 17 she said "My budget for special pieces is up to 400-500, but I always prefer something cheaper. I like nice things." Memory saved this as budget key `special/currency`, value `400-500`. The currency was missing, and both "prefer cheaper" and "nice things" were dropped. Nothing read the saved budget unless she repeated it. So the next searches showed a $12.99 Rockstar Original tee and a $48 SEO-titled corset, and on October 19 The Row at $720 with no note that it was over her budget.

What changed:

- **Memory** (`lib/memory.js`). A budget is keyed `scope/currency`. The scope uses her own terms: a category, special pieces, everyday or general. The currency is an ISO code or `unknown`, meaning her market's currency. The value must be `MIN-MAX` in plain numbers. MIN stays empty unless she names a lower bound, so "up to 400-500" becomes `-500`. A new `spending` field holds the keys `prefers_lower` and `quality`, with her own words as the value. Code checks only the format. Gift budgets and one-request limits are excluded by the model instructions. Each fact keeps its quote as evidence. Budgets saved before this change have no `format: 'range'` mark; they keep their ceiling and drop the lower number, so her old `400-500` reads as up to $500 USD.
- **Search plan** (`lib/text-wishlist.js`). The agent's plan has a new `price` field. It holds either a limit stated for this request, or `budget_key`, which names the saved budget that fits the item, for example special pieces rather than everyday. Code checks that the key exists. When the key is missing or wrong, the only saved budget applies; with several, the widest ceiling applies. A request for someone else uses only the price stated for it, never her stance.
- **Band** (`lib/price-stance.js`). The band covers discovery only; an item she's trying to identify is never hidden for its price. A verified price above the ceiling never takes a slot an in-budget option could fill. With room left, at most one over-budget option is shown last, labelled "over your $500 budget", and the reply says how many were left out. A price far below the band is a soft negative, not a filter: below half a stated floor, or, when she wants quality pieces, below a tenth of the ceiling. Those options go after the others. With `prefers_lower`, cheaper in-budget options are picked first. Prices in another currency are never converted or judged. The stylist and the ranker both receive the band. Each candidate's price fit is an input to the ranker, and the band outranks receipt spend (her Zara $30–70 history).
- **Price on every option.** Each discovery option shows its verified price, or "price not confirmed, check the store page". Unknown stays unknown.

Diagnostics: `text_wishlist_diagnostics.price_band`, `over_budget` and `price_fit`.

### Replay of "mix in some minimal luxe"

This ran local code with real model and search calls. No message was sent and nothing was saved. The profile was synthetic, built from the evidence above (her budget statement, The Row and Kate Moss references, size 8 tops, Zara receipts), not read from her stored profile. Before is main at 32da9e1 with her legacy budget fact. After is this branch with the fact as the new memory would save it: `special pieces/unknown = -500` plus `prefers_lower` and `quality`.

1. **Real configuration (exact Google pre-search on): unusable both before and after.** Before and after both returned the same Urban Outfitters and Fashion Nova category pages and an InStyle article as "options", all without prices. The cause is not budget handling. `searchProducts` runs the whole discovery brief as an exact Google query (`lib/search.js`). The category pages pass verification as likely matches, answer the search and cancel the stylist's direction searches. After now shows "price not confirmed" on each instead of nothing. This needs its own fix.
2. **Exact pre-search off, run A.** Before (17 s): two unverified links, COS and a Vince top at Mytheresa, with no prices. After (14 s): Anine Bing Blanca top $180, SRG Atelier Rhea top $300, and a Born to Glam mesh top $59, all in band. A Toteme top over $500 was left out, and the reply said so.
3. **Exact pre-search off, run B.** Before (17 s): Nili Lotan silk cami $320, Tibi top $149 (on sale, was $495). After (23 s): Mist Paris sheer top $166, Heike-NY silk top $395, and an ARRANGE top at ASOS whose price the page didn't show, labelled "price not confirmed".

Run-to-run variance from the stylist is large, so these replays show that the price rules apply, not that taste improved. In run A, the ranker put the $59 option last rather than first. Within the band, order is the ranker's call: `prefers_lower` decides which options are picked and is an input to the ranker, but it doesn't override the ranker's order. Far-below and over-budget options are always placed last.

## Category pages as options — October 19, 2026

Found while replaying "women's going-out tops, mix in some minimal luxe" for the price-stance work (PR #219, "Price stance" section). Every stylist direction returned the same three "options", all without prices: Urban Outfitters' and Fashion Nova's going-out-tops category pages and an InStyle article.

Two causes:

1. **The exact pre-search ran inside every stylist direction.** `searchProducts` types the shopper's whole brief into Google first (`lib/search.js`). The directions all share that brief (`search_brief`), so all three got the same Google results. A verified likely match answers the search and cancels the model search, so the direction's own concept was never searched.
2. **A blocked page's search title stood in for a product.** The page checks (`verifyListing`) were not what let them through. Readable category pages (Abercrombie, Express, Nordstrom) were already rejected as `not_product`. But Urban Outfitters, Fashion Nova and InStyle block our reader (`check_failed`), and `exactSearch` then used the Google result's title as the listing (`verification_basis: search_index`). A category page's title, such as "Women's Going Out Tops | Urban Outfitters", reads like a perfect match for a descriptive brief.

What changed:

- **Directions skip the exact pre-search** (`lib/text-wishlist.js` passes `exact:false`; `lib/search.js` honours it). The single discovery search (stylist off, failed or out of time) keeps it, so a named model read as discovery is still found first, as PR #45 intended.
- **The identity judge sorts out pages that are not one product** (`lib/text-sources.js`). It has a new `not_a_product` verdict for category, collection, search, brand-landing and editorial pages, judged before relevance. These are set aside with reason `not_a_product`.
- **Collection URLs are category pages** (`lib/listings.js`). `/collections/<name>` is rejected as `category_page` without being fetched; `/collections/<name>/products/<item>` is still checked. In `exactSearch`, a blocked collection-format URL is never stood in by its title, unless the row has an indexed price, which means it is a single offer. It is not kept as an unread candidate either.
- **A title-only stand-in can't answer.** A search-index listing with no price can't end the exact pass and cancel the model search. It can still be combined with the model search's results if the judge accepts it.

### Replay

The OpenAI key in `.env.local` has run out of credits (`credit_balance_exhausted`), so the full discovery replay (stylist, judge, model search) could not run: before and after both ended in the search-failed reply after about 11 seconds. Instead, the exact pre-search ran with the real brief, real Google and Google Shopping results (cached, so both versions saw the same 7 rows; 2 SerpAPI searches) and real store page checks. The judge was replaced by a stub that accepts every listing, which shows exactly which pages reach the judge as "verified". No message was sent and nothing was saved.

| Page | Before (main) | After |
|---|---|---|
| abercrombie.com/shop/us/womens-going-out-tops-tops | not_product | not_product |
| express.com/…/going-out-tops/cat2140011 | not_product | not_product |
| nordstrom.com/browse/women/…/night-out | not_product | not_product |
| fashionnova.com/collections/going-out-tops | blocked → title stand-in, verified | not_product (category_page) |
| urbanoutfitters.com/womens-going-out-tops | blocked → title stand-in, verified, likely match, no price | still reaches the judge; can no longer answer the search |
| instyle.com/best-going-out-tops-11872192 | blocked → title stand-in, verified, likely match, no price | still reaches the judge; can no longer answer the search |

With the real judge (run once the OpenAI key was funded, same cached Google results): on main it accepted Urban Outfitters and InStyle as likely matches; on this branch it marked both `not_a_product`, so the exact pass returned no options at all.

### Live replay — October 19, 2026

Full discovery flow: real stylist, model search, Google and store checks; synthetic profile (budget up to $500 for special pieces, minimal/The Row taste, size 8 tops, Zara receipts); no message sent and nothing saved. Before is main at 417e969; after is this branch. The stylist's directions differ run to run, so the two runs show what reaches the shopper, not taste quality.

- **Before (10 s).** Directions: silk camisole, asymmetric jersey, minimal satin halter. All three options came from the first direction's exact pre-search: the Urban Outfitters and Fashion Nova going-out-tops category pages and the InStyle "28 Cool-Girl Going-Out Tops" article, none with a price. The other two directions never searched their own concepts.
- **After (13 s).** Directions: minimal satin halter, draped one-shoulder, Kate Moss sheer camisoles. One product per direction, each from that direction's own search: Rebecca Vallance Elise halterneck silk satin top at Mytheresa (price not confirmed: the store blocks our reader and Google showed no price), Nili Lotan Isabella silk cami $320, A.L.C. Celeste top at Elyse Walker $395. No category pages or articles.

### Silent stylist fallback — October 20, 2026

Founder test "find me a few casual shirts": two generic shirts from unreviewed Shopify stores (BYLT Basics, UNTUCKit). Cause: the stylist never ran. Model roles (#234) had moved it onto the shared long-form `write` model; production switched that to gpt-6-luna, which takes 8–16 s on a real stylist input against a 12 s cut-off. The timed-out call returned no directions, unbilled and unlogged in the turn record, so the turn ran one generic search, and Shop's catalog, searched with the bare request and no taste, filled the set. The closet summary was present but reached the stylist cut to 600 characters, and grouped activewear under tops.

Fixes:
- The stylist has its own model role (`MODEL_STYLIST`, legacy `STYLIST_MODEL`, default gpt-5.5, low reasoning; `lib/models.js`). Changing the write model no longer changes it. Its cut-off is the smaller of 20 s and the sourcing time left beyond what the directions need.
- Every stylist outcome (ok, off, no_time, timeout, http_<status>, incomplete, invalid, with model and ms) is kept in `text_wishlist_diagnostics.stylist` and logged as `stylist_fallback` when it isn't ok.
- Shop's catalog searches each stylist direction for discovery and is skipped for a discovery without directions; named and pictured items still search it with the request.
- The closet summary reaches the stylist whole as its own `closet` field, grouped by item type (shirts, tops, knitwear, activewear…), without the silhouette line.

Offline replays of the same request with the stylist working all returned designer shirts on-brand for the founder (Dries Van Noten, Saint Laurent, Lemaire, Auralee); see the PR for the after-fix replays.

### Wrong-department listings — October 20, 2026

After Shop's catalog began searching the stylist's directions (#253), an offline replay of the founder's men's "find me a few casual shirts" showed MAYE's Sadie Embroidered Shirt, from a women's label. Cause: a search with a plan sets `allow_unknown_range`, so a listing whose page states no department passes the department check, and most Shopify pages state none. MAYE's own product data (type `SHIRT`, merchandising tags) has no department either; its description does ("feminine detail", "best with nude bra").

Fix:
- A Shopify store's product type and tags are now structured department data (`shopifyRange` in `lib/structured-product.js`), used when the page's other data says nothing. Mixed labels say nothing.
- For a men's or women's search with a plan, each verified listing that still has no department gets one batched model read of its own text (`lib/department-read.js`: name, brand, store, type, tags, description, size labels; never the user's message). An answer must quote that listing's text; a quote that isn't there counts as unknown. A listing whose text says the other department is set aside (`range_contradicted`) before slots are filled; unisex, unclear and unlabelled listings stay. Brand knowledge from elsewhere and a model's height or measurements are not evidence. A failed or unavailable read keeps today's behaviour.

Offline replays (founder profile, real stylist, search, Shop catalog and page checks; nothing sent or saved): three runs on this branch showed no women's items; the read set aside a Studio Nicholson shirt at namu-shop tagged "woman" and, in another run, two listings read as women's. The actual MAYE page is set aside for a men's search and kept for a women's one.

### Founder retry after #258 — October 20, 2026

The founder's "casual shirts… ideally a cropped fit" returned Lee's men's-work-shirts category page, then Karen Millen (women's) and Cotton On. Three causes:
- **Stylist off by a typo.** `MODEL_STYLIST` was saved in Vercel as `gpt-5.5,`; OpenAI answered 404 and every discovery ran one taste-free search. The founder fixed the setting. `modelFor` now skips a setting that isn't a model id (logged as `model_setting_ignored`) and uses the next setting or the default.
- **Category page from the Google pre-search.** Lee's page refused our reader, and its search-result title stood in as a product. In discovery, a page we can't read now needs the index's single price to count as one product; identification keeps title-only recovery.
- **Department read too cautious.** Karen Millen styles its shirt "with a sleek pencil skirt", which the read called unknown, and dāl's women's sizes (2–10) never reached it because Shopify's size list is dropped when no colour is picked. The read now counts garments only women's ranges make, receives the store's own size labels, quotes before it answers, runs one listing per call (a batch of ten was judged unevenly) at temperature 0, and doesn't count a model's height or measurements. Over three runs on eleven real pages it set aside Karen Millen, MAYE and dāl every time, and no men's or unlabelled page.

Replays of the cropped-shirts request with the stylist working (nothing sent or saved): Todd Snyder, Lucky Brand men's, Studio Nicholson; then Kith, Drake's, mnml. No women's items or category pages.

### Two options and a Kiribati link — October 20, 2026

With the stylist working again, the founder's retry returned Dries Van Noten and MAN-TLE, only two options, and the Dries link was its Kiribati storefront (`/en-ki/`).
- **Missing third option.** Only the three options to be shown reached the taste ranker, so one it set aside (it may reject a contradiction to the request, such as a tee for a shirt) left an empty slot while verified candidates went unused. The ranker now sees up to six eligible candidates; the shown three are the best-ranked from each stylist direction, then the next best (`spreadPick`), with a link the user sent first. `text_wishlist_diagnostics.rank` records how many were considered and kept.
- **Kiribati link.** Store markets were read only for 34 listed countries, so `KI` counted as no market and the page's own US version (hreflang `en-US`) was never checked. Any ISO country a page declares now counts (a bare `/xx/` URL segment still needs the common list). The US page was $695; the founder was shown the Kiribati $670. The page's chosen variant now carries over to the US version.

Replays of the cropped-shirts request (nothing sent or saved): three men's options each time (mnml, SONDÉR, mnml; Everlane, 3sixteen, mnml), with the ranker considering six.
