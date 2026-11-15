"""Contact sheet: one labelled image from many screenshots, to save image-viewing budget.

    python3 sheet.py OUT.jpg COLS TILE_W file1 file2 ...        (args may also be one space-joined string)

Each tile is labelled "<parent-dir>/<file>". All tiles take the aspect ratio of the first image.
Typical: 4 cols x 480 px for 1280x720 shots (≈ 1920 px wide sheet), max ~16 tiles per sheet.
"""
import sys
from PIL import Image, ImageDraw

out, cols, w = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
fs = " ".join(sys.argv[4:]).split()
if not fs:
    sys.exit("no input files")
ims = [Image.open(f).convert("RGB") for f in fs]
h = int(w * ims[0].size[1] / ims[0].size[0])
rows = (len(ims) + cols - 1) // cols
sheet = Image.new("RGB", (cols * w, rows * (h + 18)), "white")
d = ImageDraw.Draw(sheet)
for i, (f, im) in enumerate(zip(fs, ims)):
    x, y = (i % cols) * w, (i // cols) * (h + 18)
    sheet.paste(im.resize((w, h)), (x, y + 18))
    parts = f.split("/")
    d.text((x + 4, y + 3), "/".join(parts[-2:]), fill="black")
sheet.save(out, quality=85)
print(out, len(fs), "tiles")
