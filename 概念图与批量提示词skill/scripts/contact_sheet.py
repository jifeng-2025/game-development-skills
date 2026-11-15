"""审图拼图：把多张图按同一高度横排，上方标文件名。
用法:
  python3 contact_sheet.py out.jpg a.png b.png ...                 # 指定几张并排（放大比对）
  python3 contact_sheet.py --groups <concepts_dir> <out_dir>       # 每个 asset-id 目录一张总览 sheet_<id>.jpg
可选: --height 900（单图高度）--maxw 2600（分组模式每行最大宽度）"""
import argparse, glob, os
from PIL import Image, ImageDraw, ImageFont
ap = argparse.ArgumentParser(); ap.add_argument('args', nargs='+'); ap.add_argument('--groups', action='store_true')
ap.add_argument('--height', type=int, default=900); ap.add_argument('--maxw', type=int, default=2600)
a = ap.parse_args()
font = ImageFont.load_default(size=22)


def sheet(files, out, th, maxw=10**9):
    ims = []
    for f in files:
        im = Image.open(f).convert('RGB'); ims.append((os.path.basename(f).rsplit('.', 1)[0], im.resize((max(1, int(im.width * th / im.height)), th))))
    rows, row, rw = [], [], 0
    for lab, im in ims:
        if row and rw + im.width > maxw:
            rows.append(row); row, rw = [], 0
        row.append((lab, im)); rw += im.width + 10
    rows.append(row)
    W = max(sum(i.width + 10 for _, i in r) for r in rows)
    c = Image.new('RGB', (W, len(rows) * (th + 40)), 'white'); d = ImageDraw.Draw(c); y = 0
    for r in rows:
        x = 0
        for lab, im in r:
            c.paste(im, (x, y + 36)); d.text((x + 4, y + 6), lab, fill='black', font=font); x += im.width + 10
        y += th + 40
    c.save(out, quality=88); print('saved', out)


if a.groups:
    src, out = a.args
    os.makedirs(out, exist_ok=True)
    for d in sorted(glob.glob(os.path.join(src, '*/'))):
        fs = sorted(glob.glob(d + '*.png'))
        if fs and not os.path.basename(d.rstrip('/')).startswith('_'):
            sheet(fs, os.path.join(out, f"sheet_{os.path.basename(d.rstrip('/'))}.jpg"), min(a.height, 600), a.maxw)
else:
    sheet(a.args[1:], a.args[0], a.height)
