# Model bake-off, October 19–20, 2026

Question: can cheaper models do Jules's jobs as well as today's? No production model changed. Every default stays as it was until you decide.

## Recommendations

| Role | What it does | Today | Recommendation |
| --- | --- | --- | --- |
| chat | The conversation (agent loop and reply writer) | gpt-4.1-mini | **Keep for now; needs more data.** Both luna models tie on pass rate at a quarter to a ninth of the cost, but each has a weak spot testers would notice. gpt-5.6-luna sometimes searches again when asked to save, and gpt-6-luna asks questions instead of searching. Fixing the save case and rerunning would settle it. |
| search | Product sourcing with web search | gpt-4.1 | **Keep.** Both cheaper models found the right product less often. |
| extract | Gmail receipts and other small structured reads | gpt-4.1-mini | **Needs more data.** Not run: reading your Gmail needs your go-ahead (see "What you need to do"). |
| write | Style report lines | gpt-5.5 | **Needs more data.** gpt-6-luna passed every copy check at about 1/60th of the cost. Your blind judgement decides. |

Quality comes before cost, so nothing is a "switch" yet. The write role is closest: its candidate only needs your judgement on the blind page (about 10 minutes).

## Chat role

148 cases (132 routing evals with stubbed tools, 16 replay cases that need no search) × 3 runs per model. Same code for all models, run back to back on October 20.

| Model | Pass rate | Median | p90 | Chat model cost per 100 turns | Whole turn cost per 100 turns |
| --- | --- | --- | --- | --- | --- |
| gpt-4.1-mini (today) | 89.4% | 5.8 s | 10.1 s | $0.39 | $0.83 |
| gpt-6-luna | 88.7% | 6.5 s | 11.4 s | $0.04 | $0.30 |
| gpt-5.6-luna | 90.5% | 7.2 s | 12.8 s | $0.10 | $0.35 |
| gpt-5-nano (minimal reasoning) | 52% * | 8.4 s | 13.5 s | $0.06 | $0.69 |

\* gpt-5-nano was measured in the first run, where today's model scored 80% on the same code (see "Prompt caching"). It was 28 points behind and hit 322 rate-limit errors, so it was not run again.

"Whole turn" includes the small checks that stay on gpt-4.1-mini (consent, quality, profile). Eval turns stub search, so real turns cost more; the ratios hold.

Where they differ (passes out of runs):

| Category | gpt-4.1-mini | gpt-6-luna | gpt-5.6-luna |
| --- | --- | --- | --- |
| search routing | 57/63 | 49/63 | 56/63 |
| options | 21/24 | 18/24 | 19/24 |
| quality signals | 31/39 | 36/39 | 37/39 |
| save routing | 12/15 | 15/15 | 15/15 |
| replay: save | 12/15 | 9/15 | 5/15 |
| replay: selection | 9/15 | 14/15 | 11/15 |
| replay: alerts | 0/6 | 0/6 | 0/6 |

- gpt-6-luna often asks a clarifying question when it should search (14 of 63 search runs). That is the "ask again instead of acting" behavior testers dislike.
- gpt-5.6-luna mishandled saves: in 5 of 15 replay saves it started a new search instead of saving, and the text it sent read like an internal note ("check whether the three Prada Speedrock sneakers were added to the wishlist"). That's a trust defect and the main reason not to switch yet. Its other save failures are partly the harness: replay only prepares a save, and the newer models say plainly that it wasn't confirmed, then list the links again.
- replay: alerts fails for every model, so the problem is the case or the flow, not the model.

## Search role

The 18 replay sourcing cases × 3 runs. The chat model was fixed and only the web-search model changed. SerpApi was switched off for these runs, so the comparison isolates the search model and used none of the month's remaining SerpApi searches (3,572 of 5,000 left on October 19). Production also merges SerpApi results, so real pass rates are higher for every model.

| Model | Pass rate | Median | p90 | Search cost per 100 searches |
| --- | --- | --- | --- | --- |
| gpt-4.1 (today) | 39% | 17.9 s | 31.9 s | $8.39 |
| gpt-6-luna | 26% (32% leaving out rate-limited runs) | 18.3 s | 29.3 s | $2.00 |
| gpt-5.6-luna | 28% | 18.0 s | 30.7 s | $2.47 |

Most common failures for all three: a link that could not be verified, a generic "couldn't find it", and the named item not found on the first search. gpt-4.1 was the only model that found Salomon and Satisfy items. gpt-6-luna hit its token rate limit 22 times on this account.

These search runs used the reordered chat prompt that was later reverted (below). The chat step was the same for every search model, so the comparison is fair, but the absolute pass rates are low.

The image identification case (the Barbour jacket photo, the only case with an independent answer) goes through Google Lens on SerpApi, not the web-search model, so it can't compare search models. It was left out.

## Write role (style report)

Six fictional shoppers × the receipt line and the Gatekeeper line × 3 runs, through the report's real writers and copy checks (a line that fails the checks falls back to a fixed line).

| Model | Passes copy checks | Median | p90 | Cost per 100 lines |
| --- | --- | --- | --- | --- |
| gpt-5.5 (today) | 36/36 | 3.1 s | 7.0 s | $0.76 |
| gpt-6-luna | 36/36 | 2.8 s | 5.3 s | $0.01 |
| gpt-5.6-luna | 36/36 | 3.1 s | 5.3 s | $0.04 |

Passing the checks says the lines are allowed, not that they're funny. That's what the blind pairs are for.

## Blind pairs

[A private page](https://claude.ai/artifact/F4MDFSXGjJ9pGesxYqT6fo) with 20 pairs: 10 chat replies (gpt-4.1-mini vs gpt-5.6-luna) and 10 style-report lines (gpt-5.5 vs gpt-6-luna). The models are revealed after you judge all 20. Chat replies come from eval conversations with stubbed tools, so judge voice and judgement, not product details.

## Extract role (Gmail import)

Not run. `scripts/extract-bakeoff.js` is ready but untested: reading your Gmail needs your go-ahead, and the session's safety check stopped it. It re-reads 40 of your already-imported receipt emails with the stored read-only token and runs each through the receipt prompt with each model, 3 times. It compares what Jules would keep after code verification against today's gpt-4.1-mini, and lists every disagreement for you to look over. Results stay in `.eval-local/` on your computer. Only OpenAI models read the emails. Code refuses DeepSeek and any OpenRouter provider not pinned to a US host.

Caching finding for the import: with structured outputs, gpt-4.1-mini got **0%** cache hits on varied receipts even with a cache key. gpt-6-luna got 85% and gpt-5-nano 70% on the same requests. So the import's 0% cache rate is a gpt-4.1-mini limitation, not prompt order. A newer extract model would also cut the import's input cost through caching. Fast processing stays unchanged: no Batch or Flex.

## Prompt caching

- Chat: putting static instructions and the always-offered tools first, and the per-turn context after the conversation, **cut gpt-4.1-mini's routing pass rate from 90% to 80%** on the full suite. On the 30 most affected cases it went from 95% to 60%. The original order plus a `prompt_cache_key` already cached 92% of input tokens in the evals, so the reorder was reverted and only the cache key stays. The production 4% is most likely from requests without a cache key spreading across servers, plus gaps between messages longer than the cache lasts. Watch the Costs page after deploy to see whether the key alone fixes it.
- Gmail import: the prompt was already static-first. It gets a cache key too. See the finding above.

## What changed in the code (this PR)

- `lib/models.js` maps each model call to a role with an optional override: `MODEL_CHAT`, `MODEL_EXTRACT`, `MODEL_SEARCH`, `MODEL_WRITE` (and `MODEL_<ROLE>_REASONING` for reasoning effort). `OPENAI_MODEL`, `OPENAI_CHAT_MODEL`, `OPENAI_SEARCH_MODEL` and `STYLE_REPORT_MODEL` still work. Defaults are unchanged.
- A role can point at OpenRouter with `openrouter:<model>` (and `@provider` to pin who serves it) once `OPENROUTER_API_KEY` is set. The OpenAI key is never sent there. Receipts only go to a model pinned to a US provider, never DeepSeek.
- Costs: OpenRouter calls are metered. GPT-5 nano/mini, GPT-5.4 nano/mini, gpt-5.6-luna and gpt-6-luna are priced from OpenAI's pricing page (web search $10 per 1,000 calls). A model with no price is logged and costed at the dearest known rate instead of $0, so spending caps still hold.
- Bake-off runners: `scripts/model-bakeoff.js` (chat, search), `scripts/write-bakeoff.js`, `scripts/extract-bakeoff.js`.

## What you need to do

1. **Judge the blind pairs** (about 10 minutes, works on your phone). When you finish, press Copy picks and paste the result into the Claude session.
2. **Run the Gmail comparison.** This reads your own Gmail, which is why it needs you. In Terminal, from the `jules` folder:
   `node --env-file=.env.local .claude/worktrees/peaceful-noyce-17a7e2/scripts/extract-bakeoff.js --models gpt-4.1-mini,gpt-6-luna,gpt-5.6-luna,gpt-5-nano:minimal --emails 40`
   It costs about $1–2 and prints where the results went. Or tell the Claude session it may read your imported Gmail receipts for this test, and it will run it.
3. **Optional: OpenRouter models** (Claude Haiku 5.5, Gemini 3.1 Flash-Lite, gpt-oss-120b on Groq, DeepSeek V4.1 Flash on a US host) were not tested because there is no OpenRouter key. To add them: sign in at openrouter.ai, open Settings → Keys, create a key, and add `OPENROUTER_API_KEY=<the key>` to your `.env.local` (never to Git, and not in Vercel unless you later switch a role to one of these models). Then ask the Claude session to run the OpenRouter chat bake-off. Model ids on OpenRouter need checking at that point.
4. **Before switching a role later:** check OpenAI's rate limits for the new model on your account (Settings → Limits). gpt-6-luna and gpt-5-nano hit token limits during the bake-off at the load these tests put on them.

## Cost and side effects of the bake-off

About $32 of OpenAI usage, recorded as eval features on the Costs page. No SerpApi searches were used for the search comparison. Nothing was sent, saved or alerted. The first chat run sent up to 8 requests at a time and got 64 rate-limit retries on gpt-4.1-mini, the model production uses, so a tester's reply around 23:00–00:00 PT on October 19 may have been slowed. Later runs used less concurrency and had none.

Raw results: `.eval-local/bakeoff-2026-10-19/` (private, not in Git).
