# Closet interview (draft)

Status: draft, October 15, 2026. Not built.

October 19: `design/cold-start-taste-brief.md` extends this draft. Questions are chosen from a coverage check (missing/weak dimensions only, at most 3 before offering more), it adds an inspo ask and a secondhand-or-new question, and it replaces "When it runs" below.

## Why

Gmail and Shop show what someone bought. They don't show what they actually wear, what fits, or what they regret. A short text interview gets that in about five minutes. It works for someone who never connects an account (cold start), and it fills gaps for someone who did.

## Shape

- Up to five texts, one question each. Jules waits for an answer before sending the next one.
- Every question can be skipped ("skip", "idk", silence for a day). Skipping ends that question, not the interview.
- Photos are welcome but never required. A description is enough.
- Jules skips any question Gmail, Shop or the chat already answered, and doesn't repeat facts back as questions.
- The model reads each answer. Code checks what gets saved and where (see "What gets stored").

## Script

The wording is a starting point in Jules's voice (`VOICE.md`), not a fixed script. The model adapts it to what it already knows.

**1. Things you wear most**
> quick one so i can shop like i know you: what are 3 things you wear all the time? photos are perfect (a mirror pic or the item on your bed), but a quick description works too.

Optional follow-up, only when the answer leaves the reason unclear and it would change future picks:
> what makes the [item] work for you: the fit, the fabric, or that it goes with everything?

**2. Regret**
> and one thing you bought but barely wear? what was off: the fit, the color, or it just didn't go with anything?

**3. Fit anchor**
Ask only for a category where no size is known yet.
> what size do you usually take in [category]? if a brand runs differently for you, tell me that too.

**4. Gap**
> anything you've been meaning to buy or replace?

If they name something, this becomes the first search. Ask before searching, unless they asked for one.

**5. Stores** (skip when receipts already show a clear pattern)
> where do you usually end up shopping? and anywhere you avoid?

**Close**
> got it. here's what i'll keep in mind: [2–3 concrete takeaways]. tell me if any of that's off.

If a gap was named:
> want me to start looking for [gap] now?

## What gets stored

| Answer | Stored as | Scope |
| --- | --- | --- |
| Worn-often items (photo or text) | Wardrobe observation with source `closet_interview`, evidence and confidence; `worn_often: true` | Durable, user-stated |
| Why it works (fit, fabric, versatility) | Style preference with a quote | Durable |
| Regret and its reason | Negative observation tied to the reason (e.g. "cropped fits don't work for me"). Not a ban on the brand unless they say so. | Durable, narrow |
| Size / brand exception | Existing size memory keys (`category/system[/brand]`) | Durable, follows the existing size rules |
| Gap | Current shopping request, not a profile fact | This conversation only |
| Stores liked / avoided | Explicit store preference or avoidance | Durable; overrides receipt-derived store history |

Brand and model stay unknown unless the person says them or a label is clearly readable in the photo.

## When it runs

- **No Gmail or Shop connected:** after the welcome, as the main way to start.
- **Gmail connected:** the outfit-photo request during import covers question 1. Questions 2–5 go after the receipt questions, and only the ones still unanswered.
- **On request:** "get to know me", or similar, interpreted by the model.

## Open questions

- Should the close summary ask for confirmation before saving, or save explicit statements right away (as the chat already does) and accept corrections?
- Is five questions too many for testers? Consider stopping after 3 and offering the rest later.
