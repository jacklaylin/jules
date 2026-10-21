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

A full run (about 80 cases) takes a few minutes and costs roughly $1–3 in OpenAI credits, mostly the judge. It uses no SerpApi searches and never texts anyone, saves items or turns on alerts. Spending stops at `--max-cost` (default $10).

Useful options:

- `--model gpt-5.5`: try another chat model (the judge stays the same).
- `--runs 3`: run each case three times; the model is not deterministic, so compare prompt changes on 3 runs.
- `--cases dev-c92121ef,dev-5d59f14e` or `--category reply_quality`: rerun the cases you are fixing.
- `--no-sync`: don't look for new reports first.
- `node --env-file=.env.local scripts/frozen-evals.js list`: every case, its category and the report text.
- `node --env-file=.env.local scripts/frozen-evals.js sync --since 2026-10-13T00:00:00Z`: freeze only.

The chat bake-off (`scripts/model-bakeoff.js chat`, `MODEL-BAKEOFF.md`) runs these cases too and prints `frozen NN%` next to each model; add `--no-frozen` to leave them out.

## Where the cases live

Cases hold private conversations, so they are **never in the repository**. They are files in `~/.jules/frozen-evals/cases/` on the computer that ran `sync` (set `FROZEN_EVALS_DIR` to put them elsewhere; a folder inside the repository is refused). Files are readable only by you. Phone numbers and emails in any text are masked, and the conversation id is replaced by a one-way hash. Each run also writes its replies and reasons to `~/.jules/frozen-evals/runs/`.

To keep a case set across computers, copy that folder; don't commit it.

## What a case contains

- the reported user message, its photos, and the 20 messages before it (threaded replies resolved as the inbox does),
- the pending shopping state at that moment (pending options, `current_search_plan`), the wishlist items saved before it, and the profile facts,
- the reply Jules sent and what its search found,
- the expectation: the founder's report text, or the quality signal's summary and kind,
- a category: the quality signal's kind, or for a report, the same kinds read from the report by a small model (`wrong_results`, `ignored_request`, `misunderstood`, `repeated`, `missed_available_item`, `reply_quality`, `praise`, `other`).

Which turn a report is about: a report threaded on a Jules reply is about that reply's turn; an unthreaded report is about the latest Jules reply before it; a quality signal is about the reply before the message it was saved on. A report on a message the agent did not write (a Gmail import notice, a search follow-up, an interview question) is kept but marked not replayable and left out of the pass rate.

## How a case is run and scored

Only the agent turn runs (the same loop as the routing evals, `lib/agent-eval.js`). Every tool is stubbed: a search answers with the products the original turn found; a save, alert or other action answers with a placeholder. The draft goes through the composer when the inbox would compose it, so the judge sees the message the user would get.

The judge (`gpt-5.5` by default, `FROZEN_JUDGE_MODEL` to change; it never changes with the chat model under test) scores four criteria, each pass, fail or not applicable:

1. **Did what the user asked**
2. **One coherent message**: never contradicts itself (asks to save and says saved), never claims a save or result the actions don't show
3. **No repeated questions**
4. **Respects the report**: the problem the report describes does not happen again

A case passes when no criterion fails.

## Limits

- Searches are not re-run, so a fix to search itself (a new store, a better query) does not move this number; the replay suite (`REPLAY-SUITE.md`) covers sourcing.
- Earlier photos the agent could look up, onboarding and the style interview are not in the case.
- Profile facts changed after the turn are left out, since their earlier value is unknown.
- The quick acknowledgment sent before a search (“looking for…”) is not reproduced.
- The judge is a model: read the failing reasons, and treat a change of a few points as noise unless it holds over `--runs 3`.
