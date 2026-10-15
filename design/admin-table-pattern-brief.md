# Admin table pattern: design brief

For Claude Design. One compact, repeatable layout for every table-based admin page, starting with the person page's Purchase history tab. Written October 15, 2026.

## Context

Jules is a personal shopper you text over iMessage. The admin area is used only by the founder (one person, mostly on a laptop, sometimes on a phone) to review testers' data and correct what Jules read. It already uses the shared Jules design system (`DESIGN-SYSTEM.md`, `public/design-system.css`) and the standard Jules header (Wishlist · Your style · Admin · Log out) with an admin tool menu. Keep those. Don't introduce new global type, colours, logo or header. Admin badges stay tinted green/amber/red, and colour is never the only status signal.

## The problem

The admin pages are slow to use because the controls take more space than the data. On Purchase history (desktop), before the first purchase row you see:

1. A full-width search field on its own row.
2. Five status chips with counts ("All 171 · To review 124 · Reviewed 35 · Removed 11 · Duplicates 1") next to two large dropdowns ("All stores", "Any source").
3. "Reload" wrapped onto its own row.
4. A status line ("Import running · Imported history is partial · 0 found by more than one source") with the "Start reviewing →" button on the far right.
5. "Style tags: 103 tagged, 56 still to tag" with a "Tag the rest" button.
6. Then, beneath the list: folds for Style report, Skipped emails, Connected sources, Unlinked events, Re-check labelled emails and Report a missed purchase.

Every control is the same visual weight. Occasional operations (reload, tag, re-check, report a missed purchase) look as important as the filters you use constantly, and the rows start halfway down the screen.

## What to design: one "data view" pattern

A reusable layout that any admin table can adopt, with these parts:

- **Compact toolbar (one row on desktop).** Search (sized to content, not full width), the status filter with counts (chips or a segmented control, the one place counts appear), secondary filters (store, source) as small dropdowns or one "Filters" menu that shows active filters as removable tokens, and the primary action for that view ("Start reviewing →"). Rarely used actions (Reload, Tag the rest, Re-check, Report a missed purchase) go into one overflow menu ("⋯" or "More").
- **One quiet status line** under the toolbar for background state: import running, history partial, tagging progress, last refreshed. Plain text, small, with a spinner only while something runs.
- **Dense rows.** Desktop rows about 40px. Line 1 = the thing (e.g. `brand · product`), line 2 or trailing columns = facts. Status on the right as quiet text or one badge. Hover shows row actions. Whole row opens the detail.
- **Detail without losing your place.** Opening a row shows the detail in a side panel (desktop) or full screen (phone), with the list and filter still there and "N of M" plus previous/next. The existing item review (evidence on the left, correction form on the right, shortcuts J/K, 1–7, ⌘↵) must keep working inside it.
- **Secondary sections out of the main flow.** The six folds under Purchase history become either sub-views (e.g. a second segmented control: Purchases · Unlinked events · Skipped emails · Sources) or items in the overflow menu that open a panel. Recommend one approach that works across pages.
- **Keyboard.** `/` focuses search, J/K move the row selection, Enter opens, Esc closes the detail. Visible focus ring (3px grape) on every control.
- **States.** Loading, empty ("No purchases match these filters" with "Clear filters"), error, busy ("An import is running. Try again when it finishes."), and a long-running background job.

## Pages to show the pattern on

1. **Person › Purchase history** (main case, ~170 items, desktop and phone), including the item review open in the detail panel.
2. **People** list (/admin): search, filters for needs-attention testers, columns Identifier · Last activity, row opens the person page. Show the page's "Chat quality" stats as a compact strip, not a block.
3. **Person › Personal memory**: an editable table (Type · Key · Value · Evidence · Actions) with "Reload profile", "Learn from existing messages" and "Add a preference" fitted into the same toolbar/overflow pattern.
4. One more to prove it generalises: **Costs** (daily spend by service across 7 services) or **Replays & evals**.

The person page header (name, badges, stats Last active · Messages · Memory facts, tabs Personal memory · Conversation · Purchase history · Wishlist) should also get tighter so the table starts higher. For example, put the stats inline with the name.

## Constraints

- Real data only: don't invent columns or counts that the app doesn't have. Purchase row facts, in order: store · size (system) · colour · ×qty · date · recipient · outcome.
- Original email evidence is read-only and always visible beside the correction form.
- No reply, send-message, delete-person or export controls.
- Phone (390px): no horizontal page scroll; the toolbar collapses to search + "Filters" + overflow; tap targets at least 44px. Desktop table buttons 32px.

## Deliverables

- Desktop (1440px) and phone (390px) frames for the four pages above, including the detail panel open on Purchase history.
- A small component sheet for the pattern: toolbar, status filter with counts, filter tokens, overflow menu, status line, dense row (default/hover/selected/removed), detail panel, empty/loading/busy states.
- Implementation notes in the same style as the previous admin handoff (`SCREENS.md`-style per-screen notes and `admin.css` additions to merge into `design-system.css`).
