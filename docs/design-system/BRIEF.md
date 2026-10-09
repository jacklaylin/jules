# Jules — Design System & Implementation Spec

Jules is an agentic personal shopper. You text it a photo or a want; it searches stores, checks your size and sends the thing home. This document is the brief for building the **landing page, web/mobile app UI, share cards (“Wrapped”) and icon set**.

**Companion file:** `tokens.css` is the source of truth for all CSS (tokens, components, keyframes). Copy it into the project and build on it. This document explains rules, layouts, content and timelines. If the two ever disagree, `tokens.css` wins for values, this file wins for behaviour.

Design reference lives in the Claude artifact “Jules — Agentic Personal Shopper Identity” (boards: Identity, Jules thinking, UI elements, Landing, App screens, Menu, App icon + favicon, Wrapped, Orb options, Type options). Boards are fixed-size mocks; this spec defines how they should behave as real, responsive UI.

---

## 1. Principles (read first)

1. **White ground, always.** Background is `#FFFFFF`. No cream, sand or tinted surfaces. The clothes are the colour; the UI must never compete with product imagery.
2. **Colour belongs to Jules, not to products.** Butter / tangerine / bubblegum / grape appear only in Jules’s own elements (orb, primary action, tags, share cards). Never place saturated colour behind or next to product photos.
3. **One dot.** The orb is Jules. It is the dot on the j in the logo, the chat avatar, the input button, the active menu bullet, the slider handle and the thinking indicator. Don’t invent other spinners.
4. **Playful, futuristic, minimalist, with motion.** Flat layouts and big type; the motion and the orb do the personality. Retro-Apple nods (gel buttons, Aqua loader, iMessage) are *style*, not skeuomorphic replication. No fake OS window chrome.
5. **The chat simulation must look exactly like iMessage.** Everything else stays in the Jules identity.
6. **Copy voice** (see §9): specific, deadpan, observational. Avoid the “short sentence + italic accent word” pattern. Never use italic serif as an accent device.

---

## 2. Tokens

Defined in `tokens.css` `:root`.

| Token | Value | Use |
|---|---|---|
| `--ink` | `#17120F` | text, outlines, dark surfaces |
| `--white` | `#FFFFFF` | page/background |
| `--fog` | `#F3F1EE` | image placeholders, quiet surfaces |
| `--line` | `#E8E4E0` | hairlines, card borders |
| `--text-2` | `#6B625B` | secondary text |
| `--butter` | `#FFC93C` | primary action, tags, marquee text |
| `--tangerine` | `#FF7A2F` | orb mesh base, small pops |
| `--bubblegum` | `#FF8FC7` | orb mesh, small pops, one share card |
| `--grape` | `#6C3BFF` | secondary action (Share), one share card |
| `--aqua` | `#0A6BF0` | **iMessage bubbles and the loader only** |
| `--imsg-gray` | `#E9E9EB` | received iMessage bubbles |

Contrast: white on `--aqua` 4.8:1, white on `--grape` ~5.7:1, `--text-2` on white ~5.9:1, ink on butter high. Keep these pairings.

**Typography** (all Google Fonts, loaded in `tokens.css`):

| Role | Face | Notes |
|---|---|---|
| Display / headlines | Instrument Serif, roman | letter-spacing `-.04em`. **Roman only; no italics.** |
| UI / body / bold statements | Bricolage Grotesque 400/600/800 | 800 with `-.04em` for poster-style statements |
| Labels / data | JetBrains Mono 500, 11px, uppercase, `.08em` | class `.label` |
| iMessage content only | `-apple-system, SF Pro Text, Helvetica Neue…` | `--font-ios` |

Type scale in use: landing headline 124px/.9; thinking wordmark 250px; logo in nav 40px; Wrapped headlines 38–78px; body 15–20px; labels 11px.

Shape: cards 24px radius, pills 999px, phone screen 47px, Wrapped cards 44px. Hairline borders 1px `--line`; outlines on gel buttons 1.5px `--ink`.

---

## 3. Core components

All CSS in `tokens.css`.

### 3.1 Orb (`.orb`)
Soft mesh: three blended radial blobs (butter, bubblegum, grape) over a tangerine base. Two layers: a blurred **glow** (`::before`) and a **core** (`::after`) that **share one spin (7s linear)** so glow hues always sit behind the same core hues (no seam). The core also wobbles (`border-radius` morph, 4s). Size via `--s` (e.g. `style="--s:56px"`).
- `.orb--still` freezes it (app icon, favicon, Wrapped cards, reduced motion).
- Sizes in use: 22 (list bullet), 28 (slider handle), 36–44 (input button / avatar), 56–150 (showcase).
- **Clipped avatar variant** (chat header): wrap in a 44px circle with `overflow:hidden`, render the orb at 56px offset `-6px/-6px`, so no glow spills out.

### 3.2 Logo (`.logo`)
Serif wordmark “jules” in Instrument Serif. The **j’s tittle is the orb**. Build with a **dotless j** (`ȷ`, U+0237) plus an orb absolutely positioned above the stem; the anchor trick (zero-size inline-block on the baseline) keeps it font-size independent. Dot size `.21em`, rest position `left:-.02em; bottom:.55em`. Markup is in the `tokens.css` comment.
- **Production note:** Instrument Serif may not contain `ȷ`; if the glyph falls back, the dot will misalign. For production, convert the logo to an SVG (custom-drawn j, ideally) and keep the dot as a separate animated element. The dot’s hop keyframes are in em units, so they transfer to an SVG viewBox.
- Never put a second dot or period after the wordmark in the logo lockup. (In headlines, normal sentence punctuation after it is fine.)

### 3.3 Buttons and chips — one style: the gel pill
`.btn` and `.chip`: white fill, 1.5px ink outline, soft shadow, inset highlight, top gloss highlight (`::after`), min-height 44px, hover lifts 2px and scales to 1.03.
- Variants: default white, `.btn--ink` (also selected chip `.chip--on`), `.btn--butter` (primary action, e.g. “Keep it”, “Get early access”), `.btn--grape` (Share).
- Do **not** create a second button style (no outlined ghost buttons, no flat buttons).
- Chips are filters/toggles; selected = ink fill, white text.

### 3.4 Tag, card, placeholder, field, menu item
- `.tag`: mono caps on butter pill (“Jules pick”).
- `.card`: white, 1px `--line` border, 24px radius, 10px padding. Product card = image placeholder (16px radius) + name/price row + mono secondary line (e.g. “Matches 4 of your saves”). Product images go in `.placeholder` slots; use real photography with the same radius.
- `.field`: pill input with the orb as the send button on the right.
- `.menu-item`: serif 40px (72px on desktop overlay) with a `●` bullet; the **active/hovered item swaps its `●` for an `.orb`**. No italics.

### 3.5 Loader — Aqua barber pole (`.aqua`)
Glossy capsule with diagonal blue/light-blue stripes sliding right (0.7s linear) and a subtle brightness pulse. Indeterminate. It is the only loader besides the dot hop. Width is set by its container (320px in the thinking view).

### 3.6 Marquee (`.marquee`)
36px ink strip at the page bottom, butter mono text, loops `translateX(-50%)` over 24s. Content repeated twice, separated by ` ✦ `: “Found it · Kept it loose · Sized for you · Back in stock”.

### 3.7 iMessage kit (`.bubble`, `.typing`, `.receipt`)
Sent = `--aqua` right-aligned; received = `#E9E9EB` left-aligned; 18px radius, 17px/22px iOS font, real bubble tails on the last bubble of a group, photo bubbles are 18px-radius rounded rectangles with no tail, typing indicator is three gray dots, “Delivered” right-aligned under the last sent bubble. Tail “mask” colour is the screen background (`#fff`).

---

## 4. Motion language

| Moment | Motion | Spec |
|---|---|---|
| Orb idle | continuous | 7s spin + 4s wobble (§3.1) |
| **Thinking** | dot hops across the wordmark | 8s loop (§5) |
| Headline entrance | lines rise in, staggered | `rise` 1.2s `--ease-out-expo` both; delays .1s / .3s / .5s |
| Backdrop glow | slow drifting blobs | `drift` 9–13s ease-in-out infinite; blur 80px; opacity .3–.5; keep them away from product imagery |
| Buttons | hover lift | 0.2s |
| Chat | bubbles pop in from sender’s corner | scale .92→1 + translateY 14→0, .45s; typing dots precede received messages |
| Marquee | continuous | 24s linear |
| Reduced motion | everything static | final chat state shown, dot at rest, no marquee |

---

## 5. The thinking animation (signature moment)

The logo’s dot leaves the j, hops across the letters while Jules works, then springs back to the j when it has an answer.

- Wordmark rendered large (250px on the dedicated board). Apply `.logo--thinking`.
- **8s loop.** Dot x-travel (em): rests at j, hops to u (.37), l (.75), e (1.09), s (1.49) with small arcs (-.3em), pauses at s, takes a big return arc (-.7em) back to the j at ~62%, then a pop (scale 1.6) on landing. While hopping the dot is scaled 1.35. Exact keyframes: `hop-x`, `hop-y`, `dot-pop` in `tokens.css`.
- Beneath it, **status lines cycle** (serif roman, 40px, centred, one visible at a time, fade+rise): “Reading your saves…”, “Checking 212 stores…”, “Matching your size…”, “Picking the good ones…”. 8s total, delays 0/2/4/6s (`status-cycle`). Replace with real agent step text when available.
- Under the lines: the Aqua loader, 320px.
- Three states as a row of small wordmarks: **Idle** (dot at rest, breathing), **Searching** (hop loop), **Found N** (dot at rest, optional pop).
- This dot-hop is also used in product wherever the agent is working (e.g. wordmark in the app header, or tab favicon frames, §8).

---

## 6. Layouts

Mocks are fixed frames. Implement them responsively using the breakpoint guidance (marked *recommended*; only the desktop frames and the 390px phone frames were designed).

### 6.1 Landing page — one screen, no scroll (1440×900 mock)
**Concept:** the page never scrolls like a normal page. It is a single pinned viewport; **scrolling plays the chat simulation** in the phone.

Structure (desktop ≥1100px):
- Canvas: white. Backdrop: 2 drifting blurred blobs (bubblegum top-left, butter lower-middle), left half only, opacity .3–.5.
- **Nav** (top 30px, left/right 64px, flex, right-aligned): `● How it works`, `● Drops` (mono labels), `Get Jules` (ink gel button). **No logo in the nav.**
- **Left column** (left 64, top 190, width 840): headline in Instrument Serif 124px / .9, no wrap, two lines: “Have to have it?” / “Text **jules**.” where “jules” is the real logo (§3.2) set inline at headline size. Then body 20px/1.5, max 460px: “Snap a pic of anything you saw out in the world. Jules finds it, checks your size and sends it home.” Then two buttons: **Get early access** (butter) and **Watch it work** (default). Then the chapter list (below).
- **Chapter list** (serif 36px, each with a 22px orb bullet): **Snap it / Text it / Wear it**. The current chapter is full opacity, others .3, driven by chat time (Snap 0–4.8s, Text 4.8–20.7s, Wear 20.7s+). Below it a 3px progress rail (240px) showing playback progress, and the mono cue “Scroll to play the chat ↓” (arrow bounces).
- **Phone** (right 130, top 96, 372×758, 11px ink bezel, 58px outer radius, 47px screen radius, drop shadow `0 40px 80px #17120F30`). Must not overlap the nav. Contains the iMessage simulation (§7).
- **Marquee** pinned to the bottom (36px). Phone bottom must clear it.
- *Recommended* <1100px: stack. Headline (clamp ~56–96px) → phone (max 340px wide, centred) → chapters collapse to a row of three dots with the active label. Keep one screen tall (`100dvh`); hide “How it works / Drops” behind the menu (§6.3).

### 6.2 App — feed screen & recap (390×844 phones)
**Feed:** top row = logo (34px) left, mono “Tue · Lisbon” right. Headline (serif 44px): “Three picks for Saturday, all in your size.” Filter chips (“All 3” selected, “Linen”, “€300”). One product card (image 230px, tag “Jules pick”, name “Wide-leg linen trouser”, “€240”, “In your size · ships Thu”). Action row: **Keep it** (butter, flex 1) + **Skip** (white). Bottom: `.field` input “Tell Jules what you’re after” with orb send button. 24px/20px padding, 16px gaps, white, 1.5px ink border, 44px radius.
**Recap card:** see Wrapped §6.5.

### 6.3 Menu overlay
Full-screen overlay on white. Header row: logo (40px) + “Close ✕” (mono). Large serif menu items (72px desktop, 40px mobile), each with a `●` bullet; **hover/active item swaps the bullet for an orb**. Footer: mono “212 stores online” and a `Get Jules` button (desktop). Two menus exist in the mocks:
- **Site nav:** Home, Picks, Drops, Closet, How it works, Bag (3).
- **Account menu:** My style, Closet, Wishlist, Log out.
Bag count updates should flash the item briefly (butter background, 1.6s).

### 6.4 UI kit board (reference)
Three columns: **Actions & input** (buttons, filter chips, input, app menu); **Agent** (orb sizes 28/56/96, “Jules pick · 94% match” tag, Aqua loader, iMessage bubbles with typing indicator and “Delivered”); **Product card**.

### 6.5 Wrapped — shareable story cards (390×844, 8 cards)
Story-style: 8 thin progress segments at the top (current one full ink/white, others 25%), content, then a footer row with the small logo (frozen orb, 30px) left and a **Share** gel button right. Card radius 44px, 1.5px ink border. Data below is sample/placeholder; wire to real user data. Brackets mark placeholders.

| # | Background | Content | Type |
|---|---|---|---|
| 1 Starter pack | white | “THE QUIET LUXE STARTER PACK”; 3×3 meme grid: 8 item placeholders with mono captions (Linen trousers, The one good tote, White trainers, Inherited watch, Tan trench, Oat flat white, Silk scarf (worn once), Unread art book) around a centre “[YOU]” cell tagged “It’s you” | Bricolage 800 uppercase 46px |
| 2 Most worn | white | giant “41×” (serif 150px), “The tan trench clocked in 41 times. Nobody asked it to.”, MVP image, two ranked rows with wear bars and cost-per-wear (€2.40, €4.10) | serif + sans |
| 3 Style icon | **grape**, white text | large photo placeholder `[STYLE ICON PHOTO]`, “Stylists confirm you dress like [STYLE ICON]”, tag “89% taste match · based on 212 saves”, trait chips (Tailored ease, Neutral base, One loud shoe) | Bricolage 800 40px |
| 4 Palette | white | “CLOSET AUDIT FINDS 38% OAT. NO EXPLANATION GIVEN.”; stacked vertical colour bar from the user’s closet (e.g. Oat 38, Ink 26, Rust 16, Olive 12, Cream 8) with mono labels | JetBrains Mono 24px caps |
| 5 Taste map | fog | “Sources describe your taste as calm but armed.”; four sliders with the orb as handle (Sharp↔Soft, Loud↔Quiet, New↔Vintage, Trend↔Timeless); footnote “Jules read your last 212 saves, 41 wears and 9 returns.” | Bricolage 600 38px |
| 6 Shops + buys | white | “[STORE A] remains your main supplier. [STORE B] is a recurring problem.”; stacked share-of-spend bar, legend, bubbles sized by category share (Tops 38%, Shoes 22%, Coats 17%) | serif roman 40px |
| 7 Headline | **butter** | newspaper front page: masthead “The Daily Jules · Vol. 2026”, headline “Local Shopper Buys Sixth White Shirt, Calls It “Different.””, dek “Experts confirm the cuff is, technically, different.”, photo, “Written by Jules from your last 12 months” — **headline is generated from the user’s data** | serif roman 78px |
| 8 More ideas | white | “Five more headlines we could run” + list: Cost-per-wear champion, The one you almost skipped, Your closet gap, Your taste twin, Best find of the year | Bricolage 800 40px |

(Card 8 is a backlog of further moments to build, not a user-facing card.)

### 6.6 App icon & favicon
- **Tile:** ink `#17120F` with a white serif **ȷ** + frozen orb as its dot; also a white tile with a 1.5px `--line` outline for light surfaces. Corner radius 22.5% (25% at ≤16px). Glyph size ≈ 0.9 × tile edge.
- **Dot size** grows at small sizes: `.26em` ≥40px tiles, `.30em` below. Dot x offset formula: `left = .105em − dotSize/2`.
- **App icon is always static** (`.orb--still`). **Favicon is static by default.**
- **Favicon activity states** (swap `<link rel="icon">` from page JS every 300–400ms while Jules is working; return to static when done): *Static*; *Thinking 1* (dot `translate(.22em,-.2em) scale(1.3)`); *Thinking 2* (`translate(.5em,-.05em) scale(1.3)`); *Done* (`scale(1.5)` pop, then static). Export each as SVG (outlined j) or 32px PNG; web fonts can’t render inside favicons. Safari is unreliable at picking up favicon swaps; static fallback is fine. Keep to ≤3 frames and ≥250ms.
- Tab title example: “Jules — text it, wear it”.

---

## 7. The landing chat simulation (spec)

Design the simulation as a **timeline of 28 seconds**, driven by scroll. Phone interior (372×758 outer, screen 350×736): status bar (9:41, signal, battery), Dynamic Island, header (back chevron + unread badge “2”, avatar circle with the orb clipped to a 44px circle, “Jules ›”, FaceTime icon), message list, input bar (+ button, “iMessage” field with mic), home indicator. Header background `#F9F9F9` with a 1px `#0000001a` bottom border; chat area white. All blues are `--aqua`.

Static header inside the list: “iMessage / Today 9:41 AM” (11px, `#6E6E73`, centred).

| t (s) | Event |
|---|---|
| 0.8 | **You:** “hey! i saw these cool sneakers today and snapped a pic, can you find them” |
| 2.4 | **You:** photo bubble (200×170, 18px radius) `[YOUR PHOTO]` |
| 3.6–5.2 | Jules typing → 5.2 **Jules:** “ooh nice. chunky, cream leather, gum sole. give me a sec” |
| 5.9–7.0 | typing → 7.0 **Jules:** “checking 212 stores…” |
| 8.0–9.2 | typing → 9.2 **Jules:** 3 sneaker photos in a tight row (76×100 each, 2px gap, 18px outer radius) |
| 9.7–10.8 | typing → 10.8 **Jules:** “found 3 close ones. the middle is 94% and ships thursday” |
| 13.0 | **You:** “the middle one! do they come in a 9?” |
| 13.9–15.5 | typing → 15.5 **Jules:** “yep, a 9 is in stock. want me to grab them?” |
| 19.0 | **You:** “yes pls” |
| 19.8–21.5 | typing → 21.5 **Jules:** “done. bag is packed, arriving thursday” |
| 22.4 | “Delivered” appears under the last sent bubble |
| 27.2–28 | fade out, loop (autoplay mode only) |

**Scrolling the chat:** keep the newest message in view. The mock scrolled the list up in steps (−150, −220, −290, −340, −410, −440px at t = 10.8, 13.0, 15.5, 19.0, 21.5, 22.4, each eased over ~0.7s) for the 758px phone. In production, **compute this**: scroll the list so the latest bubble’s bottom sits 14px above the input bar.

Bubble motion: opacity 0→1, `translateY(14px) scale(.92)` → none, 0.45s, transform-origin at the bubble’s bottom outer corner. Typing bubble fades in .35s before and out just before the message lands.

### Scroll-driven implementation (required behaviour)
- Page = one pinned `100dvh` stage inside a tall scroll container (≈ 400vh). Overall page height is the scroll length; **visible UI never scrolls**.
- Map scroll progress `p ∈ [0,1]` → chat time `t = p × 22.4s` (+ a small hold so “Delivered” is reachable). Render the chat as a **pure function of `t`** (which messages are visible, which typing bubble is showing, list offset, chapter, progress rail). This makes scrub-forward/back smooth and avoids brittle CSS delay chains. CSS `animation-timeline: scroll()` is acceptable where supported but needs the same fallback.
- **Watch it work** button = autoplay `t` from 0→22.4s at 1× with the same renderer, then holds (loop optional).
- Chapters and the progress rail read from the same `t`.
- `prefers-reduced-motion` and no-JS: show the final state (all messages, “Delivered”), no autoplay.
- Touch devices: same scroll mapping; ensure momentum scroll doesn’t skip typing states entirely (clamp minimum dwell per step if scrubbing is fast).

---

## 8. Page-wide behaviour & states (summary)

- **Agent working** anywhere in the product → dot-hop on the wordmark (or an `.orb` + status text + Aqua loader in tight spaces) and favicon activity frames.
- **Found** → dot lands with the pop; show the result as product cards with a `Jules pick` tag on the best match.
- **Keep it / Skip** are the only card actions; Keep = butter, Skip = white.
- **Hover:** buttons lift; menu items swap bullet for orb.
- **Focus:** visible grape 3px outline on interactive elements.
- **Empty states / errors** are not designed; use the same voice (§9), the orb at rest, and white-ground layouts.

---

## 9. Copy voice

Specific, deadpan, observational, in the register of a newspaper correction or a witty friend who has seen your closet.
- Prefer a **concrete observation** (“The tan trench clocked in 41 times. Nobody asked it to.”) over a slogan.
- **Banned pattern:** a short sentence followed by a second short fragment with one word styled in italic serif (“Mostly oat. *A little rust.*”). Don’t use italic serif as an accent device anywhere.
- Lowercase for chat messages from both parties (iMessage-casual). Sentence case elsewhere. Mono caps for labels only.
- Vary form across surfaces: bold statement (Bricolage 800), receipt (mono), newspaper (serif), stat poster. Do not use one formula for every card.
- Numbers are sample data in the mocks; never ship invented stats.
- Named celebrities: do not hard-code real people as “style icons” without licensing and legal review; use the placeholder pattern.

---

## 10. Accessibility

- Min touch target 44px (buttons, chips). Non-interactive Wrapped chips may be 36px.
- Keep all text pairings in §2. Never put text over product photos without a scrim.
- Logo: `aria-label="jules"` on the wrapper; hide the dot/anchor from assistive tech.
- The chat simulation: provide a readable text transcript (visually hidden or in a `<details>`) and honour `prefers-reduced-motion`.
- All animation must be pausable via reduced-motion and must not flash (nothing exceeds 3 flashes/second; the barber pole is a slow slide).
- Marquee text is decorative; mark `aria-hidden="true"`.

---

## 11. Suggested build

- Stack-agnostic. A React/Next.js (or Astro + a few islands) app with `tokens.css` imported globally works well. CSS variables for tokens; no CSS-in-JS needed.
- Components to build first: `Orb`, `Logo` (static + thinking), `Button/Chip`, `Tag`, `ProductCard`, `Field`, `MenuItem`, `AquaLoader`, `Marquee`, `IMessagePhone` (props: `messages`, `t`), `WrappedCard` (+ 7 variants), `FaviconController`.
- `IMessagePhone` takes a timeline array (as in §7) and a time value; the landing page owns the scroll mapping.
- Image slots use the neutral `.placeholder` until real photography is wired in.
- Keep the page one screen: set `html, body { height: 100% }`, pin the stage, avoid `100vh` on mobile (use `dvh`).

---

## 12. Open decisions (don’t block the build)

1. **Type treatment** for taste headlines: six options were drawn (A plain bold, B condensed poster, C wide lowercase, D receipt, E soft serif with highlighter, F sticker/marker). Unpicked. The Wrapped cards currently use the mixed approach in §6.5. Those options need extra fonts (Anton, Unbounded, Fraunces, Permanent Marker) if chosen.
2. **Custom-drawn j** for the logo/icon (replacing the dotless-j glyph hack). Needed before launch.
3. **Name:** “Jules” is a placeholder pending trademark/domain checks (an existing AI product shares the name). Alternates considered: Juno, Margot.
4. **Responsive layouts** below 1100px and for tablet are recommended above but not designed.
5. Favicon frame art: export SVG/PNG frames from the Icon board.
6. Real data and copy for Wrapped moments, and the legal review for style-icon matching.
