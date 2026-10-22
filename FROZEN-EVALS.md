# Frozen eval set

One number for chat quality, measured on real failures, without replaying conversations by hand.

Every `#dev` developer report and every saved quality signal becomes a **frozen case**: the turn that was reported, exactly as the agent saw it. Running the set re-runs only that agent turn with the current prompt and model, and a model judge scores the new reply. The result is a pass rate over all cases, with a breakdown by category. The set grows as new reports arrive.

## Run it

From the project folder, with the usual `.env.local`:

```bash
node --env-file=.env.local scripts/frozen-evals.js run
```

It first freezes any new reports (needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`), then runs every case once and prints:

- **PASS RATE**: the share of replayed cases where no criterion failed. This is the number to watch.
- the pass rate per category (`frozen:wrong_results`, `frozen:reply_quality`, …),
- the pass rate per criterion,
- each failing case with the judge's one-line reasons.

A full run (88 replayable cases on October 22) costs about $1.80 in OpenAI credits (from $3.35 before October 22); see "What a run costs". It uses no SerpApi searches and never texts anyone, saves items or turns on alerts. Spending stops at `--max-cost` (default $15). Before it starts, one tiny request checks the key and the balance.

For a PR, don't run this directly: `scripts/chat-gate.js` runs the PR's area ×3 on main and the PR and compares them case by case (CHAT-DEVELOPMENT.md "The gate").

Useful options:

- `--model gpt-5.5`: try another chat model (the judge stays the same).
- `--runs 3`: run each case three times; the model is not deterministic, so compare prompt changes on 3 runs.
- `--cases dev-c92121ef,dev-5d59f14e` or `--category reply_quality`: rerun the cases you are fixing.
- `--area consent,saves`: only the cases in those areas (`lib/eval-areas.js`; `list` shows each case's areas).
- `--out <file>`: where the results go (default `runs/<time>-<model>.json`).
- `--no-cache`: send the profile check every time instead of reusing its stored answer (below).
- `--no-sync`: don't look for new reports first.
- `node --env-file=.env.local scripts/frozen-evals.js list`: every case, its category, its areas and the report text.
- `node --env-file=.env.local scripts/frozen-evals.js rejudge --from <run file> --judge gpt-6-luna`: judge calibration (below).
- `node --env-file=.env.local scripts/frozen-evals.js sync --since 2026-10-13T00:00:00Z`: freeze only.
- `node --env-file=.env.local scripts/frozen-evals.js sync --refresh-context`: add the user context snapshot (`context`, below) to cases frozen before it existed (before October 22). It reads the database only: no model is called, nothing is re-frozen or re-classified, and new reports are not frozen. For each replayable case without `context`, it finds the case's report, captures the snapshot as of the reported turn (wishlist saves and liked items before it, the purchase summary and closet as they are now), re-reads the stated facts as of the turn with their dates and sources, and saves the case with every other field unchanged. A case whose report can't be found is listed and left as it is. Running it again only retries those.

The chat bake-off (`scripts/model-bakeoff.js chat`, `MODEL-BAKEOFF.md`) runs these cases too and prints `frozen NN%` next to each model; add `--no-frozen` to leave them out.

## Baseline (October 21, 2026)

76 replayable cases × 2 runs, chat `gpt-4.1-mini`, judge `gpt-5.5`, $6.18:

| | Pass rate |
| --- | --- |
| **All cases** | **52%** (79/152) |
| wrong_results | 46% |
| ignored_request | 41% |
| reply_quality | 59% |
| misunderstood | 64% |
| missed_available_item | 57% |
| Did what the user asked | 66% |
| One coherent message | 90% |
| No repeated questions | 79% |
| Respects the report | 54% |

34 cases passed both runs, 31 failed both, 11 passed once: a single run moves by several points from chance alone, so compare changes on `--runs 3`. Both Maison Margiela cases (`dev-c92121ef`, `dev-5d59f14e`) still fail on both runs: the agent tries to save before anything is pending (and asks which item to keep), then shows the same MR PORTER listing.

## Where the cases live

Cases hold private conversations, so they are **never in the repository**. They are files in `~/.jules/frozen-evals/cases/` on the computer that ran `sync` (set `FROZEN_EVALS_DIR` to put them elsewhere; a folder inside the repository is refused). Files are readable only by you. Phone numbers and emails in any text are masked, and the conversation id is replaced by a one-way hash. Each run also writes its replies and reasons to `~/.jules/frozen-evals/runs/`.

To keep a case set across computers, copy that folder; don't commit it.

## What a case contains

- the reported user message, its photos, and the 20 messages before it (threaded replies resolved as the inbox does),
- the pending shopping state at that moment (pending options, `current_search_plan`), the wishlist items saved before it, and the profile facts (with their dates),
- what the user context layer (`USER-CONTEXT.md`) read besides stated facts (`context`): wishlist saves before the turn with their kind-of-item tags, liked items kept before it, the purchase summary and the closet summary (without its per-piece list),
- the reply Jules sent and what its search found,
- the expectation: the founder's report text, or the quality signal's summary and kind,
- a category: the quality signal's kind, or for a report, the same kinds read from the report by a small model (`wrong_results`, `ignored_request`, `misunderstood`, `repeated`, `missed_available_item`, `reply_quality`, `praise`, `other`).

Which turn a report is about: a report threaded on a Jules reply is about that reply's turn; an unthreaded report is about the latest Jules reply before it; a quality signal is about the reply before the message it was saved on. A report on a message the agent did not write (a Gmail import notice, a search follow-up, an interview question) is kept but marked not replayable and left out of the pass rate.

## How a case is run and scored

Only the agent turn runs (the same loop as the routing evals, `lib/agent-eval.js`). The turn's facts go through the same `readUserContext` prod uses (`lib/context-snapshot.js`), so the agent sees the purchase summary, wardrobe, liked items, wishlist and the `brand_taste` reading rebuilt from the case's `context`. A case frozen before `context` existed replays with its stated facts only (its stated brands still read as `brand_taste`, as in prod) until `sync --refresh-context` adds it. Every tool is stubbed: a search answers with the products the original turn found; a save, alert or other action answers with a placeholder. The draft goes through the composer when the inbox would compose it, so the judge sees the message the user would get.

The judge scores four criteria, each pass, fail or not applicable:

1. **Did what the user asked**
2. **One coherent message**: never contradicts itself (asks to save and says saved), never claims a save or result the actions don't show
3. **No repeated questions**
4. **Respects the report**: the problem the report describes does not happen again

A case passes when no criterion fails.

Because searches replay their recorded results, a report that is only about *what the search found* (wrong item, store, gender, sold out, spam site, a missed listing) or only about *how links are delivered* (wrapping, shortening, preview cards) is scored not applicable on “respects the report”. It still fails when Jules's own choices repeat the problem, for example re-showing a result the user rejected or calling a different item the exact one. Frozen runs always use the production capabilities (search, wishlist, price alerts, memory on), whatever the local `.env.local` says.

### Code checks

Before the judge, code decides what it can from the turn itself (`codeChecks` in `lib/frozen-evals.js`): the turn produced no reply; the reply has a link or a price that nothing in the case or the turn's tool calls gave; the reply is an earlier Jules message sent again word for word. Each is a failure the judge could not overturn, so that run fails without a judge call (its other criteria read "not judged"). On the October 22 run (264 runs, gpt-5.6-luna) none of the 264 had one of these, so today they remove no judge calls; they stop a broken turn or a made-up link from costing a judge call or slipping past it. Save and alert decisions can't be decided this way for frozen cases: whether a save *should* have happened is the report's question, which is the judge's job. The routing evals (`lib/agent-eval-cases.js`) are where saves, alerts and options are decided entirely in code.

### The profile check is answered from a cache

Every turn runs the independent profile check (`lib/memory.js`, gpt-4.1), about a third of a run's cost. Its request is the conversation and saved facts only, never anything the agent wrote, so main, the PR and each of the ×3 runs send it the same request. `lib/eval-cache.js` keeps its answer in `FROZEN_EVALS_DIR/cache/requests.json`, keyed by the whole request: a change to the check's model, instructions or input is a new request and goes to OpenAI. The routing evals share the cache. `--no-cache` turns it off.

### The judge

`gpt-5.5` scores every criterion. It runs on OpenAI's **Flex** tier: half price, slower, sometimes briefly unavailable, in which case that call is retried at the standard tier (`FROZEN_JUDGE_TIER=default` turns Flex off). The chat turn under test never runs on Flex: its round time limits would trip and change what is measured.

Changing the judge: `FROZEN_JUDGE_MODEL` for every criterion, `FROZEN_JUDGE_PLAN=meets_report=gpt-5.5,coherent=gpt-5.5` for single criteria, `FROZEN_JUDGE_SCREEN=gpt-6-luna` for a cheaper first pass whose failures go to the plan's judge (off by default; see below), `--judges a,b` for several judges that must all pass a case. The judge never changes with the chat model under test.

**Calibration (October 22).** A cheaper judge becomes the default for a criterion only when it agrees with gpt-5.5 on at least 90% of runs there. `rejudge` re-scored the 264 stored runs of October 22 (chat gpt-5.6-luna, judged by gpt-5.5) with gpt-6-luna and gpt-5.6-luna, and gpt-5.5 re-scored its own failing runs and a sample of its passing ones. "Agrees" means both fail, or both don't (only a fail changes whether a case passes); "finds" is the share of gpt-5.5's failures the other judge also fails.

| Criterion | gpt-6-luna agrees · finds | gpt-5.6-luna agrees · finds | gpt-5.5 vs itself agrees · finds | screen gpt-6-luna → gpt-5.5 agrees · finds |
| --- | --- | --- | --- | --- |
| Did what the user asked | 86% · 60% | 86% · 55% | 93% · 77% | 91% · 60% |
| One coherent message | 84% · 72% | 87% · 39% | 88% · 61% | 98% · 72% |
| No repeated questions | 84% · 53% | 89% · 79% | 96% · 84% | 97% · 53% |
| Respects the report | 86% · 70% | 85% · 70% | 94% · 82% | 93% · 70% |
| Whole run passes or fails | 78% | 78% | 90% | 94% |

gpt-5.5 vs itself: its 97 failing runs re-judged in full, and 56 of its 167 passing runs, weighted back to all 264. The screen's "finds" is the screen's own (gpt-5.5 only confirms or overturns what the screen fails). Calibration spent $2.74 (luna judges $0.19, gpt-5.5 $2.55).

Neither cheaper judge reaches 90% on any criterion except gpt-6-luna on "respects the report" in the runs with exact turn facts (90%), so **gpt-5.5 stays the judge for all four**. Note that gpt-5.5 judging the same reply twice reaches only 88% on "one coherent message" and finds 61% of its own failures there: some of the disagreement is the judge's own noise, which is why the gate compares cases over ×3 runs rather than single verdicts.

A screening pass (`FROZEN_JUDGE_SCREEN=gpt-6-luna`) meets the 90% bar on every criterion (91%, 98%, 97%, 93%) and sends only 46% of runs to gpt-5.5, about halving the judge's cost, because gpt-5.5 has the last word on every failure. Its cost is that a failure the screen passes is never seen: it finds 60% of gpt-5.5's "did what the user asked" failures and 53% of its "no repeated questions" failures (gpt-5.5 re-finds 77% and 84% of its own). It is off until the founder decides that trade.

Re-run the calibration when the judge, its instructions or the chat model change: `rejudge --from <a stored run judged by gpt-5.5> --judge <model>` (`--failed`, `--passed`, `--sample n` keep it cheap; about $0.20 for 264 runs with a luna model, $0.016 a run for gpt-5.5).

### What a run costs

Measured October 22 on the production chat model (gpt-5.6-luna), per run of one case:

| Part | Before | Now | Why |
| --- | --- | --- | --- |
| Chat turn (gpt-5.6-luna) | $0.0033 | $0.0033 | the thing under test; never cached or on Flex |
| Side checks (consent, quality; gpt-4.1-mini) | $0.0009 | $0.0009 | |
| Profile check (gpt-4.1) | $0.0038 | $0 once cached | answered from the cache after the first run of a case |
| Judge (gpt-5.5) | $0.0265 | $0.0157 | Flex tier |
| **One run** | **$0.0345** | **$0.0199** | −42% |
| With `FROZEN_JUDGE_SCREEN=gpt-6-luna` | | about $0.0117 | judge about $0.0075 (gpt-6-luna $0.0003, gpt-5.5 on 46% of runs) |

The full set ×1 (88 replayable cases): about $3.35 before, about $1.80 now ($1.05 with the screen). The full set ×1 now was not measured end to end: the OpenAI organization hit its spend limit while this was being measured, so it is the sum of the parts above. A routing-eval case costs about $0.0037 a run, $0.0023 with the profile check cached.

## Limits

- Searches are not re-run, so a fix to search itself (a new store, a better query) does not move this number; the replay suite (`REPLAY-SUITE.md`) covers sourcing.
- Earlier photos the agent could look up, onboarding and the style interview are not in the case.
- Profile facts changed after the turn are left out, since their earlier value is unknown.
- The purchase summary and closet are as of freezing, not the turn (they are totals over receipts and can't be rolled back to a date). Outfit photos are not in the case.
- The quick acknowledgment sent before a search (“looking for…”) is not reproduced.
- The judge is a model: read the failing reasons, and treat a change of a few points as noise unless it holds over `--runs 3`. gpt-5.5 judging the same reply twice agrees on about 90% of runs.
- Runs stored before October 22 kept no turn facts (consent, saved, alerted); calibration rebuilds them from the tools that ran, exactly for runs that neither saved nor set an alert.
