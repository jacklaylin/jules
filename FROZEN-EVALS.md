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

A full run (76 replayable cases) takes about 6 minutes and costs about $3 in OpenAI credits, mostly the judge; `--runs 3` about $9. It uses no SerpApi searches and never texts anyone, saves items or turns on alerts. Spending stops at `--max-cost` (default $15).

Useful options:

- `--model gpt-5.5`: try another chat model (the judge stays the same).
- `--runs 3`: run each case three times; the model is not deterministic, so compare prompt changes on 3 runs.
- `--cases dev-c92121ef,dev-5d59f14e` or `--category reply_quality`: rerun the cases you are fixing.
- `--no-sync`: don't look for new reports first.
- `node --env-file=.env.local scripts/frozen-evals.js list`: every case, its category and the report text.
- `node --env-file=.env.local scripts/frozen-evals.js sync --since 2026-10-13T00:00:00Z`: freeze only.

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

Only the agent turn runs (the same loop as the routing evals, `lib/agent-eval.js`). The turn's facts go through the same `readUserContext` prod uses (`lib/context-snapshot.js`), so the agent sees the purchase summary, wardrobe, liked items, wishlist and the `brand_taste` reading rebuilt from the case's `context`. A case frozen before `context` existed replays with its stated facts only (its stated brands still read as `brand_taste`, as in prod). Every tool is stubbed: a search answers with the products the original turn found; a save, alert or other action answers with a placeholder. The draft goes through the composer when the inbox would compose it, so the judge sees the message the user would get.

The judge (`gpt-5.5` by default, `FROZEN_JUDGE_MODEL` to change; it never changes with the chat model under test) scores four criteria, each pass, fail or not applicable:

1. **Did what the user asked**
2. **One coherent message**: never contradicts itself (asks to save and says saved), never claims a save or result the actions don't show
3. **No repeated questions**
4. **Respects the report**: the problem the report describes does not happen again

A case passes when no criterion fails.

Because searches replay their recorded results, a report that is only about *what the search found* (wrong item, store, gender, sold out, spam site, a missed listing) or only about *how links are delivered* (wrapping, shortening, preview cards) is scored not applicable on “respects the report”. It still fails when Jules's own choices repeat the problem, for example re-showing a result the user rejected or calling a different item the exact one. Frozen runs always use the production capabilities (search, wishlist, price alerts, memory on), whatever the local `.env.local` says.

## Limits

- Searches are not re-run, so a fix to search itself (a new store, a better query) does not move this number; the replay suite (`REPLAY-SUITE.md`) covers sourcing.
- Earlier photos the agent could look up, onboarding and the style interview are not in the case.
- Profile facts changed after the turn are left out, since their earlier value is unknown.
- The purchase summary and closet are as of freezing, not the turn (they are totals over receipts and can't be rolled back to a date). Outfit photos are not in the case.
- The quick acknowledgment sent before a search (“looking for…”) is not reproduced.
- The judge is a model: read the failing reasons, and treat a change of a few points as noise unless it holds over `--runs 3`.
