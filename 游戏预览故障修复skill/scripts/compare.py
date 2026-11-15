"""Before/after (or reference/actual) side-by-side sheets for a fix report.

    python3 compare.py pairs.json <out-dir>
    pairs.json: [{"name": "S1-teach-banner", "before": "/abs/q001/x.png", "after": "/abs/after/y.png",
                  "beforeLabel": "修复前 Q001 …", "afterLabel": "修复后 …"}, ...]
    "before" may be a glob (first match) or null (left half says 无参考).

Each sheet is 1930x600: two 960x540 panes (aspect kept, letterboxed) under one label line.
Needs Pillow and a CJK font (macOS: Hiragino Sans GB; set FIX_FONT to override).
"""
import glob
import json
import os
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

if len(sys.argv) != 3:
    sys.exit(__doc__)
pairs = json.load(open(sys.argv[1]))
out = Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)
font_path = os.environ.get('FIX_FONT', '/System/Library/Fonts/Hiragino Sans GB.ttc')
font = ImageFont.truetype(font_path, 24)


def pane(path, w=960, h=540):
    canvas = Image.new('RGB', (w, h), (30, 30, 30))
    if path:
        image = Image.open(path).convert('RGB')
        image.thumbnail((w, h))
        canvas.paste(image, ((w - image.width) // 2, (h - image.height) // 2))
    return canvas


for item in pairs:
    before = item.get('before')
    if before and any(c in before for c in '*?['):
        matches = sorted(glob.glob(before))
        before = matches[0] if matches else None
    after = item['after']
    if not Path(after).exists():
        print('skip (no after):', item['name'])
        continue
    sheet = Image.new('RGB', (1930, 600), (18, 18, 18))
    sheet.paste(pane(before), (0, 56))
    sheet.paste(pane(after), (970, 56))
    draw = ImageDraw.Draw(sheet)
    draw.text((8, 14), item.get('beforeLabel') or (f'修复前 · {Path(before).name}' if before else '修复前：无此画面'), fill=(230, 220, 200), font=font)
    draw.text((978, 14), item.get('afterLabel') or f'修复后 · {Path(after).name}', fill=(230, 220, 200), font=font)
    sheet.save(out / f"{item['name']}.png")
    print('ok', item['name'])
