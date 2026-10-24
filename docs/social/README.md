# Social on autopilot

Status: started October 24, 2026. Organic posting for the Jules accounts on TikTok and Instagram, written and scheduled every week by a Claude routine, measured by sign-up source. Constraints and positioning come from [GTM.md](../../GTM.md); this page is the routine's rulebook, so keep it short and current.

## The bet

- **Format: swipeable photo carousels**, one a day, the same post on TikTok (9:16) and the Instagram feed (4:5). Carousels are the cheapest format to make well without a face on camera, they reach the TikTok For You feed without followers, and they look like the product: the style report is already a deck of cards.
- **Channels:** TikTok first (younger, taste-driven shoppers; Wrapped season), Instagram second (creators check it before they answer a DM). Reddit stays human: the founder posts with disclosure (GTM.md step 5); automated Reddit posting reads as spam and breaks community rules. X, Threads, Pinterest and LinkedIn wait until a series proves itself.
- **Tool: [Zernio](https://zernio.com)** (formerly Late) schedules both accounts through one API. First two accounts free, unlimited posts (pricing page, October 24, 2026). Postiz ($29/month) and Buffer (free plan, but no posting API) were the alternatives.
- **Cost:** $0 a month for tools. Copy is written by the routine; slides are rendered from the brand templates in code. The $200 boost budget in the launch plan is for the best organic post, not for ads made from scratch.

## Series

The plan rotates through recurring series: "what your ___ says about you", "jules, help" example chats, "dress like ___", starter packs, in / out, Closet Wrapped, dupe or the real thing, dress-code decoder, this week, gift panic, deadpan one-liners, the hunt, and real receipts. Each one works as a carousel now and as a short video later. The list, the rotation and the seasonal calendar are in [THEMES.md](THEMES.md). Every post names its `series`, so results are compared per series.

## Rules the routine follows

Code enforces the starred rules (`scripts/social/plan.js`); the rest are judgment.

- ★ **Never "AI".** No AI, agent, GPT, algorithm. Sell the outcome (GTM.md).
- ★ **No price without a source.** A price or discount needs a store URL seen within 14 days and "prices as of <date>" in the caption. Default: no prices at all.
- ★ **No fake conversations or testimonials.** A conversation is either real (point to the screenshot) or drawn with an "Example conversation" label. Example cards say "Example card". Never invent a user, a quote, a number of users or a result.
- ★ 3–10 slides, last slide is the call to action, up to 5 hashtags, scheduled at least 12 hours ahead.
- Only claim what Jules does today (check [docs/example-conversations.md](../example-conversations.md) and the FAQ). Free while in early access; iPhone and iMessage only.
- Slide 1 is the hook: under 10 words, a statement, about the viewer. The post pays it off by the last slide.
- Write in Jules' voice ([VOICE.md](../../VOICE.md)): warm, specific, a little opinionated. Chat bubbles from Jules are lowercase.
- Celebrity looks are fine (THEMES.md › Celebrities): describe the look, never use their photo, never suggest an endorsement. Don't mock private people, bodies or anyone's money. Brand names are fine as examples of taste, never as endorsements.
- Captions: one or two plain sentences, then "link in bio". Hashtags are for search, not decoration (`fashiontok`, `wheresitfrom`, `stylewrapped`, `thrifttok`, `restock`).

## How the loop works

Every Friday the routine:

1. Reads results for everything posted so far: `node scripts/social/run.js stats --days 28`.
2. Picks next week from [THEMES.md](THEMES.md) › Rotation: one post per series plus two wild cards for last week's best series (by shares + saves per 1,000 views, then views), weighted to the seasonal calendar. A hook that flopped gets one rewrite, then it's dropped.
3. Writes `docs/social/plans/<next Monday>.json` (see the 2026-10-26 plan for the shape).
4. Checks and renders: `node scripts/social/run.js render <plan>`, then looks at the slides itself.
5. Schedules: `node scripts/social/run.js schedule <plan>`, 7pm New York time, Monday to Sunday.
6. Pushes the plan and its `.scheduled.json` to the `social-plans` branch (never `main`) and posts a short summary: last week's numbers, what it changed, and next week's hooks.

Posts sit in the Zernio calendar for at least 12 hours before they publish. To stop one, delete it there. To stop everything, pause the routine.

## Measuring

- **Bio links carry the source.** TikTok bio: `textjules.com/?ref=tiktok`. Instagram bio: `textjules.com/?ref=instagram`. The landing page carries `ref` into sign-up, and Admin › People shows the source of each sign-up.
- **Weekly:** views, shares, saves and comments per post and series (Zernio analytics), and sign-ups by source (Admin).
- **The number that matters:** sign-ups per 1,000 views by channel, compared with creator posts (their own `?ref=` codes) at the Monday review.
- **Decision on November 30** (about 30 posts): if social has brought fewer than 25 sign-ups, cut it back to three posts a week and move effort to creators and Product Hunt. If one series clearly wins, give it most of December.

## Setup (once)

1. **Accounts.** A TikTok account for Jules switched to a Business account (TikTok › Settings › Account › Switch to Business), and an Instagram account switched to Professional › Creator or Business. Put the bio links above in each.
2. **Zernio.** Sign up at zernio.com, connect the TikTok and Instagram accounts, then Settings › API keys › create a key. The key starts with `sk_`.
3. **Where the key lives.** On your Mac: add `ZERNIO_API_KEY=sk_…` to `.env.local` (never in Git). For the weekly routine: the cloud environment (Project settings › Cloud environment › gear) needs `zernio.com` under Allowed domains, and the key as a network secret for `zernio.com`, header `Authorization`, prefix `Bearer`, plus the environment variable `ZERNIO_INJECTED=1`.
4. **Check:** `node --env-file=.env.local scripts/social/run.js accounts` lists both accounts.

## Commands

```bash
node scripts/social/run.js check docs/social/plans/2026-10-26.json     # rules only
node scripts/social/run.js render docs/social/plans/2026-10-26.json    # slides to docs/social/out/ (not committed)
node --env-file=.env.local scripts/social/run.js schedule docs/social/plans/2026-10-26.json
node --env-file=.env.local scripts/social/run.js stats --days 14
```

Rendering needs a local Chrome (found automatically on a Mac and in the cloud container, or set `CHROME_PATH`). `schedule --dry` prints the requests without sending them. A rerun skips posts already in the plan's `.scheduled.json`.

## Not yet verified

- Zernio's analytics may need its analytics add-on for some numbers (`hasAnalyticsAccess` in the accounts response); the pricing page says analytics are included.
- Whether Zernio honors the `Idempotency-Key` header. The `.scheduled.json` ledger and Zernio's duplicate check (409) cover reruns either way.
- TikTok may cap API posts per day for new accounts. One a day is well under Zernio's stated limit of 15 photo posts.
