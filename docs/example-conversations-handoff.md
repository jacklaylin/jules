# Handoff: example conversations into the chat prompt

Status: October 23, 2026. For a new chat-quality session. Read `CHAT-QUALITY.md` (project page) and `CHAT-DEVELOPMENT.md` (rules, gate) first.

## Where things are

- **The doc:** `docs/example-conversations.md` on branch `claude/chat-quality-overview` (worktree `.claude/worktrees/chat-guardrails`). Six commits ahead of origin, **not pushed**. Push before anything else. The main checkout's copy is the old template without conversations; don't use it.
- **Ten founder-approved conversations:** 1 find it cheaper · 2 photo, confident match · 3 photo, no confident match · 4 broad request, refined · 5 picking some options with tapbacks · 6 none of the options work · 7 correcting a saved size · 8 topic change · 9 asking her to buy it · 10 search fails, then only finds the original.
- **Not in the prompt yet.** `CHAT-DEVELOPMENT.md` already plans an `examples` prompt block from this doc, exempt from word budgets.

## Decisions the founder made

- **Write what lands on the phone.** The examples show iMessage as the user sees it: each product link is its own `jules: [link N]` text, and a save is followed by `jules: [wishlist link]`.
- **Only a search gets a heads-up text.** One line naming what's being searched, using the request's details, with no results, links, prices or questions. Saves, alerts, questions and advice get one reply.
- **Notation:** `[photo: ...]`, `[link: ...]` for links the user sends, `[tapback EMOJI on ...]`. A 👎 is developer feedback, never a shopping answer. Jules's 👀 is sent by code, so it's left out.
- **Placeholders:** `[price]`, `[amount]`, `[store]`, `[brand/product/variant name]`, `[size]`. A store the user's own link came from is named (MR PORTER, SSENSE). Any other store is `[store]`.
- **Optional `state:` lines** give saved facts (size, department, wishlist, alerts), so a test can check that Jules used them.
- **Grading:** tests grade against the `why:` and `state:` lines, never the exact wording. Test conversations are written separately from these examples (held out).
- **No change to `VOICE.md` for links** (see the first conversion below).

## Next step (one PR, then stop for the founder's live check)

Build the `examples` prompt block from the doc. You need to convert the examples, not paste them:

1. **Links.** The model writes each URL on its own line under its product, which `lib/compose.js` enforces. Code then sends product links as their own messages (`lib/link-preview.js`, `withoutPageLink`). So turn each `jules: [link N]` back into a URL line under item N.
2. **Heads-up.** That line is the `acknowledgment` argument of the search tool (`lib/ai.js`), not a reply. Show it as that, or the model will write it into the reply.
3. **Wishlist link.** Check whether code adds it after a save or the model writes it. If code adds it, leave it out of the model's side.
4. **Placeholders.** Keep the brackets, but make sure the reply checks catch a literal `[price]` or `[link]` if the model copies one.

Then run the gate on the final commit:

```bash
node --env-file=.env.local scripts/chat-gate.js --area conversation
```

Add `options`, `saves`, `alerts`, `search` and `profile` too, since the examples touch all of them. Use the evals key, not production's (its credit has run out three times). In the PR, list the cases that flipped, with a line for each.

## Still open

- **Situations not written yet** (founder writes them, or Claude drafts and the founder approves):
  - a reply to an older message (do this one first)
  - shopping for someone else (their size must not overwrite the user's)
  - advice only, no search
  - what's on my wishlist and which alerts are on, including changing or cancelling one
  - forgetting a fact or removing an item
  - size from a photo ("i'm a 50R" on a suit photo)
  - Jules texting first (price drop, return window)
  - receipt-based store preference
- **Held-out test conversations** for the same behaviors, with different wording, never used for tuning.
- **Doc tweak:** add to the Links notation: "write links as you see them on your phone; code handles the split."
