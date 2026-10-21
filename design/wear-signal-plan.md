# Wear signal: "seen in your outfit photos" — plan (not built)

October 20, 2026. Investigation only: no code, no test calls. The founder decides before any step is built.

## The idea

The wardrobe knows what someone **owns** (receipts, Shop orders, confirmed photos, photo tags, closet
summary, closet-aware ranking). It does not know what they **wear**. Outfit photos are the only evidence
of wearing we have. Matching the pieces in those photos to wardrobe items would give a signal such as
"seen in 3 of your outfit photos", kept separate from ownership.

## What exists today

| Piece | Where | What it does |
|---|---|---|
| Outfit photos | `style_sources` rows with `kind='outfit'` | Texted photos (`add_outfit_photos`, `lib/outfit-photos.js`) and `/style` uploads share one private store. EXIF and date taken are stripped on the way in (`prepareSource`, `lib/style.js`), so only the arrival time is known. |
| Photo cap | `db/010_style.sql` `write_style` | **At most 12 sources per person in total**, outfits, inspiration and receipts together. The 13th fails with "Source limit". |
| Outfit reading | `readOutfits` / `outfitReading` | Up to 10 newest photos, one call, up to 3 short observations ("lots of wide-leg trousers"). No item-level output. |
| The Read | `lib/fit-read.js` | Picks one photo, boxes the person, points at 3–4 items for jokes. It points at things; it does not identify them. |
| Outfit pieces | `lib/visual-search.js` (#203) | For a shopping request: lists every visible piece with a box, description and readable product text. Built for search, not the wardrobe. |
| Wardrobe photos and tags | `lib/photo-tags.js`, `lib/wardrobe-photos.js` | Each item's confirmed photo (order photo, or a searched photo the owner said Yes to) with colour, pattern, fit, silhouette, fabric, formality, details. |
| Section 30 step 2 | **Not built** | Texted outfit photos become wardrobe items (crop or matched store photo) and are **linked to receipt items** ("confident link attaches, unsure asked once"). That linking step is the same matching this plan needs. |

## Answers

### 1. Which outfit photos exist, and how many does the founder have?

Two kinds in one table: photos texted to Jules as the person's own outfits, and photos uploaded on `/style`
for the style report (including the one The Read uses). Each person can hold at most 12 sources in total.

I could not count them: the production read was blocked in this session. The founder can run this in the
Supabase SQL editor (read-only):

```sql
select left(conversation_id::text, 8) as person, kind, count(*), min(created_at)::date as first, max(created_at)::date as last
from public.style_sources
group by 1, 2
order by 1, 2;
```

Whatever the exact number, the cap means **nobody can have more than 12**. That limits what "seen worn N
times" can mean (see the risks below).

### 2. Can a match be stored reliably as evidence, and how is it checked?

**Item-level, unconfirmed: no.** Three reasons:

1. **Basics can't be told apart.** If someone owns six black T-shirts, a black T-shirt in a mirror pic
   matches all six. Section 30 already says a generic piece is never matched to a lookalike; the same
   applies here.
2. **Worn photos are harder than shop photos.** Folds, angles, layering, mirror lighting and partial
   views. Our easier test (searched store photo vs. a receipt line) was right only ~80% of the time, short of
   the 90% bar for showing something as fact (PRD section 29). Worn-photo matching will be lower, not higher.
3. **A wrong match teaches the wrong taste.** "You wear this a lot" about something they never wear is a
   trust defect, and against the rule never to claim a habit without evidence.

**What can be reliable:**

- **Distinctive pieces, owner-confirmed.** Use the Section 30 rule: a match counts only with distinctive
  evidence (readable brand or model text, a logo, or a signature design detail seen in both the outfit crop
  and the item's confirmed photo). The model proposes; code checks the item is the owner's and in the
  wardrobe now; the owner confirms with the **Is this yours? Yes / No** pattern already used for suggested
  photos (on the item detail: "Seen in this outfit photo?" with the crop). Only Yes becomes evidence.
  No is remembered so the same pair is never asked again.
- **Generic pieces at the kind level, no confirmation needed.** "Black T-shirt" or "dark straight jeans"
  counted against the closet summary's type and colour ("black tees: in 5 of 9 outfit photos"), never
  pinned to one item. This is a fact about the photos, not a claim about a specific item.

Stored like the other wardrobe evidence: append-only under the `wardrobe` origin, keyed to the outfit photo
and the item, deleted with imported history and when the outfit photo is removed.

### 3. Cost per photo (estimate; no test calls run)

Prices from `lib/usage.js` (gpt-4.1-mini $0.40 / $1.60 per million input/output tokens).

| Step | Model | Tokens (approx.) | Cost |
|---|---|---|---|
| A. List the visible pieces and propose candidates from the owned list (text, ≤150 pieces) | gpt-4.1-mini, photo at 1024px | ~4,000 in, ~500 out | ~$0.0025 |
| B. Check each proposed distinctive match: outfit crop vs. the item's confirmed photo | gpt-4.1-mini, low detail, ~2 checks per photo | ~1,000 in, ~100 out each | ~$0.001 |
| **Per outfit photo** | | | **about $0.004–0.01** |

Each photo is read once and cached (like photo tags), and re-read only when the wardrobe changes enough to
matter. The founder's backfill at the 12-photo cap is **about $0.05–0.12**. All 10 testers at the cap:
under $1.50. If step B moves to gpt-4.1 for accuracy, it costs about 5× more, which is still under $0.05 per photo.

**Before any test run:** OpenAI credit ran out on October 20 (every call got a 429). Top it up first. The
first test is the founder's own photos only: **expected under $0.15**.

### 4. Where it plugs in

| Place | Use | Wording rule |
|---|---|---|
| **Closet summary** (`lib/closet-summary.js`) | Add a `seen_in_photos` count per group or type ("black tees: 5 of 9 outfit photos") and a short list of confirmed items seen 2+ times. The stylist and search already read it. | `ABOUT` gains "Seen in outfit photos is what they chose to photograph, not how often they wear it." |
| **Closet ranking** (`lib/closet-ranking.js`) | Prefer pieces that have been seen worn for the "could go with your…" pairings. Owned but never seen stays eligible. No change to duplicate demotion. | Still a suggestion; never "you always wear…" |
| **Style report** | A later card, after the founder signs off the wording: "in your photos" vs. "in your receipts" (bought five, photographed one). Fits the "behaviour beats category counts" signal. | Accurate over funny; jokes join the thumbs feedback loop. |
| Wardrobe page | The confirm prompt on item detail. Showing "seen in N photos" on cards is optional and can come later. | |

Order of value: closet summary first (small, feeds everything), ranking second, report last.

### 5. Does it need a PRD decision?

**Yes.** Section 29 lists "wear tracking" as out of scope, and Section 30 lists "wear tracking" as out of
scope for outfit photos. The founder needs to decide:

1. **Lift the exclusion** for a "seen in outfit photos" signal (not daily wear logging).
2. **Consent scope:** may `/style` uploads count, or only photos texted as their own outfits? Section 30
   lets only texted photos create wardrobe items. Counting is lighter than creating items, and the `/style`
   ask already says "outfits you actually wear". Recommendation: count both, but never create items from
   `/style` uploads without asking (as Section 30 says).
3. **The 12-source cap:** keep it for now. Lifting it only matters if the signal proves useful (see the risks below).
4. **Sequencing with Section 30 step 2**, which is still unbuilt and needs the same matcher.

## Risks

- **Small numbers.** At most 12 photos, often 2–4. "Seen in 2 of 3 photos" is a weak signal; the wording
  must say photos, never "often".
- **Photo bias.** People photograph their best outfits, not their Tuesday ones. It is "what they show",
  not "what they wear most". Neither the stylist nor the report may treat it as frequency.
- **Same outfit, several photos.** A burst or two mirror angles from one day would double-count, and the
  date taken is stripped. Step A should flag photos showing the same outfit, and those count once.
- **Someone else in the photo.** Count only the person whose outfit it is; skip photos with several
  people, as The Read does.

## Recommendation and build order (one PR each, checked live before the next)

0. **Founder decision** on the four points above (PRD Section 31, or an amendment to 29 and 30).
1. **Build Section 30 step 2's matcher first, shared with this plan:** outfit photo → pieces with boxes →
   proposed links to owned items, distinctive evidence only, code-checked. Cache the result per outfit photo.
   The texted-photo path also creates items, as already decided. One matcher, two uses.
2. **Owner confirmation:** "Seen in this outfit photo? Yes / No" on the item detail, using the suggested-photo
   pattern. Only Yes becomes evidence. Plus kind-level counts for generic pieces.
3. **Closet summary + stylist:** `seen_in_photos` lines and the updated `ABOUT` caveat.
4. **Closet ranking:** prefer seen-worn pieces for pairings. Then, if the signal holds up, a style report card.

If the founder wants a cheaper first look before committing: a one-off script (no UI, no storage) that runs
step A on the founder's own photos and prints the proposed matches for review. Cost under $0.15. It would
show whether distinctive matches occur often enough to be worth steps 1–4.
