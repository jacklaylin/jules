# Image identification evaluation

Goal: identify the right product and variant from an image, then choose a merchant. A working URL and correct brand alone do not pass.

Keep tester photos and run outputs in `.eval-local/` (Git-ignored). The manifest's `expected` labels are for grading only and are never sent to the search/model. Use neutral image filenames and queries such as “Find the jacket,” with no brand/model hint. Do not put expected answers in VOICE.md or prompts. Use the same input and API model for baseline and visual-search runs. Repeat each case three times to expose variability.

Start with 12 cases:

| Cases | Input | Expected behavior |
| --- | --- | --- |
| 1–2 | Founder’s original Barbour outfit photo and a tighter jacket crop | Barbour × Paul Smith check jacket, MWX2611BR71; a solid rust version or longer coat is a wrong identification |
| 3–4 | Two visually close jackets with independently confirmed different models | Correct model/variant; no substitution based solely on brand/collar |
| 5–6 | Clear bag and shoe photos with independently confirmed product links | Correct product and color/variant |
| 7–8 | Two whole outfits with ground truth for each requested visible piece | Separate results per piece; report missing pieces, no claim of finding the whole outfit from one jacket |
| 9 | Outfit + “Find this” with no clear target | Clarifying question before provider upload |
| 10 | Low-resolution/occluded garment that cannot support identification | Abstain or ask for a closer image; no confident match |
| 11 | A known correct product sold by multiple merchants | Same product grouped; official/preferred sellers above unreviewed, with no invented availability/policies |
| 12 | Wrong-model listing at an official brand and correct model elsewhere | Correct product wins before merchant ranking |

For each case retain original input, query, provider candidates, comparison evidence, returned product URLs, merchant order, elapsed time, and model/version/commit. In the first iteration, grade by opening listing images and comparing against the independently confirmed answer. Model-generated evidence is not ground truth.

Metrics:

- Exact product-and-variant precision: correct identifications / all claimed identifications.
- Identification coverage: correct identifications / identifiable requested pieces.
- False-match rate: wrong identifications / all claimed identifications.
- Appropriate abstention: unclear/unanswerable cases that return no likely match.
- Candidate recall: whether the correct product appeared among retrieved candidates (manually grade in the retained trace).
- Outfit coverage: requested pieces correctly identified / requested pieces, including missed or failed pieces.
- Retailer-order pass rate for equivalent products, not across different products.
- Median latency and provider searches per request.

Initial release gate: zero false likely matches on this small set, at least 80% coverage on identifiable pieces, all ambiguity/unanswerable checks correct, and all retailer-order checks pass. This is a provisional prototype gate, not a statistically meaningful accuracy claim. Keep at least four cases held out from prompt tuning; show development and holdout results separately.

## Running

Create a private JSON manifest with neutral IDs, `image_paths` (absolute paths), `query`, and independent `expected` labels. Start from `evals/manifest.example.json`. Set credentials as private shell environment variables, not committed files. Run `node scripts/evaluate-identification.js /absolute/path/to/private-manifest.json`. The runner refuses to overwrite a run, sends only images/query, and saves outputs privately without keys. The manifest and answers are not bundled into the app.

After reviewing each run, create a private grades file: `[{"id":"case-01","claimed":1,"correct":1,"identifiable":1,"expected_abstention":false,"abstained":false,"retailer_pass":true}]`. A wrong likely match counts as claimed but not correct; similar alternatives do not count as identification. Run `node scripts/score-identification.js /absolute/path/to/grades.json`. Missing cases must not be silently dropped when reporting a batch; the score script reports only the explicitly graded case count.

Status: test design and runner implemented; real-photo benchmark not yet run. Only the Barbour ground truth is supplied so far. The remaining independent answers and private photos must be assembled before claiming the release gate passed.
