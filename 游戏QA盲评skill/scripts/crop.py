"""Crop (and optionally enlarge) a region of a screenshot — for text overlap, health bars, small VFX.

    python3 crop.py SRC OUT x0 y0 x1 y1 [scale=1]          (pixels of the source image)
    python3 crop.py SRC OUT 0.25 0.36 0.75 0.56 2           (values <= 1 are fractions of width/height)
Several crops stacked vertically:  python3 crop.py --stack OUT x0 y0 x1 y1 SRC1 SRC2 ...
"""
import sys
from PIL import Image


def box(im, a):
    w, h = im.size
    v = [float(x) for x in a]
    if all(x <= 1 for x in v):
        v = [v[0] * w, v[1] * h, v[2] * w, v[3] * h]
    return tuple(int(x) for x in v)


if sys.argv[1] == "--stack":
    out, coords, srcs = sys.argv[2], sys.argv[3:7], sys.argv[7:]
    parts = [Image.open(s).convert("RGB") for s in srcs]
    parts = [p.crop(box(p, coords)) for p in parts]
    W = max(p.size[0] for p in parts)
    s = Image.new("RGB", (W, sum(p.size[1] for p in parts)), "white")
    y = 0
    for p in parts:
        s.paste(p, (0, y)); y += p.size[1]
    s.save(out)
else:
    src, out, coords = sys.argv[1], sys.argv[2], sys.argv[3:7]
    scale = float(sys.argv[7]) if len(sys.argv) > 7 else 1
    im = Image.open(src).convert("RGB")
    c = im.crop(box(im, coords))
    if scale != 1:
        c = c.resize((int(c.size[0] * scale), int(c.size[1] * scale)), Image.LANCZOS)
    c.save(out)
print("ok", out)
