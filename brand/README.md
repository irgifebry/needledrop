# Brand assets

The mark is the product in one shape: a record, a tonearm coming in from the
top right, and the stylus dropping onto the groove in orange. It is the only
mark that says "needledrop" without needing the word.

| File | Use |
|---|---|
| `logo-512.png` | Google OAuth consent screen (square, under 1 MB) |
| `logo-120.png` | Google asks for 120×120 for the best result |

Both are generated from the palette in `app/globals.css`: mint `#a7ff9c`,
ink `#0b0b0b`, orange `#ff6831`.

## Why not a letter

The first version of this mark was the letter "N" on a mint square, taken
from the footer wordmark. Google's branding review rejected it:

> *"Your logo does not uniquely identify your brand and identity. Configure
> your app with a logo that reflects your identity and does not impersonate
> any other brand."*

A monogram is the most generic mark there is — it says nothing about what the
app does and could belong to any product. The record-and-needle does the
work: it is the app's name, drawn.

## Regenerating

The marks are generated with Pillow. The shape is built at four times the
target size and downsampled — the consent screen renders the logo small, and
the supersample is what keeps the groove lines and the stylus clean at
120px. The type is Anton, by Vernon Adams and Cyreal, licensed under the
SIL Open Font License 1.1; the site loads it through `next/font/google`
(`app/layout.tsx`), so the licence travels with the build.
