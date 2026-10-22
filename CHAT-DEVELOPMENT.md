# Developing Jules chat without regressing it

Status: October 22, 2026. This is the one page to read before changing anything the chat model reads or does: a prompt rule, a skill, a tool or field description, a reply check, or the context it is given. It sums up how chat is built and sets the rules for changing it. Details live in the linked docs. Feedback-triage sessions follow it too (`.claude/agents/feedback-triage.md`).

## How a chat turn works

```
iMessage ─► INBOX ─► CONTEXT ─► ROUTER ─► AGENT LOOP ─► TOOLS ─► REPLY CHECKS ─► send
            (code)   (code)    (model)   (model)       (code)   (code + model)
                                              ▲
                         side checks (model): consent · profile · quality
```

| Layer | What it does | Where | Decides by |
|---|---|---|---|
| Inbox | Receives the message, handles declared commands (`#dev`, 👎) before any model, typing dots, newest-message-wins | `lib/inbox.js`, `lib/developer-feedback.js` | Code. `#dev`/👎 is the only marker-based routing allowed (AGENTS.md). |
| Context | Everything Jules knows: the user context (profile, purchases, wardrobe, likes, stores) plus shopping state (pending options, current search plan, threads, saved items). It is passed to the model as data, never as instructions. | `lib/user-context.js` ([USER-CONTEXT.md](USER-CONTEXT.md)), `lib/message-context.js`, `lib/shopping-context.js` | Code reads; the model interprets |
| Router | Picks which skills (jobs) this turn needs. **Shadow mode today:** it logs its picks, but every turn still gets every skill. | `lib/skills/router.js` | Model. It fails open to all skills. |
| Skills | The rules, one file per job: core, find_exact, better_price, explore, options, save_or_watch, saved_items, profile, history, conversation | `lib/skills/*.js` ([CHAT-SKILLS.md](CHAT-SKILLS.md)) | n/a |
| Agent loop | Reads the message plus context, then calls tools (up to 4 rounds) and finishes with a reply | `lib/ai.js` | Model |
| Tools | Search, save, alerts, profile and so on. Code validates references, consent and formats, then executes. | `lib/text-wishlist.js`, `lib/wishlist-selection.js`, `lib/memory.js`, … | Code |
| Reply checks | No links or prices that results didn't give, no false save/alert claims (`auditClaims`). One repair try, then a single coherent fallback. | `lib/compose.js` | Code + one model reading |
| Measurement | Frozen failure set, routing evals, replay suite, nightly judge, router recall, chat metrics | see "The gate" | n/a |

## Rules for changing chat

1. **The model interprets, code validates.** No keyword, phrase or regex decides intent (AGENTS.md). Code decides from state (what is pending, what ran), never from wording.
2. **A fix goes in this order of preference:** code (a validation, a repair, a result field) > a structured field or enum the model fills > one rule in one skill. A rule that code could enforce is a bug waiting to happen.
3. **Every fix arrives with an eval case.** Put it in the frozen set (reported failures are frozen automatically) or the routing evals (`lib/agent-eval-cases.js`). Cover varied wording and the neighboring case where the action must *not* happen.
4. **One rule, one place.** A rule lives in exactly one skill. If a tool or field description says it, no skill does, and the reverse holds too. Don't copy a rule to make it "stronger".
5. **No contradictions; length is only a warning sign.** What hurts quality is two rules that would tell the model to do different things in the same case, and rules with no reason given. Length alone isn't the problem.
   - A PR that adds or changes a rule lists the rules it could conflict with (same skill, other skills, tool and field descriptions) and says how the conflict is resolved. When a rule's reason isn't obvious, it states it in a few words, because models follow rules better when they know why.
   - Word budgets are a brake, not a goal. A migrated skill has at most 150 words of rules (a raise needs `word_cap: {words, reason}`). Prompt blocks, feature guides and tool descriptions each have a ratchet budget (`tests/fixtures/chat-prompt-budget.json`). Growing a part needs a raise with a reason. Shrinking one means lowering the budget in the same PR. Tests enforce both. A clearer rewrite that's longer is a fine reason for a raise.
   - **Example conversations are exempt** from word budgets (an `examples` prompt block, from `docs/example-conversations.md`). Examples shape tone and judgment better than rules. When an example can replace a rule, prefer the example.
   - Before deleting a rule, check which feedback added it (`docs/chat-skills-inventory.md`, `git log -S`), and cover that case with an eval first.
6. **Fewer, clearer tools.** The model is offered 21 tools today, which is a lot. The tool count may not grow (enforced by the same budget test). A new capability extends an existing tool or replaces one. Merging tools that overlap, such as the status tools or the purchase-history tools, counts as progress.
7. **Write the reply from what happened.** The reply should be written from a structured record of what this turn actually did (searched, found, saved, alerted, refused), not from the model's memory of its own tool calls (CHAT-SKILLS step 4). Prefer this over adding more after-the-fact checks.
8. **One job per PR.** A skill migration touches one skill. A triage PR fixes one root cause. Stop after each for the founder's live check.
9. **The gate runs on the production chat model.** Read `MODEL_CHAT` in Vercel. Since October 22 it is `gpt-5.6-luna`. When the model changes, re-measure the baseline before comparing anything.
10. **Evals spend real money.** Run them with the local evals key (its own OpenAI project and budget), never production's. Check the balance with one tiny call before a large run, and cap it with `--max-cost`.

## The gate (every PR that touches `lib/skills/`, `lib/ai.js` prompts or tool schemas, or `lib/compose.js` checks)

| Check | Command | Pass |
|---|---|---|
| Unit tests, including word and tool budgets | `npm test` (also run by CI) | green |
| Frozen failure set, **compared case by case** | `node --env-file=.env.local scripts/frozen-evals.js run --runs 3` on main and on the PR's final commit, same model | See below |
| Routing evals, compared case by case | `node --env-file=.env.local scripts/replay-gate.js --suite agent --runs 3` on main and the PR | See below |
| Router recall (only if selective loading is still planned) | `scripts/router-recall.js --days 2` | ≥98% |

**How to read the results.** One run of the frozen set moves about ±7 points by chance, so the overall pass rate alone can't decide a merge. Compare the same cases on both versions instead:
- List every case that **flipped**: passed on main in most runs but fails on the PR in most runs, and the reverse. The PR should fix the cases it targets and flip none the other way.
- **A flip to failing in a trust area blocks the merge** until it's explained and fixed. Trust areas are saves, alerts, consent, prices, and claims about what happened.
- A flip elsewhere needs a one-line explanation in the PR.
- The overall pass rate is reported, but it doesn't decide anything on its own.
- **Check results in code where possible.** Did the save or alert actually happen? Was the link or price in the results? The model judge decides only what code can't check, such as tone or whether the reply answered the question.
- **Keep some cases back.** Conversation tests with held-out cases (proposed separately) are never used for tuning, only for reporting, so we can tell whether fixes generalize or just fit the 76 known failures.

Put the before/after table and the flipped cases in the PR description. If you skip a check, say so and why.

## Decided later: the router and loading only the needed skills

CHAT-SKILLS steps 2 and 12 plan a separate router call that picks which skills a turn loads. That plan assumed the problem was a small model overloaded with rules. The October 21 tests point elsewhere: a model 8× larger scored the same, and 21 of 76 cases fail on every model. **Before step 12 turns selective loading on, test the simpler path on the production model:** all skills loaded, with conflicts removed, duplicates between skills and tool descriptions merged, and fewer tools. If that scores at least as well, don't turn selective loading on. If selective loading is still needed, prefer letting the agent load a skill itself (`load_skill`) over a separate router in front of every turn.

## Numbers that say whether chat is getting better

The real goal is fewer bad turns for testers, measured in production weekly (`scripts/chat-metrics.js`):
- complaints per turn (`#dev`, 👎, quality signals);
- share of replies code had to assemble (target under 5%);
- time to reply (see [SPEED.md](SPEED.md));
- messages per turn.

The frozen set and routing evals stand in for these during development. They don't replace them.

## Where we break these rules today (October 22)

| Rule | Status |
|---|---|
| **One skill per task** (load only the skills a turn needs) | **Not yet, and now under review** (see "Decided later"). The router only runs in shadow mode. Every turn still gets all the rules: ~2,990 words of prompt blocks, ~6,470 words of tool and field descriptions, and up to ~1,200 words of feature guides. |
| **No contradictions** | **Known conflicts remain.** For example, the brand-role rules kept for the routing evals in #337 overlap better_price and explore. No contradiction audit has been done across skills and tool descriptions. |
| **Fewer tools** | **21 tools offered.** Several overlap (two status tools, several purchase-history tools). |
| **Examples over rules** | **None in the prompt yet.** The founder is writing them (`docs/example-conversations.md`). |
| **150 words per skill** | **1 of 10 skills migrated.** better_price has 83 words. Unmigrated: core 777, explore 440, find_exact 413, conversation 294, options 219, history 214, save_or_watch 207, profile 183, saved_items 144. The test only checks migrated skills. |
| **Rules don't grow** | **Broken before this PR.** Prompt blocks grew from 2,703 to 2,988 words (+11%) in the day after the plan was approved, and tool descriptions grew by about 90 words more. That includes the Oct 22 triage PR #344, which added 65 words and ran no frozen gate. The new ratchet test stops this from now on. |
| **One rule, one place** | **Partly broken.** Tool and field descriptions (6,466 words, the largest part; `find_products` 1,469 and `ask_shopping_question` 1,380) still repeat prompt rules. The 10 feature guides (`*_GUIDE`) sit outside `lib/skills/`, so the skill test can't see them. |
| **Gate on the final commit, case by case** | **Loosely followed.** #337 merged with its frozen-set run measured before its last commit, and one routing case (dupe of a linked item) fell from 100% to 33% without an explanation in the PR. Under the case-by-case rule, that drop would have needed one. |
| **Gate on the production model** | **Stale.** The frozen baseline (46–56%) was measured on gpt-4.1-mini. Production moved to gpt-5.6-luna on Oct 22. |
| **Eval spend** | **Broke production twice** (Oct 20 and 21). Evals and production share one OpenAI budget. |
