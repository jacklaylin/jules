# Jules web design system

The current visual system adapts the founder-supplied [brief](docs/design-system/BRIEF.md) and [original tokens](docs/design-system/tokens.css) to the existing plain HTML/JavaScript app. The attached brief supplies visual guidance, not permission to build future screens or change supported shopping behavior.

## Scope and ownership

- `public/design-system.css` owns shared tokens, local fonts, typography, full-width gutters, header, controls, selection chips, focus states, dialog defaults and reduced-motion/forced-color behavior.
- `public/design-system.js` mounts the companion-page header once and preserves sign-out and permission-controlled Test chat navigation. Pages attach their own actions.
- `public/brand-ui.js` supplies the shared outlined wordmark, orb dot, request-driven thinking/completion states and favicon controller. SVG outlines come from the locally licensed Instrument Serif; the logo never depends on a fallback dotless-j glyph.
- `public/brand-mark.js` paints the same outlines and a frozen orb into PNG exports. `public/brand/` contains the wordmark and font-independent favicon frames.
- Page CSS owns composition only. Repeated controls belong in the shared layer; base control selectors have low specificity so explicit page compositions such as image overlays retain their positioning.
- `public/internal-design.js` shares the brand with the existing owner pages without changing their actions or permissions.

## Visual rules

White page ground; neutral product-image surfaces. Ink `#17120F`, fog `#F3F1EE`, line `#E8E4E0`, secondary text `#6B625B`. Butter is the primary-action color; grape is for sharing and focus. Tangerine, bubblegum and grape form the orb. Aqua is reserved for iMessage bubbles and the indeterminate loader.

Instrument Serif roman supplies headlines; Bricolage Grotesque supplies body text and bold starter-pack titles; JetBrains Mono supplies small labels/data. All fonts and redistribution licenses are bundled in `public/fonts/`; no external font request or CSP expansion is required. The old Mongule/neon wordmark, random hover gradients and rotating display-font pool are no longer used by these pages.

Actions use one gel-pill vocabulary with 44px minimum targets. Selected radio chips retain native inputs. Wishlist chooses its desktop column count from the available width, using a 280px minimum card width and a maximum of four columns, and uses two on phones, with equal-height rounded cards, portrait image slots, bold product titles and mono price labels. Photo-pending slots use the orb and an honest status label. The alert bell remains at the upper-right, with ink on butter and an ON badge when active. Removal is available on each card at the upper-left, with an accessible label and undo; the alert stays at the upper-right. Product details use the same saved product title and have no refresh or removal controls. Saved metadata renders before background photo recovery; opening a product shows its known summary immediately. Desktop heading is Wishlist; mobile heading is Your wishlist with the count beneath. Shared dialogs use rounded borders, visible focus and keyboard support. Main/header align to `--page-gutter` (5vw), without a centered outer max-width wrapper.

The header retains a compact scroll state without shifting body spacing. Desktop shows serif Wishlist, Your style, permission-controlled Test chat, and Log out links, with an orb marking the active page. At 800px and below, a gel Menu button opens a full-screen white modal with the same navigation nodes in a vertical list. Escape/Close restores focus and page scrolling; resizing to desktop closes the menu. Test chat permissions and logout handlers remain attached to the same elements. The menu footer reports the actual wishlist count when available and is cleared on sign-out.

## Activity and motion

`public/activity.js` tracks concurrent requests and local workflows. It shows the actual current action and that action's elapsed time. The orb and Aqua loader replace the old spinner. Private image fetches retain neutral per-image placeholders without flashing the page activity panel.

Only explicit style analysis and shopping-chat POST operations trigger the header dot hop and favicon frames. Loading pages or saving notes does not imply a store search. Other agent workflows can explicitly pass `{agent:true}` to `withActivity`. HTTP errors and thrown failures suppress successful completion for that activity batch. The next batch can recover normally.

The orb spins in 7s and wobbles in 4s. Thinking hops in an 8s loop, with horizontal distances calibrated to the outlined letters and a smaller return arc inside compact headers; successful completion has a short landing pop. Favicon frames swap every 350ms and settle to the static icon. Hidden tabs stop favicon intervals. Reduced motion disables all decorative animation, including typing, entrances, hover transitions and favicon swaps, while retaining readable status text. The Aqua capsule is indeterminate and never represents measured progress.

The test chat retains real simulator behavior with native iMessage fonts/colors, last-in-group bubble tails, photo bubbles and typing feedback while a request runs. Previously rendered messages do not replay their entrance on every update.

## Style cards and exports

Existing report cards, including the existing starter-pack card, retain supported content, evidence and consent. Web cards and 1080×1920 PNG exports share typography/color choices via `style-visuals.js`. Product-photo collages stay on white. Personal-photo and shopping-history sharing consent remain intact. Exports use the frozen brand mark and wait for the new fonts to load.

Desktop stories use the full width with text and an evidence collage. Phones keep horizontal story navigation, with vertical space/scrolling for long content and wrapped controls. Evidence remains readable in its dialog. Existing hover collage motion remains limited to fine pointers and users allowing motion.

## Deferred

New feed screens, new nine-cell starter-pack layouts, additional Wrapped moments, animated marquee placement and navigation to unbuilt destinations. Never ship the brief's example prices, stock, store counts, style-match percentages, wear counts, delivery or purchasing claims as facts.

## Public landing page

The public `/` page now follows the brief's pinned viewport and scroll-driven iMessage demonstration, with responsive composition in `public/landing.css`. `public/landing-timeline.js` supplies deterministic progress, chapters and typing states for scroll and the progress control. Reduced motion displays the complete conversation; an inline screen-reader transcript is also available without JavaScript. Example requests and the licensed sneaker photograph are explicitly illustrative, with no invented commerce results or purchasing claims.

`mountPublicHeader` in the shared JavaScript hydrates public-page logos, while the shared gel links and header navigation primitives serve `/`, `/signup` and `/login`. Public signup collects private consent records only; outbound welcome messages are not enabled. See `LANDING-PAGE.md` for setup and remaining launch requirements.

## Verification before shared changes ship

Check wishlist and style at desktop, 390px and 320px phone widths, including logo rest/hover/thinking/completion, compact header, signed-out forms, uploads, draft review, confirmed cards, image controls, product/alert/evidence/export dialogs, long copy, PNG output, keyboard focus and no horizontal overflow. Check reduced motion, HTTP failures, concurrent request completion, and browser errors. Also smoke-check simulator and owner screens. Use synthetic browser fixtures; do not send real messages or perform paid searches just to verify styling. Run the application suite when shared JavaScript changes.
