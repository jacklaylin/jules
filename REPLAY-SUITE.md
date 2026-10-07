# Reply regression suite

Acceptance: asking about a shoe yields sourced, individually checked product-page links compatible with the profile, or a useful question about the specific model or variants. Missing prices or stock are not reasons to reject an otherwise valid product page. Generic refusals fail when a supported known product should be available.

## Before reporting a fix

1. Open `/replay.html` signed in as the owner.
2. Replay the latest reported turn with the expected brand/model, and download its private snapshot. The snapshot uses the current profile: it cannot reconstruct the profile at the time of an older failure. Keep these reports outside Git.
3. Run all eight synthetic cases, across Nike, ASICS, New Balance, Salomon, and Prada; include correction, explicit recipient, misspelling/spacing, ambiguous versions, and unknown models.
4. Run the affected case three times and repeat the suite after deployment. Each run reports pass/fail, reasons, returned reply, checked products, elapsed time, request count, and token usage. Dollar cost is explicitly unknown; billing may include search tool fees not inferable from tokens alone.
5. Report observed successes/failures. Passing unit tests or one unrelated live success is not evidence that a reported bug is fixed. Do not ask the founder to keep texting for sourcing validation.

The owner-only existing identification-test endpoint runs one case per request, bounded by the existing 120-second limit. The browser queues cases sequentially. Stop ends the queue after the current request. Runs use the deployment's actual conversation/search models and live providers. No new services, credentials, or database tables.

The runner calls the real reply dispatcher and text-wishlist state machine. Its record callbacks keep results only in memory. It does not call Photon, write memory, store a wishlist item, or enable an alert. This tests reply preparation, not inbound webhook handling or actual delivery. Those transport checks remain separate. Private snapshots preserve a reported turn, prior text context, current facts, and pending state and can be imported for repeat runs.

Automatic grading checks all emitted links against recorded verified listings, expected brand/model, category paths, and clothing range. A clarification must concern models/variants or identifying an unknown item. This is an explicit, inspectable heuristic; humans may still need to review subtle visual identity and subjective styling. A refusal, wrong range, unsupported link, or false completed-save claim never passes. Assertions do not promise inventory in a saved size when it is unverified.

## Less brittle page checks

- Product-bound structured data takes precedence over recommendation products elsewhere in the HTML. Ambiguous unbound multi-product pages still fail.
- ProductGroup data can establish a product when its page-bound size variants share one color. Size variants do not establish stock in the user's size, and differing colors remain ambiguous.
- Ignore retailer brand/department filler in title comparison; keep meaningful model/material words.
- Explicit product metadata with a matching canonical URL and product title can establish a product page without JSON-LD. Missing commerce facts stay unknown.
- Category pages, bot challenges, unsafe redirects, wrong products, and profile mismatches remain blocked.
- Retry sourcing after rejected category, inaccessible, or profile-incompatible candidates once; preserve diagnostics. Unknown products do not trigger endless searches.
- Checked page titles label color variants, and matching SKUs deduplicate locale aliases. Distinct versions prompt version selection rather than a color question.

Run deterministic tests with `npm test`. They include page layouts, mismatch rejection, source-gated replay grading, no-side-effect execution, and owner authorization. Live acceptance is reported separately.
