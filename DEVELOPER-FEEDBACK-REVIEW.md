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

### Collection recovery and image-failure diagnosis

The second deployed mfpen cycle still failed all three runs: the direct search returned zero eligible products, and refinement returned unsupported domains or an SSENSE page blocked with HTTP 403. Recovery now follows matching product links directly from a retrieved supported collection, independently of the search provider. It preserves failed checks across refinement for diagnosis. Links are bounded, same-origin, and require matching product and brand evidence plus the existing eligibility checks.

The fourth feedback report was a separate attachment-download failure: the incoming image was marked failed and no bytes were saved. Historical Vercel runtime logs are no longer available under the current plan, so the original failure cause cannot be established. Added bounded diagnostic codes for missing attachments, unsupported types, file-size limits, download timeouts, empty/invalid bytes and HEIC conversion failures. Provider error messages and private bytes are excluded from logs. This improves diagnosis; it is not evidence that the original attachment issue is resolved.

Commit `9a76c1b` deployed Ready to the existing production domain. The deterministic suite passes 239 tests. No database changes were needed for these fixes.

### Final deployed results

Commit `7f63718` deployed Ready to `jules-gamma.vercel.app`. Three mfpen runs passed and three SATISFY runs passed on this final release. The mfpen recovery includes retrieved official collection sources even when the formatter omitted them from the candidate list. SATISFY replies returned verified product links, displayed page-level sold-out status and offered another color or similar product. The earlier tentative-subset cycle passed three of three; later source recovery does not change that selection path. All 240 automated tests pass.

Private reports retain the earlier failed cycles and the final six successful sourcing runs. A browser replay stalled during an intermediate SATISFY cycle; its completed first result was preserved before reloading. Do not count that incomplete cycle as three successful runs. The report containing final tests also includes one prior mfpen failure, so its overall eight-of-nine score differs from the final release's six-of-six result.

Remaining acceptance limits: these sourcing replays have no saved department facts and do not establish size-specific availability; unknown department remains unknown. Phone delivery of tapbacks and the original screenshot route have not been verified end to end. The historical failed attachment has no recoverable bytes or retained runtime error, and is not marked resolved. No claim of universal sourcing reliability or completed tester readiness is made.

## October 9 follow-up: supplied links, market and stalled search

Reviewed the two DM comments visible in the founder's signed-in simulator: the Satisfy link being described as unverified before reading it, and its price being saved in CAD. Also addressed the supplied iMessage example where acceptance of similar Lemaire/Jacques Marie Mage options produced a promise rather than executing sourcing. The separate admin feedback inbox was not signed in; this review does not establish that every newly saved report has been read.

- Read a newly supplied product URL before intent interpretation and carry its sourced identity/price into the model's context. Failed optional retrieval preserves the reference; save consent is still interpreted by the model. Complete direct retailer evidence can skip slower index recovery in this path.
- Use the confirmed US storefront cookie for market-neutral Satisfy requests, including product and size/alert reads and hosted browser recovery. Explicit locale/currency/market URLs remain intact. No currency conversion or relabeling is performed. A real public-page check returned TheROCKER, two images and USD 290. Other retailers still need individually verified market integrations.
- Require a supported tool outcome in search-enabled image/general conversation turns, with a separate natural conversation tool. Instruct both intent paths to execute accepted sourcing and brand-clue continuations immediately. Regression fixtures prove execution/failed-provider reporting rather than an unexecuted promise; a real model-and-phone replay remains necessary to assess semantic accuracy.

Wishlist rich previews ship separately and reuse existing product JPEGs. Product metadata is signed, private source photos are excluded, and opening a preview still requires the normal wishlist account session. Apple rendering/phone receipt has not been established by mocked provider tests.

## October 9: complete saved inbox review

Owner access now reuses the existing companion-app session while retaining server-side owner authorization. Read all eight saved reports and the surrounding conversations; three new reports concern variant research, redundant alert consent, and a stalled initial price/size check. The earlier statement that the admin inbox was not read describes the previous review only.

- Research actual variants during sourcing, expanding retailer-provided variant data first and using one bounded additional search for a single candidate when needed and time permits. Keep only independently verified pages for the same model. Present known variants and prices, match singular/plural to the actual set, and avoid a mandatory color question or asking the user to choose between one item. A failed supplemental lookup preserves the verified primary result without inventing more variants.
- Interpret an explicit monitoring request as permission to save its associated product and enable its alert. Invalid `answer_to_offer` classifications are sent back to the model with the original message and state for one correction; code still rejects unscoped consent. No phrase routing or blanket conversion of acknowledgments into permission.
- Pass product names and market context into size inspection. Read Satisfy's retailer-published per-SKU size labels and prices from ProductGroup data; read SSENSE's explicit native-size selector. Recover blocked size pages through the existing hosted browser and retain selectors in its output. Do not convert sizes or conflate different SKUs: the checked Satisfy page places EU 45 and US men's 12 on different variants.
- Repair empty baselines for already-enabled, owned alerts on a wishlist visit, with a five-minute retry cooldown and revision checks. This does not send a notification, create a new alert or change its consent. The scheduled checker remains the independent retry path. Confirmation describes any remaining unverified starting price honestly rather than pretending background work is still underway.

Read-only live inspection found the Lemaire SSENSE listing at USD 695 with native IT 39 sold out and IT 40–46 selectable. The Satisfy US page exposes USD 290 and per-variant inventory. These observations validate the integrations' source formats, not universal availability or future prices. Product-rich wishlist cards are now visible in the founder's actual Messages conversation; no test phone message was sent for this review.

Validation: the deterministic suite includes original-message intent repair, bounded rejection, exact-model variant filtering, market/currency filtering, selected-SKU isolation, sold-out variants, rendered-page identity checks, and owned baseline recovery without notifications. Deployment and live replay results follow after release verification.

### Live replay corrections

The first deployed wishlist visit established the existing Satisfy alert baseline successfully. A simulator replay exposed two additional defects: sourcing language was incorrectly classified as interest in an existing saved item, and monitoring that item tried to import it again and failed. Strengthened model action priority and size-label preservation, and reuse owned saved groups for alert activation without a new save/photo retrieval. Added regressions for owned group validation and no new save requirement. Legacy alerts with an unqualified numeric size can use one bounded model check to bind the sole identical retailer size code; explicit systems and ambiguous labels are never converted, and the sourced mapping is retained for future checks.

The final Satisfy monitoring replay succeeded: the response confirmed reminders immediately, without a new save or consent question. The subsequent Lemaire variant replay timed out before returning a turn. This exposed a deadline gap in browser recovery. All recursive source passes now share one deadline, hosted browser recovery receives its remaining budget and closes on abort, and text-wishlist sourcing uses a 60-second primary budget with at most 20 seconds of supplemental research. The Lemaire baseline remained pending in the live wishlist check; parser tests and an accessible personal-browser page are not proof of hosted recovery success.

### October 10: production database and saved-item routing

The failing Lemaire replay also encountered PostgreSQL statement timeout 57014 while reading wishlist encounter metadata. Browser deadline tests alone did not identify that failure. The metadata query repeatedly unpacked inline photo JSON to project individual fields. Migration 015 now returns product metadata once while excluding large image and retrieval payloads. The founder explicitly approved applying this production view and its permissions; the SQL editor confirmed success. Read-only privilege checks returned anonymous=false, browser/authenticated=false, existing server=true.

The live wishlist loaded all nine existing items after migration. The existing Lemaire alert recovered its starting-price baseline automatically (`baseline_pending=false`), as did Satisfy earlier. No additional alert activation or phone notification was performed during this recovery. The preparatory unused summary function remains installed but is not called by the app.

The next variant replay returned in 3.2 seconds but incorrectly answered from wishlist contents rather than researching retailer variants. This is not a successful sourcing replay. Restricted the model's wishlist-status action to persistence/list-content questions and clarified action schema and final instructions: retailer research must execute sourcing even when the product is already saved. This uses model interpretation, not phrase matching. The complete deterministic suite passes 361 tests. Final live sourcing results follow after deployment verification.

The corrected live replay executed `start` and returned a verified official Lemaire Flat Piped Slippers listing in 46.7 seconds, without a repeated search-permission question or database error. It found one verified version, not a complete catalog. Inspection of the retailer HTML established an explicit Black / Dark Chocolate swatch that the existing Shopify color reader missed because colors are separate product links rather than size variants. Added a bounded, same-origin Lemaire swatch reader, retaining market context and excluding unrelated/cross-origin links; checks still verify each linked product. Supplementary variant research remains possible when only one version is known. The actual page fixture yielded its one published swatch. All 362 deterministic tests pass. Broader variant completeness and search latency remain quality work; these results do not establish universal success or tester readiness.

## October 13: brand constraint, sold-out listing and result wording

Three reports from one tester conversation. Findings:

- **Requested brand not enforced (trust).** A category requested from a named brand ran as open discovery, whose query told sourcing that new brands were welcome; no code checked results against the brand. A follow-up asking for other options returned other brands. Fix: a model-filled `required_brands` search-plan field, checked in code against the retailer page's own brand in every sourcing path; when nothing from the brand verifies, Jules offers to widen rather than substituting.
- **Sold-out listing offered (trust).** Page verification correctly read the listing as out of stock in every size, but the text-wishlist path built its own product list and ignored availability. This recurs the October 9 duplication class (fixed for failures, not stock). Fix: one shared sold-out check used by every product list; sold-out items are filtered when any available option verifies, and an all-sold-out result says so and offers alternatives. A listing counts as sold out only when every offer reports an unavailable state.
- **Plural wording with one result (degraded).** Discovery and identify headings were fixed text chosen before ranking. Fix: wording follows the final set; same for search results and clarification candidates.
- **Undiagnosable from data (observability).** Successful replies recorded no products, and the search plan was absent from triage packets. Fix: replies record shown products with brand and availability, the plan, and brand/sold-out rejections; triage keeps the plan. The redactor no longer masks ISO dates as phone numbers.
- **Open, eval-only:** a product request answered with the Gmail onboarding link, and a promised search that did not run. Eval cases added; investigate if they fail live.

Evals added: brand-category, brand-other-options, brand-more-from-them, brand-widen, brand-as-taste, search-while-onboarding-offered, retry-after-empty-search.

Triage cursor: 2026-10-13T04:08:40.91548+00:00

## October 13 (later): out-of-scope fallback, hidden partial results and supplied links

Two new reports from the same tester conversation as the earlier October 13 batch. Findings:

- **Off-request item presented as the found item (trust).** When a brand search in identify mode verified nothing eligible, the text-wishlist fallback handed the raw search result to the generic formatter, which applies none of the request's scope rules. A verified "similar" extra outside the requested item was shown under a heading that claimed a found option. Same duplication class as the October 9 and earlier October 13 fixes: an eligibility rule enforced for options but not for a fallback list. Fix: every fallback uses the same scope (match type for the mode, required brand, already-shown/kept exclusions); the brand-widen offer now applies in identify mode too; the formatter's heading follows the displayed set and never calls an extra the found item.
- **Real in-brand candidates reported as nothing found (blocked).** Retrieval had found in-brand likely matches, but their pages failed verification, and the reply said nothing verified existed. Fix: in-scope candidates whose pages could not be verified are shown as a partial result with price and stock explicitly unverified (the October 8 presentation), before offering to widen.
- **A link the user sent was ignored (trust).** The agent ran a fresh search and the reply never mentioned the supplied link. Fix: in the sourcing turn, a verified supplied link is offered first (it bypasses brand/scope checks because the user identified it, but not the sold-out check); an unverifiable or sold-out one is acknowledged in the reply.
- **Technical footer read as an error code (degraded, recurring).** The "other sources didn't pass checks" line from October 8 is removed; hidden unverified sources make no claim, and failed checks remain in diagnostics.
- **Two texts after a failure (unknown).** The packet shows exactly one reply per inbound message (a feedback acknowledgement and a search reply for two rapid messages); no duplicate delivery is recorded. Not changed.
- **Observability:** diagnostics now record each candidate's role, the supplied links' check status and which unverified candidates were shown.

Evals added: link-after-empty-brand-search, link-this-is-the-one, link-save-after-miss.

Triage cursor: 2026-10-13T16:36:01.094593+00:00

## October 14: iMessage threads, named models and purchase-history answers

Six reports from one tester conversation, all sent as threaded replies. Findings:

- **Thread replies resolved against the wrong product set (trust, blocked).** iMessage points every reply in a thread at the thread's first message. Reply resolution followed only that chain, so a reply inside a thread ignored everything Jules had sent later in the same thread: a save request right after the right product was shown was matched to the older empty search, and a brand/model clue threaded onto a photo lost Jules' analysis of that photo (colour, material). Same class as the October 9 "reply to an older message" rule, missed for threads. Fix: reply context now includes the thread's later turns (the user's replies to the root and Jules' sent answers to them, newest eight, excluding developer feedback and unsent replies), so the newest result in the thread is what a reply refers to. Verified read-only against the reported turns.
- **Named model searched as open discovery (trust).** Three named-product requests in this conversation (eyewear, a bag, trousers) were planned as `discover`; for the trousers the plan also dropped the model name, so only similar items were found until the user repeated it. Fix: a model-filled `named_model` search-plan field; code treats a named model as identification and guarantees the query carries the name.
- **Unanswerable purchase-history answer failed the whole reply (blocked).** An answer that mixed a clear recipient update with an unspecified "kept one" got the generic failure text. The packet had no failure reason; the likeliest mechanism is all-or-nothing application of the interpreted actions. Fix: chat answers keep valid actions and withhold invalid ones (logged as `purchase_history_actions_withheld`), then ask which item the rest was about; nothing applicable asks a clarifying question instead of failing. Instrumentation: every AI fallback now logs `ai_reply_failed` with error class and database code (no message text).
- **Receipt question asked for already-known details of returned items (degraded).** Fix: code withholds `details` questions about items whose receipts or corrections show a return, refund or cancellation (return requests still qualify); the question prompt says so too.
- **Repetitive fixed reply text, and the "starting price hasn't been verified" alert wording (degraded, recurring).** Both come from fixed template text and one-size alert baselines that open PR #31 (model-written replies, size-aware alerts) replaces; not changed here to avoid conflicting with it. Re-check after #31 merges.
- **Visually different product after a text identification (trust).** Partly the thread defect above (the photo brief was lost). Comparing text-found candidates to the referenced photo is proposed, not built (adds a vision call per search).
- **Observed in context, not reported:** a developer-feedback message whose reply stayed in `generating` and was never delivered or saved. Unknown cause; the new fallback log does not cover a stalled (rather than failed) reply.

Evals added: named-model-in-my-size, named-model-want-a-pair, named-model-best-price, named-model-retry-after-miss, named-model-as-inspiration, save-right-after-found-in-thread.

Triage cursor: 2026-10-15T01:23:06.195194+00:00
