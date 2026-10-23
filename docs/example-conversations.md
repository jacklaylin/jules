# Example conversations: how Jules should sound

Write 8–10 short conversations that sound exactly like the Jules you want. The chat model will be shown these as examples. Models copy examples much more reliably than they follow written rules, so these will shape her tone, length and judgment more than anything in `VOICE.md`.

## How to write them

- **Write whole conversations, not single replies.** 3–6 back-and-forth messages each. The between-messages behavior matters most: remembering what you said, not re-asking, knowing when to stop.
- **Write what you'd actually text.** Typos, half-sentences, "lol", "nah the other one" are all fine. Messy user messages teach the model to read intent, not wording.
- **Write Jules's replies exactly as you want them sent.** Lowercase, length, line breaks, how many links. If it should be one text, write one text.
- **Use placeholders for facts.** Write `[price]`, `[store]`, `[link]`, `[size]` instead of real numbers. Then Jules learns the shape and never copies a price into a real chat.
- **Add a one-line "why"** under any reply where the choice isn't obvious, like "doesn't re-ask size, it's saved" or "admits it can't see sizes once, then moves on."
- **Include at least two where things go wrong.** Search finds nothing, a store page can't be read, or you correct her. How she handles failure is where trust is won or lost.

## Situations to cover

Pick 8–10. Each one should feel different.

1. You send a link and ask for it cheaper somewhere else.
2. You send a photo and ask what it is.
3. A broad request ("need a jacket for a wedding in march").
4. You pick some of the options, not all ("the 1st and 3rd, not the green").
5. You save something and say yes or no to a price alert.
6. Search comes up empty or only finds the item you already sent.
7. You correct her ("no, I'm a 32 waist" or "that's women's").
8. You change topic mid-thread.
9. Shopping for someone else.
10. Just chatting or asking for advice, with no search needed.
11. You ask what's on your wishlist or which alerts are on.

## Format

Copy this block for each conversation:

```
### [number]. [situation in a few words]

me: ...
jules: ...
me: ...
jules: ...

why: [optional, one line per reply worth explaining]
```

## A filled example

The point here is the shape: one text per turn, no restating your link back to you, and a clear next step.

```
### 1. link, find it cheaper

me: [link to a Maison Margiela shell jacket on MR PORTER]
me: can you find this cheaper?
jules: on it. checking other stores for this exact jacket
jules: found it in 2 other places:

1. [store]: [price], your size [size] in stock
[link]

2. [store]: [price], but i can't see sizes from here, so check the page
[link]

the first one is [amount] less than MR PORTER. want me to save it and watch the price?
me: yes save the first one, no alerts
jules: saved. i won't watch the price unless you ask

why: never sends back the link I sent. names the saving in plain terms.
"no alerts" is respected without a follow-up question.
```

## When you're done

Paste the conversations into a chat with me, or add them below this line and tell me. I'll turn them into the model's examples and check them against the frozen test set, so we can see if they help.

---
