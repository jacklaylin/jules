# Answer-engine visibility

When a shopper asks an answer engine (ChatGPT, Perplexity, Claude) a question Jules is built for, does the answer bring Jules up? This folder holds a dated report for each check, so we can see whether that changes over time.

## What it measures

`scripts/aeo/probe.js` sends each question in [`scripts/aeo/questions.json`](../../scripts/aeo/questions.json) to each answer engine once, with web search on, the way a shopper would type it. Questions never name Jules. For each answer it records:

- **Mentioned:** "confirmed" when textjules.com appears in the answer or its links; "likely" when "Jules" appears next to shopping words (iMessage, price, size, restock…). "Jules" alone isn't enough because it's a common name; other well-known Juleses (Verne, Koundé…) are skipped. Every hit keeps the sentence around it so a person can check it.
- **Cited:** the answer links to textjules.com.
- **Cited domains** and **competitors named** (list in `questions.json`).
- Token use and estimated cost (list prices; invoices are the source of truth).

Engines: OpenAI (Responses API with web search, default `gpt-5.5`), Perplexity (`sonar`), Anthropic (Messages API with web search, default `claude-opus-5-5`). An engine without a key is skipped and the report says so.

It only reads answers. **It never edits the site, never posts anywhere, and never writes to Jules' database** (its spend is not counted in the admin Costs page).

## Running it

Keys live in `.env.local` on your computer (and in the cloud environment's settings for a scheduled run), never in the repository:

| Setting | Where to get it |
|---|---|
| `OPENAI_API_KEY` | Already set for Jules. |
| `PERPLEXITY_API_KEY` | perplexity.ai → Settings → API → add a payment method and a few dollars of credit → Create API key. |
| `ANTHROPIC_API_KEY` | console.anthropic.com → Settings → Billing (add a few dollars) → API keys → Create key. |

**Scheduled cloud runs** don't use environment variables for keys (the cloud environment's own note says not to put secrets there). Each key is a **network secret** on the Default cloud environment instead (claude.ai/code → environment menu → Cloud → Default → gear → Network secrets → Add secret). The secret is added to requests to that one website and sessions never see it:

| Engine | Allowed website | Header |
|---|---|---|
| OpenAI | `api.openai.com` | `Authorization`, prefix `Bearer` |
| Perplexity | `api.perplexity.ai` | `Authorization`, prefix `Bearer` |
| Anthropic | `api.anthropic.com` | `x-api-key`, no prefix |

Then list those engines in the environment variables as `AEO_INJECTED_KEYS=openai,perplexity,anthropic` (only the ones with a secret). The probe then calls them without a key of its own.

Optional: `AEO_OPENAI_MODEL`, `AEO_PERPLEXITY_MODEL`, `AEO_ANTHROPIC_MODEL` to change models; `AEO_MAX_COST_USD` (default 5) stops the run once estimated spend passes it.

```bash
node --env-file=.env.local scripts/aeo/probe.js --dry
```

```bash
node --env-file=.env.local scripts/aeo/probe.js
```

`--dry` lists questions and which engines will run, without calling anything. `--engines perplexity --limit 2` runs a small trial. A full run is one call per question per engine: about $1 for OpenAI; Perplexity Sonar and Claude should be in the same range or less. It writes `docs/aeo/YYYY-MM-DD.md` and `.json` (the full answers).

## Reading the report

- **Summary:** how many answers mentioned Jules, per engine. Today's baseline is the number to beat.
- **Compared with…:** appears once there's an earlier report: which questions gained or lost a mention, and new gaps.
- **Mentions:** the sentence each mention came from. Check "likely" ones by eye.
- **Questions:** which sites each answer leaned on and which products it named. This is who answer engines think does the job today.
- **Off-site gaps:** non-store sites (Reddit, roundups, app stores, blogs) cited for two or more questions in answers that left Jules out. A real, disclosed mention there is the likeliest way into these answers. That's founder work (GTM.md step 5), never automated.

Answers vary from run to run, so treat a single changed answer as noise and look at the trend across runs.

## Changing the questions

Edit `questions.json` on purpose and bump `version`; reports compare by question id and note when the list changed.
