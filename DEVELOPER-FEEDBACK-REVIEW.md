# Developer feedback review — October 8, 2026

Reviewed all five saved reports with the surrounding conversation and persisted search diagnostics. Personal message IDs, phone numbers, photos and profile values remain outside this file.

## Findings and changes

- Selection acknowledgment: the historical reply restarted sourcing after a tentative two-color selection. Existing model-interpreted pending selection already supports subsets; it now sends a best-effort thumbs-up for understood interest/confirmation. Removed keyword-based progress reactions. Reactions follow structured actions, share the existing provider connection, and cannot duplicate on webhook retry. This acknowledgment does not claim saving or alert activation.
- Screenshot evidence: the visual path cropped the garment and relied only on Lens, losing readable product information outside the crop. Planning now captures product text from the full screenshot and model-interpreted exact/alternative scope. Retrieve by that text before Lens, independently verify product pages, and corroborate the result against the original screenshot. Failed recovery retains the visual fallback. Contradictions, invalid references, and unrequested alternatives remain rejected.
- Store dead ends: official SATISFY and mfpen sites were not supported by the page verifier. Added their official domains without permitting arbitrary hosts. SSENSE's HTTP 403 remains a failed check, not proof of absence or stock. A retrieved collection page remains ineligible. Empty direct-source recovery now continues the existing bounded refinement rather than returning early. Visual identity-only results attempt another merchant retrieval when screenshot text has not already been tried.
- Source transparency: identity-only replies name the reason verification failed, label source links as identification evidence with unverified price/stock, and offer another color or similar item. They no longer say “no store I can recommend” or require a new photo by default. No purchase, save or monitoring state is fabricated.

## Validation

234 deterministic tests pass. Coverage includes varied subset language, no repeated product list, scoped consent, structured reactions and provider cleanup, screenshot-first retrieval, fallback and alternate-merchant recovery, contradictory/missing evidence, unsupported references, exact-versus-similar scope and safe product-page checks.

Read-only live checks using the actual page verifier successfully verified the mfpen Scout Deck Shoe and SATISFY MothTech Waffle Long Tee product pages. The pages did not establish a clothing department; that remains unknown and profile eligibility checks remain intact. These checks do not establish size-specific availability, universal search accuracy, or a qualifying price alert.

Deployment and repeated live-model replay results are recorded below after completion. Phone tapback receipt and the original private screenshot still require separate end-to-end acceptance; unit tests are not proof of those outcomes. No schema change is required.

### First deployed replay cycle

Commit `44af81e` deployed successfully. Three tentative-subset replays passed: they preserved both chosen variants, advanced to a scoped wishlist/reminder offer, and repeated no links. Three SATISFY runs returned verified official product pages but failed the replay gate because replies also included unverified identification-source links. Three mfpen runs failed: retrieval selected unsupported retailer domains, despite an independently verified official product page.

These failed runs prompted further changes: show verified shopping options first and keep failed checks separate; offer alternatives when all checked options are sold out; use the same transparent failure response in text-wishlist sourcing; scope direct recovery to the identified brand's registered official domain; and follow at most three matching same-origin product links from each of at most two retrieved supported collection pages. All resulting product links still require verification. Do not construct product slugs or accept unsupported domains. This is bounded recovery for a retrieved page, not a catalog crawler.

The updated deterministic suite passes 237 tests. The original failed replay cycle is retained in the private report; final replay results follow separately.

## October 9 follow-up: supplied links, market and stalled search

Reviewed the two DM comments visible in the founder's signed-in simulator: the Satisfy link being described as unverified before reading it, and its price being saved in CAD. Also addressed the supplied iMessage example where acceptance of similar Lemaire/Jacques Marie Mage options produced a promise rather than executing sourcing. The separate admin feedback inbox was not signed in; this review does not establish that every newly saved report has been read.

- Read a newly supplied product URL before intent interpretation and carry its sourced identity/price into the model's context. Failed optional retrieval preserves the reference; save consent is still interpreted by the model. Complete direct retailer evidence can skip slower index recovery in this path.
- Use the confirmed US storefront cookie for market-neutral Satisfy requests, including product and size/alert reads and hosted browser recovery. Explicit locale/currency/market URLs remain intact. No currency conversion or relabeling is performed. A real public-page check returned TheROCKER, two images and USD 290. Other retailers still need individually verified market integrations.
- Require a supported tool outcome in search-enabled image/general conversation turns, with a separate natural conversation tool. Instruct both intent paths to execute accepted sourcing and brand-clue continuations immediately. Regression fixtures prove execution/failed-provider reporting rather than an unexecuted promise; a real model-and-phone replay remains necessary to assess semantic accuracy.

Wishlist rich previews ship separately and reuse existing product JPEGs. Product metadata is signed, private source photos are excluded, and opening a preview still requires the normal wishlist account session. Apple rendering/phone receipt has not been established by mocked provider tests.
