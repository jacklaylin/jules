# Cold-start taste: coverage check, gap-filling interview, early read

Status: October 20, 2026. Step 1 (coverage check) built; the rest is not built yet. Founder answered the open questions on October 19 (see "Founder decisions"). Extends `design/closet-interview-brief.md` (October 15 draft).

**October 20: checked against `main`.** This brief was first written on an older branch. `main` already has several pieces it planned, so they are reused, not rebuilt: the `store` taste field (and `fit`, `avoid`, `inspiration`, `owned`) in `lib/memory.js`; screenshots of Depop/Poshmark likes kept as liked items (`LIKED-ITEMS.md`, tool `add_liked_items`); outfit photos asked for during the import (`lib/outfit-photos.js`); item tags with a colour family and a resale flag for every purchase (`lib/item-tags.js`); and a resale marketplace list (`RESALE_MARKETPLACES`, `lib/source-registry.js`). The style report is now the purchase-based report in `lib/style-report.js`. Sections below are updated to match.

## Why

One tester has few receipts, most of them from resale shops, and very few outfit photos. Their taste profile and style reading both came out thin. Gmail and Shop work well for people who buy new from big stores. They work poorly for people who:

- skipped Gmail and Shop,
- connected them, but most clothing came from Depop, Poshmark, eBay, Vinted or TheRealReal,
- buy in person, or use a mailbox Jules can't see.

The fix is **not** a separate "quiz path" for people who skip Gmail. One coverage check runs for everyone. It finds which parts of the profile are missing or weak, and Jules asks only about those. Someone with 200 clear receipts gets one or two questions. Someone who skipped gets the full interview. Both go through the same code.

Order of work (smallest first, as AGENTS.md asks):

1. **Coverage check** (code only, no new UI). Also used for observability.
2. **Gap-filling interview** by text, plus the inspo ask. Builds on the closet interview draft.
3. **Resale receipts treated as real signal**, with honest limits.
4. **Stated-answer evidence**, plus an honest **"early read"** in place of silence.
5. *Phase 2, optional:* a 60-second this-or-that quiz on the web page while the import runs.

Steps 1–4 are one milestone-sized change. Step 5 waits until steps 1–4 have run with real testers.

## Principles (from AGENTS.md, applied here)

- **The model reads answers; code checks what gets saved.** No keyword lists decide what an answer means. The model turns each reply into structured changes, each with a quote. Code checks that the quote is real, that each change fits a dimension the question was about (or another valid dimension), and that the scope is right (for this person, durable).
- **Every belief cites evidence.** Stated answers become evidence rows. Profile facts cite them, as they do today (`facts_supported`).
- **Say what something is.** "You told me" is not "I saw you wear". "You bought on Depop" is not "you love Depop". "You saved this" is not "you own this".
- **Nothing invented.** Unknown stays unknown. An early read is labelled as an early read and names what it is built on.

---

## 1. Coverage check

A pure function, `coverage()`, in `lib/coverage.js` (`readCoverage(store, owner)` gathers its inputs). It reads what already exists: taste-profile facts, the person's own purchases (the same set the style report and ranking learn from: recipient confirmed as them, not removed, returned or duplicated), their item tags, kept outfit photos and their reading, and liked items. Stated answers (step 3) will feed in through the facts they create. It returns one entry per dimension. It does no model call and has no side effects. That keeps it cheap, testable and the same every time it runs on the same data.

### Dimensions

As built there are **eight** dimensions: categories and silhouettes are separate entries, because the fit-anchor question needs categories while the style reading needs silhouettes. Colours and secondhand status come from item tags, which count a colour only when the receipt or product text writes it.

| Dimension | What "known" needs | "Weak" means | Evidence sources it reads |
| --- | --- | --- | --- |
| **Categories & silhouettes** | Categories: at least 3 personal purchases (or stated items) across at least 2 categories. Silhouettes: a stated/confirmed style fact (e.g. "wide-leg, cropped jackets"), **or** at least 2 outfit photos with a repeated silhouette observation. | Categories known but silhouette only hinted at by product names on receipts ("Wide Leg Trouser"), or a single outfit photo. | `purchase_event` (category, product), `photo_observation`, `stated_answer`, `chat_statement`, style facts |
| **Palette** | At least 2 outfit photos with a palette observation, **or** a stated colour preference, **or** at least 4 personal purchases with a quoted colour that cluster. | 1–3 quoted receipt colours, or only inspiration images (inspiration shows what they like, not what they wear; both can make a dimension "known" only with a stated answer confirming it). | `purchase_event` (colour), `photo_observation`, `stated_answer` |
| **Brands** | A stated/confirmed brand preference, **or** at least 3 personal purchases from the same brand where the brand field was quoted from the receipt. | Brands seen once or twice, or only in resale listing titles (see section 3). | `purchase_event` (brand), brand facts, visible labels in `photo_observation` |
| **Sizes per category** | A stated or confirmed size fact for that category (existing `size` keys `category/system[/brand]`). Purchased sizes alone **never** make a size known (existing rule: bought ≠ fits). | Purchased sizes exist for the category but nobody has confirmed them. | size facts, `purchase_event` (size_label, size_system) |
| **Stores** | A stated store preference/avoidance, **or** at least 3 personal purchases with a clear top store. | 1–2 purchases, or many stores with no pattern. | `purchase_event` (merchant), store preference facts |
| **Price band** | `priceRange()` returns a band (it already needs at least 3 priced items in one currency), **or** a stated usual budget for a category. | 1–2 priced items. Resale-heavy bands are flagged `resale_band: true` (section 3). | `purchase_event` (price), `budget` facts |
| **New vs resale** | At least 3 personal purchases where the channel is known (section 3), **or** a stated answer ("i mostly thrift"). | 1–2 purchases with a known channel. | `purchase_event` (channel), `stated_answer` |

"Missing" means no evidence at all for the dimension. Sizes are reported per category: `sizes: {tops: known, shoes: weak, suits: missing}`. Only categories the person actually buys or mentions are listed; Jules doesn't ask for a suit size from someone who has never mentioned suits.

### What each entry contains

```json
{
  "dimension": "palette",
  "status": "weak",
  "sources": [{"kind": "purchase_event", "count": 2}, {"kind": "photo_observation", "count": 0}],
  "evidence_ids": ["gmail:…", "gmail:…"],
  "note": "2 quoted receipt colours, no outfit photos"
}
```

`evidence_ids` let the admin view and the interview cite exactly what Jules has, so it never asks for something it already knows.

### "Thin" is defined by coverage, not receipt count

- **Rich:** silhouette **and** palette are known, and at least 5 of the 8 dimensions are known.
- **Thin:** anything less.
- **Empty:** every dimension is missing (a skip, or an import that found nothing).

Fifty receipts from one marketplace with no photos can still be thin (no palette, no silhouette, unknown sizes). Eight receipts plus three outfit photos and a stated size can be rich. The receipt count isn't used anywhere in this decision.

### When it runs

- When a Gmail or Shop import reaches `ready`, before the completion text is sent.
- When the person declines Gmail/Shop at onboarding (onboarding moves to `declined`).
- After each interview answer, so the next question reflects what was just learned.
- After a style report is generated or a profile fact changes. (This is cheap; it can run whenever it's needed rather than being cached.)

### Where it's stored

The check is computed, not stored as a belief. Nothing new is stored:

- A `coverage_computed` log line (Vercel logs) per run, with the level, the eight statuses and the trigger. Built: `import_ready` (when the import's completion text is sent) and `declined` (Gmail/Shop skipped). Later steps add `answer` and `report`. The line carries statuses only, never brands, products or stores. (`usage_events` was the first idea, but it is the OpenAI/SerpAPI cost meter and only accepts those providers.)
- The interview state (step 2) will keep the snapshot it planned questions from, so a log shows why a question was asked.

**Admin:** Admin › People › person › Personal memory shows a "Coverage · thin" label and eight chips (known / weak / missing), each with a hover note such as "3 purchases with a written colour". Computed fresh on each page load (`/api/admin?view=coverage`). Read-only. No new page.

---

## 2. Gap-filling interview (extends `closet-interview-brief.md`)

The closet interview draft stays the base: its tone, its one-question-per-text shape, skipping, and its storage table. This brief changes **which questions are asked and why**.

### Change 1: questions come from coverage, not a fixed script

Each question in the draft maps to the dimensions it fills. Jules only asks a question when at least one of its dimensions is `missing` or `weak`.

| Question (draft wording, adapted by the model) | Fills | Asked when |
| --- | --- | --- |
| **Things you wear most** (photo or description) | silhouettes, palette, categories, brands | silhouette or palette is missing/weak. Strongest single question for thin profiles. |
| **Inspo** (new, below) | silhouettes, palette, brands (aspirational) | silhouette or palette is missing/weak. Never instead of "things you wear most"; it comes after. |
| **Regret** | silhouettes (what fails), palette (what fails) | profile is thin and at least one taste dimension (silhouette or palette) is weak. Skipped for empty profiles until something is known; a regret is easier to answer once Jules has reflected something back. |
| **Fit anchor** | sizes for one category | a category the person buys or mentioned has size `missing` or `weak`. When weak, Jules offers what it saw rather than asking cold: "your receipts show mostly M in tops. is that your usual?" Confirming makes the size known (`confirmation`). |
| **Secondhand or new** (new) | new vs resale, stores | new-vs-resale is missing **and** stores are missing or weak. Example: "do you mostly buy secondhand, new, or a mix? and any apps or shops you always end up on?" |
| **Spend** (new) | price band | price band missing or weak, and only as the last question. Framed as private. Example: "roughly what do you usually spend on a piece like a jacket? just for me, so i don't show you stuff way outside it." Stored as a `budget` fact only if the answer names a usual amount (existing rule: no occasion budgets). |
| **Gap** | the current request, not the profile | always offered once at the close, never as a profile question. |
| **Stores** | stores | stores missing or weak and not already covered by "secondhand or new". |

**Order:** the planner sorts candidate questions by how many missing/weak dimensions each fills, with silhouette and palette first because the style reading needs them. Ties keep the draft's order.

**Length:** at most **3 questions**, then the close. The close offers the rest: "i've got a couple more that'd sharpen this, want them now or later?" This answers the draft's open question ("is five too many?"). After each answer, coverage is recomputed and the next question is chosen again, so an answer that happens to cover two dimensions removes a later question.

**Who plans, who reads.** Planning is deterministic code over coverage (which dimensions are open). Wording is the model, in Jules's voice, adapting to what it knows. Interpreting the reply is the model, returning structured changes with quotes. No code decides from words whether the reply was a skip, a partial answer or a change of subject. The model says so (`outcome: answered | partial | skipped | declined_interview | changed_topic`), and code acts on that:

- `changed_topic`: the interview pauses. The person's new request goes to the normal agent. The open question is not re-sent in the same conversation stretch.
- `declined_interview`: no more interview questions unless the person asks. Coverage still guides ranking caveats.
- `partial`: save what was said, keep the dimension weak, and don't ask the same question again.

### Change 2: the inspo ask

New question, asked after "things you wear most" (or first, if the person says they don't have photos of their own outfits):

> want to show me what you're into? screenshots of your depop or poshmark likes, pinterest saves, or someone whose style you'd steal all work. no need to explain them.

What happens with what comes back:

- **Screenshots of likes and saves** go through the existing `add_liked_items` tool (`LIKED-ITEMS.md`): kept as liked-item evidence, never wishlist items, purchases or owned clothing. Own outfit photos go through `add_outfit_photos`. The interview adds no new storage for either; it only asks.
- **A named person** ("i'd steal harry styles' wardrobe") is stored as a `stated_answer` with `subject: 'inspiration_person'` and the name as the person typed it. Jules may say what it understands about that style only if the person adds images, or describes it themselves. It never looks up or identifies a person from a photo. (`ANALYSIS_PROMPT` already says this; it applies here too.)
- **A link** to a Pinterest board or Depop profile is not fetched in this version. Jules says it can't open those and asks for a couple of screenshots instead. (Fetching boards adds scraping and login problems; not worth it for 10 users.)

Inspiration can move silhouette and palette from `missing` to `weak`, never to `known`, unless the person also says it's what they actually wear or want to wear ("yes, that's what i'm going for" → `stated_answer`, which can make a **preference** known).

### Change 3: when it runs (replaces the draft's "When it runs")

| Situation | What happens |
| --- | --- |
| Gmail/Shop declined at onboarding | Coverage = empty. Interview starts after the welcome. |
| Import finished, profile **thin** | Completion text → receipt questions (unchanged) → interview questions only for missing/weak dimensions → early read (section 4). |
| Import finished, profile **rich** | Completion text → receipt questions → "Who you are" (unchanged). No interview, except a fit anchor if a category size is still weak. |
| Import found nothing | Completion text already says so and invites a photo or link. It now continues straight into the interview instead of stopping. |
| Any time, on request | "get to know me" or anything like it, interpreted by the model, re-runs the planner. |

### Interview state

Stored as a new `interview` jsonb column on `onboarding_sessions` (one row per conversation already exists). It holds: the coverage snapshot it planned from, the questions asked (id, dimensions, outbound message id), each outcome, and whether the person declined. Outbound texts go through the existing message ledger with ids like `interview:<started_at>:<question_id>`, so a replayed delivery never sends a question twice (same pattern as receipt questions).

Threaded replies follow the existing rule: a reply to an older interview text is resolved against that text's question, not the newest one.

---

## 3. Resale receipts as first-class signal

Resale purchases are often **better** taste signal than new ones. Someone picked a specific used item, often after searching for it, rather than taking what a store stocked. They are also less reliable for facts. This section says which is which.

### What resale receipts usually contain

Varies by platform and by email. **These are observations to confirm against real tester emails before building**, not claims about the platforms.

| Platform | Usually present | Often missing or unreliable |
| --- | --- | --- |
| **Depop** | Item title (written by the seller), price paid, seller username, order number, sometimes a size and photo | Brand as a separate field (it's in the seller's title, if anywhere), colour, size system, condition |
| **Poshmark** | Listing title, brand field, size as listed, price paid, order number, item photo | Size system, colour (in title only), the item's condition beyond the listing |
| **eBay** | Listing title, price, item number, seller, sometimes "Pre-owned"/condition text | Brand (title only), size (title only, any format), whether it's clothing at all (eBay sells everything; triage already handles "other goods") |
| **Vinted** | Item title, price, buyer protection fee, sometimes size and brand | Colour, size system |
| **TheRealReal** | Designer/brand, item name, price, often condition grade, sometimes size | Size system for some categories, colour |

### What Jules can learn from them

- **Categories, silhouettes, palette** from item titles, at the same confidence as new-item receipts *when the title states it*. "Vintage Levi's 501 straight leg" is a silhouette hint (`weak`, like any product name).
- **Brands:** a brand quoted from a brand field (Poshmark, TheRealReal) counts like any receipt. A brand found only in a seller's free-text title counts as a brand *seen*, and stays `weak` until confirmed or repeated (seller titles often name-drop for search: "Zara-style", "Aritzia vibes").
- **Stores:** the marketplace is the store. A Depop-heavy history means "you shop on Depop". It is shopping history, not a favourite (existing rule: receipts never claim loyalty).
- **New vs resale:** determined per purchase by (a) a `resale: true` flag on the merchant in the source registry for known secondhand marketplaces, a data lookup of the merchant's identity, not conversational routing, **or** (b) a condition quoted from the email ("Pre-owned", "Used – excellent"), extracted as a new optional `condition` field with a quote, verified like every other receipt field. Anything else is `channel: unknown`. Not guessed from the product.
- **Price band:** computed separately for resale (`resale_band: true`). A $25 Depop jacket doesn't mean someone shops at $25 for new jackets. The early read and "Who you are" say "what you usually spend secondhand" when the band comes mostly from resale.

### What must stay unknown

- **Fit and size.** A listed size on a used item is the seller's label, often vintage or another country's sizing. It counts as a purchased size, which is already never a confirmed fit. It may prompt a fit-anchor question; it never sets a size.
- **Authenticity.** Jules never says an item was genuine or not.
- **Retail price or original value.** Never inferred from a resale price.
- **Condition after arrival,** whether they kept it, whether it fit. Same as new receipts: unknown unless the person says.
- **Seller identity** isn't a preference. A seller username is never stored as a favourite store.

### Extraction changes

- Add optional `condition` (value + quote) to the receipt event schema and `reconcileReceipt` field list. Verified by quote like `color` and `size_label`.
- ~~Add a resale flag to source-registry entries.~~ Already on `main`: `RESALE_MARKETPLACES` in `lib/source-registry.js`, and the item tagger marks each purchase `resale: yes/no/unknown` from its merchant. Coverage uses the tag. Still open: eBay is mixed new/used, so a quoted condition should decide there.
- Check `TRIAGE_PROMPT` against real resale emails. It already skips seller-side notices ("an item the person listed was sold"), which is right: selling is not buying. Watch for buyer emails being skipped by mistake.

---

## 4. Stated-answer evidence and the early read

### New evidence kind: `stated_answer`

| Field | Value |
| --- | --- |
| `kind` | `stated_answer` (new value in the `evidence.kind` check) |
| `origin` | `interview` (text interview) or `quiz` (phase 2). New values in the `evidence.origin` check. |
| `source` | `{type: 'message', id: <inbound message id>, question_id}`, or `{type: 'quiz', session_id, pair_id}` |
| `data` | `{question, dimension, subject, answer_quote, choice?, image_source_ids?}` |
| `recorded_by` | `user` |

How it differs from `chat_statement`: a chat statement is something the person volunteered. A stated answer is something they gave in response to Jules's question or a quiz pair, so the question is kept with it. That matters because "do you like this or that?" invites a choice the person might not otherwise make. A quiz pick is weaker than an unprompted statement.

**What it can establish:**

- **Preferences:** likes and dislikes for colour, silhouette, category, brand, store, secondhand vs new, budget (usual only). Stored as profile facts with `basis: 'stated'` (text answers) or `basis: 'inferred'` (quiz picks, see phase 2).
- **Sizes**, when the answer states one (existing size rules apply).
- **Self-reported wear** ("i wear these jeans constantly"), stored as the closet draft already says: a wardrobe observation with `source: closet_interview`, marked as *the person said so*.

**What it cannot establish:**

- **Wear patterns Jules observed.** "You wear a lot of black" needs outfit photos. A stated answer supports "you told me you mostly wear black".
- **Ownership** of anything shown in an inspiration image or a quiz picture.
- **Frequency, seasonality or habits** beyond the person's own words.

### Changes to `REPORT_PROMPT` in `lib/style.js`

**Re-check before step 5.** The style report on `main` is now the purchase-based report in `lib/style-report.js` (cards such as the gatekeeper, emoji persona and in/out). The early-read design below was written against the older photo report and must be re-done against that file, with Claude Design, before building.

Today the report needs outfit photos. `reportSchemaFor` only allows `colors`/`formula` with 2+ outfits, and the validator rejects core cards that cite no file-derived observation. That's correct and stays. For a thin profile, it means one photo gives a one-card report, and no photos gives no report.

Add an **early read** mode rather than loosening the full report:

1. New input `mode: 'full' | 'early'`. `early` is used when coverage is thin. Observations passed in can now include `stated_answer`, purchase-derived observations (from the receipt summary: categories, colours, brands, channel) and inspiration observations, each tagged with its basis: `photo`, `purchase`, `stated`, `inspiration`.
2. New prompt text for early mode, appended to `REPORT_PROMPT`:

   > EARLY READ. Evidence is limited and comes from several kinds of source. Every card must say which kind it rests on in plain words: "from what you told me", "from what you've bought", "from what you saved". Never present stated or bought evidence as something seen in outfit photos. Purchases show what was bought, not what is worn or fits. Inspiration shows what the person likes, not what they own. Secondhand purchases are as meaningful as new ones; describe the item, not its price. Write 1–3 cards. End with what would make the read sharper, phrased as an invitation, not a requirement.

3. Allowed cards in early mode: `style` (any basis, must cite at least two observations from at least two sources, or one stated answer about overall style), `brands` (existing rule), `colors` (stated or purchase basis allowed, with the basis named), and `gap` (stated "wear" answer plus inspiration). `starter`, `formula` and `modes` stay photo-only.
4. The report row stores `mode: 'early'` and the coverage snapshot. The `/style` page shows an "Early read" label and the short "what would sharpen this" line. A full report replaces it when coverage reaches rich (no automatic text; Jules mentions it the next time the person is chatting about style, or on request).

The validator change: in early mode, the "must cite a file-derived observation" check accepts a cited observation of basis `stated` or `purchase` for `style` and `colors`, and requires the card's basis label to match the cited observations. That is a check on evidence references, not on wording.

### Changes to "Who you are" (ENTRY-FLOW.md, `profileText` in `lib/receipt-notifications.js`)

Today (`main`): with fewer than 2 purchases it sends only the outfit-photo reading, if there is one; otherwise nothing. For a thin profile that means the person hears nothing after the questions, which feels like Jules gave up.

New behaviour, all still sent once per import through the same ledger key:

- **Rich, 2+ purchases:** unchanged.
- **Thin:** the summary waits until the interview finishes (or is declined, or 24 hours pass, same fallback as now). Then it sends an **early read**: what's known, from where, and one line on what's still open. It lists only dimensions that are `known` or `weak`, and says which is which. Example shape (model writes the wording in Jules's voice; these facts are illustrative):

  > here's my early read, mostly from what you told me and a few depop finds:
  > you're into relaxed fits and earthy colours (your words)
  > you buy mostly secondhand, mostly on depop
  > sizes: you said M in tops; still not sure on shoes
  > it'll get sharper with a couple of outfit pics, whenever.

- **Empty and interview declined:** no summary. Jules says once, plainly, that it'll learn as they shop together. No pretend profile.
- **Fewer than 2 purchases but interview answers exist:** early read from the answers. The 2-purchase rule now gates *purchase-based lines*, not the whole text.

The text never lists a dimension as known that coverage marks weak, never calls a store a favourite unless the person said so, and labels a resale-heavy spend band as secondhand spend.

`profileText` stays deterministic for the rich case. The early read is written by the model from the coverage entries and their evidence, then checked: every line must cite evidence ids that exist and match the dimension it's about. A failed check falls back to a plain deterministic list of known facts.

---

## 5. Phase 2 (optional): this-or-that during the import

**Not in the first build.** Build only if testers start the interview but drop off, or if the import wait (several minutes) proves to be a good moment to get a few signals.

### Shape

- On `/onboarding`, while the import runs, below "Checked N emails so far": "while you wait, want to play this or that?" One tap to start, one tap to stop.
- 8–10 pairs of images, about 60 seconds. Each pair varies **one dimension**: palette (earth tones vs brights), silhouette (wide-leg vs slim), formality (tailored vs relaxed), secondhand feel (vintage vs new-season). Plus a "neither" and a "both".
- Picks are saved as `stated_answer` with `origin: 'quiz'`. They become profile facts with **`basis: 'inferred'`**, not `stated`, because picking one of two pictures is weaker than saying it. A later text answer or correction (`stated`) always outranks them (existing `BASIS_RANK`).
- Coverage counts quiz picks as at most `weak`. A quiz alone never makes a dimension known. It changes which questions the interview asks first and lets the early read say "from your picks".
- Pairs that cover dimensions the import is clearly going to fill (e.g. stores for a Shop user) are skipped. A pair that has an image of a specific product never implies that product is available or priced.

### Image sourcing tradeoff

| Option | Good | Bad |
| --- | --- | --- |
| **Static curated set** (recommended) | Free per play, fast, same for every tester so picks are comparable, images checked once for rights and quality, no real products so no implied prices or stock | Someone has to pick ~40 images once; can feel generic; needs a licence check (use images the founder owns or has rights to, or plain illustrations) |
| **SerpAPI live images** | Fresh, could tailor to known brands | Uses the 5,000/month search budget (shared with real shopping searches); slower; product photos imply specific items, prices and stock; image rights unclear; results vary per tester |

Recommendation: a static set of about 40 images (20 pairs, show 8–10). Store them in `public/quiz/` with a small JSON file mapping each pair to the dimension and value it tests. No SerpAPI use.

---

## What gets stored where

| What | Where | Basis / scope | New? |
| --- | --- | --- | --- |
| Coverage snapshot | `coverage_computed` log line; computed fresh for admin; later `onboarding_sessions.interview.coverage` | Observability only, never a belief | Log line (built); column in step 2 |
| Interview progress | `onboarding_sessions.interview` (jsonb) | Workflow state | New column (one new migration) |
| Interview answer (the proof) | `evidence`, `kind: stated_answer`, `origin: interview` | Immutable | New kind + origin values |
| Preferences from answers | `taste_profiles` facts (`style`, `brand`, `category`, `budget`, `size`), citing the `stated_answer` row | `stated`, durable | Existing fields |
| Store preference / avoidance | `taste_profiles` fact, new `store` field in `memory.js` `FIELDS` (key = merchant key, value likes/avoids + reason) | `stated`, durable, outranks receipt history | New field value (founder decision 1) |
| Secondhand-vs-new preference | `taste_profiles` fact `field: style, key: secondhand` | `stated` | Existing field |
| Screenshots of likes/saves | Liked-item evidence via `add_liked_items` (`LIKED-ITEMS.md`) | Never owned, never worn, never wishlist | Existing |
| Named style inspiration (a person) | `evidence`, `stated_answer`, `subject: inspiration_person` | Inspiration only, no lookup | New subject |
| Self-reported worn-often item | Wardrobe observation per closet draft, citing `stated_answer` | Person said so | Per closet draft |
| Regret | Narrow negative style fact citing `stated_answer` (closet draft rule: not a brand ban unless stated) | `stated`, narrow | Existing fields |
| Gap | Current shopping request | This conversation only | Existing |
| Receipt condition | `purchase_event` data `condition` (value + quote) | Quoted fact | New optional field |
| Resale marketplace flag | `RESALE_MARKETPLACES` and item tags (`resale`) | Data about the store | Existing |
| Early read report | `style_sessions.data.report` with `mode: 'early'` + coverage snapshot | Draft, user-reviewable | New property |
| Quiz picks (phase 2) | `evidence` `stated_answer` `origin: quiz` → facts with `basis: inferred` | Weak, overridable | Phase 2 |

One migration, in step 2 (next free number on `main`): add `stated_answer` to the `evidence.kind` check, add an `interview` row to `evidence_origins` (origins are a lookup table since `db/022`), and add `onboarding_sessions.interview jsonb`. Per the "unrun migrations break prod" lesson, the code must not deploy until the migration has been run in Supabase.

---

## Acceptance tests (multi-turn)

These assert intent, state and evidence, not exact wording. Each runs in the chat simulator / replay suite with fixture imports. "Jules asks about X" means the outbound question targets dimension X, checked through the interview state, not the text.

**A. Resale-heavy, few photos (the tester who prompted this)**
Fixture: 9 personal purchases (7 Depop, 1 Poshmark, 1 Uniqlo), quoted colours on 3, sizes on 5 (seller labels), 0 outfit photos.
1. Import ready → coverage: categories known, silhouette weak, palette weak, brands weak, sizes weak (tops, bottoms), stores known, price band known with `resale_band: true`, new-vs-resale known (8/9 resale). Profile = thin.
2. Completion text sent, then receipt questions, then interview Q1 = things you wear most (fills silhouette + palette).
3. Person replies with two mirror photos and "these are basically my uniform". → 2 outfit sources saved, `stated_answer` saved, silhouette and palette become known if the photos support a repeated pattern; otherwise they stay weak and the answer is saved anyway.
4. Next question is chosen again: fit anchor for tops, offering "your receipts show mostly M". Person: "yeah M, but L in vintage stuff". → size fact `tops/…=M` stated; vintage note saved as a size exception only if the model returns it as one; nothing converted.
5. Interview stops after 3 questions and offers more. Early read sent: says "secondhand", does not call Depop a favourite, labels the spend as secondhand spend, names the photos as the source of the style lines.

**B. Gmail skipped**
1. Person declines Gmail and Shop → coverage empty → interview starts after the welcome with Q1.
2. Person: "i don't really take outfit pics". → outcome `partial`/`answered` with no images; Jules moves to the inspo ask without re-asking for photos.
3. Person sends 3 Pinterest screenshots. → 3 `style_sources` with `kind: inspiration`; silhouette/palette move to weak at most; nothing in the profile says they own these items.
4. Person: "yeah that's the vibe i want". → `stated_answer`; a style **preference** becomes known; no wear pattern claimed.
5. Early read: one or two cards, each saying "from what you saved" or "from what you told me". No starter/formula card.

**C. Rich import: interview mostly skipped**
Fixture: 60 purchases, 3 outfit photos, stated shoe size, quoted colours on most.
1. Coverage rich. No interview questions, except fit anchor if one category's size is weak.
2. "Who you are" is the existing deterministic text, unchanged.

**D. Topic change mid-interview**
1. Jules asks Q2 (regret). Person: "actually can you find me a black wool coat under 300?"
2. Interpreted as `changed_topic`. The coat search runs through the normal agent. The regret question is not sent again in the same stretch, and the `under 300` is not saved as a budget fact.
3. Later the person says "ok ask me the rest of your questions". → planner recomputes and continues from what's still open, not from Q1.

**E. Reply to an older question**
1. Jules asks the fit anchor (shoes), then the person answers Q1 late by replying to the Q1 text with a photo.
2. The photo is saved against Q1's dimensions. The shoe size question stays open; nothing from the photo is saved as a shoe size.

**F. Correction and forgetting**
1. Early read says "relaxed fits (your words)". Person: "not really, i said relaxed jeans, my tops are fitted".
2. The style fact is narrowed to jeans; a separate tops fact is saved. Both cite the new `stated_answer`/`chat_statement`. The old fact is replaced, not duplicated.
3. Person: "forget the depop thing". → the model interprets which fact is meant. A stated secondhand preference is removed. Receipt history stays (it's evidence, not a preference), and the next early read stops mentioning it as a preference.

**G. Someone else**
1. During the interview: "my sister would love this kind of stuff" with a screenshot.
2. Saved as a request for someone else. Nothing written to this person's profile or inspiration sources.

**H. Interview declined**
1. Person: "not now, i'll just ask when i need something". → `declined_interview`; no more interview texts.
2. Empty profile → no early read. One plain line that Jules will learn as they go. A week later no interview text has been sent.

**I. Resale extraction limits** (unit tests on `reconcileReceipt` and coverage)
- A Depop receipt with title "vintage carhartt jacket (fits like L)" and no brand field → brand seen (`weak`), size label kept as written, never a size fact.
- A Poshmark "item sold" email → skipped by triage (seller side).
- An eBay electronics purchase → not apparel; no event.
- A quoted "Pre-owned" → `condition` saved with its quote; channel `resale`.
- A resale price never changes the new-items price band.

**J. Coverage is not a receipt count** (unit tests)
- 50 purchases, one marketplace, no colours, no photos, no stated sizes → thin.
- 6 purchases, 3 outfit photos with a repeated silhouette, stated palette → silhouette and palette known; with 2 more known dimensions → rich.

**K. Phase 2 (only if built)**
- 10 quiz picks → facts `basis: inferred`; coverage at most weak; a later stated answer that disagrees wins.
- Quiz is abandoned after 3 picks → the 3 picks are saved; the import and its texts carry on unchanged.

---

## Out of scope

- Fetching Pinterest boards or Depop profiles from links.
- Identifying people in inspiration images.
- A web form version of the interview (the web stays companion-only; questions happen by text).
- Changing the full style report's photo requirement.
- The wardrobe tab (separate draft, not yet authorized in the PRD).

## Founder decisions (October 19, 2026)

1. **Store preference field: add it in this change.** *(October 20: already on `main` before this work began; nothing to add.)* Add `store` to `FIELDS` in `lib/memory.js` (key = merchant key, value = likes/avoids plus the reason in the person's words). `MEMORY_PROMPT` gets the matching instruction, so stores named in ordinary chat are saved too, not only interview answers. A stated store fact outranks receipt-derived store history in ranking, and an avoided store is never ranked up. Product identity and verified availability still come first (TESTER-READINESS rule).
2. **Early read on `/style`: yes, after a Claude Design review.** Before building the page part, write a short Claude Design brief: how the "Early read" label, the source labels on each card ("from what you told me / bought / saved") and the "what would sharpen this" line fit the fixed 9:16 cards. Then update the style report canvas, which is the source of truth. The text early read doesn't wait for this; the `/style` display ships once the design is agreed.
3. **Spend question: ask it.** It stays in the planner and is asked when the price band is missing or weak, as the last question. The wording says it's private: "just for me, so i don't show you stuff way outside it". The answer becomes a `budget` fact. It never appears in card prose; `REPORT_PROMPT` already keeps money amounts out of cards. It may appear in the person's own early-read text, like the receipt spend band does today.
4. **Resale emails: the founder will share 3–5 real receipts.** Check section 3's table against them before building the extraction changes, and update the table to match what they actually contain. Handling: forward them, or export them as `.eml`, into a local folder **outside the repo** (or the session's scratchpad). Use them only to write test fixtures with names, addresses, order numbers and seller usernames replaced. Never commit the originals. Get the resale tester's consent before using any of their emails.

## Build order

Revised October 20 (the `store` field already existed, and the coverage check needs no migration):

1. **Coverage check**, with its log line and the admin chips. *Built in this PR.*
2. **Interview planner and inspo ask**, with `stated_answer` evidence and the migration it needs (`evidence.kind` value, `interview` evidence origin row, `onboarding_sessions.interview`). Use the next free migration number on `main`.
3. **Text early read** in place of silence for thin profiles.
4. **Resale extraction changes** (quoted condition), after the real emails have been checked.
5. **Early read on `/style`**, re-designed against `lib/style-report.js` with Claude Design.
6. **Phase 2 quiz**, only if the testers' results call for it.

One PR per step, each checked in production before the next one starts.
