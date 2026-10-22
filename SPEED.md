# Chat speed: where a turn's time goes, and what to cut

Status: **approved October 22; built one PR at a time, each checked live before the next.** Change 1 (store page time limit, 25 s directions cap): live October 22 (#340), founder saw searches much faster. Change 2 (typing dots beside the context read, plus the search 👀 tapback first): live October 22 (#342). Change 3 (left-out prices put back beside their link): live October 22 (#363). Change 4: skipped (measured below). Change 5 (reply over the typing conversation, text time recorded): in review.

## What was measured

Production turns from October 17 to 21 (86 turns, the period when each step's start time is recorded in `reply_diagnostics.steps`). Sources: step timings, `timing_diagnostics`, the sourcing timings in `text_wishlist_diagnostics`, and the model calls per turn in `usage_events`. Only counts and timings were read, no message text. Each check was also timed once locally (a few cents of OpenAI, no SerpApi).

All production turns in this window ran on **gpt-4.1-mini**. The gpt-5.6-luna trial hasn't produced any turns yet, so the "after" numbers will need the same analysis rerun (see the end).

| Turn type | Turns | Median to final reply | p90 | Model calls (median) |
|---|---|---|---|---|
| Search (find products) | 53 | **61.5 s** | 91 s | 14 + ~5 SerpApi |
| Save or alert | 11 | **18.0 s** | 28 s | 7 |
| Conversation (no search, no save) | 22 | **12.3 s** | 20 s | 6 |

Search turns are getting slower: the daily median went from 45 s on Oct 19 to 79 s on Oct 21, as more of them became discovery searches with stylist directions.

## Where the time goes (medians)

**Every turn**
- **Typing indicator: 3.3 s, which blocks everything else.** Before Jules reads the conversation, the code connects to Photon, sends the read receipt and starts the typing dots, and waits for all three. This is the "~3.5–4 s context load" we'd seen. The actual context read takes 0.6–1.7 s.
- Agent rounds: each round sends about 22,000 tokens to the model, and only 44% of them are cached. On gpt-4.1-mini a round takes 2–4 s.
- Checks that already run alongside the turn and don't add time: the quality check, the shadow skill router, and the profile check (about 1 s each, and they finish while round 1 is still running).
- Send: 1.2 s for a plain text. With product or wishlist cards it's 3–4 s (p90 9 s), because the cards go out one after another. The tester sees the text after about 1 s, so the cards make the recorded time look longer than the wait really is.

**Search turn (61.5 s)**
| Step | Median | Note |
|---|---|---|
| Typing indicator + context | 5 s | 3.3 s of this is the blocking typing indicator |
| First agent round (decides to search) | 4.4 s | The "on it" acknowledgment goes out here, at 10.7 s |
| Sourcing, discovery | **44.7 s** | stylist 3.7 s, then **direction searches 40.0 s**, department check 0.8 s, ranking 2.5 s |
| Sourcing, named item | 23.7 s | one web search 21.5 s, of which store page checks can take up to 27 s |
| Writing the reply after results | 9.6 s (p90 22 s) | write round, claim audit, sometimes a rewrite |
| Send | 4.1 s | text first, then up to 3 product cards |

- **Discovery direction searches hit the 40 s cap in 12 of 20 searches.** A third of the individual direction searches never finish in time. The ones that do finish have a median of 20 s. The long tail is the **store page checks**: up to 4 pages render at once in the shared browser, and one page can take up to 28 s (18 s to load plus 10 s waiting for product data). Every direction waits for its slowest page.
- **In 11 of 40 search turns the reply failed the checks twice**, so the plain factual text went out anyway. That's about 6–10 s of rewriting that the tester never saw. The most common reasons were a left-out price (6), the audit's claim reading (8) and unsupported shop facts (3).

**Save turn (18 s):** typing indicator 3.1 s, context 1.6 s, agent 9 s, send 3.1 s. The 9 s of agent time is usually: a round that chooses the save, then the consent check (~1 s), the save itself, a writing round, often one more round, and the claim audit (~1 s).

**Composer:** in this window, no reply went through the separate composer. Every reply was either the agent's own checked text or the plain fallback, so removing the composer duplication would save no chat time today. It still runs for the next style-interview question (one extra call, about 1–2 s, on those turns only).

## Each step, classified

| Step | Protects the user? | Verdict |
|---|---|---|
| Typing indicator | No (feedback only) | **Keep, but run it alongside the context read** |
| Consent check before saves and alerts | **Yes** | Keep. It runs only when a save or alert is proposed. Preparing the save can start beside it, but the save is committed only after it passes. |
| Claim audit (saved, alert on/off, unsupported shop facts) | **Yes** | Keep on every written reply. It also catches invented shipping or stock statements on search turns, so gating it only to save/alert turns would drop that protection. |
| Code checks on links and prices | **Yes** | Keep. Where code can place the fact itself, add a repair instead of asking the model to rewrite (as is already done for links). |
| Store page checks (verified price and stock) | **Yes** | Keep the check, but stop waiting for pages that are too slow. A page not checked in time is left out and never shown as verified. |
| Quality check, skill router, profile check | Observability / memory | Already run alongside the turn. No change. |
| Waiting for an older reply (newest message wins) | Yes (correct thread state) | Keep. It happened on 3 of 86 turns. |
| Composer rewrite of an agent-written reply | Duplicate | Already gone from chat replies |
| Interview-question compose | Duplicate-ish | Small. Fold it into the agent's own reply later. |

## Ranked changes

| # | Change | Turns affected | Expected saving | Rules |
|---|---|---|---|---|
| 1 | **Time-limit each store page check** (about 12 s per page), and **lower the discovery directions cap from 40 s to about 25 s** (the "3 verified products, then a short grace" rule stays). A page not checked in time is dropped, never shown unchecked. Also applies to the exact-item search's page checks. | Discovery search (about half of searches); named-item searches with a slow store | **10–15 s** on discovery; up to 15 s on slow named-item searches | Unchanged: only verified prices and stock are shown. **Tradeoff:** sometimes 2 options instead of 3. I'd record the verified count per search and compare it before and after. |
| 2 | **Start the typing indicator alongside the context read** instead of before it | Every turn | **~3 s** on every turn; the search acknowledgment arrives at ~7.5 s instead of 10.7 s | None touched |
| 3 | **Code puts a left-out price on its product's link line** (the same idea as today's link repair: the draft already pairs each price with its link), so a missing price no longer costs a rewrite round or ends in the plain fallback | 15–28% of search turns | **4–8 s** on those turns, and more replies in Jules's voice | Unchanged: code adds only the verified price, never wording |
| 4 | ~~Prompt order for caching~~ **Skipped October 22.** Measured on a 22,000-token prompt: cached vs not is 1.18 s vs 1.53 s on gpt-4.1-mini and no difference on gpt-5.6-luna; rounds are already 24–65% cached, so the gain is ~0.3 s per turn on mini, none on luna. Reordering the context already cut routing evals from 95% to 60% (October 20). | — | ~0.3 s (mini), 0 (luna) | Not worth the eval risk |
| 5 | **Reuse the typing indicator's Photon connection to send the reply**, and record when the main text went out (separately from the cards) so the metric matches what the tester sees | Every turn | ~0.5–1 s, plus an honest "time to reply" number | None touched |
| 6 | **Prepare the save while the consent check runs**, and commit only if it passes | Save and alert turns | ~1 s | Consent still decides; nothing is written before it passes |
| 7 | **Ask the model to write its reply in the same round as a save when nothing else is pending.** Code still runs the save first, and the checks still read the reply against what actually happened. | Save turns | ~2–3 s (one round) | Needs eval runs: the frozen saves are the risk area, especially on luna |

Not recommended:
- Skipping the claim audit on turns without a save or alert. It's also what stops invented "ready to ship" claims on search turns.
- Skipping the consent check when the wording looks clear. That would be wording-based routing.
- Cutting the stylist (3.7 s), because it is what makes discovery results fit the person.

**If 1–5 ship:** search turns go from about 61 s to about 42–45 s median, save turns from 18 s to about 14 s, and conversation turns from 12 s to about 8–9 s. The biggest single lever is #1. It's also the only one with a product tradeoff (sometimes fewer options).

**Exact-item "cheaper elsewhere":** the exact Google-query search already runs first, beside the model's web search. On named items its time goes to the store page checks (#1), not to the model web search. Comparing prices through a direct shopping lookup is already what the post-save store scan does in the background. Moving it into the chat turn should wait until we have data from the new `same_item_for_less` goal (#337, merged today).

## Effect of the gpt-5.6-luna trial

Bake-off: a whole conversation turn takes a median of 7.2 s on luna against 5.8 s on gpt-4.1-mini (p90 12.8 s against 10.1 s). Locally, one round with a small context took about 2.5 s on luna against 1.4–2.2 s on mini, and the side checks were about the same. Expect about **+1.5 s on conversation and save turns and +2–3 s on search turns** (2–3 rounds each). That is smaller than #1 or #2. The rerun below will show the real figure.

To rerun after the switch, same method: the analysis scripts are in the session notes folder (`speed-analysis/`). Run them with `node --env-file=.env.local`, then compare the medians per turn type before and after the switch date.
