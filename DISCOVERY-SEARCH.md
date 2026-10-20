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

Fixes: sourcing now counts the time left in the whole turn (`turnLeft` from the inbox) and keeps 20 seconds for the reply. The stylist runs only with at least 25 seconds of room (timeout 12 seconds). The direction searches share one hard cap (at most 40 seconds); results finished by then are used and slow directions are left behind (`stylist_searches.timed_out`). After directions ran, the extra refinement, in-stock and replacement searches are skipped. Shop catalog results come after every direction’s results, so they only fill an empty slot. Vercel logs were not reachable, so the exact slow step in production is not established.

### Speed — October 19, 2026

Local runs skip the hosted browser (it only runs on Linux), which is why the same search took about 14 seconds locally and 64–90 in production: each store page that blocks a plain request launched and closed its own Chromium, and three parallel direction searches could launch up to nine. Now one browser is shared per function instance, each page check gets its own browser context (separate cookies), at most four pages render at once, and a stale browser from a frozen instance is replaced after 3 seconds. Discovery starts Chromium while the stylist thinks. Once the directions have three verified, unshown products, the rest get a 4-second grace instead of the full cap. Each result now records `timing` (stylist, directions, each direction, shop, rank, total) in `text_wishlist_diagnostics`. The shared-browser path could not be run locally (no Linux runtime); the first production searches confirm it.

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
