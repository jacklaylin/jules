# Cost tracking and spending caps

Jules spends money every time it calls OpenAI (chat, photo and receipt reads, style reports) or SerpApi
(product search). A viral spike costs money before it earns any, so Jules can now stop itself at a
spending ceiling. This page covers what was checked, how the caps behave and how to turn them on.

## Cost tracking audit (October 19, 2026)

Checked against production `usage_events` (October 13–19) and SerpApi's own account report.

| What | Finding | Fixed? |
|---|---|---|
| **SerpApi searches were used up** | SerpApi reported 1,000 of 1,000 searches used and 0 left (Starter plan) on Oct 19; Jules' last recorded search was 17:50 UTC. Product searches that needed SerpApi failed until the upgrade. | Yes: upgraded to the Developer plan the same day (see below) |
| SerpApi price per search | Jules recorded each search at $0.015 while on the Starter plan ($25 / 1,000 = $0.025), so October's per-person search spend was understated by about 40%. Admin › Costs totals already used the real plan price. | Yes. The default now matches the Developer plan Jules moved to on Oct 19 ($75 / 5,000 = $0.015); set `SERPAPI_COST_PER_SEARCH` if the plan changes. Caps price searches at the current rate. |
| SerpApi refused calls counted | A search SerpApi refused (no searches left, rate limit) was recorded as spend. SerpApi doesn't charge for these. | Yes. Only searches SerpApi ran are counted. |
| SerpApi count gap | SerpApi counts 1,000 searches this plan month; Jules recorded 655. Likely causes: metering started Oct 13 (the plan month started Oct 12); until today's #185 some handlers bypassed the meter; and local testing with the same key. | Partly. #185 closed the bypass. Use a separate SerpApi key for local testing so it doesn't eat the production allowance. |
| gpt-5.5 calls stored at $0 | 21 style-report/chat calls made before gpt-5.5 had a price were stored at $0 (about $0.27). | Yes. Caps and Admin › Costs › By person reprice from token counts; `db/036` also fixes the stored rows. |
| OpenAI web search price | Jules used $25 per 1,000 searches. OpenAI's current pricing page lists $10 per 1,000 for the `web_search` tool, with the pages it reads billed as input tokens (already counted). | Yes ($0.010). The billed-vs-recorded check on Admin › Costs will show if this is off. |
| Per-person attribution | All but $0.01 of October's metered spend is tied to a person (the rest is an owner eval). No unattributed calls since #185. | Nothing to fix |
| OpenAI billed vs recorded | Not re-checked here: the local OpenAI admin key was rejected (401). Admin › Costs runs this comparison in production (added in #184). | Check the status line on Admin › Costs |
| Photon (iMessage) | Not metered per message; it's a manual monthly fee on Admin › Costs. Fine if Photon charges per line, not per message. | Confirm with Photon's pricing |
| Hosted browser (rendering store pages, report images) | Runs inside Vercel functions, so it's part of the Vercel bill, not per person. | Nothing to fix; shared cost |
| Recurring jobs | Price checks at 13:00 UTC today ran before job tracking (#178) deployed at 18:08 UTC, so no job runs are recorded yet. | Should appear from tomorrow |

Metered spend so far (Oct 13–19, at corrected prices): about $21, roughly $11 OpenAI and $10 SerpApi
(655 searches at today's $0.015). Two people account for nearly all of it: about $17 and $4.40, and about $2.30 each today.

### SerpApi plan

Upgraded to the Developer plan ($75 for 5,000 searches a month, renews the 12th) on Oct 19, which matches
the $0.015 default. If the plan changes, set `SERPAPI_COST_PER_SEARCH` in Vercel (Production) to the plan
price ÷ searches per month. Use a separate SerpApi key for local testing, kept only in your local `.env.local`.

## How the caps work

There are four limits, all **off** unless you set them. Amounts are US dollars of metered OpenAI + SerpApi
spend, priced at today's list prices. Days and months are UTC (a UTC day ends at 5pm Pacific, 4pm after clocks change on Nov 1).

| Setting | What happens when reached |
|---|---|
| `COST_CAP_USER_DAILY_USD` | That person's paid work stops until the next UTC day. |
| `COST_CAP_USER_MONTHLY_USD` | That person's paid work stops until the 1st of next month. |
| `COST_CAP_GLOBAL_DAILY_USD` | Paid work stops for everyone until the next UTC day, and new signups pause. |
| `COST_CAP_GLOBAL_MONTHLY_USD` | The same, until the 1st of next month. |

When a cap is reached:

- **Chat:** their message is saved in the conversation as usual. Jules texts a fixed note (no AI, so it costs
  nothing) saying it has hit its limit, that the message is saved, and roughly when to text again. Other
  messages within 3 hours get no reply; after that the note can go again. When they text after the reset,
  Jules sees the earlier message in the conversation and picks it up. Nothing is searched or claimed.
- **Price alerts:** that person's alerts are skipped (still on) and checked on a later run.
- **Gmail / Shop import, daily purchase check, profile summary:** they wait with nothing lost and continue
  after the reset. They are not counted as failures.
- **Style page and other web steps:** show "Jules has reached its spending limit…" with the reset time.
- **Signup page (global cap only):** shows "Jules is full for now. Please check back soon." and doesn't sign
  anyone up.
- **Owner tools** (evals, replay gate) are never stopped by a cap, but their spend counts toward the global total.

Caps are checked before work starts, so one reply can go a few cents past a ceiling; the next one stops.
If spend can't be read (e.g. a database problem), Jules carries on and logs `cost_cap_check_failed`, so a
fault never silences Jules. Each stop is logged as `cost_cap_reached` (no message text).

**Your own conversation is never capped** when `OWNER_ALERT_CONVERSATION_ID` is set to it (Admin › People ›
you; the id at the end of `/admin/people/<id>`). Its spend still counts toward the global total. Other numbers
you test from are capped like anyone else's.

### Later: a free tier for Jules+

Every person is on a `free` plan in `lib/cost-caps.js` (`planFor` / `limitsFor`). A paid plan only needs a
stored plan per person and its own limits there (or none). No payments are built.

## Turning caps on

1. **Why:** to put a ceiling on spend before a launch.
2. **Run the migration first** (one time): Supabase → SQL Editor → paste all of `db/036_cost_caps.sql` → Run.
   It adds a read-only view and reprices the $0 gpt-5.5 rows. Caps work without it but undercount late-priced calls.
3. **Action:** Vercel → Project → Settings → Environment Variables. Add any of the four settings above for
   **Production**, then redeploy (Deployments → … → Redeploy).
4. **Value:** a dollar amount, e.g. `3` or `250`. Leave a setting out (or set it to 0) for no cap.
5. **Check:** Admin › Costs → **By person** shows each person's spend today and this month against their cap,
   and the status line shows the global position. With no caps set it says "Spending caps are off."

A starting point from October's data (the heaviest person spent about $17 in a week, $2.30 on a busy day):
per person `5` a day and `50` a month; global `50` a day and `500` a month. Raise them if you see people capped in normal use. The amounts aren't secret, but keeping them in
Vercel lets you change them with a redeploy instead of a code change.
