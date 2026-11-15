"""把 v02 无缝贴图复制成资产专用贴图（缩放到 1024，存 JPG），原图不动。
用法: python3 prep_tile.py <src.png> <dst.jpg> [--size 1024] [--brightness 1.0] [--tint #RRGGBB --amount 0.3]"""
import argparse
from PIL import Image, ImageEnhance
ap = argparse.ArgumentParser()
ap.add_argument('src'); ap.add_argument('dst')
ap.add_argument('--size', type=int, default=1024)
ap.add_argument('--brightness', type=float, default=1.0)
ap.add_argument('--tint'); ap.add_argument('--amount', type=float, default=0.0)
a = ap.parse_args()
im = Image.open(a.src).convert('RGB').resize((a.size, a.size), Image.LANCZOS)
if a.brightness != 1.0:
    im = ImageEnhance.Brightness(im).enhance(a.brightness)
if a.tint:
    t = Image.new('RGB', im.size, tuple(int(a.tint.lstrip('#')[i:i + 2], 16) for i in (0, 2, 4)))
    im = Image.blend(im, t, a.amount)
im.save(a.dst, quality=90)
print('saved', a.dst)
