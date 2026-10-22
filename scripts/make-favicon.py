#!/usr/bin/env python3
"""Generate the needledrop favicon set.

The site has one mark (a record, a tonearm, a stylus dropping onto the
groove) and three places it has to work in: a browser tab, a bookmark, and
an iOS home screen. Those want different files, so this script writes all
three from one geometry.

    app/icon.svg        the vector master; every browser that speaks SVG
                         renders this one, at any size
    app/favicon.ico     16/32/48, for the browsers and crawlers that still
                         ask for /favicon.ico by reflex
    app/apple-icon.png  180x180, opaque, for the iOS home screen

Run it after changing the geometry below:

    python3 scripts/make-favicon.py

Needs Pillow. The vector master is written from the same constants that
drive the raster, so the two cannot drift apart.

Why the geometry differs from brand/logo-512.png: the consent mark is
drawn at 120px and up, where three groove lines have room. A tab is 16px.
At that size a groove has to be at least a pixel and a half wide or it
stops being a line and becomes grey, and three of them turn the disc into
a smudged green-black blob. So the favicon is the same drawing with the
detail pulled out: one bold groove instead of three, a larger label, a
thicker arm and stylus. Same composition, same palette, legible at the
size it is actually seen at.
"""

from __future__ import annotations

import os

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(ROOT, "app")

MINT = (167, 255, 156)  # #a7ff9c
INK = (11, 11, 11)  # #0b0b0b
ORANGE = (255, 104, 49)  # #ff6831

HEX = {MINT: "#a7ff9c", INK: "#0b0b0b", ORANGE: "#ff6831"}

# ── The geometry, on a 512 master ──────────────────────────────────────
# Everything below is in master units; a 32px favicon is this divided by 16.

# The record. Centred low and left so the disc runs off two edges, the way
# it does in the consent mark: a cropped record reads as "in motion".
DISC_C = (178.0, 342.0)
DISC_R = 216.0

# The groove. One, not three. At 16px a groove line has to be at least a
# pixel and a half wide or it stops being a line and becomes grey; three
# of them turn the disc into a smudged green-black blob. One bold ring
# survives the downscale and still says "record".
GROOVE_R = 130.0
GROOVE_W = 44.0

# The label. The one thing that must not shrink: it is the orange the eye
# reads first, and at 16px it is the whole record.
LABEL_R = 30.0

# The tonearm: a ball at the pivot, a shaft running down and to the left.
ARM_BALL_C = (452.0, 36.0)
ARM_BALL_R = 33.0
ARM_FROM = (452.0, 36.0)
ARM_TO = (318.2, 194.3)
ARM_W = 36.0

# The stylus: orange, breaking out of the arm and dropping onto the record.
STYLUS_FROM = (319.8, 196.1)
STYLUS_TO = (238.0, 268.0)
STYLUS_W = 24.0
TIP_R = 22.0

SUPERSAMPLE = 4


# ── Drawing ────────────────────────────────────────────────────────────


def _unit(v: float) -> str:
    """Trim a float to something that belongs in a source file."""
    return f"{v:g}"


def _corners(p0, p1, width):
    """The four corners of a thick segment with flat, perpendicular ends."""
    (x0, y0), (x1, y1) = p0, p1
    dx, dy = x1 - x0, y1 - y0
    length = (dx * dx + dy * dy) ** 0.5
    ux, uy = dx / length, dy / length
    # The normal, pointing to one side of the shaft.
    nx, ny = -uy, ux
    hw = width / 2.0
    return [
        (x0 + nx * hw, y0 + ny * hw),
        (x1 + nx * hw, y1 + ny * hw),
        (x1 - nx * hw, y1 - ny * hw),
        (x0 - nx * hw, y0 - ny * hw),
    ]


def render(size: int, mode: str = "RGB") -> Image.Image:
    """Draw the mark at `size` pixels square."""
    scale = SUPERSAMPLE
    big = size * scale
    factor = big / 512.0

    img = Image.new("RGB", (big, big), MINT)
    draw = ImageDraw.Draw(img)

    def sc(point):
        return (point[0] * factor, point[1] * factor)

    def circle(c, r, fill=None, stroke=None, width=0.0):
        # Pillow strokes an ellipse *inside* its bounding box; an SVG stroke
        # is centred on the path. Grow the box by half the stroke so the
        # two agree — otherwise the groove sits a whole stroke width closer
        # to the middle in the raster than in the vector, and the ICO and
        # the SVG are two different marks.
        rr = r + width / 2.0 if stroke else r
        cx, cy = sc(c)
        rr *= factor
        draw.ellipse(
            (cx - rr, cy - rr, cx + rr, cy + rr),
            fill=fill,
            outline=stroke,
            width=int(round(width * factor)),
        )

    def segment(p0, p1, width, fill):
        draw.polygon([sc(p) for p in _corners(p0, p1, width)], fill=fill)

    # The record, then its groove cut back out of it.
    circle(DISC_C, DISC_R, fill=INK)
    circle(DISC_C, GROOVE_R, stroke=MINT, width=GROOVE_W)
    circle(DISC_C, LABEL_R, fill=ORANGE)

    # The arm, then the ball that hides the joint at its pivot.
    segment(ARM_FROM, ARM_TO, ARM_W, INK)
    circle(ARM_BALL_C, ARM_BALL_R, fill=INK)

    # The stylus, then the tip that lands on the record.
    segment(STYLUS_FROM, STYLUS_TO, STYLUS_W, ORANGE)
    circle(STYLUS_TO, TIP_R, fill=ORANGE)

    out = img.resize((size, size), Image.LANCZOS)
    if mode == "RGBA":
        out = out.convert("RGBA")
    return out


# ── The vector master ─────────────────────────────────────────────────


def svg() -> str:
    def circle(c, r, fill=None, stroke=None, width=None):
        attrs = [f'cx="{_unit(c[0])}"', f'cy="{_unit(c[1])}"', f'r="{_unit(r)}"']
        if fill:
            attrs.append(f'fill="{HEX[fill]}"')
        else:
            attrs.append('fill="none"')
        if stroke:
            attrs.append(f'stroke="{HEX[stroke]}"')
            attrs.append(f'stroke-width="{_unit(width)}"')
        return f"  <circle {' '.join(attrs)} />"

    def segment(p0, p1, width, color):
        return (
            f'  <line x1="{_unit(p0[0])}" y1="{_unit(p0[1])}"'
            f' x2="{_unit(p1[0])}" y2="{_unit(p1[1])}"'
            f' stroke="{HEX[color]}" stroke-width="{_unit(width)}"'
            ' stroke-linecap="butt" />'
        )

    parts = [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"',
        '     width="512" height="512" role="img"',
        '     aria-label="needledrop">',
        f'  <rect width="512" height="512" fill="{HEX[MINT]}" />',
        circle(DISC_C, DISC_R, fill=INK),
        circle(DISC_C, GROOVE_R, stroke=MINT, width=GROOVE_W),
        circle(DISC_C, LABEL_R, fill=ORANGE),
    ]
    parts.append(segment(ARM_FROM, ARM_TO, ARM_W, INK))
    parts.append(circle(ARM_BALL_C, ARM_BALL_R, fill=INK))
    parts.append(segment(STYLUS_FROM, STYLUS_TO, STYLUS_W, ORANGE))
    parts.append(circle(STYLUS_TO, TIP_R, fill=ORANGE))
    parts.append("</svg>")
    return "\n".join(parts) + "\n"


# ── Writing ────────────────────────────────────────────────────────────


def main() -> None:
    os.makedirs(APP, exist_ok=True)

    svg_path = os.path.join(APP, "icon.svg")
    with open(svg_path, "w", encoding="utf-8") as handle:
        handle.write(svg())
    print(f"wrote {os.path.relpath(svg_path, ROOT)}")

    # The ICO carries every size a browser might ask for, packed into one
    # file, so the tab never renders a stretched 512.
    #
    # PNG entries, which is what Pillow writes by default, and RGBA, which
    # is not optional: the ICO decoder in the Next.js image pipeline
    # rejects a PNG entry that is not in RGBA format. BMP entries would be
    # the older format, but Pillow's BMP writer pads the AND mask past the
    # size it declares in the directory, and a strict decoder rejects the
    # file outright with "ICO image data size did not match expected size".
    # PNG-in-ICO has been understood by every browser since Chrome 32.
    ico_master = render(256, mode="RGBA")
    ico_path = os.path.join(APP, "favicon.ico")
    ico_master.save(
        ico_path,
        format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48)],
    )
    print(f"wrote {os.path.relpath(ico_path, ROOT)} (16, 32, 48)")

    # iOS composites a transparent apple-icon onto black. Opaque mint, so it
    # never does.
    apple_path = os.path.join(APP, "apple-icon.png")
    render(180).save(apple_path, format="PNG", optimize=True)
    print(f"wrote {os.path.relpath(apple_path, ROOT)} (180)")


if __name__ == "__main__":
    main()
