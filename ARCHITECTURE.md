# Jules architecture: inputs, skills and data stores

Status: October 12, 2026. Describes the code after the evidence store (`db/019_evidence.sql`) and the single-agent change. Use this to sanity-check new work: every new feature should fit one of the layers below, or explain why it needs a new one.

## The model in one picture

```
 INPUTS                         EVIDENCE (proof)                 BELIEFS (profile)              VIEWS (computed)
 iMessage text/photos  ─┐                                                                       shopping history
 Gmail / Shop orders   ─┼─► extract ─► evidence table ──cite──► taste_profiles.facts ──┐        style report
 /style photos         ─┤      (model reads,  (immutable rows,     (stated / confirmed /  ├──►  Wrapped cards
 wishlist actions      ─┤       code checks)   one per proof)       inferred)            │        search ranking
 operator edits        ─┘                                                                │
                                      │                                                  │
                                      └──────────── replayed directly ───────────────────┘
 WORKFLOW STATE (not proof, not belief): import jobs, open questions, pending offers, wishlist, alerts
```

Five rules keep this from drifting:

1. **Proof lives only in `evidence`.** One row per citable proof point, pointing back to its raw source. Rows record what a source says, never what Jules concludes about the person.
2. **Beliefs must cite proof.** Every profile fact has `evidence_ids` and a `basis`. The database rejects a fact without existing evidence from the same user.
3. **Corrections are new evidence, not edits.** The original row stays; views replay corrections in order.
4. **Computed views are never stored as beliefs.** Shopping history, report statistics and Wrapped signals are recalculated from evidence, so they update automatically when evidence changes.
5. **One agent interprets every message.** No keyword, phrase or regex rule decides what a message means. The model reads the message, conversation and application context and calls tools; code validates references, consent and formats, then executes.

## Input sources

| Input | How it arrives | What is extracted | Becomes |
|---|---|---|---|
| iMessage text and photos | Photon webhook → `api/imessage.js` → `lib/inbox.js` → the agent (`lib/ai.js`) | Whatever the agent's tools record | See skills below |
| Self-statements in chat | Agent calls `update_profile` | Remember / correct / forget, with the exact quote | `chat_statement` evidence + `stated` belief |
| Corrections to purchase history in chat | Agent calls `update_purchase_history` | Recipient, return, dispute, field fix, duplicate, defer | `correction` evidence |
| Gmail receipts | Read-only OAuth import (`lib/gmail-import.js`, `lib/gmail-worker.js`) | Purchase, shipping, return, cancellation and refund events with quoted fields | `purchase_event` evidence |
| Connected sources (Shop today) | Sign-in with a code on `/onboarding`, then up to 100 records (`lib/connected-sources.js` plus a small adapter such as `lib/shop-orders.js`); same extraction and validation as Gmail, sharing the `gmail_imports` row | Same events, quoting the record; an order another source already found links to the same item | `purchase_event` evidence, origin = the source's name |
| `/style` photos (outfits, inspiration) | Upload on the private page (`api/style.js`) | Photo observations; user notes and occasions | `photo_observation` and `user_note` evidence |
| `/style` card confirmation | User accepts a card's preference | The accepted preference | `confirmation` evidence + `confirmed` belief |
| Wishlist actions | Confirmed save in chat; remove/restore on the wishlist page | Which item, which action, when | `wishlist_event` evidence |
| Operator edits | Private admin inbox (`api/profile.js`) | The edited preference | `operator_entry` evidence + `stated` belief |

Receipts come only from Gmail (receipts texted to Jules are a planned `chat`-origin `purchase_event`). Manual receipt upload has been removed. Items Jules merely sent are workflow history, not evidence of interest; only the user's own save/remove/restore is evidence.

## The agent and its skills

Every message goes to one agent (`generateReply` in `lib/ai.js`): one model call, one tool list, `tool_choice: required`. The agent sees the conversation, any photos, and an application-context block (data, not instructions): pending options, saved wishlist with alert status, saved profile beliefs, message references, onboarding state, and whether purchase history exists. It calls exactly one replying tool, plus `update_profile` alongside it when the message also states a durable fact, and `record_quality_signal` when the message shows an earlier turn missed what the user wanted. Developer feedback never reaches the agent: a `#dev` message or a 👎 tapback is saved by `lib/developer-feedback.js` in the inbox before the agent runs (founder exception in `AGENTS.md`). If code rejects the call (for example, accepting an offer that was never made), the agent gets one retry with the validation feedback; it never guesses consent.

**Search turns reply in stages.** With `find_products` the agent also writes a one-line `acknowledgment`. `lib/inbox.js` sends it (operation `ack:<message>`) before the search runs, then responds to the webhook. The search finishes in Vercel's `waitUntil` and the result goes out as its own message. If the search passes 60 seconds, `searchFollowup` (model-written, VOICE.md) sends one update (`followup:<message>`). An update is never sent after the result. The result row is re-dated at send time so history keeps send order. Turns that don't search finish before the webhook responds, as before. A failed reply is retried once with a compact context (six recent turns, no retailer colour images) before the generic fallback. `timing_diagnostics` on the search outcome records `first_message_ms` and `result_ms`, and the `turn_timing` log line records them for every turn.

| Skill (tool) | Offered when | Executor | Writes to |
|---|---|---|---|
| `find_products` | search enabled | `lib/text-wishlist.js` (text) or `lib/search.js` (photos) | `messages.search_result` (workflow) |
| `ask_shopping_question` | wishlist enabled | `lib/text-wishlist.js` | pending brief (workflow) |
| `respond_to_options` | there are pending options | `lib/wishlist-selection.js` | pending selection (workflow) |
| `save_to_wishlist` | wishlist enabled | `lib/wishlist-selection.js`, then save after delivery | `wishlist_items`, `wishlist_event` evidence |
| `manage_price_alerts` (create / status / cancel) | wishlist enabled | create: `lib/wishlist-selection.js`; status/cancel: `manageAlerts` in `lib/inbox.js` | `price_alerts` |
| `wishlist_status` | wishlist enabled | grounded reply; link added by code | none |
| `prepare_checkout` | `CHECKOUT_LINKS_ENABLED`, with pending options or saved items | `lib/checkout.js`: a cart link with the exact size for stores in Shop's catalog, otherwise the product page; never pays | `messages.search_result` (`purchase_intent`) |
| `update_purchase_history` | the user has imported purchases | `lib/receipt-chat.js` | `correction` evidence, open questions |
| `update_profile` (remember / correct / forget) | memory enabled | `updateProfile` in `lib/memory.js` | `chat_statement` evidence + beliefs |
| `profile_status` | memory enabled | grounded reply | none |
| `onboarding` (accept / decline / status / style) | invited to onboarding, or `/style` enabled | `onboardingAction` in `lib/onboarding.js` | `onboarding_sessions` |
| `record_quality_signal` (non-replying) | the store can save it | `store.saveQualitySignal` (best effort; logged as `quality_signal`) | `messages.quality_signal` |
| `conversation_reply` | always | grounded reply | none |

Structured arguments replace wording rules: the agent passes `department` (men/women/unisex/unspecified) and `for_someone_else` with each search, so code never parses "for my wife" or "women's" out of text. Consent for saves and alerts is checked in code against the actual offer and options (`invalidOfferConsent`, `selectionOutcome`). Previously there were four separate model calls or routers per message (onboarding, purchase-history check, memory extraction, then one of two interpreters); now there is one.

## How replies are written

Jules has no fixed reply text. When a tool's result is drafted by code (search results, saves, alerts, size questions, notifications), `lib/compose.js` gives the model that draft as a factual outcome, along with the recent turns and `VOICE.md`. The model writes the message. Code then checks the message before sending:
- every link in the draft is present unchanged, and no other links are added;
- no price appears that the draft didn't state;
- the model's structured `claims` (`saved_now`, `alerts_turned_on`, `alerts_turned_off`) match what this turn actually did.

A message that fails the checks gets one retry, listing the problems. Replies the agent already wrote itself (`conversation_reply`, `profile_status`, `wishlist_status`, a profile acknowledgment) are sent as written. The draft goes out unchanged in two cases: the model is unreachable, or both attempts fail the checks. The only other fixed text is the reply when the agent itself fails, and the `#dev` acknowledgment. Notifications sent through `deliverReply` (price alerts, onboarding, purchase questions, save confirmations) are composed the same way; the stored message is the text actually sent.

Alert sizing is structured too. The agent tags each alerted option as `footwear`, `apparel` or `one_size` (`option_sizing`). A saved shoe size applies only to footwear. A one-size item is watched under the `One size` key, priced from the listing offer bound to its exact URL, and only when the page lists no other sizes.

## Product search: which source runs when

Cheapest reliable source first; the model-driven web search (`gpt-4.1` + web search, the most expensive and slowest step) is the fallback.

| Request | First | Fallback |
|---|---|---|
| Photo or screenshot | Google Lens via SerpApi (`VISUAL_SEARCH_ENABLED=true` in production) | Web search with the image |
| Named product or identifiable brief | SerpApi Google results + our own page checks (no model call) | Web search when nothing verifies |
| Open discovery ("understated white sneakers, any brand") | Web search (needs breadth) | SerpApi recovery |
| Identification from context ("the jacket Connor Storrie wore") | Structured lookup usually finds nothing, then web search | |

- **Shop's catalog** (`SHOP_CATALOG_ENABLED`) runs beside the first web search as one more source (`shopCandidates` in `lib/text-sources.js`). It covers Shopify stores only. Its results are candidate URLs: each plain product page passes the same listing check, results interleave with web results, and market/taste ranking decides order. A required brand whose own store is listed in `lib/shopify-stores.json` (refresh with `node scripts/shopify-stores.js`) is searched inside that store. If web search fails, verified Shop results are shown instead of a failure. `text_wishlist_sources` logs and the replay report count shown merchants per source.
- **Variants:** the expensive "find variants" web search runs only when the agent sets `show_variants` (the user named a model without its version, or asked which versions exist). Color options listed on the retailer's own page are always read; that costs no model call.
- **Search before asking:** when the agent decides a question is needed, the executor first runs the structured lookup. With verified candidates, a small model call writes the one question that best separates them, and the candidates are shown as selectable options ("Could it be one of these?"). With none, the agent's question is asked as is.

## Adding a purchase-history source

Every source rides the same rails (`lib/purchase-sources.js`): it produces prepared records `{id, date, text}`. The shared code reads each record with the model, keeps only fields quoted from the record, links it to items any source already found (so an order in both Gmail and Shop is one item), writes `purchase_event` evidence with the source's origin, and reselects follow-up questions. Gmail keeps its own email search and triage but uses these rails for extraction, evidence and questions.

For a new connected service (another MCP or order API):
1. Write an adapter like `SHOP_SOURCE` in `lib/shop-orders.js`: name, origin, label, consent version, enabling flag, extraction instructions, `start`/`poll` (code-based sign-in) and `list` (records).
2. Register it in `CONNECTED_SOURCES` (`lib/connected-sources.js`). Shared code handles the sealed sign-in, resumable queue, retries, evidence, questions and status.
3. Add a migration inserting its origin into `evidence_origins` with `purchase_history=true`.
4. Add its section to `/onboarding` (element IDs prefixed with its name) and an entry in `SOURCES` in `public/onboarding.js`.

Sign-in is code-based (device flow) today. A service that only supports redirect sign-in would also need a callback route, like Gmail's.

## Data stores

### Proof and beliefs

| Store | Definition | Purpose | Written by | Read by |
|---|---|---|---|---|
| `evidence` | Immutable proof rows: `id, seq, kind, origin, source, data, recorded_by`. Kinds: `purchase_event`, `correction`, `photo_observation`, `user_note`, `chat_statement`, `operator_entry`, `confirmation`, `wishlist_event`, `legacy_record`. Origins: `gmail`, `style`, `chat`, `operator`, `wishlist`, `legacy`. | The single place proof lives. `seq` gives replay order. Deleting by origin or source is how data is forgotten. | Gmail import and corrections, `/style` analysis and confirmation, memory, operator | Receipt history view, style report, belief validation |
| `taste_profiles.facts` | Beliefs about the user: `field, key, value, basis, evidence_ids` (≤150). `basis` is `stated`, `confirmed` or `inferred`. Clothing range (`men`/`women`/`unisex`) and gender (`man`/`woman`/`non-binary`/`prefer-not-to-say`) use fixed values that code compares directly. | What Jules believes about taste, sizes, budgets, brands, market. Used in every chat and search. | `update_profile`, operator, `/style` confirmation | Agent context, search ranking, market, `/style` context |

How beliefs resolve: when two beliefs share a field and key, the stronger basis wins (stated > confirmed > inferred); within the same basis the more recent one wins, so a correction replaces what the user said before (`prevails` in `lib/memory.js`).

How the agent sees purchase history: a compact summary (top brands, stores, purchased sizes, latest items) in its context and in search prompts, read from the cache without replaying evidence. Full per-item history is loaded only for discovery ranking.

How beliefs follow evidence: `prune_unsupported_facts` runs whenever evidence is deleted. It drops citations that no longer exist and removes a belief left with none. A belief supported by both Gmail and chat evidence survives deleting Gmail history, with only its chat citation. Receipt-derived shopping history is never stored as a belief; it is recomputed from evidence on every read, so corrections take effect immediately.

### Raw sources (input material, not proof by themselves)

| Store | Holds | Notes |
|---|---|---|
| `messages` | Every inbound/outbound iMessage, status, reply references, search results, developer feedback, quality signals | Also carries workflow columns (`search_result`, `wishlist_payload`, `memory_status`). |
| `message_images` | Images sent in iMessage | Private; used for search. |
| `gmail_imports.data.sources` | Prepared (redacted) receipt email text, fingerprints, warnings | Kept so extraction can be audited and changed emails detected. |
| `style_sources` | Normalized `/style` photos | Deleting a photo clears style evidence and the beliefs that relied only on it. |

### Workflow state (neither proof nor belief)

| Store | Purpose |
|---|---|
| `gmail_imports` (row) | OAuth token (encrypted), consent version, import job progress, open questions (`data.questions`), lease/revision lock, and `history_summary`: a cache of the purchase-history view refreshed on every write. Receipt items are not stored here. |
| `usage_events` (+ `usage_by_user_day` view) | One row per OpenAI or SerpApi call, attributed to the user action (chat message, Gmail step, style reading) and the agent tool chosen, with tokens, web-search calls and an estimated cost (`lib/usage.js`). The basis for per-user cost and eventual billing; provider invoices remain authoritative. |
| `style_sessions` | `/style` notes, tone, current report (cards plus references to observation evidence), analysis lock. |
| `onboarding_sessions` | Onboarding step per invited user. |
| `wishlist_items`, `wishlist_encounters`, `wishlist_entry_metadata` (view) | What the user saved and where each save came from. |
| `price_alerts` | Active alerts, baselines and last checks. |
| `conversations` | One per user; the identity everything else is scoped to. |
| `wishlist_members`, `wishlist_revoked_sessions`, `login_challenges`, `public_signups` | Sign-in, access and signups. |
| `cost_entries` | Operator cost tracking. |

## Write paths (all atomic, all owner-scoped)

| Action | Database function | Proof written | Beliefs changed |
|---|---|---|---|
| Gmail step / answer / correction | `finish_gmail_import(…, p_evidence, p_clear)` | New purchase and correction rows, in the same transaction as job progress | None directly; history view recomputes |
| Delete imported history | `finish_gmail_import(…, p_clear=true)` | All `gmail` evidence deleted | Pruned |
| `/style` upload, remove, notes change | `write_style(…, p_clear=true)` | All `style` evidence deleted | Pruned (confirmed style beliefs removed) |
| `/style` analysis | `write_style(…, p_evidence)` | Observation and note rows | None |
| `/style` confirmation | `write_style(…, p_evidence, p_facts)` | Confirmation rows | Replaces previous `style_report` beliefs |
| `update_profile` / operator edit | `insert_evidence` then `save_taste_profile` | Quote / operator entry | Saved only if every citation exists |
| Wishlist save (chat) / remove / restore (page) | `insert_evidence` after the save or change | `wishlist_event` | None |

Pre-evidence data: the migration backfills existing beliefs and `/style` observations. Pre-evidence Gmail imports convert on their next write (`legacyReceiptEvidence`); until then they are read through the same conversion.

## Chat quality metrics

`lib/chat-metrics.js` turns existing message rows into a few numbers. The script (`node --env-file=.env.local scripts/chat-metrics.js`), the People page in admin, and every feedback-triage packet all use it:

- **Time to first message and to final result** for each inbound message. Every reply for a message has an operation id ending in `:<inbound provider_id>` (`ai:`, `ack:`, `followup:`, `wishlist-confirm:`), so new kinds of reply are counted automatically. Search turns use the recorded `timing_diagnostics`. Other turns use `messages.sent_at`, which `db/027` stamps when a row becomes `sent`. Older rows fall back to estimates (`timing_source`), and the placeholder `created_at` is never used as a send time.
- **Failed replies**: `source = 'ai_fallback'`, plus replies that stayed `generating`/`sending` for more than 10 minutes or ended `uncertain`. Once `db/028` adds `messages.reply_diagnostics`, its recorded `outcome` is used directly, and a watchdog-recovered reply (`source = 'ai_recovery'`, outcome `stalled`) counts as a stall, not a normal reply. Its `composed_by` takes precedence over the inferred one.
- **Model-written vs fixed template**: `search_result.composed_by` when recorded. Otherwise it is inferred from the chosen tool in `usage_events.action`: model-written tools are listed in `MODEL_WRITTEN_TOOLS`, and saves and fallbacks count as template text.
- **First-try find rate**: a named-product search (`search_plan.named_model` or `mode: identify`, not a continuation) counts as found on the first try when the item the user then selected or saved was in the first result set. The alternatives are after a retry, or supplied by the user.

`scripts/replay-gate.js` is the pre-deploy check on the same behavior: see `REPLAY-SUITE.md`.

## Known gaps and existing debt (honest list)

- **iMessage photos are not evidence yet.** They are used for the current search only; nothing learns taste from them. If something does, they must become evidence rows first.
- **Receipts texted to Jules are not supported yet.** The `chat` origin and `purchase_event` kind are ready for it.
- **Alerts on an already-saved item that isn't in the current options** can be checked and cancelled in chat but not created there yet; creation goes through current options or the wishlist page.
- **Wishlist evidence is written right after the save or change, not in the same transaction.** Row IDs are deterministic, so retries don't duplicate, but a crash between the two could miss a row. After an unclear save or alert failure, chat repeats only the failed keyed write once and then replies from what is stored (`settleTextWishlist`); a repeated remove/restore on the wishlist page writes nothing.
- **The replay grader (`lib/replay.js`) still scores replies with phrase checks.** It grades test output; it does not route messages. `REPLAY-SUITE.md` already flags replacing it with structured grading.
- **Output safety filters use word lists** (commerce claims in search reasons, body comments in style copy). They check what Jules writes, not what the user means.
- **`messages` mixes transcript and workflow** (`search_result`, `wishlist_payload`). Acceptable at this scale.
- **Live model behavior needs regular checks.** Unit tests mock the model's tool choice. The routing eval (`lib/agent-eval-cases.js`, 50 labeled turns, "Run routing eval" on `/admin/replays`) scores the real model's tool and argument choices with tools stubbed; run it after any prompt or tool change. Replace synthetic cases with real turns over time (keep those private).
- **Cost estimates use list prices** in `lib/usage.js`; update them when provider prices change.

## Deployment order

- `db/019_evidence.sql`: applied October 12, 2026. `db/020_drop_evidence_transition.sql` removes the transitional functions and backups once the release is verified.
- `db/022_history_sources.sql`: replaces the fixed origin list with the `evidence_origins` table (adds `shop`), clears every purchase-history origin with imported history, and lets a connected source create the history row. Run before `SHOP_ORDERS_ENABLED=true`.
- `db/027_reply_sent_at.sql`: adds `messages.sent_at` and the trigger that stamps it. Run before relying on reply speed for turns that don't search. Nothing reads it until then: the metrics fall back to estimates and label them as such.
- `db/021_usage_events.sql`: run before relying on cost data. Until then usage writes fail quietly (logged as `usage_record_failed`) and nothing else is affected.
