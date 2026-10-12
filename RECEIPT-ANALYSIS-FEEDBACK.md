# Receipt analysis feedback

Founder decision, October 10, 2026: receipt analysis must produce a small set of simple questions for unresolved, decision-relevant facts. Chat answers and future closet edits must feed the same structured correction loop.

## Current implementation

`lib/receipt-feedback.js` is a private analysis-tool layer. It validates model-proposed questions, interprets answers through a model callback, applies explicit structured corrections, preserves their provenance, and rebuilds receipt-derived learning observations. `scripts/receipt-feedback.js` persists private JSON state atomically. This does not deploy a closet interface or overwrite the explicit taste profile. The founder-authorized Gmail pilot now persists this state and supplies separately sourced receipt observations to shopping context; see `GMAIL-IMPORT.md`.

The model decides which uncertainty warrants a question and interprets natural answers. Code validates item/evidence references, ownership, correction types, values and scope. No phrase, keyword or regex routing determines intent. Structured closet controls may submit the same events directly.

Questions are capped at five per analysis and five open questions across updates, reference specific items/evidence, and should not repeat readable receipt facts or previous answers. The model selects and orders the most consequential questions using the evidence and profile context: trustworthy closet contents and personal learning take priority over cosmetic details. Each reason explains the impact. Twenty uncertainties should produce at most five questions, without automatically refilling the queue after answers or deferrals; lower-priority facts remain unknown. Use fewer questions when useful. A clothing department or size outlier is a reason to ask about recipient, not proof of a gift. Partial answers retire the old grouped wording; reanalysis asks only about the remaining items. Uncertain answers can defer a question without guessing a fact.

## Feedback effects

| Structured correction | Result |
| --- | --- |
| Recipient self / other / unknown | Update only selected items; gifts stay in history and cannot teach personal sizes/taste. |
| Dispute purchase | Retain original evidence and audit history; exclude the claim and dependent learning. |
| Restore purchase | Confirm purchase without assuming recipient, kept status or fit. |
| Report return | Preserve purchase; store user-reported return; refund stays unknown. |
| Correct fields | Update only supplied product/brand/size/color/quantity fields with provenance. |
| Mark duplicate | Count once and combine source evidence; reject cycles and edits to a redirected item. |
| Defer question | Preserve unknown facts and avoid immediately repeating the question. |

Receipt observations distinguish purchased size from confirmed fit, ownership and a general category default. A return does not imply dislike or a wrong size. Other-person purchases do not become personal retailer affinity. Rebuilding these observations does not modify independent explicit chat preferences.

## Private workflow

Keep all input, state, messages and feedback files outside Git. Use the bundled Node runtime. No credentials are required for saved model proposals or structured edits.

- `scripts/receipt-feedback.js create INPUT OUTPUT`: input contains `owner_id`, normalized items with stable `id`/`source_ids`, and model-proposed `questions`.
- `apply STATE OUTPUT EVENTS`: apply scoped structured chat/closet events with unique event ID, owner ID, source and timestamp.
- `questions STATE OUTPUT PROPOSALS`: validate new model-proposed questions against previous corrections.
- `refresh STATE OUTPUT ITEMS`: refresh receipt evidence while preserving user corrections and question history. Preserve stable item IDs across imports; do not regenerate them from corrected size/product names.
- `answer STATE OUTPUT ANSWER`: interpret a natural-language answer with `message` and `provenance`, then apply validated events.

For automatic question generation, `create` accepts `generate_questions: true` and a relevant `profile`/previous-feedback context. This and `answer` use OpenAI Responses with `store: false`, `OPENAI_API_KEY` and optional `OPENAI_MODEL`. Obtain authorization for the exact private payload before external calls. No such new API transfer was used to implement or test this layer.

Tests cover gift corrections, dependent learning removal, duplicates, returns, scoped field corrections, partial answers, deferred questions, reference ownership, idempotency and evidence refresh. They test state/actions rather than exact prose. Production model quality and a future closet UI need separate acceptance tests.
