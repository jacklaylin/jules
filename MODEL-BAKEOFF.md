# Model bake-off, October 19–20, 2026

Question: can cheaper models do Jules's jobs as well as today's? No production model changed. Every default stays as it was until you decide.

## Recommendations

| Role | What it does | Today | Recommendation |
| --- | --- | --- | --- |
| chat | The conversation (agent loop and reply writer) | gpt-4.1-mini | **Keep for now; needs more data.** Both luna models tie on pass rate at a quarter to a ninth of the cost, but each has a weak spot testers would notice. gpt-5.6-luna sometimes searches again when asked to save, and gpt-6-luna asks questions instead of searching. Fixing the save case and rerunning would settle it. |
| search | Product sourcing with web search | gpt-4.1 | **Keep.** Both cheaper models found the right product less often. |
| extract | Gmail receipts and other small structured reads | gpt-4.1-mini | **Keep.** gpt-6-luna catches returns and refunds today's model misses, but drops some real purchases and marks more items as gifts. It is not a drop-in switch yet. See the Extract section. |
| write | Style report lines | gpt-5.5 | **Switch report lines to gpt-6-luna.** It passed every copy check, you preferred it 5 to 2 in the blind pairs (3 even), and it costs about 1/60th as much. See "Switching the write role" for how. |

Quality comes before cost. The write role is the only switch: the cheaper model matched on the checks and won your blind judgement. For chat, your blind picks were mostly even (7 of 10), so voice doesn't decide it; the weak spots below do.

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

Your picks (October 20):

| Pairs | Today's model | Candidate | Even |
| --- | --- | --- | --- |
| Chat replies | gpt-4.1-mini · 2 | gpt-5.6-luna · 1 | 7 |
| Style report lines | gpt-5.5 · 2 | gpt-6-luna · 5 | 3 |

Ten pairs per group is a small sample. It's enough to say the cheaper writer is not worse, and the chat voice is a wash.


[A private page](https://claude.ai/artifact/F4MDFSXGjJ9pGesxYqT6fo) with 20 pairs: 10 chat replies (gpt-4.1-mini vs gpt-5.6-luna) and 10 style-report lines (gpt-5.5 vs gpt-6-luna). The models are revealed after you judge all 20. Chat replies come from eval conversations with stubbed tools, so judge voice and judgement, not product details.

## Extract role (Gmail import)

Run October 20 on 40 of your already-imported receipt emails, 3 times each, inside production through an owner-only admin action (`extract-compare`). The production Gmail key is Sensitive in Vercel, so the local script couldn't open your Gmail sign-in. It had also expired, and worked again after you reconnected. Only OpenAI models read the emails. What's compared is what Jules would keep after its own checks, not the raw model text. The email-by-email list is in your private `.eval-local/bakeoff-2026-10-19/extract-disagreements.md`, which is not in Git.

| Model | Same as today's model (whole email) | Same number of items | Agrees with itself over 3 runs | Median / p90 per email | Reading step for a 443-receipt import | Cost per 100 receipts |
| --- | --- | --- | --- | --- | --- | --- |
| gpt-4.1-mini (today) | 76% (its own reruns) | 100% | 29 of 40 | 2.8 s / 5.0 s | ~9 min | $0.19 |
| gpt-6-luna | 21% | 77% | 29 of 40 | 3.3 s / 7.9 s | ~11 min | $0.04 |
| gpt-5.6-luna | 15% | 72% | 28 of 40 | 4.3 s / 8.3 s | ~13.5 min | $0.10 |
| gpt-5-nano (minimal) | 6% | 73% | 2 of 40 | 2.7 s / 6.5 s | ~10.5 min | $0.03 |

"Whole email" is strict: any difference in any field counts. Most differences are harmless, so here is gpt-6-luna's first run sorted by kind (30 of 40 emails differ):

- **Cosmetic, same items (16 emails).** It keeps a brand, color or quantity that today's model leaves blank, or lists "×2" as two lines. Those values passed the same quote check, so it's extra detail rather than a mistake.
- **Better (5 emails).** It records a return request, return or refund that today's model missed entirely. That matters for the style report, which counts what you kept.
- **Worse (3 emails).** It drops a real purchase or delivery. gpt-5.6-luna drops 2 of the same 3.
- **Different recipient (6 emails).** Mostly it marks items as bought for someone else where today's model says unknown, in one email for all six items. Only you know which is right. These six are flagged in the private list.

gpt-5-nano refused 33 of its 120 readings (Jules's checks rejected the evidence it quoted) and rarely agreed with itself, so it's out.

Whole-import time is an estimate for the reading step only: the import reads 6 emails at a time and waits for the slowest. Gmail listing, sorting and photos come on top and don't change with the model. Each request read the same email with all four models at once, so these times are slightly pessimistic for every model.

**Recommendation: keep gpt-4.1-mini for now.** gpt-6-luna is the one worth pursuing. It costs about a fifth as much per receipt, caches 85% of its input versus 0% today, and finds returns and refunds that today's model misses. But it's about 2 minutes slower on a 443-receipt import, which is the activation moment, and it drops some purchases. Next steps:

1. Look at the six "different recipient" emails in the private list and say which model is right.
2. Separately, today's model misses returns and refunds (5 of these 40 emails). That's worth fixing in the receipt prompt whatever model is used.
3. After those, re-run this comparison. gpt-6-luna becomes a switch if it stops dropping purchases.

Caching finding for the import: with structured outputs, gpt-4.1-mini got **0%** cache hits on varied receipts even with a cache key. gpt-6-luna got 85% and gpt-5-nano 70% on the same requests. So the import's 0% cache rate is a gpt-4.1-mini limitation, not prompt order. A newer extract model would also cut the import's input cost through caching. Fast processing stays unchanged: no Batch or Flex.

## Prompt caching

- Chat: putting static instructions and the always-offered tools first, and the per-turn context after the conversation, **cut gpt-4.1-mini's routing pass rate from 90% to 80%** on the full suite. On the 30 most affected cases it went from 95% to 60%. The original order plus a `prompt_cache_key` already cached 92% of input tokens in the evals, so the reorder was reverted and only the cache key stays. The production 4% is most likely from requests without a cache key spreading across servers, plus gaps between messages longer than the cache lasts. Watch the Costs page after deploy to see whether the key alone fixes it.
- Gmail import: the prompt was already static-first. It gets a cache key too. See the finding above.

## What changed in the code (this PR)

- `lib/models.js` maps each model call to a role with an optional override: `MODEL_CHAT`, `MODEL_EXTRACT`, `MODEL_SEARCH`, `MODEL_WRITE` (and `MODEL_<ROLE>_REASONING` for reasoning effort). `OPENAI_MODEL`, `OPENAI_CHAT_MODEL`, `OPENAI_SEARCH_MODEL` and `STYLE_REPORT_MODEL` still work. Defaults are unchanged.
- A role can point at OpenRouter with `openrouter:<model>` (and `@provider` to pin who serves it) once `OPENROUTER_API_KEY` is set. The OpenAI key is never sent there. Receipts only go to a model pinned to a US provider, never DeepSeek.
- Costs: OpenRouter calls are metered. GPT-5 nano/mini, GPT-5.4 nano/mini, gpt-5.6-luna and gpt-6-luna are priced from OpenAI's pricing page (web search $10 per 1,000 calls). A model with no price is logged and costed at the dearest known rate instead of $0, so spending caps still hold.
- Bake-off runners: `scripts/model-bakeoff.js` (chat, search), `scripts/write-bakeoff.js`, `scripts/extract-bakeoff.js`.

## Switching the write role

Changing the setting in Vercel is enough; no code change is needed. One catch: the write role also drives the stylist step and the fit reading, and the bake-off only tested report lines. Keep the stylist on gpt-5.5 by setting it explicitly:

1. Vercel → the jules project → Settings → Environment Variables (Production).
2. Add `MODEL_WRITE` = `gpt-6-luna`.
3. Add `STYLIST_MODEL` = `gpt-5.5` (skip if it's already there).
4. Redeploy, then open your own style report and check a few lines.

The fit reading moves to gpt-6-luna too. It is the same kind of writing, but it wasn't in the test, so read one after the switch. To undo, delete `MODEL_WRITE` and redeploy.

## What you need to do

1. ~~Judge the blind pairs.~~ Done October 20 (results above).
2. ~~Run the Gmail comparison.~~ Done October 20 (results above). **Next:** check the six "different recipient" emails in `.eval-local/bakeoff-2026-10-19/extract-disagreements.md`.
3. **Optional: OpenRouter models** (Claude Haiku 5.5, Gemini 3.1 Flash-Lite, gpt-oss-120b on Groq, DeepSeek V4.1 Flash on a US host) were not tested because there is no OpenRouter key. To add them: sign in at openrouter.ai, open Settings → Keys, create a key, and add `OPENROUTER_API_KEY=<the key>` to your `.env.local` (never to Git, and not in Vercel unless you later switch a role to one of these models). Then ask the Claude session to run the OpenRouter chat bake-off. Model ids on OpenRouter need checking at that point.
4. **Before switching a role later:** check OpenAI's rate limits for the new model on your account (Settings → Limits). gpt-6-luna and gpt-5-nano hit token limits during the bake-off at the load these tests put on them.

## Cost and side effects of the bake-off

About $32 of OpenAI usage, recorded as eval features on the Costs page. No SerpApi searches were used for the search comparison. Nothing was sent, saved or alerted. The first chat run sent up to 8 requests at a time and got 64 rate-limit retries on gpt-4.1-mini, the model production uses, so a tester's reply around 23:00–00:00 PT on October 19 may have been slowed. Later runs used less concurrency and had none.

The Gmail extract comparison on October 20 added $0.44 (feature eval_extract). It ran one email at a time, with at most one gpt-4.1-mini call in flight, and saw no rate limits.

Raw results: `.eval-local/bakeoff-2026-10-19/` (private, not in Git).
