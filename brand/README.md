# Brand assets

The mark is the first letter of the footer wordmark, on its own block: mint
ground, ink letter, Anton — the same letterform device the site already uses,
so the OAuth consent screen shows the same identity as the product page.

| File | Use |
|---|---|
| `logo-512.png` | Google OAuth consent screen (square, under 1 MB) |
| `logo-120.png` | Google asks for 120×120 for the best result |

Both are generated from the palette in `app/globals.css`: mint `#a7ff9c`,
ink `#0b0b0b`.

## Typeface

Anton, by Vernon Adams and Cyreal — licensed under the SIL Open Font
License 1.1. The site loads it through `next/font/google`
(`app/layout.tsx`), so the licence travels with the build.

## Regenerating

The marks are generated from `anton.ttf` with Pillow. Fetch the font from
the Google Fonts repository (`ofl/anton/Anton-Regular.ttf`) and re-render at
four times the target size, then downsample — the consent screen renders the
logo small, and the supersample is what keeps the letterform's diagonals
clean at 120px.
