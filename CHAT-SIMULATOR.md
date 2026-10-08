# Chat simulator

Open `/simulator.html` after signing in through the owner's wishlist. It uses the production `receiveInInbox` handler, conversation model, memory extraction, product search and retailer checks. Send natural follow-ups and product links, or attach a JPEG/PNG/WebP under 1 MB. Each turn exposes the interpreted shopping outcome, profile updates, saved items, alert consent and delivery status.

The database, Photon transport and alert scheduling are replaced with an isolated in-memory store returned to the browser. Nothing is added to the real collection or sent to a phone. This is useful for conversation testing, not proof of database atomicity, provider acceptance, phone receipt or scheduler correctness. Model/search calls still use the deployment's configured services and credits. The endpoint requires owner authorization and never constructs a production store.

Export the conversation and diagnostics to preserve a failure. Resume the report to try follow-ups under a new build. Keep private reports outside Git. A permanent regression additionally needs an explicit expected intent, selected set, profile change and action outcome; an exported conversation alone is not a passing test. Inject wishlist-persistence or delivery failure to check truthful responses and state continuity. The simulator does not add threaded-reply interpretation that the production handler lacks.

## Conversation reset and quality gate

Keep the existing sourcing, storage and alert tools. Replace competing conversation routes and response templates with a coherent model-driven tool loop: interpret the active request in context, execute validated actions, and compose a natural response from tool results. Store references, pending choices, profile evidence and action receipts separately. Consent gates protect real actions without forcing the user through redundant confirmations. Do not add wording-based routing to compensate for model mistakes.

Build a frozen corpus of real failures and independent holdout journeys covering images, supplied links, broad requests, variations, missing attributes, subsets, exclusions, corrections, profile learning and alert scope. Compare Jules and ChatGPT using the same prompts/images/context; disclose the saved-profile context supplied to each. Grade sourcing and conversational usefulness blindly. Grade Jules's actions separately by persisted state rather than its wording, since the comparator does not have Jules's wishlist/alert integrations.

Proposed recruitment gate: at least 95% complete supported journeys across three repetitions, zero false save/active-alert claims or unauthorized mutations, and Jules preferred on at least 80% of comparable shopping conversations. Report ties, retrieval failures, unsupported cases, latency and all failed attempts. These are proposed targets, not measured results. Every fixed failure needs a regression case plus neighboring cases where the action must not occur; retain holdouts to detect overfitting.

## Retrieval failures

Current listing verification is a server-side fetch with a retailer allowlist, a six-second timeout, bounded redirects and an HTML/structured-product parser. Unsupported domains, HTTP blocking, bot pages, large responses, client-rendered content and parser mismatches can all fail even when the page exists. A retrieval failure must remain distinct from a missing product. Saving an explicitly requested reference is independent of this check. Broader sourcing recovery still needs implementation and acceptance; this simulator does not make retailer checks infallible.

October 8: the first production-model save benchmark recorded 4/6 passes, including two misses on explicit subset saving. This evidence prompted removal of conflicting interest/consent instructions and clearer schema semantics. Do not erase failed runs when recording follow-up results.
