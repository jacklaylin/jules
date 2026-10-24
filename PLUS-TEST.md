# Jules+ fake-door test

`/plus` pitches Jules+ (unlimited watches, size hunting, return reminders, texting from any phone) at **$7 a month** and counts who taps **Get Jules+**. Nothing is sold: the tap shows "Jules+ isn't open yet", says nothing was charged, and changes nothing on the person's account. The page is unlinked and `noindex`; share the link directly (for example, text it to testers).

## What is counted

Two rows in `adoption_events` (lib/plus-test.js, db/053), each with the price shown in `ref`:

- `plus_viewed`: someone opened the page. At most once a day per signed-in tester or per browser.
- `plus_interest`: they tapped Get Jules+. Once per signed-in tester; once per browser when signed out.

A tester signed in to their wishlist on that phone is counted as themselves (`conversation_id`); anyone else is counted anonymously (`conversation_id` is empty). Bots and link previews are left out. Signed-out counts are a weaker signal: one person on two browsers counts twice.

## Turn it on

1. In Supabase, open **SQL Editor**, paste `db/053_plus_test_events.sql`, and run it once. Until then the page works and taps only show up in Vercel logs as `plus_event_failed`.
2. Merge and let Vercel deploy. No new settings or keys are needed.
3. Open `https://textjules.com/plus` on your phone and tap the button once to check it works.

## Read the results

In Supabase **SQL Editor**:

```sql
select kind, conversation_id is not null as signed_in, count(*) as taps, count(distinct conversation_id) as testers
from adoption_events where kind in ('plus_viewed','plus_interest')
group by 1, 2 order by 1, 2;
```

Tap rate = `plus_interest` ÷ `plus_viewed`. To change the price, edit `PLUS_PRICE` in `lib/plus-test.js` and the price in `public/plus.html` together (a test checks they match); each row keeps the price it was shown at.

## Load speed

Static page, no data to load. First contentful paint in a local headless browser: 108 ms desktop, 68 ms at 390px, 72 ms at 320px. The view count is sent after the page draws and never blocks it.
