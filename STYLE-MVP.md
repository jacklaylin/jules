# Personal style / starter pack MVP

Implemented for the invited pilot. Production database migration, feature flag, and exact `/style` sign-in redirect were configured on October 7, 2026. Release `a160e6a` deployed successfully to https://jules-gamma.vercel.app/style. The existing signed-in session loads the private upload screen with no browser errors; unauthenticated API requests return 401. Real-input and iPhone acceptance remain pending.

## Behavior

`/style` is a private companion page alongside the wishlist. It reuses invited-email sign-in and conversation identity. A tester uploads up to 12 outfit photos, inspiration screenshots, or receipt images/PDFs; adds occasions and notes; resumes later; generates a draft; corrects or rejects cards; separately selects shopping preferences to remember; switches tone; hides cards; and previews/exports a story image.

Texting “get to know my style,” “analyze my style,” “show my style,” or “starter pack” returns the private web-app entry point when enabled. There is no scheduled outbound campaign.

Reports adapt using a small card library. One personal outfit is required to start; inspiration stays separate. Purchase counts use deduplicated receipt items explicitly marked as purchases for the user, with matched completed-return evidence. Missing prices, sale status, ownership, sizes, and histories stay unknown. No shopping recommendations or live product claims are generated here.

OpenAI extracts observations, receipt records and garment crop bounds. Code computes receipt counts. A separate writing call receives evidence and eligible card types, using `VOICE.md`. It produces Be nice, Balanced, and Roast me together. Switching tone does not call the model or change facts. Fashion labels can describe supported style; motives such as wanting to blend in require explicit user evidence. Further voice refinement remains editorial work.

## Architecture

- Existing Vercel functions, Supabase/Postgres, managed sign-in, OpenAI Responses API, and Sharp. No new production account, API key, service, or package dependency.
- `style_sources`: owner-scoped JPEGs or receipt PDFs plus labels. JPEG/PNG/WebP/HEIC uploads normalize to JPEG and strip EXIF/location metadata. Private receipt viewing downloads the PDF; no public source URLs.
- `style_sessions`: notes, revision, current evidence/report snapshot, and expiring analysis reservation. Category batches have no file-count cap; each file remains under 3 MB after normalization. `db/011_style_bulk_uploads.sql` removes the original database cap and was applied to production on October 7, 2026. Browser resizes photos before upload.
- Report confirmation and selected taste facts save atomically. Inferences remain unconfirmed until selected. Chat facts and operator edits survive. Brand/category budgets and brand/size-system exceptions retain structured keys.
- Changing inputs clears the report and preferences saved by this feature. Deletion removes uploads, report and its style-memory entries, retaining a revision tombstone so in-flight analysis cannot resurrect them. Independent chat/operator facts remain.
- Browser export is 1080 × 1920. Web and image use the same approved copy. Including personal garment crops or shopping-history cards requires separate explicit approval. Evidence and receipts never enter the export.
- Native sharing attempts image + text + signup link where supported, with download/copy fallback. Actual iPhone/iMessage/Instagram behavior still needs device acceptance.
- Signup CTA uses the HTTPS `SITE_ORIGIN` plus `/style`. The pilot remains invitation-only. Public registration, referral attribution, and a waitlist are outside this release.
- No inbox scanning, Instagram login, virtual closet ownership, color-season analysis, cutout generation, or automatic purchases.

## Exact production setup

1. **Create private storage.** Existing Supabase project → SQL Editor: paste `db/010_style.sql` and run once after `003_memory` and `008_wishlist`. This creates two private tables and two server-only functions. No credential is produced or needs copying.
2. **Allow sign-in to return to the page.** Supabase → Authentication → URL Configuration → Redirect URLs: add `https://YOUR-EXISTING-JULES-DOMAIN/style`, using the actual production domain. Keep existing wishlist/admin redirects. No credential is produced.
3. **Enable in the existing Vercel project.** Set `STYLE_ENABLED=true`; keep `WISHLIST_ENABLED=true` for email sign-in and `MEMORY_ENABLED=true` so confirmed facts guide conversation. Use existing `OPENAI_API_KEY`, `OPENAI_MODEL`, Supabase variables, and correct HTTPS `SITE_ORIGIN`. Credential values stay in Vercel, never source/Git. `.env.example` contains placeholders only.
4. **Deploy through the normal Git/Vercel workflow.** Include the `/style` rewrite and new function/page files. The database migration is applied to production; Git pushes to `main` trigger the existing Vercel deployment.
5. **Reuse invited membership mappings.** Each lowercase email in `wishlist_members` maps to a verified tester conversation UUID. Existing mappings work unchanged. Do not guess identities or put emails/phone numbers in Git.
6. **Try the phone flow.** Text “get to know my style,” open the link, sign in, and follow the acceptance checklist. The link is navigation, not an access credential.

PDF requests follow [official OpenAI file-input documentation](https://developers.openai.com/api/docs/guides/file-inputs). Inputs go inline to the existing vision model with `store:false`; no public file URL is created.

## Local verification

- Automated Node tests: private source access, consent, stale revisions, analysis locking/recovery, deletion during generation, selected/corrected memory, conflicting preference edits, tone stability, receipt deduplication/returns, unsupported evidence rejection, normalized photos, PDF inputs, private crop access, long export text, and the text invitation.
- PostgreSQL-compatible PGlite execution: migration, revision conflicts, atomic preference updates, preservation of chat/operator facts, source deletion, tombstone, and denied authenticated-role table/function access. Temporary testing package installed outside the repository, not a production dependency.
- Headless Chrome desktop and 390px phone-width flow using fictional images and mocked generation: upload, context, report, correction retained across tone switching, selected memory, crop-sharing consent, PNG download, hiding, deletion. No page JavaScript errors or horizontal mobile overflow.
- Wishlist typography, white layout, Mongule wordmark, shared neon interactions and collapsing header are reused. Desktop and 390px layouts and the refreshed export preview were visually checked.
- Exported PNG inspected visually. The browser fixture's clothes are synthetic diagrams, not product images or customer data.

Local provider/database credentials are unavailable. Production configuration is installed; real model quality and end-to-end tester/device acceptance remain unverified. Mocked generation verifies integration/validation, not recognition by real users.

## Live acceptance

1. Enter from iMessage, sign in, upload inputs, and resume after returning.
2. Check real outfit/inspiration/receipt extraction against originals. Start with short receipt PDFs, not large archives. Verify unknowns stay unknown and gift purchases are excluded from personal purchase counts.
3. Confirm report length changes with evidence and unsupported commerce/occasion claims are omitted. No fabricated identity or body/appearance commentary.
4. Confirm one preference, edit another, reject a card, leave another preference unselected. Verify the next shopping conversation uses only selected, corrected facts.
5. Switch tone without changing evidence or corrections; hide a card and verify it cannot be exported while hidden.
6. Export without crops, then explicitly include crops. Shopping-history cards require separate approval. Image matches preview and contains no private evidence/receipts.
7. Download/share through iMessage and Instagram Stories on an actual iPhone. Check typography, watermark, and link/text handling; use fallbacks where needed.
8. Tester B cannot fetch Tester A's files/report/crops by changing IDs. Revoked/expired sessions fail.
9. Change inputs or delete while another tab has an analysis/preview. Old results cannot overwrite the new revision; stale downloads/shares require a fresh preview. Independent chat/operator facts survive deletion.
10. Interrupt generation: saved inputs remain, duplicate analysis is blocked, and the reservation expires if a function is terminated.

Category-batch iteration: tested a 14-image inspiration upload in the local browser fixture, successful reset/category grouping, database uploads beyond 12 in PGlite, and pagination so every saved source reaches analysis. Individual files upload sequentially to retain per-file size limits and resume remaining files after partial failure. Export composition now scales to remaining space with varied image sizes and staggered overlap; captions follow actual asset edges. Pally is removed from active fonts.
