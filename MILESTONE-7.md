# Milestone 7 — Human fallback (deprioritized)

**Status: Historical record. Deprioritized October 7, 2026; will not be implemented.** Kept only as the record of that decision; the current requirements are in PRD Section 13 and `AGENTS.md`.

Founder decision: Jules must be a self-supported application without human intervention in the shopping loop. Do not build the human task table, operator queue, or manual sourcing/resolution workflow below. Difficult requests should receive supported partial findings, an honest explanation of uncertainty or failure, and useful clarification or recovery within the conversation. See PRD Section 13 and AGENTS.md for the current requirements. Milestone 8 remains Watches; this decision does not authorize additional implementation.

## Archived plan — superseded, not implementation instructions

Prepared October 6, 2026. Implementation had not started when the milestone was deprioritized. The original plan is retained below for historical context only.

## Outcome

A difficult product search appears in an owner-only queue in `/admin`. The operator opens its original request, images, and search evidence, researches manually, supplies supported product links and a short response, sends it through Jules, and resolves the task. The task records what required human work.

## Current position

README records live acceptance for milestones 1–5. Milestone 6 recognition/photo-thread acceptance and the companion wishlist live acceptance remain documented as pending. Confirm those results before claiming they are complete; successful automated tests do not establish recognition accuracy.

Search evidence already lives on private messages. Admin displays “Sourcing review needed” for non-found results and supports manual replies. There is no persistent human task queue or resolution state. Reuse those pieces rather than introducing a separate service.

## Recommended scope

- Create a task for a failed or insufficient sourcing attempt, and for an unmatched requested piece in a partial result. Keep successful pieces in the reply and wishlist.
- Ask the user to clarify an ambiguous request first; ambiguity alone should not create an operator task.
- Show unresolved tasks oldest-first in the existing admin page. Open the associated conversation and source evidence directly from a task.
- Let the operator enter a concise response, supported HTTPS product links, and internal research notes. Leave unsupported prices, stock, sizing, shipping, duties, and policies unknown.
- Preview the exact outgoing response before sending. Reuse durable reply reservations to prevent duplicate sends. Resolve only after Photon accepts the reply; an uncertain send stays unresolved for investigation. Acceptance is not a delivery/read receipt.
- Allow explicit closure without sending, with a recorded reason, for duplicates or requests the user withdrew.
- Record task creation, send outcome, resolution, and operator notes. Do not automatically derive taste preferences from operator findings.

A task queue introduces durable workflow state and retry coordination. For ten testers, one database table and the existing admin/send path are sufficient; no worker, new queue provider, or scheduled job is needed.

## Architecture and schema

Use the existing Vercel handlers, Supabase Postgres, owner authorization, and Photon sender. One new private `human_tasks` table:

- `id`, `conversation_id`, `source_message_id`, `search_reply_id`
- stable unique `dedupe_key` per search operation/requested piece
- `reason`, `target`, `status` (`open`, `resolved`, `closed`)
- `operator_notes`, structured `resolution` (reply text and supported links)
- `resolution_operation_id`, `resolved_reply_id`
- `created_at`, `updated_at`, `resolved_at`

Reference existing messages/images rather than copying image bytes or contact details. Enable RLS and restrict access to the server service role. Atomic database operations enforce deduplication and resolution transitions; an accepted send followed by a failed task update must be recoverable using the existing operation record, without resending.

Manual findings should reuse wishlist snapshot/save behavior when they resolve an explicit image-identification request. Include only links actually sent and preserve the source garment/image association; saving must remain repairable without another message. This integration is part of completing the existing user loop, not a new wishlist feature.

## Repository changes

1. `db/009_human_tasks.sql`: table, access restrictions, unique keys, atomic task transitions.
2. `lib/human-tasks.js`: task eligibility, per-piece reasons, validated resolution payloads.
3. `lib/store.js` and `lib/inbox.js`: persist/recover tasks from saved search evidence, including partial results. Persisted evidence must allow repair if task creation fails.
4. `api/admin.js`: owner-only list/detail/resolve/close actions, using the existing sender.
5. `public/admin.html`, `public/admin.js`, `public/admin.css`: queue, context, research notes, response preview, send/close controls.
6. Existing reply/wishlist modules: reuse accepted-send state and source encounters for manual results.
7. Focused tests and README setup/acceptance documentation.

## Setup

No new account, API key, dependency, or paid service is planned. Existing OpenAI, Photon, Supabase, and Vercel settings suffice.

After implementation and local verification, run the new migration in the existing Supabase project → SQL Editor → New query → Run. It creates private task records and produces no credential. Deploy through the existing Git/Vercel workflow. Keep existing credentials in Vercel; never put them in this plan or source code.

## Verification and release

Automated checks: failed/partial-result eligibility; clarification exclusion; duplicate webhook/task suppression; oldest-first queue; owner authorization; conversation/task mismatch rejection; safe supported links; accepted/uncertain sends; send/task-update recovery; manual wishlist saves and retry deduplication.

Live acceptance:

1. Send a difficult explicit sourcing request from a tester phone. Verify one unresolved task and the correct source request/image.
2. Open the queue in admin, research the item, enter supported links and notes, and preview the response.
3. Send once. Confirm receipt on the phone, correct links, and persisted resolution after reload.
4. Repeat/retry the operation; confirm no duplicate task or reply.
5. Test a partial jacket/bag search: retain the successful piece and resolve only the missing piece. Verify manually sent findings appear under the correct source item in the wishlist.
6. Verify unauthenticated/non-owner queue access is rejected. Verify uncertain delivery cannot silently resolve a task or trigger an automatic resend.

Mark Milestone 7 complete only after the difficult-search → queue → manual resolution → phone loop passes. Watches remain Milestone 8 and require a separate assignment.
