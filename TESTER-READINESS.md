# Tester readiness — shopping, monitoring and learning

Status: requirements and execution plan, updated October 7, 2026. Implementation and live acceptance are not complete. This milestone prepares the existing prototype for at most ten invited testers. Human fallback (Milestone 7) is deprioritized and will not be implemented.

## Required outcome

Jules interprets a user's natural-language message, relevant images, threaded reply, saved profile and current choices; sources evidence-backed products; clarifies only material gaps; saves the intended items; manages price alerts; sends qualifying notifications; and learns useful sizes and preferences. The user can correct or undo actions and inspect actual status. No operator is required to finish the shopping loop.

These requirements supersede narrower earlier shoe-only, fixed color-question, and receipt-preference rules. Examples illustrate meaning, not phrases to match.

## Profile learning

Use the existing structured profile as the user's shopping profile: sizes, taste, retailer preferences and supporting evidence. Separate permanent profile facts from the active request, the selected products, and action consent.

- Sizes cover all relevant categories and brands. Save the original label, interpreted category, stated sizing system when present, length/fit modifiers, scope and evidence. A suit image with “I'm a 50R” establishes the general suit size 50R across brands. Missing system information does not prevent remembering the label; it may prevent mapping to a particular retailer's offer.
- General category sizes apply across brands by default. Explicit brand exceptions override that default for their brand without erasing it. A current request may override either. Do not infer brand-only scope merely from the product being discussed, convert sizes without evidence, or treat a saved size as proof of fit or availability.
- Resolve category and recipient from the image, thread and conversation. Ask if unresolved ambiguity would affect the action. A gift recipient's size does not replace the user's size.
- Learn retailer affinity from supported receipts uploaded in `/style`, chat and subsequent feedback. SSENSE and Mr Porter receipts contribute store affinity without requiring the user to separately declare them favorites. Keep receipt-derived shopping history distinct from explicit likes, dislikes and loyalty statements. Explicit corrections/avoidance take precedence.
- Deduplicate receipt evidence. Known gifts/other people's purchases do not establish the user's preferences. Purchased size is useful evidence but not confirmed fit. Correcting/deleting evidence updates dependent learning without deleting independent facts.
- Record product feedback at its appropriate scope: identity error, merchant issue, fit/size correction, variant preference, request-only exclusion, or lasting taste. Model interpretation establishes scope; a single rejection is not automatically a permanent brand dislike. Later search must use established learning.

The internal `shopping_range` field means clothing department (men's, women's, unisex or any), separate from gender identity. Do not infer it from appearance. Current explicit recipient/request preferences take precedence over general shopping preferences.

## Sourcing and merchant selection

1. Interpret the requested piece/product, recipient and supplied attributes, including any exact-versus-similar intent.
2. Retrieve candidates and establish product identity and variant from supported evidence.
3. Check each eligible merchant's product page for supported images, price/currency, relevant retailer size labels and size-specific availability. Retain source URLs and check times; unknowns remain unknown.
4. Compare merchants for the same eligible product/variant. Begin with Jules's recommended stores; promote learned/preferred stores when the requested size is verified available there. Product identity and eligibility precede merchant preference. A favored store cannot make a wrong item or unavailable size eligible.
5. Ask only about unresolved attributes that materially affect the next action, using differences actually found. The user may have supplied color, length or material already, or there may be no meaningful ambiguity. Do not run a fixed questionnaire or force one item when the user wants a set.

Preference ranking does not establish authenticity, loyalty benefits or lowest delivered cost. Keep known item prices separate from unknown shipping/taxes/duties. Keep unsupported merchant offers visibly unresolved rather than inventing stock or equivalence.

## Conversation and application actions

Use one model-interpreted intent contract for text, images and follow-ups, routing to supported application actions. Extend the existing app and database; no new agent service or queue provider is required. This introduces shared persistent conversation/action state and recovery work, rather than a prompt-only change.

Required supported actions: source/refine products; clarify; choose a set; save/inspect/remove wishlist items; enable/inspect/change/disable item/set alerts; record feedback; update/correct/forget profile facts; and ordinary conversation/navigation. The model may propose an action; code checks ownership, references, evidence, consent and preconditions before execution. When intent does not clearly map to a supported action, take a reversible supported step or explain the limitation and ask one useful question. Do not guess consent to mutate state.

Remove phrase/keyword/regex rules for conversation routing, reactions and semantic preference gates. Tests grade structured intent, actions and progress rather than phrase triggers. Deterministic parsing/validation of signatures, URLs, retailer formats, source references and other technical data remains appropriate.

Persist incoming reply targets and outgoing message-to-product associations. Resolve a threaded reply against its original message, images, products and selected set, including older threads. Do not substitute the newest search for an explicit reply target. Unknown/cross-user references are rejected or clarified. Verify the actual provider thread metadata before choosing its transport representation.

Support rapid successive messages, subsets/all/none, uncertainty, exclusions, recipient changes, unrelated conversation and returning to earlier requests. Maintain contextual state without repeating a full list or restarting a completed search unnecessarily. Interest, a save request and consent to monitoring are distinct. Questions about unrelated topics do not authorize earlier offers.

## Wishlist and monitoring

- Apply saving rules consistently across input types: explicit image-identification requests retain sent findings under the existing auto-save policy; text selection and later mutations follow scoped user consent. Describe the policy honestly and never treat interest as consent to alerts.
- Use stable item/variant identifiers for saves, replacements and item/set alert changes. Confirm completed actions only after successful persistence; describe partial success precisely.
- Monitoring is a supported capability when configured. Chat instructions must agree with enabled tools, evidence coverage and deployment settings. Create, inspect, change and cancel alerts from chat as well as the wishlist.
- Separate active monitoring with a checked baseline, monitoring awaiting supported evidence/availability, a temporarily failed check, disabled monitoring and uncertain notification delivery. State must survive reload/restart and be explainable in chat.
- Keep conditions explicit: existing web alerts require more than a 10% drop; existing text-created alerts use any verified drop, normally checked every three days. Preserve their variant/size/currency scope unless the user changes it. Do not merge conditions silently.
- Send only qualifying, freshly verified notifications. Cancellation must invalidate obsolete work; revisions and send operations prevent stale or duplicate actions. Later checks use the updated reference price according to the applicable alert condition.
- Resolve interrupted saves/actions and check failures automatically when safe. Never blindly resend a message whose provider outcome is uncertain. Establish provider-supported reconciliation or an explicit automated failure outcome; routine shopping cannot depend on an operator inspecting the phone or repairing a record.

## Observed implementation gaps

The October 7 local review found separate text-selection/image-search paths, shoe-only saved-size selection in text alert setup, a global merchant registry, absent chat cancellation tools, phrase-based routing/reactions and semantic memory gates, contradictory monitoring instructions, and recovery paths requiring manual investigation. These are implementation gaps, not completed work.

The local test run passed 214 tests at that review. That baseline does not establish current/future deployed behavior. Existing replay tests prepare replies without persistence or Photon delivery. The identification evaluation document records an unrun independent real-photo benchmark. Recheck each gap against the implementation when work starts and report live acceptance separately.

## Verification and release gate

Build tests from complete conversations and expected outcomes, with varied wording and different evidence conditions. Cases below are dimensions to combine, not a required sequence of questions:

| Coverage | Required outcome |
| --- | --- |
| Text, product link, garment image, whole outfit, unclear image | Relevant sourced listings and supported photos/facts, or useful clarification/partial results; distinguish exact identity from alternatives |
| Supplied attributes, multiple differing attributes, no meaningful differences | No repeated questions; clarify only decision-relevant gaps, including model/material/length/fit/finish/color/size when applicable |
| Unstructured sizes across suits, outerwear, tops, trousers and shoes | Correct category default across brands; raw labels retained; explicit brand exceptions/current overrides respected; no invented conversions |
| Caption contains size/preference; older threaded image reply contains it | Profile updates use the correct context and are recalled in a later separate request |
| Preferred/avoided stores; receipts; duplicate/deleted receipts; gifts | Learned affinity influences equivalent eligible offers, explicit corrections win, evidence is deduplicated/revocable, wrong products/size stock never win |
| One/subset/all/none; exclusions; uncertainty; corrections | Selected set and uncertainty preserved; no restart/full-list repetition; consent matches the actual action/set |
| Feedback, replacement/removal, size correction, forgetting | Appropriate scoped state/profile changes persist and alter later sourcing without unwanted generalization |
| Older message threads, multiple active requests, rapid replies, topic changes | Correct message/image/product references; no action on the wrong item or lost context |
| Wishlist save and item/set alert enable/change/disable | Real persisted state, precise confirmations, supported status inspection and no unauthorized alerts |
| Scheduled qualifying drop, nonqualifying drop, sold-out/wrong variant, cancelled alert | One qualifying phone notification; no false or cancelled-item notification; correct subsequent baseline |
| Provider timeout, duplicate webhook, process interruption, database failure, uncertain send | Bounded automatic recovery, no duplicate action, truthful failure status, no operator dependency to finish the user loop |
| Two separate users | No access or action across users, including threaded targets and source images |

Use three layers: deterministic evidence/state/action tests; repeated live-model text/image conversations with independent answers; and deployed integration tests exercising real persistence, scheduler and controlled phone delivery. Fault injection verifies interrupted operations without depending on a real retailer's price changing. Controlled fixtures are labelled test data and must never appear as real product offers to users.

Record input/context, interpreted intent, source evidence, action/state changes, output, model/commit, latency and failure stage privately. Do not commit personal photos, receipt details or secrets. Grade product correctness independently of model-generated explanations. Hold out cases from tuning and repeat affected journeys at least three times.

Before inviting testers: all required actions must be implemented and end-to-end gates must pass; zero observed unsupported commerce claims, unauthorized mutations, cross-user access, wrong-target mutations, duplicate notifications or required operator resolutions in the release suite. Retain the provisional image benchmark gate of zero false claimed likely matches and at least 80% identifiable-piece coverage, with correct ambiguity/abstention checks. Report coverage and failures explicitly; a small passing set does not prove universal reliability. Verify production configuration and actual phone notification receipt separately from provider send acceptance.

## Implementation order

1. Shared intent, thread references and persistent conversation/action state; remove competing phrase routes.
2. General size memory, evidence-scoped retailer learning and feedback; apply profile learning to sourcing and merchant ranking.
3. Unified product/variant references and complete wishlist/alert actions; align capability instructions and persisted status.
4. Safe automatic recovery, message ordering, cancellation/revision protection and truthful failure handling.
5. Full release suite, independent image benchmark and deployed phone/database/scheduler acceptance.

Use the existing Supabase, Vercel, OpenAI, SerpApi and Photon setup. Determine any schema changes during implementation and document exact external setup then. Do not add speculative infrastructure or declare this gate complete from unit tests alone.


## Running the first diagnostic baseline

`npm test` runs the existing deterministic regression suite. `npm run test:readiness` runs eight local probes against the actual memory validator, selection handler and inbound handler, with controlled dependencies. To retain a private report, run `npm run test:readiness -- .eval-local/readiness-RUN-ID.json`, replacing RUN-ID with a fresh identifier. Existing reports are never overwritten. A nonzero exit status means a product requirement is unmet; do not weaken expectations to make the check green.

The October 7 baseline passed four probes and failed four. Passing: preserving an interpreted raw suit size, using a saved shoe size for approved monitoring, retaining a selected subset without mutation, and rejecting consent applied outside the offered set. Failing: using saved suit/jacket/trouser sizes for monitoring, and invoking profile learning for an explicit size in an image caption. This does not grade real natural-language interpretation: the model output is controlled. It performs no live writes, uploads or phone sends. The eight probes are an initial diagnostic subset, not the full release gate.

### Improvement cycle

1. Reproduce a failure with the exact input, prior state, thread target and profile snapshot; distinguish interpretation, retrieval, verification, state, persistence and delivery failures.
2. Add varied conversation cases with the same intended outcome, plus nearby cases where an action must not happen. Fix the responsible layer rather than adding a phrase exception.
3. Run affected local contracts, then repeated live-model cases. Freeze model/configuration/commit and record all runs, including failures.
4. Verify deployed persistence/delivery for changed actions with a dedicated test identity. Confirm fixes do not regress unrelated journeys. Never test destructive mutations or artificial price offers on a real user's collection.
5. Preserve the failed case for future releases. Keep separate holdout examples that are not used to tune the fix.

### Measuring excellence

Track complete-journey success, exact product/variant precision and coverage, correct scoped profile learning, unnecessary clarification/repeated-context counts, action persistence, notification correctness, latency distribution and provider calls. Report unsupported cases separately, never omit them to inflate success. Judge tone and usefulness against context and evidence rather than exact wording. Evaluate whether each response advances the conversation and whether the user needs to repeat anything already supplied.

For live-model conversations, include all required categories, recipient/brand exceptions, known and unknown products, supplied and missing attributes, complete and partial outfit matches, material/length/model choices, older threads, several chosen items, unrelated-topic consent, correction/undo and later recall. Repeat each journey three times and include unambiguous as well as ambiguous cases. Use the independent real-image benchmark separately: model-generated confidence is not an answer label.

For delivery and alert acceptance, exercise actual deployment/database/scheduler with an isolated test collection and controlled evidence. Verify a qualifying event, nonqualifying event, currency/variant mismatch, cancellation, duplicate invocation and persistence recovery; verify an actual notification on the designated test phone. Provider acceptance is not proof of phone receipt.

Recruit only after the hard release checks pass and complete supported journeys work repeatedly without developer help. Passing eight probes, a high model score or a pleasing reply is insufficient. Paid live-model/search runs require configured private credentials; the current local workspace has only `.env.example`, so this baseline does not run them. Keep secrets in existing private environment configuration, never chat or Git.
