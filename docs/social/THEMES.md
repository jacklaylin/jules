# Social series

Recurring series the weekly plan rotates through. Each one works as a swipeable carousel today and has a short-video version for later. The `id` goes in each post's `series` field, so results can be compared series by series. Rules in [README.md](README.md) still apply to all of them: example chats and cards are labeled, there are no prices without a dated source, and there's no "AI".

Inspiration (October 24, 2026): the **Selleb** sisters' "what your ___ says about you" videos (some past 1M views) and their receipts-as-proof idea, which is the same instinct as Jules' style report. **SSENSE**'s deadpan, meme-literate voice, which puts luxury next to the mundane (a spelling bee campaign, billboards made of memes). Jules takes the irony, but stays warm rather than mean.

| id | Series | The carousel | The short video | Example hooks |
|---|---|---|---|---|
| `says-about-you` | What your ___ says about you | One item variant per slide, each with a one-line read. Affectionate, a little too accurate | Hands pointing at each item, read out loud, or green screen over item photos | "What your tote bag says about you" · "What your running shoes say about you" · "What your winter coat says about you" |
| `help-me` | jules, help | An example text chat about a real, specific occasion: the panic, then Jules' decisive answer, then the find | Screen recording of the chat typing out, with a trending sound | "running the marathon sunday but i want to look cool" · "first date at a natural wine bar" · "meeting his parents, they golf" · "make my boyfriend look like he has a stylist" |
| `dress-like` | Dress like ___ | A celebrity or character's look decoded into 4–5 buyable pieces, as an example chat or a list | "Get the look" pieces appearing one by one | "jules, make me dress like Dua Lipa" · "Jacob Elordi's coat era" · "Carolyn Bessette-Kennedy, but for a Tuesday" |
| `starter-pack` | Starter pack | An affectionate meme of a scene. The last slide asks what Jules would put in yours | Items dropping in one by one | "Run club starter pack" · "Copenhagen girl starter pack" · "Brooklyn dad starter pack" · "Finance vest starter pack" |
| `in-out` | In / out | Paired lines, one per slide. Opinionated, never mean about bodies or people | Two-column flips on beat | "In / out: winter edition" · "2027 in / out" (Dec 26–31) |
| `closet-wrapped` | Closet Wrapped | Example style-report cards: receipt, starter pack, gatekeeper, then vs now, dating profile | The report's own story player, recorded | "Spotify Wrapped, but for your closet" · "POV: Jules read your order history" |
| `dupe-or-real` | Dupe or the real thing? | The landing page's Rodeo-bag shape: the original, the resale price, the dupe, and Jules' call | Chat recording, ending on the call | "can you find me a dupe of this bag?" (prices checked the day it's made, with sources) |
| `dress-code` | Dress code decoder | What an invitation actually means, with 3 looks from easy to brave | Talking-head explainer or text on b-roll | "What 'cocktail attire' actually means" · "'Festive' on a holiday invite" · "Creative black tie, decoded" |
| `this-week` | This week | Whatever the culture is doing this week, translated into an outfit or a find | Trend sound plus the chat | Halloween from your own closet · marathon weekend · Thanksgiving with the in-laws · the show everyone's watching |
| `gift-panic` | Gift panic | An example chat for a hard-to-shop-for person, ending with 3 kinds of gift (no prices unless sourced) | Chat recording | "my dad likes golf and hates everything" · "secret santa, I know nothing about her" |
| `deadpan` | Deadpan | SSENSE-style one-liners in big type: luxury next to the mundane, the joys of shopping | Single still with a sound | "me pretending the price drop alert was a sign" · "my closet: black, black, navy, a cry for help" |
| `hunt` | The hunt | Useful how-tos for restocks, sold-out sizes, resale and scam stores | Fast tips over screen captures | "Sold out in your size? Stop refreshing." · "5 signs that deal site is a scam" |
| `real` | Real receipts | Real finds and real cards, only with the person's consent and dated sources | Their own screen recording | Starts once testers or creators share |

## Rotation

- 7 posts a week, at most one per series, plus two "wild cards" that repeat whichever series did best the week before.
- Never the same series two days in a row. Keep the calendar in mind:

| When | Lean on |
|---|---|
| Oct 26 – Nov 1 | Halloween (Oct 31) and NYC Marathon weekend (Nov 1): `this-week`, `help-me` |
| Nov 2 – 22 | `says-about-you`, `dress-like`, `starter-pack`, `dress-code` (holiday parties) |
| Nov 23 – Dec 1 | Thanksgiving (Nov 26), Black Friday (Nov 27), Cyber Monday (Nov 30): `hunt` (price drops in your size), `gift-panic` |
| Dec 1 – 14 | Wrapped season: `closet-wrapped` leads, every other day |
| Dec 15 – 24 | `gift-panic`, `dress-code` (parties, New Year's Eve) |
| Dec 26 – 31 | "2027 in / out", "your 2026 in receipts" |

## Celebrities and real people

The style report already matches people to style icons, so celebrity looks are on-brand. Describe the look, never use their photo, never suggest they use or endorse Jules, and keep it affectionate. Don't make fun of private people, bodies, or anyone's money.

## Example chats

They have to look like a real iMessage thread and only show what Jules does today: identify a piece from a photo, find it in your size, compare stores and resale, plan an outfit, give an opinion, watch prices and restocks, and remember sizes and stores. A photo the person sends is drawn as a labeled tile (`{"from":"me","tile":"a TikTok screenshot"}`), never someone's real photo. Jules writes in lowercase ([VOICE.md](../../VOICE.md)).
