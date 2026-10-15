# Reply regression suite

For the full tester-readiness gate, see `TESTER-READINESS.md`. This older shoe-oriented runner is a diagnostic subset. Its phrase-based clarification/refusal grading must be replaced with structured outcome grading before it can count as readiness evidence; it cannot verify saves, alerts or delivery. Use `npm run test:readiness` for the first controlled application-contract probes.

Acceptance: asking about a shoe yields sourced, individually checked product-page links compatible with the profile, or a useful question about the specific model or variants. Missing prices or stock are not reasons to reject an otherwise valid product page. Generic refusals fail when a supported known product should be available.

## Before every deploy: the replay gate

Run from the project folder, with the same `.env.local` the other scripts use (it needs `OPENAI_API_KEY`; the replay half also uses the search keys):

```bash
node --env-file=.env.local scripts/replay-gate.js
```

It runs every routing eval (`lib/agent-eval-cases.js`) and every replay case (`lib/replay.js`) three times against the real model, prints a pass rate per category (for example `agent:save`, `replay:alerts`), lists each case that failed at least once with its reasons, and exits with an error if any category is under 80%. **Don't deploy while it says `Gate FAILED`.** A full run takes about 20–30 minutes and uses OpenAI and SerpApi credits. It never texts anyone, saves items or turns on alerts.

When `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are in `.env.local`, the gate first checks that every migration the code needs has been run (`scripts/schema-check.js`) and stops with the missing `db/` filenames if not. Run them in the Supabase SQL editor, then rerun the gate.

If it stops at once with `OpenAI rejected the request (invalid_api_key)`, the `OPENAI_API_KEY` in `.env.local` is out of date. Copy the current value from Vercel (Project → Settings → Environment Variables) into `.env.local`; never into a file Git tracks. The same cases also appear on `/admin/replays`, which runs them with the deployed key.

Useful options:

- `--suite agent`: routing evals only. About 5 minutes, no search credits. Enough for a prompt or tool-schema change.
- `--suite replay`: replay cases only (real sourcing). Use when search or verification changed.
- `--runs 5 --threshold 0.9`: stricter, for changes to interpretation or consent.
- `--cases cheaper-and-alert,receipt-me-for-both` or `--category reports`: rerun the cases you are fixing.
- `--concurrency 2`: slower and gentler on rate limits.

Cases grade intent, state transitions and outcomes (which tool ran, which items were selected or saved, whether an alert was prepared with consent, whether a verified link to the named model came back), never exact wording. A case that passes only some of the time is flaky and still needs a fix. The `reports` category holds multi-turn cases from the latest feedback, each with a reworded twin: "Me for both" after a receipt question, "find these for cheaper and set a price alert", "add them to my wishlist" right after an unverified result, and named models found on the first try (`replay:named-first-try`).

After deploying, `node --env-file=.env.local scripts/chat-metrics.js` shows whether real conversations got faster and more reliable (see `ARCHITECTURE.md`, Chat quality metrics).

## Before reporting a fix

Follow the conversation operating principle in `AGENTS.md` and PRD Section 4.1. A single sentence reproducer is not sufficient coverage for an interpretation bug. Test varied language across complete turns: choose one, a subset, all, none, tentative preferences, exclusions, corrections, and a topic change. Assert the intended selected set, preserved context, useful next step, and consent scope rather than matching trigger phrases or exact response wording. A response that repeats the full list or forces one choice after the user expresses interest in several is a failure. Technical URL and evidence checks remain deterministic.

Wishlist selection now uses model-resolved option references, selected sets, and scoped consent. Feedback acknowledgements do not erase pending product state. The live suite includes subset, exclusion, all, and none turns; grading checks the resulting set and next action rather than reply wording. Phrase-based reaction handling and some older clarification grading still need refactoring to meet this principle.

1. Open **Replays & evals** (`/admin/replays`) in the admin console.
2. Replay the latest reported turn with the expected brand/model, and download its private snapshot. The snapshot uses the current profile: it cannot reconstruct the profile at the time of an older failure. Keep these reports outside Git.
3. Run all synthetic sourcing and selection cases, across Nike, ASICS, New Balance, Salomon, and Prada; include correction, explicit recipient, misspelling/spacing, ambiguous versions, unknown models, subsets, exclusions, all, and none.
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
- With the existing SerpApi key, failed text sources use one direct Google search rather than another model-selected source attempt. Only page-verified brand/model and department matches can be returned. Provider snippets do not establish commerce facts. This consumes one SerpApi search credit on recovery.
- Category and unreadable pages remain sourcing failures, not department mismatches. Clear named-item desires consistently enter the wishlist selection flow.
- Checked page titles label color variants, and matching SKUs deduplicate locale aliases. Distinct versions prompt version selection rather than a color question.

Run deterministic tests with `npm test`. They include page layouts, mismatch rejection, source-gated replay grading, no-side-effect execution, and owner authorization. Live acceptance is reported separately.

Request failures are recorded as failed runs and stop the queue. They are not automatically retried: the server may still have consumed API credits even when the browser loses the response.
