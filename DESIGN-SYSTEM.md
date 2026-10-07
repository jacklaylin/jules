# Jules web design system

The wishlist and personal style pages use `public/design-system.css` and `public/design-system.js`. This is a small shared layer for the plain HTML/JavaScript app; no component framework is required.

## Shared ownership

- `mountHeader(page)` renders the logo, companion-page link, and Log out button once. Pages attach their existing sign-out behavior after mounting. Do not copy header markup into a page.
- `design-system.css` owns color/spacing tokens, full-width main layout, typography, form controls, focus states, neon palettes, the header and logo, and reduced-motion/forced-color behavior.
- Main content and the header align to `--page-gutter` (5vw). Main has no centered max-width wrapper. Page-specific grids can divide the available width without adding another outer gutter.
- `app-heading` is the shared page-heading row. Use existing heading sizes before adding a new typography variant.
- The Mongule logo uses `wordmark-glyph` with padding inside the gradient paint area to preserve its side bearing and descender. The logo link never has text decoration. Hover changes color, not geometry or visibility.
- Header height is 100px desktop / 76px phone, collapsing to 50px / 38px after scrolling. Body spacing remains stable.
- `wishlist.css` owns products, previews, detail dialogs, and price alerts. `style.css` owns upload/report/export composition. Neither should redefine shared layout, header, logo, or global controls.

## Extending the system

For any repeated UI, extend the shared component or primitive and use it from both pages. Keep page-specific content and behavior in the page modules. Avoid importing one page's stylesheet into another, appending competing global overrides, or copying shared markup.

Before deploying a shared style change, inspect both pages at desktop and phone sizes, including logo rest/hover, compact header, link navigation, form alignment, and dialogs. Check keyboard focus, no horizontal overflow, and browser errors. Automated application tests remain relevant when shared JavaScript changes.
