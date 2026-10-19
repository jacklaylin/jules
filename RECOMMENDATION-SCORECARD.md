# Recommendation quality scorecard — plan

Status: **approved 2026-10-19 with the low-cost judge** (below). Built one PR at a time.

Goal: measure how good Jules's search and recommendations are from real tester traffic, without waiting for testers to file `#dev` reports or 👎 a reply.

## What already exists (and what this plan reuses)

Since this work was scoped, several pieces have shipped. The scorecard builds on them; it doesn't replace them.

| Already on main | Where | Reused for |
|---|---|---|
| Time to first message / final result, failed replies, first-try find rate | `lib/chat-metrics.js` (People page strip) | latency, failed rate |
| Model-inferred "Jules missed" notes on the user's next message | `messages.quality_signal` (db/025), `record_quality_signal` + `qualityCheck` | negative next action, worst-turn ranking |
| Results shown, link clicks (`/go/…`, off by default), purchase intent | `adoption_events` (db/032), Admin › Adoption | engagement |
| Photo outcomes, misses by kind | Admin › Adoption › Quality | stays where it is |
| Per-call cost, keyed by operation id | `usage_events` (db/021) | cost per sourcing request |
| Search verification status per product | `messages.search_result` (`listing_check.status`, `text_wishlist_diagnostics.status`) | verified-result rate |
| Step-by-step reply trace | `messages.reply_diagnostics` (db/028) | records which tools ran (below) |

**Real gaps:** (1) what the user did *next* after a set of results is not recorded as a structured label; (2) non-👎 tapbacks (❤️ 👍 😂 …) are only logged, never stored; (3) no automated grading of transcripts; (4) no single weekly scorecard; (5) no signup source.

## Recommended build order (one PR each, reviewed in prod before the next)

I recommend shipping the **signup `ref`** first: it's tiny, independent, and every signup before it lands is unattributable forever. Then the quality work in order.

### PR 1 — Signup source (`/signup?ref=…`)

- `signup.html` reads `ref` from the page URL (falls back to `utm_source`), keeps it only if it looks like a short code (`a-z 0-9 _ -`, ≤ 40 chars, lower-cased) and sends it with the form. The server checks the same format again; anything else is dropped, never rejected — a bad link must not block a signup.
- Stored on the signup row. Shown as a **Source** column on Admin › People (blank = direct).
- Tests: format validation, missing/odd values still sign up.
- **Migration `db/033_signup_ref.sql`** — one line: `alter table public_signups add column if not exists ref text`. Code tolerates it not being run yet (saves without the ref and logs `signup_ref_unsaved`).

### PR 2 — Per-turn outcome records

**A sourcing turn** = one inbound message whose reply ran `find_products` or `ask_shopping_question` (text, photo or link).

Two small additions in the live path; everything else is derived from rows that already exist.

1. **Record which tools the agent ran and their structured result** in the existing `reply_diagnostics` (no migration): e.g. `{tool: 'respond_to_options', decision: 'decline', option_indices: [...]}`, `{tool: 'find_products', continuation: 'same_request', mode: 'alternatives'}`, `{tool: 'save_to_wishlist', outcome: 'saved_now'}`, `{tool: 'manage_price_alerts', outcome: 'alerts_turned_on'}`, `{tool: 'prepare_checkout'}`. These are the model's own interpreted intent plus what code actually did.
2. **Store tapbacks** (all kinds, not only 👎) as `adoption_events` rows of kind `reaction` with the emoji and the reply they target. The emoji is a protocol field Photon sends, read the same way 👎 already is — not wording.

Then a pure labeler, `lib/turn-outcomes.js` (rows in, records out, like `chat-metrics.js`), produces one record per sourcing turn:

| Field | Source |
|---|---|
| request type: text / photo / link | inbound message (attachment / supplied link in the search plan) |
| products shown, verified product pages shown | `search_result.products` + `listing_check.status` |
| search status | `text_wishlist_diagnostics.status` / photo outcome (shown, shown unverified, nothing found, constraints rejected, unreadable, fallback, stalled) |
| time to first reply, time to result | `chat-metrics.js` turn timing |
| cost (USD) | sum of `usage_events` whose operation ends `:<inbound id>` |
| **next action** | below |

**Next action**, taken only from the next turn's recorded tool calls and outcomes (never from wording):

| Label | When | Counts as |
|---|---|---|
| `saved` | a save committed (`saved_now`) | positive |
| `alert_on` | alerts turned on | positive |
| `picked` | `respond_to_options` decision `interest` | positive |
| `purchase_intent` | `prepare_checkout` ran | positive |
| `clicked` | a `link_click` on this reply (existing `/go/` tracking, #159; counted whenever `LINK_CLICK_TRACKING` is on) | positive |
| `reacted` | a tapback on this reply: ❤️ 👍 😂 ‼️ positive, ❓ / 👎 negative | by emoji |
| `rejected` | `respond_to_options` decision `decline` | negative |
| `asked_for_other` | `find_products` on the same request asking for different results | negative |
| `refined` | `find_products` on the same request with added/changed constraints | neutral |
| `clarified` | `respond_to_options` decision `clarify` | neutral |
| `moved_on` | next turn is a new request or something else | neutral |
| `silent` | no message from the user within 24 h | neutral (reported separately) |

Rules: a turn can carry several labels (picked two, rejected one → `picked` + `rejected`); the headline uses the strongest (positive beats neutral; negative is still counted). A threaded reply or tapback attaches to the turn it **targets**, not the newest one. A quality signal on the next message marks the turn `missed` regardless.

Persisted nightly (PR 3's job) into a new `sourcing_turns` table keyed by the reply's operation id, so labels are frozen next to the judge's scores; the admin page computes today's not-yet-saved turns live with the same labeler.

- Tests: the labeler across varied multi-turn sequences — subsets, all, none, a correction, uncertainty (`clarify`), a topic change, a reply to an older result set, a tapback on an older reply, rapid double messages, silence — asserting labels from tool calls, never from text.
- **Migration `db/034_turn_outcomes.sql`**: allow `reaction` in `adoption_events.kind`, add a `detail` column (the emoji), and create `sourcing_turns`. Code before it runs: reactions are logged only (as today), nothing breaks.

### PR 3 — Nightly LLM judge

- **Schedule:** Supabase `pg_cron` calls an existing function every 10 minutes between 2 and 4 am Pacific (same pattern and secret as the Gmail sweep), so no new service and no new Vercel function (Hobby allows 12; we use 12). Each call judges a small batch within the 120 s limit and stops when the day is done; re-running never double-judges.
- **Input per turn:** the user's message (and photo), the 6 turns before, Jules's reply, the structured search result (what each page check actually found: name, variant, price, stock, sizes), and the user's next message.
- **Rubric** — each criterion `pass` / `fail` / `not_applicable` with a one-sentence neutral reason (no quotes, names or contact details, like quality signals):
  1. correct product identity and variant
  2. every link is a verified product page — **checked by code**, not the model (every URL in the reply is in the result and verified)
  3. no fabricated commerce facts — price, stock, sizes, shipping, discounts stated in the reply match what was checked
  4. no unnecessary clarifying question
  5. no repeated list or restarted search
  6. consent respected — **checked by code** from the recorded actions (no save/alert without a passing consent check); the judge adds context only
- A turn passes when no applicable criterion fails. Scores and reasons go into `sourcing_turns`.
- **Cost guard (low-cost for now, founder decision 2026-10-19):** the judge runs on `gpt-4.1-mini`, the model Jules already uses, at roughly $0.005 per judged reply: about $7 a month at an assumed 50 sourcing turns a day, and never more than about $7.50 a month because `JUDGE_DAILY_TURNS` defaults to 50. Calls are metered in `usage_events` (feature `judge`) and show on Admin › Costs. `OPENAI_JUDGE_MODEL` switches models without a code change.
- **Failures → triage:** the feedback-triage packet gains judge failures as a third source next to `#dev`/👎 and quality signals, so the daily triage task clusters and fixes them. Each failed turn has a **Copy as replay case** button on the drill-down that produces a draft case for `lib/replay.js` / `evals/IDENTIFICATION.md`; real turns stay private and are anonymised before they go in a case.
- **Trust check:** on the drill-down you can mark "judge was wrong" on a turn; the page shows judge agreement so you know when to trust the pass rate.
- Tests: rubric response parsing, the two code-checked criteria, batching/idempotency, cap.
- **Migration `db/035_judge_schedule.sql`**: the cron job only (`sourcing_turns` already exists from 034).

### PR 4 — Admin › Scorecard

New page `/admin/quality` under Conversations in the admin sub-nav, built from the shared design system (stat tiles, badges, table), served through the existing admin function.

- **This week vs last week**, with sample size and "too few to tell" under 5 (same rules as the People strip):
  - verified-result rate — sourcing turns that showed ≥ 1 verified product page
  - positive engagement rate — turns that showed products and got a positive next action
  - judge pass rate
  - time to first reply and to result, p50 / p90
  - failed or unsupported rate — fallback, stall, nothing found, constraints rejected, unreadable photo
  - cost per sourcing request
- **8-week trend** table for the same six numbers, split by request type (text / photo / link).
- **Worst turns** list: judge failures first (most criteria failed), then negative next actions and misses, then failures — each with the judge's reasons, labels and a link to the message in the person's conversation.
- Verified on desktop and phone before deploy, per `DESIGN-SYSTEM.md`.
- No migration.

## Decisions I need from you

1. **Order.** Recommendation: signup `ref` first, then outcomes → judge → scorecard page. (Alternative: scorecard page before the judge, showing outcome metrics only, so you see numbers a step earlier.)
2. **Judge sees message text.** Same data already sent to OpenAI for the reply itself; stored reasons are paraphrases. OK?

## Considered later

- **Stronger judge model.** A judge on the same model that wrote the replies tends to miss that model's own mistakes. Moving the judge to `gpt-4.1` (about $0.02 a reply, about $35 a month at 50 turns a day, $70 a month at a 100-turn cap) needs only `OPENAI_JUDGE_MODEL=gpt-4.1` in Vercel. Revisit once the "judge was wrong" agreement rate on the Scorecard shows whether the mini judge is reliable enough, or before going live.

## What you will run (manual migrations)

Each PR says it again; run in the Supabase SQL editor **right after merging** that PR:

- PR 1 → `db/033_signup_ref.sql`
- PR 2 → `db/034_turn_outcomes.sql`
- PR 3 → `db/035_judge_schedule.sql` (needs `db/023_gmail_sweep.sql` already applied, which it is)

Every PR's code works before its migration runs (it degrades and logs), so a late migration doesn't take Jules down.
