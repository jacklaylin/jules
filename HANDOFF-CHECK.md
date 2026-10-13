# Jules handoff comparison — October 12, 2026

Scope: landing, signup/login and Gmail onboarding, compared with the supplied HTML, DESIGN_SYSTEM.md and jules-handoff.zip. The attached brief is a design reference, not authorization to implement every future screen.

## Changes from the zip review

- Removed the obsolete iMessage/Today stamp and retained the frameless conversation.
- Matched the 104px desktop / 44px phone landing headline, six-phrase 14.4-second ticker, glows and entry actions.
- Added mid-column chat positioning, measured scrolling, reversible timeline transitions, touch pacing, idle playback, background pausing and reduced-motion/print final states.
- Matched 60px phone auth headings and full-width primary controls; adjusted login positioning separately from signup.
- Added connect, thinking and reading onboarding route aliases. Persisted import progress determines the screen. Progress announcements update no more frequently than four seconds during polling.

## Explicit behavior differences

- Per the founder, all post-import questions are delivered in Messages, one at a time; there is no web questions screen.
- Illustrative shopping copy avoids unverified inventory, delivery and completed-purchase claims. Jules cannot autonomously purchase.
- Real Gmail consent and processing counts replace fictional inbox/store totals. Consent disclosures remain visible even where they make the form longer than a static reference.
- Reading currently shows actual receipt history and links to the existing style page. A new Gmail-generated Wrapped report and the zip’s broader wishlist/PDP work are not implemented by this entry-flow change.

## Evidence and limits

459 automated tests passed before deployment. Synthetic browser flows cover signup, phone-code login and Gmail connect/thinking/completion at 1440, 390 and 320px. The final mobile login and signup layouts were also visually inspected after the zip adjustments. Real account, message delivery and deployed OAuth checks remain pending real-account acceptance. Lighthouse scores and exact pixel equality have not been established; this is not a claim that every board is identical.

Database migrations 014 and 018 returned success in the existing Supabase project. Vercel publication completed on October 12 at https://jules-gamma.vercel.app (deployment dpl_6hw5oqMyYppKymKkUHGqSSryhXzk). Signup is enabled; entry routes return HTTP 200. No private mailbox was read and no real tester message was sent as a test.
