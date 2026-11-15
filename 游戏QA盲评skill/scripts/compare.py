"""Side-by-side "target vs actual" comparison images for scoring art / UI closeness.

    python3 compare.py PAIRS.json OUT_DIR [LABEL]

PAIRS.json: {"name": ["/abs/target.png", "/abs/actual.png"], ...}   (see templates/compare-pairs.example.json)
Each output is OUT_DIR/<name>.jpg, 1920x566, left = target, right = actual, captioned with paths + LABEL
(put the commit under test in LABEL, e.g. "inkblade 37955da preview").
"""
import json
import os
import sys
from PIL import Image, ImageDraw

pairs = json.load(open(sys.argv[1]))
out = sys.argv[2]
label = sys.argv[3] if len(sys.argv) > 3 else "ACTUAL"
os.makedirs(out, exist_ok=True)
for name, (a, b) in pairs.items():
    if name.startswith("$"):
        continue
    A = Image.open(a).convert("RGB").resize((960, 540))
    B = Image.open(b).convert("RGB").resize((960, 540))
    s = Image.new("RGB", (1920, 566), "white")
    d = ImageDraw.Draw(s)
    s.paste(A, (0, 26)); s.paste(B, (960, 26))
    d.text((6, 6), os.environ.get("QA_LEFT_LABEL", "TARGET") + ": " + "/".join(a.split("/")[-2:]), fill="black")
    d.text((966, 6), label + ": " + "/".join(b.split("/")[-2:]), fill="black")
    s.save(os.path.join(out, name + ".jpg"), quality=88)
    print("ok", name)
