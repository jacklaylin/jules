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
5. **Word budgets.**
   - A migrated skill has at most 150 words of rules. A raise needs `word_cap: {words, reason}` in the skill's file.
   - Everything the model reads as instructions has a ratchet budget: prompt blocks, feature guides and tool descriptions (`tests/fixtures/chat-prompt-budget.json`). Growing a part needs a raise with a reason. Shrinking one means lowering the budget in the same PR. Tests enforce both.
   - Before deleting a rule, check which feedback added it (`docs/chat-skills-inventory.md`, `git log -S`), and cover that case with an eval first.
6. **One job per PR.** A skill migration touches one skill. A triage PR fixes one root cause. Stop after each for the founder's live check.
7. **The gate runs on the production chat model.** Read `MODEL_CHAT` in Vercel. Since October 22 it is `gpt-5.6-luna`. When the model changes, re-measure the baseline before comparing anything.
8. **Evals spend real money.** Run them with the local evals key (its own OpenAI project and budget), never production's. Check the balance with one tiny call before a large run, and cap it with `--max-cost`.

## The gate (every PR that touches `lib/skills/`, `lib/ai.js` prompts or tool schemas, or `lib/compose.js` checks)

| Check | Command | Pass |
|---|---|---|
| Unit tests, including word budgets | `npm test` (also run by CI) | green |
| Frozen failure set | `node --env-file=.env.local scripts/frozen-evals.js run --runs 3` (current code *and* main, same model) | Mean pass rate ≥ main's. No category loses more than one case. Measured on the PR's final commit. |
| Routing evals | `node --env-file=.env.local scripts/replay-gate.js --suite agent --runs 3` (current code and main) | No category drops by more than one run against main |
| Router recall (before selective loading) | `scripts/router-recall.js --days 2` | ≥98% before PR 12 turns selective loading on |

Put the before/after table in the PR description. If you skip a check, say so and why.

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
| **One skill per task** (load only the skills a turn needs) | **Not yet.** The router only runs in shadow mode. Every turn still gets all the rules: ~2,970 words of prompt blocks, ~6,370 words of tool and field descriptions, and up to ~1,200 words of feature guides. This is by design until CHAT-SKILLS step 12, but rule interference continues until then. |
| **150 words per skill** | **1 of 10 skills migrated.** better_price has 83 words. Unmigrated: core 777, explore 440, find_exact 413, conversation 294, options 219, history 214, save_or_watch 207, profile 183, saved_items 144. The test only checks migrated skills. |
| **Rules don't grow** | **Broken before this PR.** Prompt blocks grew from 2,703 to 2,972 words (+10%) in the 24 hours after the plan was approved, across 6 commits. That includes the Oct 22 triage PR #344, which added 65 words and ran no frozen gate. The new ratchet test stops this from now on. |
| **One rule, one place** | **Partly broken.** Tool and field descriptions (6,373 words, the largest part; `find_products` 1,469 and `ask_shopping_question` 1,380) still repeat prompt rules. The 10 feature guides (`*_GUIDE`) sit outside `lib/skills/`, so the skill test can't see them. |
| **Gate on the final commit** | **Loosely followed.** #337 merged with its frozen-set run measured before its last commit, and one routing case (dupe of a linked item) fell from 100% to 33% without an explanation in the PR. |
| **Gate on the production model** | **Stale.** The frozen baseline (46–56%) was measured on gpt-4.1-mini. Production moved to gpt-5.6-luna on Oct 22. |
| **Eval spend** | **Broke production twice** (Oct 20 and 21). Evals and production share one OpenAI budget. |
