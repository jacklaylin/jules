# Chat quality project

Status: October 23, 2026. This is the project page for making Jules's chat feel natural and get better over time. It covers why we started, what we found, what shipped, the decisions made and what's left. The rules for changing chat are in [CHAT-DEVELOPMENT.md](CHAT-DEVELOPMENT.md). This page doesn't repeat them.

## Goal

Chat should read what the person actually wrote, answer in one natural text, never claim something it didn't do, and get better from feedback **without the founder replaying conversations by hand**.

## Where we are (October 23)

Production, last 7 days compared with the 7 before (`scripts/chat-metrics.js`, Admin › Scorecard › All chat turns):

| Number | Before | Now | |
|---|---|---|---|
| **Complaints per turn** (`#dev`, 👎, quality signals) | 39% | **35%** | better, still high |
| **Failed replies** (OpenAI outages excluded) | 8.9% | **9.5%** | about flat |
| **Messages per turn** | 1.2 | **2.1** (search turns 2.7) | worse, mostly product cards |
| **Time to full answer** (median / slowest 10%) | 39 s / 82 s | **39 s / 80 s** | slightly better |
| First text back (median) | 19 s | 14 s | better |
| Replies written by the model, not code | 33% | **81%** | better |

Frozen test set (88 reported failures replayed): **63% pass on gpt-5.6-luna**, against 46–56% on gpt-4.1-mini. The share of replies code had to stitch together is about 2% on luna, down from 13%.

## What we found

1. **One huge rule book.** Every turn sent ~2,650 words of prompt rules plus ~6,400 words of tool descriptions. Most triage fixes added a sentence, and the rules started contradicting each other. For example, "cheaper" was read as "find this exact item, only from this brand", so Jules sent back the user's own link.
2. **Stitched replies.** When the model's reply failed code's checks twice, code joined every tool's draft into one text: "want me to save it?" next to "saved". This happened on 29% of turns on Oct 20–21. The main cause was the model claiming saves or alerts that hadn't happened.
3. **A bigger model alone wasn't the fix.** On the frozen set, gpt-5.5 at 8× the cost scored the same as gpt-4.1-mini, and 21 of 76 cases failed on every model. gpt-5.6-luna scored best, and the live trial since Oct 22 confirms it (63% vs ~50%).
4. **Slow turns.** Search turns took a median of 61 s, mostly waiting on slow store pages. Every turn also lost ~3 s to the typing indicator.
5. **The tests were the wrong shape.** We had only reported failures, no holdouts, and runs that swing ±7 points. A gate of "don't drop below main" was too noisy to decide merges, and full runs cost $13–25 per PR, so sessions skipped them.
6. **Test spend silenced production.** Evals share production's OpenAI key. The org spend limit was hit on Oct 20, 21 and 22, and each time Jules went silent.

## What shipped

**Measurement**
- Frozen eval set built from every `#dev` report and quality signal, judged pass rate (#321, #356, #360). Docs: [FROZEN-EVALS.md](FROZEN-EVALS.md).
- Model bake-off on the frozen set (#321). Docs: [MODEL-BAKEOFF.md](MODEL-BAKEOFF.md).
- Cheap gate: `scripts/chat-gate.js --area <area>` per PR (~$0.60–3.50, search ~$9.40), and `--nightly` (~$1.80). Judge on Flex pricing, code checks before the judge (#386).
- OpenAI outages counted apart from failed replies (#364, #412). Nightly judge stops on billing refusals (#382).
- Admin › Scorecard › All chat turns, with the four weekly numbers (#420).

**Rules and structure**
- Skills registry: the prompt's rules split by job in `lib/skills/` (#319). Shadow router (#324, #361). The "cheaper" fix as structured search goals (#337).
- Chat guardrails: [CHAT-DEVELOPMENT.md](CHAT-DEVELOPMENT.md), a CI word and tool budget on everything the model reads, and the triage agent bound to it (#354).
- Write the reply from what happened: behind `CHAT_NARRATE`, off (#385). Design in [CHAT-SKILLS.md](CHAT-SKILLS.md).

**Reply quality**
- One coherent fallback instead of stitched drafts (#334).
- Fewer texts per turn: the search acknowledgment is held, and the purchase question goes in the same text (#338, #339).
- Left-out verified prices are put back by code instead of rejecting the reply (#363). No duplicate option when a sale's former price is missing (#416).

**Speed** ([SPEED.md](SPEED.md))
- Store page time limit and a 25 s discovery cap (#340). Typing dots alongside the context read (#342). Reply over the typing connection (#368). Save photos read during the consent check (#371). Parallel context reads (#427).

**Triage fixes (Oct 22 batches)**
- Size by fixed category (#355). Options that contradict the request are left out (#359).
- A save under one card saves that product (#367, #432). An approved save is finished, not set aside (#369). A refused save isn't retried in the same turn (#384).
- One-department stores set the department (#374). Off-look candidates are left out using the user's own brands (#379).
- A size reply continues the waiting save and alert (#396). Re-choosing a colour doesn't refetch the page (#405). A leaning toward lower prices must be the user's own words (#433).

**Process**
- Daily triage (09:09) is report-only: it freezes new reports, ranks root causes and adds the chat numbers. The founder picks at most 3 causes, then one PR per cause, gated case by case.
- Production chat model is gpt-5.6-luna since October 22 (`MODEL_CHAT` in Vercel).

## Decisions (founder)

- Fix order: code > structured field > example conversation > one skill rule. Never add a prompt sentence without saying what it replaces. Never add a tool (October 21–22).
- Word budgets are a brake, not a goal. No contradicting rules. Example conversations are exempt (October 22).
- Skill loading by router (CHAT-SKILLS step 12) only if it beats the simpler path: conflicts removed, duplicates merged, fewer tools (October 22).
- Test live on production with luna rather than more bake-offs (October 22).
- The gate compares the same cases between main and the PR. A trust-area case that starts failing (saves, alerts, consent, prices, claims) blocks the merge. Targeted runs are never skipped for cost (October 22).
- Card layout: keep up to 3 product cards for now, and revisit after the held acknowledgment has been used live (October 22).
- All chat metrics live on the Scorecard page (October 22).
- Pause chat behavior changes for 1–2 days after Oct 22 so the numbers can settle.

## What's left

In priority order:

1. **Separate OpenAI project and key for evals** (founder). It blocks safe testing, the nightly run and the next step of item 4.
2. **Schedule the nightly regression run** (`scripts/chat-gate.js --nightly`) once item 1 exists.
3. **Example conversations.** Ten are written and approved in [docs/example-conversations.md](docs/example-conversations.md). Next: build them into the prompt ([docs/example-conversations-handoff.md](docs/example-conversations-handoff.md)), then test them on luna with and without.
4. **`CHAT_NARRATE` decision.** Run the routing evals with the flag off and on (~$5–8). On the frozen set, flag on scored 67–70% vs 63%, but two save/alert cases got worse.
5. **The simpler-path test.** Remove contradicting rules, merge duplicates between skills and tool descriptions, and cut the 21 tools. Hold further router work until this is decided.
6. **Complaints per turn is 35%.** That's the real target. Read it per conversation and per kind on the Scorecard.
7. **Messages per turn (2.1).** Revisit the product-card layout.
8. **Luna timeouts.** 4 of 6 failed replies on Oct 22 were model timeouts, 2 of them in the shadow router, which should never fail a turn.
9. **Conversation journey tests with holdouts.** These are end-to-end shopping conversations with real search, so we can tell whether fixes generalize beyond the 88 known failures.
10. **Open PRs to decide:** #401 (save+alert approval sets the alert on a plain save).

## Where things live

| What | Where |
|---|---|
| Rules, gate, budgets | [CHAT-DEVELOPMENT.md](CHAT-DEVELOPMENT.md), `tests/fixtures/chat-prompt-budget.json` |
| Skills plan and step 4 design | [CHAT-SKILLS.md](CHAT-SKILLS.md), [docs/chat-skills-inventory.md](docs/chat-skills-inventory.md) |
| Test sets | [FROZEN-EVALS.md](FROZEN-EVALS.md), `scripts/chat-gate.js`, `lib/agent-eval-cases.js`, [REPLAY-SUITE.md](REPLAY-SUITE.md) |
| Model results | [MODEL-BAKEOFF.md](MODEL-BAKEOFF.md) |
| Speed | [SPEED.md](SPEED.md) |
| Triage history and cursor | [DEVELOPER-FEEDBACK-REVIEW.md](DEVELOPER-FEEDBACK-REVIEW.md), `.claude/agents/feedback-triage.md` |
| Production numbers | Admin › Scorecard, `scripts/chat-metrics.js` |
| Voice | [VOICE.md](VOICE.md), [docs/example-conversations.md](docs/example-conversations.md) |
