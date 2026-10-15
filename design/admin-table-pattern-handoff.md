# Admin table pattern: handoff notes

Design canvas: https://claude.ai/artifact/EAUkx1bqcca1thFLXyiRdk (private to the founder). Brief: `design/admin-table-pattern-brief.md`. Written October 15, 2026.

Bracketed values in the frames (`[$0.00]`, `[source]`, `[4s]`, quoted receipt lines) are placeholders; wire them to the real fields. Purchase rows and phone numbers are sample data.

## The pattern ("data view")

Top to bottom, every table page uses only the rows it needs:

1. **Standard Jules header**, compact (64px).
2. **Admin tool strip**: one 40px row of text links (People · Test chat · Replays & evals · Search check · Photo identification · Costs), current one underlined. This replaces the tall left menu, so tables get the full width. It already becomes a strip on phones.
3. **Page or person header on one line**: `← People`, the identifier (serif, 34px), any problem badge, then the stats as one mono line on the right (`Last active 2h ago · 412 messages · 38 facts`) and `⋯` for person actions (Reset onboarding lives there).
4. **Tabs** (person pages only): Personal memory · Conversation · Purchase history · Wishlist, with counts.
5. **Toolbar, one row**: views (quiet pills, if the tab has sub-pages) | status filter as a segmented control with counts (the only place counts appear) | search (240–280px, `/` focuses) | `Filters` (every other filter; badge shows how many are set) | spacer | `More ⋯` (occasional actions) | at most one butter primary action.
6. **Filter tokens + status line, one row**: removable tokens for active filters, then one 12px line of background state (import running with the Aqua loader, partial history, tagging progress, last refreshed, errors in `danger` with words). Keyboard hints on the right.
7. **Dense table**: 40px rows, 32px mono header row, hairlines. Item first (`brand` bold · product), facts in their own columns, quiet status text on the right. Selected (keyboard cursor) row = `fog` fill. Removed = struck through.

## Purchase history specifics

- Views: **Purchases · Unlinked events (n) · Skipped emails · Sources**. These replace the Unlinked events, Skipped emails and Connected sources folds.
- More menu: Reload purchases; Tag the rest (n untagged); Re-check labelled emails; Build style report; Report a missed purchase…. Runs show progress in the status line and their results in the detail panel. These replace the Re-check, Style report and Report-a-missed-purchase folds and the "Tag the rest" line.
- Store and Found-by dropdowns move into the Filters menu.
- **Item open (desktop)**: list becomes a 340–400px left column (item + one facts line, status filter kept), detail panel on the right with `Reviewing: To review · 4 of 124`, ‹ K, J ›, Close × Esc. Evidence (read-only) left, grape-tinted correction form right. **Save and open next** is now the butter (primary) button; Save correction is secondary.
- **Phone**: list rows are two lines with a chevron; "Start reviewing · 124 →" is a sticky bottom bar. Review is its own screen: top bar with back, `4 of 124`, ‹ ›; form first, evidence in an open fold below; sticky Save / Save and open next bar.

## Other pages

- **People**: chat quality becomes one bordered strip of 6 metrics (value + Better/Unchanged/Worse badge). Toolbar = search, count + refreshed time, More (Refresh). Table: Identifier · Last activity · Open →.
- **Personal memory**: status filter by type (All · Sizes · Brands · Style · Stores · Other, counted client-side). `+ Add preference` is the primary action (opens the add form in the detail panel). Reload profile and Learn from existing messages go in More. Values are inline-editable cells; an edited row gets a grape tint + 2px grape outline, its actions become Save / Undo, and a `1 unsaved edit` badge appears in the toolbar.
- **Costs**: total next to the title. Views: By service · By feature · Evals. Day picker in the toolbar, Refresh in More, `Update an amount` primary (form in the detail panel). Coverage and budget text go in the status line. Badges: Recorded (green) / Incomplete (amber).

## Keyboard

`/` search · `J`/`K` move the cursor · `Enter` open · `Esc` close detail · on item review `1`–`7` pick a label and `⌘↵` save and open next. No shortcuts while typing in a field.

## CSS to add to `public/design-system.css`

Compact admin controls (34px desktop, 44px on phone/touch): `.seg` (segmented filter), `.search` with `.kbd` hint, `.token` (removable filter), `.pop` (menu/popover using `shadow-panel`), `.data-table` 40px rows, `.status-line`, `.views` pills, `.detail-split` (list column + panel). Badge tints stay green/amber/red.
