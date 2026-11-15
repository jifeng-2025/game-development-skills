"""审图数值统计：尺寸、画幅、禁用颜色像素占比、高饱和占比、四角背景色（检查纯灰/纯黑/纯白底）。
用法: python3 review_stats.py <concepts_dir> <out.json> [--hue-lo 0.05 --hue-hi 0.95 --sat 0.5 --val 0.35]
默认「禁用色」是红色（HSV 色相 ≤18° 或 ≥342°、S>0.5、V>0.35），换项目可改阈值。
输出每张图一行，并写 JSON；跳过以 _ 开头的目录（归档）。"""
import argparse, colorsys, glob, json, os
from PIL import Image
ap = argparse.ArgumentParser(); ap.add_argument('src'); ap.add_argument('out')
ap.add_argument('--hue-lo', type=float, default=0.05); ap.add_argument('--hue-hi', type=float, default=0.95)
ap.add_argument('--sat', type=float, default=0.5); ap.add_argument('--val', type=float, default=0.35)
a = ap.parse_args(); rows = []
for f in sorted(glob.glob(os.path.join(a.src, '*', '*.png'))):
    if os.path.basename(os.path.dirname(f)).startswith('_'):
        continue
    im = Image.open(f).convert('RGB'); w, h = im.size
    s = im.resize((200, max(1, int(200 * h / w)))); px = list(s.getdata()); n = len(px); bad = sat = 0
    for r, g, b in px:
        hh, ss, vv = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
        sat += ss > 0.45
        bad += (hh < a.hue_lo or hh > a.hue_hi) and ss > a.sat and vv > a.val
    W, H = s.size; corners = [s.getpixel(p) for p in [(2, 2), (W - 3, 2), (2, H - 3), (W - 3, H - 3)]]
    row = dict(file=os.path.relpath(f, a.src), size=f'{w}x{h}', aspect=round(w / h, 3), forbidden_pct=round(100 * bad / n, 2),
               saturated_pct=round(100 * sat / n, 1), corners=corners)
    rows.append(row); print(row['file'], row['size'], 'aspect', row['aspect'], 'forbidden%', row['forbidden_pct'], 'sat%', row['saturated_pct'], corners[0], corners[3])
json.dump(rows, open(a.out, 'w'), ensure_ascii=False, indent=1)
