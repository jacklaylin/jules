# Wishlist save follow-ups — October 8, 2026

A request to save existing products or a supplied product link routes to a scoped save rather than a new search. Recent image and ordinary product-search results now populate the same referenced-choice state as text searches. Supplied URLs are references for the model to interpret, not phrase-triggered commands; a standalone link does not automatically authorize saving.

An explicitly requested link can be retained even when its retailer page is blocked or unsupported. The wishlist labels it “Saved link · price and stock unverified” until a page check succeeds. This does not establish product identity, fit, size availability, price or merchant credibility. Unrequested failed search links continue to be withheld. Save-only consent never enables monitoring.

Confirmed saves persist atomically before the reply is sent. The reply confirms the actual save and, when monitoring is configured, offers a price alert for that same selected set. It does not repeat product links or send a preliminary “I'll add it” message. If sending is uncertain, the authorized save remains, and duplicate webhook deliveries do not resend the confirmation. Image-identification auto-saves retain their existing accepted-send requirement.

## Production setup

Apply `db/013_confirmed_wishlist.sql` in the existing Supabase SQL Editor before deploying the code. It adds one service-role-only atomic function and no new table, account or credential. It checks operation state, stored explicit consent, selected product URLs and source-image ownership, and reuses existing wishlist uniqueness constraints. Existing database and deployment configuration are reused.

Deploy the changed application using the existing Git/Vercel workflow. No environment-variable change is required. This fixes wishlist saving; remaining tester-readiness work, including general-category alert sizing, thread-target resolution and comprehensive failure recovery, remains separate.

## Verification

Tests cover image/ordinary-search references, separate request-plus-link messages, selected subsets and exclusions, uncertain interest, standalone links, unrelated conversation, blocked-page retention, scope validation, pre-send persistence, snapshot/save failure, uncertain sends and duplicate delivery. New owner-only replay cases exercise actual model interpretation of four save requests against blocked-page references without saving or texting.

The SQL function was executed in PostgreSQL-compatible PGlite: pre-confirmation persistence, idempotence, missing-consent rejection, unselected-product rejection, uncertain-operation rejection, foreign-source rollback and browser-role invocation denial passed. Live-model replay, production configuration and end-to-end phone receipt must be reported separately from deterministic tests.
