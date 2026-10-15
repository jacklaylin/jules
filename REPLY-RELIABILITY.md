# Reply reliability: fallbacks, stalled replies and founder alerts

Goal: a tester should almost never see "i couldn’t prepare a reply just now", and the founder hears about every time they do, or a reply never arrives at all.

## What happens on a failed turn (`lib/inbox.js`, `lib/reply-failures.js`)

- Every turn keeps a trace: the step it reached (`agent`, `tool:<name>`, `retry`, `prepare`, `send`), the model's last HTTP status, and the durable actions that already finished. Steps are written to `messages.reply_diagnostics` as the turn goes, so a turn that dies mid-way still leaves its last step.
- One retry with a compact context (PR #44) runs only when there is time for it.
- The whole turn has a 105-second deadline (the Vercel function stops at 120). Work still running after it is abandoned, and its late search results are not attached to the reply.
- Starting the typing/read-receipt connection is bounded to 5 seconds and sending to 30 seconds. A send that never answers is recorded as `uncertain`, never resent.
- If the model still fails, the reply reports what this turn already did, such as a purchase-history answer recorded or a profile update saved, and asks for the rest again. With nothing finished, the generic text stands.
- Every fallback is saved with `outcome: 'fallback'`, `step`, `error_class`, `model_status`, `elapsed_ms` and `compact_retry`. The founder gets a text after the tester's reply has gone out.

## Root causes fixed

- **Purchase-history answers during an import** ("Me for both", "Both were for me…"): the background Gmail/Shop reader holds the import lease for up to 110 seconds per step. A chat answer that arrived in that window threw `Purchase history busy`, the compact retry hit the same lease, and the tester got the fallback. Now the answer is interpreted and handed to the worker (`gmail_imports.chat_answers`). The worker applies it as its next step and then asks the next question. The reply says the answer will be recorded when the reading finishes. A failed interpretation now returns an honest reply instead of throwing.
- **Search-plan references to options that don't exist** ("Find these for cheaper and set a price alert" sent before the link): `keep_option_indices`/`exclude_option_indices` that name no shown option threw and failed the turn. They are now dropped (logged as `search_plan_references_dropped`) and the search runs.

## Stalled replies (watchdog)

Each minute, a Supabase scheduled job checks for an `ai:` reply that has been `generating` or `sending` for over 125 seconds. It only calls `GET /api/imessage?watchdog=replies` when it finds one (authorized with the Vault secret from `db/023_gmail_sweep.sql`). Each stuck reply is claimed once and marked `outcome: 'stalled'`, keeping its last step.

- A reply still `generating` (nothing was sent) under 20 minutes old, in a conversation with no later reply, gets a short model-written recovery message (`source: 'ai_recovery'`). If the model is down, a fixed apology is sent instead.
- A reply stuck in `sending` may already have arrived, so it is never resent.
- The founder is texted for every stalled reply.

## Setup (once)

1. Supabase → SQL Editor: run `db/028_reply_reliability.sql` (after `023_gmail_sweep.sql`). It adds the two columns and schedules `jules-reply-watchdog`. No credential is produced. Run it before deploying: feedback triage reads the new column.
2. Vercel → Project → Settings → Environment Variables: add `FOUNDER_ALERT_PHONE` with the phone number that should get alerts, in international format (for example +1…), for Production. Redeploy. The alert is sent from the tester's Photon line, so it appears in your iMessage thread with Jules. Leave the variable empty to turn alerts off.

Triage: `scripts/feedback-triage.js` shows `reply_failure` on any turn that fell back or stalled.
