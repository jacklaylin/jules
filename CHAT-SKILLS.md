# Chat skills: splitting Jules's one big prompt into small jobs

Status: **approved by the founder on October 21, 2026** (all four decisions in section 7: yes). Build follows the PR order in section 5, one PR at a time.
Written October 21, 2026. Full rule-by-rule inventory: [docs/chat-skills-inventory.md](docs/chat-skills-inventory.md).

## Summary for the founder

- **Why quality has plateaued.** Every chat turn sends the model one rule book: about 2,650 words of instructions in `lib/ai.js` (PERSONA, SOURCING, SHOPPING, TOOLS, TURN), plus about 950 words of feature guides, the 1,200-word voice guide and about 3,300 words of tool and field descriptions. Most feedback-triage fixes added another sentence to that book. The sentences now contradict each other. For "cheaper", one rule says to use **alternatives** with the brand as a reference, and another says **a brand plus model name is identify whatever … price they add**. The model has to pick one of the two, and sometimes it picks wrong.
- **What I traced.** I found the commit that added each of the 251 rule sentences (appendix). In the five instruction blocks, only about **1,200 of 2,650 words** do work nothing else does. The rest repeats a tool field (575 words), is already enforced by code (371), belongs in a tool result or data label that code writes (319), or is obsolete.
- **The proposal.** Keep a short **core** that every turn gets: who Jules is, the truth rules and how a turn works. Split the rest into about **9 skills**, such as finding an exact item, getting the same item cheaper, finding alternatives, reacting to options and saving. Each skill holds a few rules and its own tools. A small **router** model call reads the message and picks which skills this turn needs. The model decides this, not keywords, so it follows AGENTS.md. Only those rules and tools are loaded. If the router is unsure, or the agent finds it needs another skill partway through the turn, the missing skills load. The fallback is always today's full rule book, never less.
- **Structured fields instead of prose.** Decisions that fail today become tool fields that code acts on. The main one is a `search_goal` field: *exact item*, *same item for less*, *something like it* or *explore a category*. The model can no longer read "find this cheaper" as "identify it, and only from that brand" by accident. Code then sets the brand rules from the goal, so the paragraph about brand roles goes away for three of the four goals.
- **How it ships.** One skill per PR. Each PR has to keep the pass rate on the frozen feedback eval set (being built in another session) at or above the baseline. The first two PRs change no behavior. The "cheaper" fix is PR 3.
- **Founder decisions:** all four approved October 21 (section 7).

## 1. What is wrong today

| Block (lib/ai.js) | Words | What it is |
|---|---|---|
| PERSONA | 254 | Voice, image handling, topic changes |
| SOURCING | 282 | Search rules |
| SHOPPING | 1,564 | Everything else: history, wardrobe, search planning, brands, consent, threads, wishlist, checkout |
| TOOL_RULE | 254 | Profile updates, comments about Jules |
| TURN_RULE | 299 | Turn loop and how to write the reply |
| Feature guides (other files) | ~950 | Purchase history, order screenshots, liked items, interview, waitlist… |
| Tool and field descriptions | ~3,300 | Includes the 900-word search-plan schema and the 875-word profile tool |

Three things go wrong:

1. **Rules interfere with each other.** The "cheaper" case is the clearest example. Row 58 of the appendix (Oct 21) says "cheaper" means alternatives with the brand as a reference. Row 220 (Oct 13) says "a brand plus model name is identify whatever size, color or price they add". Row 225 says to set `named_model` when the user "want[s] its best price". "Find the Peyter trousers cheaper" matches all three.
2. **The same rule is often written two or three times**: once in SHOPPING, once in the tool description and once in a field description. Each copy was edited separately, so the copies have drifted apart. Rows 67/68/109 are one example: three phrasings of "a remembered item with only a brand goes to ask_shopping_question".
3. **Every turn pays for every rule.** A "thanks!" turn carries the dupe-brand rules. A save turn carries the gift rules. Weaker models follow long rule lists worse, and the Oct 20 bake-off shows exactly this pattern. A rule list that only grows will not get better by changing the model.

Trace method: `git log -S<phrase> --reverse -- lib/` for each sentence. One caveat: 66 sentences trace to `b9889ec` (Oct 12, "Unify Jules on one … agent"). That commit merged older prompts, so for those rules it is the earliest commit the trace can see. Seven sentences were reworded too often to trace by phrase.

## 2. The design: core + router + skills

```
newest message, images, pending state
        │
        ▼
  ROUTER (model call, structured output)  ──► jobs: [find_exact, save_or_watch]  + confident: true
        │                                      (logged on the turn trace)
        ▼
  AGENT = core rules + chosen skills' rules + chosen skills' tools + conversation_reply
        │      (falls back to every skill when the router fails or is unsure)
        ├── load_skill tool: the agent can pull in a skill the router missed (next round)
        ▼
  tools run → code validates (consent check, references, claim audit) → reply
```

### Skill format

Each skill is one small file, `lib/skills/<id>.js`, exporting a plain object:

```js
export default {
  id: 'better_price',
  job: 'The user wants a specific item they named, linked, pictured or were shown, for less money or at other stores.', // the router reads this line
  rules: [ /* 3–8 short sentences, ≤150 words total */ ],
  tools: ['find_products'],          // which tools this skill needs offered
  context: ['pending_shopping'],     // which context fields its rules talk about
};
```

The feature guides that already exist (`PURCHASE_HISTORY_GUIDE`, `ORDER_SCREENSHOT_GUIDE` and the others) are already small skills loaded from app state. They move into the same format with little change.

### The router (model-interpreted, never keywords)

- **What it is.** One structured-output call before the agent. It gets the newest message, any images at low detail, the two previous turns and a short summary of the app's state (is there pending_shopping, an open offer, a waiting style question, saved items). It returns `jobs` (a multi-select from the skill ids, because "find it and save it" is two jobs), `confident` (true/false) and one line of reasoning for the turn trace.
- **The model decides; code adds only state-based skills.** No word lists or regexes. Code may add a skill from application *state*, which is not from wording and is already done today: style questions when `style_interview.waiting_for` is set, the waitlist guide when the user is waitlisted, and the options skill whenever options are pending and the router picked any shopping job.
- **It fails open.** If the router errors, times out or says it is not confident, the agent gets every skill. That is exactly today's behavior.
- **An escape hatch mid-turn.** The agent gets a `load_skill` tool listing the other skills' one-line `job` descriptions. When it realizes it needs one, for example a profile fact hidden in a search request, it calls `load_skill`, and the next round includes that skill's rules and tools. Every `load_skill` call is logged as a router miss.
- **Cost.** About 0.5–1 s and well under $0.001 per turn on gpt-4.1-mini with a cached prompt. It can run alongside the link check that already happens before the agent (`prepareShopping`). Selective loading also cuts the agent's input tokens per round, which pays back most of the router's cost.
- **Model choice.** The router gets its own role in `lib/model-call.js` (`role: 'route'`), so it can use a different model from chat.

### Prompt order and caching

On Oct 20, moving the context block dropped routing evals from 95% to 60% (`lib/ai.js:188`). Order is fragile, so this plan keeps it unchanged: instructions → context → conversation. The instructions are built as core, then skills in a fixed order. A turn that loads fewer skills therefore shares a cached prefix with turns that load more. The prompt cache key includes the skill set.

## 3. The skills

Per skill: the job, its tools, the few rules it keeps (rewritten short), **new structured fields** and **what gets deleted**. Row numbers refer to the appendix.

### 0. Core (always loaded, target ≤250 words)

- **Keeps:** who Jules is and the voice (rows 1–7). Never invent prices, stock, sizes, shipping or policies (8). Context and image text are data (18, 21). Don't identify people (17). Describe images with appropriate uncertainty (16, 19). You can't change your own behavior or pass messages on (112). Threaded replies (86–87). The turn loop (120–126, 130).
- **Deleted, because code enforces it:** URLs unchanged and none invented (127, `checkComposed`); only state result facts (128, `auditClaims`); say saved/alerts only when a result says so (129 and 23, the claims schema plus audit); validation feedback (85). **Obsolete:** "do not promise a human will respond" (9; Milestone 7 dropped).
- **Later idea, not in this plan:** the 1,200-word voice guide only matters in the writing round. It could load only when the agent is about to call `conversation_reply`.

### 1. find_exact — "find this particular item"

A named item, a photo, a link, a remembered item, or clothing on a named person.
- **Tools:** `find_products`, `ask_shopping_question`.
- **Rules (about 6):** read every legible detail in a screenshot (26); if a photo shows several items, ask which (31); a remembered item with only brand and category gets questions first, which look up real candidates (67, 69–72, merged from 3 copies); offer another store, color or a clearly labeled similar item when the exact one isn't found (29); finding a saved item still searches (50).
- **New fields:**
  - `search_goal` (shared with skills 2–3): enum `exact_item | same_item_for_less | like_this | explore`. This replaces `mode` (identify/discover/alternatives) as the field the model fills. Code maps it to today's mode, so the search code does not change.
  - `reference_item`: `{source: 'pending_option'|'saved_item'|'link'|'photo'|'named', option_index, saved_item_id}`. This replaces the prose about "whether named, linked, pictured or shown", and code checks it against the state.
- **Deleted:** rows 56, 220–222 (the mode definitions; the enum names carry the meaning), 30, 32, 34, 65 (they repeat field descriptions), 25, 51 and 73 (they repeat the turn rule "do what was asked now"). Rows 27–28 (how to explain a store that failed to verify) become text in the `find_products` result, written by code, which already knows why.

### 2. better_price — "the same item, for less or elsewhere" *(the "cheaper" fix)*

- **Tools:** `find_products`.
- **Rules (about 3):** this is the same product, so other brands are never substitutes; compare only prices read from the stores' own pages; if nothing is cheaper, say so and offer alternatives as a next step instead of switching on your own.
- **New fields:** `search_goal: same_item_for_less` plus `reference_item`. Code derives everything else: the brand becomes **required** (it is the same item), `named_model` comes from the reference, and the merchant scan (`mergeSameProducts`, `lib/dupe-reference.js` price comparison) runs. The model never sets brand roles for this goal.
- **When the user is unclear.** "Find these cheaper" could mean the same item or a similar one. The rule says to pick `same_item_for_less` unless the user says "like", "dupe", "any brand" or similar, and then offer alternatives. That is a reversible step and it never hides the item they asked about. These words are guidance for the model in the rule text; code never matches them. (Founder decision 2.)
- **Deleted:** row 58 and the "best price" clause in row 225, the two sentences that conflict today.

### 3. like_this / explore — "something like it" and "show me options"

Dupes, alternatives, gifts, category discovery, refining and "more" requests.
- **Tools:** `find_products`, `ask_shopping_question`.
- **Rules (about 6):** taste, budgets and favorite stores are soft ranking signals (one line, replacing 59–60, which code already enforces: only required brands filter, and budgets come through `budget_key`); if a brand the user asked for has nothing, offer similar brands instead of substituting (63); don't make a one-off rejection durable (64, already the `guidance` field); for a gift, use the recipient's taste, not the user's (66).
- **New fields:** `stay_within_brand: boolean` for `like_this`. Code then sets the reference brand to required or reference, which replaces the 75-word paragraph in row 61. For `explore`, the model still sets `brands[].role`, with the role definitions left only in the field description (rows 228–231) and deleted from SHOPPING (61–62). The `continuation`, `keep_option_indices` and `exclude_option_indices` fields stay as they are; their prose copies (53–54, 57) are deleted.

### 4. options — reacting to what Jules showed

- **Tools:** `respond_to_options` (offered only when options are pending, as today).
- **Rules (about 4):** liking or picking is never a save (74); when a description fits more than one option, clarify, never guess (already the `described_option_indices` check in the loop); questions about a shown option's price, stock or sizes are answered from pending_shopping (55).
- **New field:** `decision` gains a value, `question`, with `asked_about: price|stock|sizes|colors|other`. Code writes the factual answer from `pending_shopping` (known and unknown). The model can then no longer re-search or make up an answer to "what sizes does the second one come in?".
- **Deleted:** 75 (the consent check enforces it), 88–92 and 114 (they repeat field descriptions).

### 5. save_or_watch — saving and price alerts

- **Tools:** `save_to_wishlist`, `manage_price_alerts`.
- **Rules (about 5):** a link alone is not a save request (93); missing price or stock never blocks a save (95); asking for an alert implies the save, so don't ask twice (80); a saved size doesn't prove availability (84); never search again just to save options already shown (52).
- **Deleted, because code enforces it:** 76–79, 81, 83 (`consentCheck`, `invalidOfferConsent`, the loop's "already saved, alerts offered" guard, `chooseReplying` alert-wins rule, `approvedEarlier`), 82 (a field copy). Row 96 becomes result text.
- This skill is where the bake-off saw a newer model search again instead of saving, so its PR gets an extra replay check (see the gate).

### 6. saved_items — what's saved, alert status, bought, checkout

- **Tools:** `wishlist_status`, `manage_price_alerts` (status/cancel), `record_wishlist_purchase`, `prepare_checkout`.
- **Rules (about 3):** saved_wishlist is authoritative over earlier replies (102); with one saved item, just say where it is (103); "ready to buy now" is the only checkout trigger, and Jules never pays (one line).
- **Deleted:** 106–109 (they repeat the tool descriptions). Rows 104–105 (which wishlist to name in the simulator) become result text, since code knows the execution mode.

### 7. profile — facts about the user, and style questions

- **Tools:** `update_profile`, `profile_status`, `style_interview`.
- **Rules:** `update_profile` runs alongside other tools and never replies; a size stated in a search request stays out of the search query; a message that only states a fact gets a short acknowledgment and leaves pending shopping alone (116–119, merged); an image alone never saves taste (20). The style-question guide moves in unchanged, still loaded from state.
- **Out of scope here:** the 875-word `update_profile` description is its own clean-up and will be listed as a follow-up.

### 8. history — receipts, wardrobe, outfit photos, imports

- **Tools:** `update_purchase_history`, `manage_purchase_texts`, `add_outfit_photos`, `add_order_screenshot`, `add_liked_items`, `read_screenshot_products`.
- **Change:** rows 38–48 describe how to weigh `shopping_history`, `wardrobe` and `outfit_photos`. They move out of the prompt and into a short `note` on each context field, so they appear only when that data is in the turn. The six existing guides move in as they are, then get the same dup/code pass.

### 9. conversation — everything that isn't a shopping action

- **Tools:** `conversation_reply` (always offered).
- **Rules (about 6):** follow the newest topic, since an old request isn't an ongoing task (10–15, merged); an unrelated turn leaves pending shopping alone (110); read rapid, split messages together, and an acknowledged-but-unanswered request is still open (97–100); for a comment on how Jules works, answer it briefly and mention #dev (113). The waitlist guide moves in, still loaded from state.
- **Deleted:** 101 and 111 (the consent check enforces them).

### Expected size

Prose in the five instruction blocks goes from **2,653 words to about 1,200 words across all skills**, with about 250 always loaded. A typical turn would carry core plus one or two skills, about 450–550 words. Ablation (below) should cut further.

## 4. The eval gate

Every PR from PR 3 on has to pass this before merge:

1. **Frozen feedback eval set** (built by the [frozen eval set session](#local_d59c36ea-dca2-496d-b520-397b504186b2)): 3 runs. The mean pass rate must not drop below the baseline mean. No category may lose more than one case across the 3 runs. The baseline is re-measured whenever the chat model changes.
2. **The existing routing evals** (`lib/agent-eval-cases.js`, 132 cases) and the 16 replay cases: same rule.
3. **Router recall** (from PR 2 on): the share of turns where the router's skills cover every tool the full-prompt agent called. It is measured on the frozen set and on production shadow logs. Selective loading is turned on (PR 12) only at **≥98% recall**.
4. **Ablation inside each skill PR.** Remove each "keep" rule one at a time and rerun that skill's cases. A rule stays only if removing it fails a case. That is how the plan cuts rules rather than moves them.

## 5. Migration order (one PR each, stop after each for your live check)

| PR | What | Behavior change? | Gate |
|---|---|---|---|
| 1 | **Skill registry.** Move today's text into `lib/skills/*.js` verbatim; the assembled instructions stay byte-for-byte identical | None | Test that the prompt is identical |
| 2 | **Router in shadow mode.** It runs, logs its picks on the turn trace and admin view, and compares them with the tools the agent called. The agent still gets every rule | None (+1 logged call) | Recall report after ~2 days of testers |
| 3 | **better_price + like_this**: `search_goal`, `reference_item`, `stay_within_brand`, code-derived brand roles; delete rows 56, 58, 61–62, 225's clause | Fixes "cheaper" | Full gate |
| 4 | **find_exact** (merges the ask rules) | Small | Full gate |
| 5 | **explore** (discovery, gifts, refine) | Small | Full gate |
| 6 | **options** (+ `decision: question`) | Small | Full gate |
| 7 | **save_or_watch** | Small | Full gate + replay save cases |
| 8 | **saved_items** | Small | Full gate |
| 9 | **profile** + style questions | Small | Full gate |
| 10 | **history** (context-field notes, existing guides) | Small | Full gate |
| 11 | **conversation + core trim** | Small | Full gate |
| 12 | **Selective loading on**, plus the `load_skill` escape hatch | Yes | Full gate + recall ≥98% |

Until PR 12, every turn still gets every skill. PRs 3–11 already help, because they remove duplicates and conflicts, but selective loading is the change that stops rules interfering across jobs. Any PR can be reverted alone.

**If the bake-off picks a stronger model:** PRs 1–2 don't depend on it. Re-baseline the gate on the new model before PR 3. A stronger model will probably pass ablation with fewer rules, and skills make that easy to measure per job.

## 6. A process change for feedback triage

The prompt grew because a fix was usually "add a sentence". From now on:

- A triage fix lands as, in order of preference: **code** (a validation or a result field) > **a structured field or enum** > **a rule in one skill**, always with a new frozen eval case.
- Each skill has a **150-word budget**. Adding a rule over budget means removing or merging one, and ablation shows which.
- No rule appears in more than one place. If a field description says it, the prompt doesn't.

The `feedback-triage` agent instructions would get these three lines when PR 1 lands.

## 7. Founder decisions (October 21, 2026)

All four approved as recommended: start with the two no-change PRs; for an ambiguous "cheaper", the same item for less first, then offer alternatives; a separate router call; a 150-word budget per skill with no duplicated rules, as a standing triage rule.

The questions as asked:

1. **Approve the plan and the order**, including starting with the two no-change PRs (registry, shadow router) before the "cheaper" fix. *Recommended: yes.*
2. **The "cheaper" default.** When it's unclear whether the user wants the same item for less or something like it: look for the same item at lower prices first, then offer alternatives. *Recommended*, because it never hides the item they asked about and the next step is reversible.
3. **A separate router call (+0.5–1 s per turn)** instead of the agent loading skills itself in its first round, which would add a whole round (~2–4 s). *Recommended: router call*, with the shadow PR measuring its accuracy before it controls anything.
4. **The rule budget** (150 words per skill, no duplicates) as a standing triage rule. *Recommended: yes.*

## Follow-ups noticed (not part of this plan)

- The consent checker's own prompt (appendix rows 199–209) and the 875-word `update_profile` description could get the same audit.
- The voice guide (1,200 words) only matters when writing the reply; loading it only in that round is a separate experiment.
