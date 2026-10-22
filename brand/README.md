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

## The favicon

The favicon is the same mark, drawn smaller. It lives in `app/` because that
is where Next.js looks for it — the file names are the convention, not a
choice.

| File | Use |
|---|---|
| `app/icon.svg` | the vector master; what a browser tab actually shows |
| `app/favicon.ico` | 16, 32 and 48px, for the browsers and crawlers that ask for `/favicon.ico` by reflex |
| `app/apple-icon.png` | 180×180, opaque, for the iOS home screen |

### Why it is not the logo, shrunk

A tab is 16 pixels. At 16 pixels the three groove lines of the consent mark
are each a sixth of a pixel wide: they stop being lines and become a
smudged green-black wash over the whole disc. The stylus falls below a
pixel too, and the arm turns into a scratch.

So the favicon is the drawing with the detail pulled out rather than scaled
down: **one** groove instead of three, and wide — a bold mint ring that is
still a ring at 16px, where three thin ones would be mud. The label is
enlarged, the arm and the stylus are thickened, and the composition is
otherwise untouched.

The line between the two variants was drawn by looking at them, not by
computing them. Three grooves: unreadable at 16px. Two: the inner one
smears the orange label into a brown blob. One: a record, plainly, at every
size from 16 up.

### Regenerating

```sh
python3 scripts/make-favicon.py
```

The geometry lives in that script once and is emitted twice — as the SVG and
as the raster — so the two cannot drift apart. It needs Pillow.

The ICO is written with PNG entries in RGBA, and both of those are load
bearing: Next.js's image pipeline refuses an ICO whose PNG entries are not
RGBA, and it refuses the BMP entries Pillow can also write, because Pillow's
BMP writer pads the AND mask past the size it declares in the directory.
Either way the build fails with `Processing image failed` — and takes
`app/favicon.ico` with it.

## Regenerating the consent marks

The marks are generated with Pillow. The shape is built at four times the
target size and downsampled — the consent screen renders the logo small, and
the supersample is what keeps the groove lines and the stylus clean at
120px. The type is Anton, by Vernon Adams and Cyreal, licensed under the
SIL Open Font License 1.1; the site loads it through `next/font/google`
(`app/layout.tsx`), so the licence travels with the build.
