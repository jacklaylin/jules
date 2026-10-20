# Jules architecture: inputs, skills and data stores

Status: October 20, 2026. Describes the code after the evidence store (`db/019_evidence.sql`) and the single-agent change, plus what was added through October 20: spending caps, the waitlist, price stance, the daily purchase check with its purchase texts and fit checks, turn outcomes, the nightly judge and connected sources (Shop). Use this to sanity-check new work: every new feature should fit one of the layers below, or explain why it needs a new one.

## The model in one picture

```
 INPUTS                         EVIDENCE (proof)                 BELIEFS (profile)              VIEWS (computed)
 iMessage text/photos  ─┐                                                                       shopping history
 Gmail / Shop / order  ─┼─► extract ─► evidence table ──cite──► taste_profiles.facts ──┐        style report
 screenshots, /style   ─┤      (model reads,  (immutable rows,     (stated / confirmed /  ├──►  Wrapped cards
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
| Order screenshots in chat | The agent decides an image is the user's own past order (`lib/order-screenshots.js`); no import feature or keyword rule | Transcribed, then read with the same receipt reader and linking as Gmail and Shop; several screenshots of one order are read together | `purchase_event` evidence, origin `chat` |
| `/style` photos (outfits, inspiration) | Upload on the private page (`api/style.js`) | Photo observations; user notes and occasions | `photo_observation` and `user_note` evidence |
| `/style` card confirmation | User accepts a card's preference | The accepted preference | `confirmation` evidence + `confirmed` belief |
| Wishlist actions | Confirmed save in chat; remove/restore on the wishlist page | Which item, which action, when | `wishlist_event` evidence |
| Operator edits | Private admin inbox (`api/profile.js`) | The edited preference | `operator_entry` evidence + `stated` belief |

Purchase history comes from Gmail, connected sources (Shop) and order screenshots sent in chat. Manual receipt upload has been removed. Items Jules merely sent are workflow history, not evidence of interest; only the user's own save/remove/restore is evidence.

## The agent and its skills

Every message goes to one agent (`generateReply` in `lib/ai.js`) with one tool list. The agent sees the conversation, any photos, and an application-context block (data, not instructions): pending options, saved wishlist with alert status, saved profile beliefs, message references, onboarding state, and whether purchase history exists. Developer feedback never reaches the agent: a `#dev` message or a 👎 tapback is saved by `lib/developer-feedback.js` in the inbox before the agent runs (founder exception in `AGENTS.md`). A message that a small model check finds finishes a report sent in the last two minutes is appended to that report and acknowledged instead (`continuesReport`).

**The turn is a bounded loop.** Each round the model calls tools (`tool_choice: required`); code validates and runs them and sends each result back as a tool output; the model then calls more tools or finishes with `conversation_reply` (or `wishlist_status` / `profile_status` when that is the whole answer). So one message can do several things ("find these cheaper and set a price alert" = `find_products`, then `manage_price_alerts` on an option the search returned, then the reply), and the model talks about what was actually found.

- **Tool outputs** carry the code-drafted factual result, what happened (`outcome`: `saved_now`, `alerts_turned_on`, `alerts_turned_off`), and, after a shopping action, the pending options with what is known and unknown about each (`optionFacts`: store, price and its basis, availability, sizes seen, whether the page was checked). A refused call comes back as a tool output too (`not_run`, `blocked`, `failed`) with the reason, so the model can recover instead of the turn failing.
- **Limits.** At most 4 tool rounds, then a round that forces `conversation_reply`. One deadline for the whole turn (`AGENT_DEADLINE_MS`, default 100 s, inside the 120 s function limit): a search is not started with under 45 s left, and the loop stops with under 5 s left. An identical call is never run twice in a turn; a repeat makes the model write instead.
- **Order within a round.** `update_profile` runs first (a stated size informs the search), saves and alerts run before a search in the same round (their option indices refer to the options shown before it), and a search may still run after a save or alert. A save or alert next to `respond_to_options` in the same round leaves consent unclear and is not run; one next to an early reply runs (behind the consent check) and the reply waits for its result. An alert request includes the save. A call refused only for its timing may be made again in a later round.
- **What the model sees of the last search.** `pending_shopping.current_search_plan` is the stored plan without its own `continuation` flag and option indices; the model decides those for each message (`continuation` is chosen as `same_request`/`new_request`, `mode: alternatives` is searched as discovery with the named model as guidance, and each brand the model mentions is classified `required` or `reference`; only required brands filter).
- **Independent checks beside the turn.** Each is one focused structured model call, never wording rules: consent (before any save or alert), the profile check (`profileCheck` in `lib/memory.js`: durable facts stated in the newest message, applied before any action so a stated size informs this turn's search; the agent's own `update_profile` still works and saving twice is idempotent), and the quality check.
- **Consent stays in code.** Saves and alert creation still pass `invalidOfferConsent`, `selectionOutcome` and the independent `consentCheck` model call before anything is persisted. An approval given earlier and waiting for a detail (stage `size_set`, `confirmed_consent`) is checked too: the check is told about it and resumes it only when the newest message gives that detail (the size), not when the user says something else such as their name. Interest in exactly the approved set resumes it, so it is gated the same way. The check reads against the shopping state the user saw when they wrote (the turn's start): an offer this turn's own reaction made is not open yet, and products this turn's search found are flagged, so "find X and save it" saves what the search found while "find X" never does. The reading lists what the newest message asks for (`newest_message_asks_for`); asking counts only when that list includes the action. A check that fails (timeout, rate limit) blocks like a refusal and is recorded in `consent_diagnostics` as `failed`. Only one save or alert change runs per turn. An approved save is committed inside the loop (`commitWishlist` in `lib/inbox.js`), before the reply, so the reply can say it happened.
- **An unreachable model** is retried once with reduced context (last 6 turns, no retailer color images). A failure before any tool ran goes back to the inbox, whose compact retry reruns the turn once; only if that also fails is "i couldn’t prepare a reply" sent. A failure after tools ran ends the loop with what it has (the drafts, composed in Jules's voice); it never discards a save.
- **Model.** `OPENAI_CHAT_MODEL` (falls back to `OPENAI_MODEL`, then `gpt-4.1-mini`) is used for the loop and the composer; background calls (consent check, search, memory, receipts) stay on `OPENAI_MODEL`. Reasoning models (o-series, GPT-5) run with low reasoning effort and their reasoning items are passed back between rounds.

**Search turns reply in stages.** With `find_products` the agent also writes a one-line `acknowledgment`. `lib/inbox.js` sends it (operation `ack:<message>`) before the search runs, then responds to the webhook. The search finishes in Vercel's `waitUntil` and the result goes out as its own message. If the search passes 90 seconds (`SEARCH_FOLLOWUP_MS`; testers preferred waiting to an earlier update), `searchFollowup` (model-written, VOICE.md) sends one update (`followup:<message>`). An update is never sent after the result. The result row is re-dated at send time so history keeps send order. Turns that don't search finish before the webhook responds, as before. A model call refused for a short rate limit (HTTP 429, not exhausted quota) is sent again once after the wait the API asks for (at most 4 s). A failed reply is retried once with a compact context (six recent turns, no retailer colour images) before the generic fallback. Reply diagnostics record each step with when it began (`steps`) and, for a refused model call, the API error code and exhausted limit. `timing_diagnostics` on the search outcome records `first_message_ms` and `result_ms`, and the `turn_timing` log line records them for every turn.

| Skill (tool) | Offered when | Executor | Writes to |
|---|---|---|---|
| `find_products` | search enabled | `lib/text-wishlist.js` (text) or `lib/search.js` (photos) | `messages.search_result` (workflow) |
| `ask_shopping_question` | wishlist enabled | `lib/text-wishlist.js` | pending brief (workflow) |
| `respond_to_options` | there are pending options | `lib/wishlist-selection.js` | pending selection (workflow) |
| `save_to_wishlist` | wishlist enabled | `lib/wishlist-selection.js`, then committed inside the loop before the reply | `wishlist_items`, `wishlist_event` evidence |
| `manage_price_alerts` (create / status / cancel) | wishlist enabled | create: `lib/wishlist-selection.js`; status/cancel: `manageAlerts` in `lib/inbox.js` | `price_alerts` |
| `wishlist_status` | wishlist enabled | grounded reply; link added by code | none |
| `prepare_checkout` | `CHECKOUT_LINKS_ENABLED`, with pending options or saved items | `lib/checkout.js`: a cart link with the exact size for stores in Shop's catalog, otherwise the product page; never pays | `messages.search_result` (`purchase_intent`) |
| `update_purchase_history` | the user has imported purchases | `lib/receipt-chat.js` | `correction` evidence, open questions |
| `update_profile` (remember / correct / forget) | memory enabled | `updateProfile` in `lib/memory.js` | `chat_statement` evidence + beliefs |
| `profile_status` | memory enabled | grounded reply | none |
| `onboarding` (accept / decline / status / style) | invited to onboarding, or `/style` enabled | `onboardingAction` in `lib/onboarding.js` | `onboarding_sessions` |
| quality signal: an independent structured check beside the turn (`qualityCheck`), plus the `record_quality_signal` side tool in the first round; at most one is saved per turn | the store can save it and Jules has spoken before | `store.saveQualitySignal` (best effort; logged as `quality_signal`) | `messages.quality_signal` |
| `conversation_reply` | always | ends the turn with the model's message, checked by code (below) | none |

Structured arguments replace wording rules: the agent passes `department` (men/women/unisex/unspecified) and `for_someone_else` with each search, so code never parses "for my wife" or "women's" out of text. Consent for saves and alerts is checked in code against the actual offer and options (`invalidOfferConsent`, `selectionOutcome`). Previously there were four separate model calls or routers per message (onboarding, purchase-history check, memory extraction, then one of two interpreters); now there is one.

## How replies are written

Jules has no fixed reply text. In chat, the agent loop's model writes the final message itself from the tool results it saw (above), following `VOICE.md`. Tools still draft their result in plain factual text; that draft is what the model restates, and what the checks compare against. Code checks the message before sending (`checkComposed` in `lib/compose.js`, shared by the loop and the composer):
- every link in this turn's drafts is present unchanged, and no other links are added (links already in the conversation, pending options or saved items may be repeated);
- no price appears that a draft, the conversation or a pending option didn't state;
- the model's structured `claims` (`saved_now`, `alerts_turned_on`, `alerts_turned_off`) match what this turn actually did.
- when the wishlist is on, an independent reading of the message (`auditClaims`, one small structured model call) agrees with what this turn did: nothing said to be saved or alerted that wasn't, nothing done left unsaid, and no other item named as the one saved. The writer's own `claims` are self-reported, so they alone cannot catch a message that says "added" while declaring nothing. An unavailable reading leaves the declared claims standing. Save drafts name the saved items for the same reason.

Links and prices from the recent turns may be repeated in composed messages too. Why a draft was sent instead of a model-written message is recorded in reply diagnostics (`compose_fallback` / `agent_fallback`: reason and problem kinds, never text). A save committed before the turn fails is reported by the fallback reply as completed work.

A message that fails the checks gets one retry, with the problems listed in the tool output and `conversation_reply` forced. If it fails again, the plain factual drafts are sent (a conversation-only reply keeps only its sentences that pass). If the loop ends without a message (round cap or repeated calls), the drafts go to the composer below.

Outside the chat loop, `lib/compose.js` writes messages from code drafts: notifications sent through `deliverReply` (price alerts, onboarding, purchase questions, save confirmations), and the loop's drafts when it ended without a message. The composer gets the draft as a factual outcome, with the recent turns and `VOICE.md`, applies the same checks and one retry, and sends the draft unchanged if the model is unreachable or both attempts fail. The only other fixed text is the reply when the agent itself fails, and the `#dev` acknowledgment. Notifications sent through `deliverReply` (price alerts, onboarding, purchase questions, save confirmations) are composed the same way; the stored message is the text actually sent.

Results the search retrieved but couldn't read (the store's page blocked or timed out) are real options, not failures: they are shown with their link, store and any search-index price, marked as unverified (`reference_provenance: 'search_unverified'`), and can be selected and saved; the wishlist stores them with price and stock unknown. A missing page, a page that isn't this product, or an unsupported source is still left out.

Alert sizing is structured too. The agent tags each alerted option as `footwear`, `apparel` or `one_size` (`option_sizing`). A saved shoe size applies only to footwear. A one-size item is watched under the `One size` key, priced from the listing offer bound to its exact URL, and only when the page lists no other sizes.

## Product search: which source runs when

Cheapest reliable source first; the model-driven web search (`gpt-4.1` + web search, the most expensive and slowest step) is the fallback.

| Request | First | Fallback |
|---|---|---|
| Photo or screenshot | Google Lens via SerpApi (`VISUAL_SEARCH_ENABLED=true` in production) | Web search with the image |
| Named product or identifiable brief | SerpApi Google results + our own page checks (no model call) | Web search when nothing verifies |
| Open discovery ("understated white sneakers, any brand") | Web search (needs breadth) | SerpApi recovery |
| Identification from context ("the jacket Connor Storrie wore") | Structured lookup usually finds nothing, then web search | |

- **Shop's catalog** (`SHOP_CATALOG_ENABLED`) runs beside the first web search as one more source (`shopCandidates` in `lib/text-sources.js`). It searches the same brief as the web: the request for a named or pictured item, each stylist direction for discovery (its results tagged with the direction and placed after every direction's web results), and nothing for a discovery without directions. It covers Shopify stores only. Its results are candidate URLs: each plain product page passes the same listing check, results interleave with web results, and market/taste ranking decides order. A required brand whose own store is listed in `lib/shopify-stores.json` (refresh with `node scripts/shopify-stores.js`) is searched inside that store. If web search fails, verified Shop results are shown instead of a failure. `text_wishlist_sources` logs and the replay report count shown merchants per source.
- **Variants:** the expensive "find variants" web search runs only when the agent sets `show_variants` (the user named a model without its version, or asked which versions exist). Color options listed on the retailer's own page are always read; that costs no model call.
- **Price stance** (`lib/price-stance.js`): what the shopper is willing to pay, as a price band for one request. Memory saves budgets (scoped to a category, special pieces, basics or general) and spending facts (`prefers_lower`, `quality`); the search plan names which saved budget or stated limit fits this item. Code only parses those stored values and compares verified prices against the band. The band is a soft ranking signal except its ceiling: a verified price above it never takes a slot an in-budget option could fill. A price far below a stated floor (or a tenth of the ceiling for someone who likes quality pieces) is flagged as a quality concern, never filtered. An unknown price stays unknown and is never judged. Used by `lib/text-wishlist.js` and `lib/discovery-ranking.js`.
- **Search before asking:** when the agent decides a question is needed, the executor first runs the structured lookup. With verified candidates, a small model call writes the one question that best separates them, and the candidates are shown as selectable options ("Could it be one of these?"). With none, the agent's question is asked as is.

## Around the turn: access, spending and proactive texts

These run outside the agent loop, each behind its own flag, and none decides what a message means.

- **Waitlist** (`lib/waitlist.js`, `db/035_waitlist.sql`, `WAITLIST_ENABLED`). Numbers that existed when `db/035` ran are approved; new numbers start on the waitlist. A waitlisted number gets 3 real replies (`WAITLIST_REPLIES`), then one fixed notice a day, and other messages are stored without a reply. The allowance is decided atomically in the database so rapid messages can't exceed it. The agent sees the waitlist in application context and mentions it in its own words. The owner approves people in Admin › People, which texts them once (`approveAccess`); with self-serve onboarding on (`SELF_SERVE_ONBOARDING_ENABLED`, which also needs onboarding and the Gmail import), approval sets up their account and texts the onboarding welcome instead.
- **Spending caps** (`lib/cost-caps.js`, `db/036_cost_caps.sql`, `COST-CAPS.md`). Four ceilings in US dollars, per person and global, per UTC day and month, all off unless set (`COST_CAP_USER_DAILY_USD`, `COST_CAP_USER_MONTHLY_USD`, `COST_CAP_GLOBAL_DAILY_USD`, `COST_CAP_GLOBAL_MONTHLY_USD`). Spend is the metered estimate in `usage_events`, repriced from token and search counts at current list prices. Caps are checked before work starts (the inbox, price checks, Gmail and Shop imports, the daily purchase check, the judge, signup) and by the meter itself (`enforceCaps` in `lib/usage.js`), so one turn can run a few cents past a ceiling and the next one stops. A capped chat gets a fixed, no-cost notice at most every 3 hours; background work waits and resumes after the reset; a global cap also pauses signups. Owner tools are never stopped but count toward the global total. Everyone is on the free plan (`planFor`).
- **Daily purchase check** (`lib/purchase-texts.js`, Vercel cron `/api/wishlist?gmail=refresh` at 17:00 UTC, `PURCHASE_TEXTS_ENABLED`). For everyone with Gmail connected it reads only mail since the last check, with the import's reading rules, so new purchases land in purchase history and the wardrobe. Its job state lives in `data.refresh`, separate from the last full import in `data.job`. Then Jules sends at most one proactive text a day about what was bought: the model picks the lead item and an angle (`styling`, `new_direction`, `pattern`, `just_added`), and code falls back to `just_added` when the purchase history doesn't support the angle.
- **Fit checks** (`lib/fit-checks.js`, `FIT_CHECKS_ENABLED`). A few days after something the person bought for themselves arrives, Jules asks how it fits in the size they bought. Arrival comes only from their own email (a delivery notice, else about five days after shipping); past the window it stays quiet. Fit checks share the daily slot with purchase texts: at most one proactive text a day per person. The answer goes through `update_purchase_history`, which the model reads into a structured `report_fit` or `report_return` (`lib/receipt-feedback.js`).
- **Price checks** (`api/price-checks.js`, Vercel cron at 13:00 UTC): checks active alerts; a capped person's alerts are skipped and checked on a later run.

## Adding a purchase-history source

Connected sources are services the user signs in to (Shop today, `SHOP_ORDERS_ENABLED`; see `SHOP.md`). Shop is also a search source (`SHOP_CATALOG_ENABLED`, above) and supplies cart links for `prepare_checkout` (`CHECKOUT_LINKS_ENABLED`); the three are separate flags.

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
| `adoption_events` | One row per reply that showed product options (`results_shown`, quantity = options linked), product-link tap through `/go/…` (`link_click`), purchase request (`purchase_intent`), or tapback on a reply (`reaction`, kind in `detail`), with the reply's operation id. No message text, links or phone numbers (`lib/adoption-events.js`). Feeds save rate, clicks and the Purchase intent step on Admin › Adoption. |
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

The People page compares the last 7 days with the 7 before (`metricsTrend`). Each metric is judged on its own sample (timed replies, replies with recorded authorship, named searches that ended in a pick); under 5 in either week is "too few to tell", a figure with nothing the week before is "no earlier data", and a week with nothing is "no data" with a dash. Each cell shows the week before's value and its sample, and "What these numbers mean" under the strip explains each one.

### Turn outcomes

`lib/turn-outcomes.js` gives one record per **sourcing turn** (a reply that ran `find_products` or `ask_shopping_question`): request type (text, photo, link), products shown and how many were verified pages, the result (verified, unverified only, nothing found, a shopping question, failed, unreadable photo), time to first reply and to result, cost (`usage_events` for every operation ending `:<inbound id>`), and labels for what the user did next. Read it with `node --env-file=.env.local scripts/turn-outcomes.js` or `/api/admin?view=turn-outcomes` (ids, counts and labels only).

Labels come only from structured data, never message text: the actions the agent ran for the user's later messages (`reply_diagnostics.actions`, written by `lib/turn-actions.js`: tool, how code ran it, the decision and option numbers in its arguments, whether a search continued the request), what code actually saved or turned on (`saved_now`, `alerts_turned_on`), tapbacks (`adoption_events` kind `reaction`, recorded against the reply they point at), tracked link taps, 👎/`#dev` flags and quality signals. A threaded reply or tapback attaches to the turn it points at; otherwise a message belongs to the newest turn whose results were sent before it, until a later search's results go out. Replies from before actions were recorded use the stored `intent_action`/`intent_decision`, `user_confirmed` and the chosen tool in `usage_events.action`; with none of those the follow-up is `not_recorded` and left out of engagement rates.

### Nightly judge

`lib/judge.js` scores each sourcing turn once, a day after its results (so the user's next message is evidence), against six criteria, each pass / fail / not applicable with a one-sentence paraphrased reason. Two are checked by code: **links verified** (every product link Jules sent is in the turn's checked results and is a verified page; Jules's own links are ignored) and the code half of **consent** (a save or alert ran only after the consent check). The model (`OPENAI_JUDGE_MODEL`, default `OPENAI_MODEL`) judges **identity**, **commerce facts**, **unnecessary clarification**, **repetition** and the claim half of **consent** from the redacted conversation, this turn's messages, `optionFacts` for the shown products, the recorded actions and the next user message. It does not see photos, so identity for photo requests is judged from the text only. A turn passes when no applicable criterion fails.

The Supabase scheduler calls `/api/imessage?job=judge` (same secret as the reply watchdog) every 10 minutes, 09:00–11:50 UTC. Each call refreshes the last three days' outcomes into `sourcing_turns`, then judges due turns within `JUDGE_DAILY_TURNS` (default 50), the global cost cap and the function's time. Calls are metered as the `judge` job (feature `judge`), never against the tester's own cap; about $0.001 per turn on gpt-4.1-mini. Failures appear in feedback-triage packets as `judge_failure`. `node --env-file=.env.local scripts/judge.js --dry --limit 5` scores turns without saving (`--days 7 --negative` picks turns with a negative outcome to check the judge against).

### Admin › Scorecard

`/admin/quality` (`public/scorecard.html`, figures in `public/scorecard-view.js`, data from `lib/scorecard.js`): this week against last week and an 8-week table for verified-result rate, positive next step, judge pass rate, first reply and result times (typical and slowest 10%), failed or nothing found, and cost per search, filterable by request type. Each figure is judged on its own sample (under 5 either week is too few to tell). Older weeks come from `sourcing_turns`; the last three days are computed live. **Turns to read** lists judge failures, then negative outcomes, then failed searches, each linking to the message; the owner can mark the judge right or wrong (`founder_verdict`, shown as an agreement rate) and copy a redacted replay-case draft. `node --env-file=.env.local scripts/judge.js --backfill 56` saves older outcomes without judging them.

`scripts/replay-gate.js` is the pre-deploy check on the same behavior: see `REPLAY-SUITE.md`.

## Known gaps and existing debt (honest list)

- **iMessage photos are not evidence yet.** They are used for the current search only; nothing learns taste from them. If something does, they must become evidence rows first.
- **Receipts texted to Jules are not supported yet.** The `chat` origin and `purchase_event` kind are ready for it.
- **Alerts on an already-saved item that isn't in the current options** can be checked and cancelled in chat but not created there yet; creation goes through current options or the wishlist page.
- **Wishlist evidence is written right after the save or change, not in the same transaction.** Row IDs are deterministic, so retries don't duplicate, but a crash between the two could miss a row. After an unclear save or alert failure, chat repeats only the failed keyed write once and then replies from what is stored (`settleTextWishlist`); a repeated remove/restore on the wishlist page writes nothing.
- **The replay grader (`lib/replay.js`) still scores replies with phrase checks.** It grades test output; it does not route messages. `REPLAY-SUITE.md` already flags replacing it with structured grading.
- **Output safety filters use word lists** (commerce claims in search reasons, body comments in style copy; the style report's shared lists are in `lib/copy-guards.js`). They check what Jules writes, not what the user means.
- **`messages` mixes transcript and workflow** (`search_result`, `wishlist_payload`). Acceptable at this scale.
- **Live model behavior needs regular checks.** Unit tests mock the model's tool choice. The routing eval (`lib/agent-eval-cases.js`, 50 labeled turns, "Run routing eval" on `/admin/replays`) scores the real model's tool and argument choices with tools stubbed; run it after any prompt or tool change. Replace synthetic cases with real turns over time (keep those private).
- **Cost estimates use list prices** in `lib/usage.js`; update them when provider prices change.

## Deployment order

- `db/019_evidence.sql`: applied October 12, 2026. `db/020_drop_evidence_transition.sql` removes the transitional functions and backups once the release is verified.
- `db/022_history_sources.sql`: replaces the fixed origin list with the `evidence_origins` table (adds `shop`), clears every purchase-history origin with imported history, and lets a connected source create the history row. Run before `SHOP_ORDERS_ENABLED=true`.
- `db/027_reply_sent_at.sql`: adds `messages.sent_at` and the trigger that stamps it. Run before relying on reply speed for turns that don't search. Nothing reads it until then: the metrics fall back to estimates and label them as such.
- `db/021_usage_events.sql`: run before relying on cost data. Until then usage writes fail quietly (logged as `usage_record_failed`) and nothing else is affected.
- `db/038_nightly_judge.sql`: creates `sourcing_turns` and schedules `jules-nightly-judge`. Needs `db/023` (scheduler secret) and `db/034_recurring_jobs.sql` (job runs). Until it runs, nothing is judged and triage says judge failures are unavailable.
- `db/034_turn_outcomes.sql`: allows `reaction` rows in `adoption_events` and adds their `detail` (the tapback kind). Run before relying on tapbacks in turn outcomes. Until then tapbacks are logged only.
- `db/033_signup_ref.sql`: adds `public_signups.ref`, the source code from a `/signup?ref=…` link (or `utm_source`, or a landing-page link carrying `?ref=`; the shared style report's signup link is `shared-report`). Run before relying on the Source column in Admin › People. Until then signups save without it and log `signup_ref_unsaved`.
- `db/035_waitlist.sql`: adds waitlist access. Everyone with a conversation when it runs is approved. Nothing reads it until `WAITLIST_ENABLED=true`.
- `db/036_cost_caps.sql`: adds per-person daily spend with token and search counts, so caps price calls at current list prices, and reprices gpt-5.5 calls stored at $0. Until it runs, caps use the stored per-call estimates, which undercount those calls.
- `db/032_adoption_events.sql`: run before relying on save rate, link clicks or purchase intent in Admin › Adoption. Until then event writes fail quietly (logged as `adoption_event_failed`), the page shows them as not tracked, and tracked links still forward. Product links are always sent as `/go/…` links (they carry the product preview, see `RICH-PREVIEWS.md`); turn on `LINK_CLICK_TRACKING=true` afterwards to record taps on them.
