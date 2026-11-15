#!/usr/bin/env python3
"""立绘、插画、单色印章的后处理。
  python cutout.py portrait --in a.png --out b.png [--size 1024] [--margin .04] [--tol 26] [--check c.png]
      去纯灰底（从四边连通 + 被线条围住的大块底色）→ 透明方图；贴边的一侧不留边距，默认底对齐
  python cutout.py cover --in a.png --out b.png --size 1920x1080
      等比放大后居中裁切，不拉伸、不调色
  python cutout.py chroma --in a.png --out b.png --dominant r [--min 40] [--range 80] [--color '#RRGGBB']
      按主色抠图：去掉烤进「透明」图里的灰白光晕，只留该色块并去空边。只适用于单色元素。
      --dominant 选元素最强的通道。青、黄这类双通道色的差值小，要降 --min、--range（如 10 / 15）。
      --color 是半透明边缘的填充色，不传时保留原色。
"""
import argparse

import numpy as np
from PIL import Image
from scipy import ndimage


def remove_bg(path, tol):
    rgb = np.asarray(Image.open(path).convert('RGB')).astype(np.float32)
    h, w, _ = rgb.shape
    bg = np.median(np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]]), 0)
    dist = np.sqrt(((rgb - bg) ** 2).sum(-1))
    cand = (dist < tol) & (rgb.max(-1) - rgb.min(-1) < 18)
    labels, count = ndimage.label(cand)
    edge = np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))
    mask = np.isin(labels, edge[edge > 0])
    sizes = ndimage.sum(cand, labels, index=np.arange(count + 1))
    big = np.where(sizes > h * w * 0.002)[0]
    mask |= np.isin(labels, big[big > 0]) & (dist < tol * 0.7)
    mask = ndimage.binary_opening(mask, iterations=1)
    alpha = np.clip(ndimage.distance_transform_edt(~mask) / 1.5, 0, 1)
    rim = (alpha > 0) & (alpha < 1)
    a = alpha[..., None]
    rgb = np.where(rim[..., None], np.clip((rgb - bg * (1 - a)) / np.maximum(a, 1e-3), 0, 255), rgb)
    return Image.fromarray(np.dstack([rgb, alpha * 255]).astype(np.uint8), 'RGBA')


def place(image, size, margin):
    solid = ndimage.binary_opening(np.asarray(image)[..., 3] > 128, iterations=3)
    ys, xs = np.where(solid)
    covers = lambda line: line.mean() > 0.03       # 覆盖超过 3% 才算真贴边，零星噪点不算
    touch = dict(t=covers(solid[2]), b=covers(solid[-3]), l=covers(solid[:, 2]), r=covers(solid[:, -3]))
    image = image.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
    gap = round(size * margin)
    pad = {key: (0 if touch[key] else gap) for key in touch}
    scale = min((size - pad['l'] - pad['r']) / image.width, (size - pad['t'] - pad['b']) / image.height)
    image = image.resize((round(image.width * scale), round(image.height * scale)), Image.LANCZOS)
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    if touch['l'] and not touch['r']:
        x = 0
    elif touch['r'] and not touch['l']:
        x = size - image.width
    else:
        x = (size - image.width) // 2
    canvas.alpha_composite(image, (x, size - pad['b'] - image.height))
    return canvas, touch


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('mode', choices=['portrait', 'cover', 'chroma'])
    parser.add_argument('--in', dest='src', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--size', default='1024')
    parser.add_argument('--margin', type=float, default=0.04)
    parser.add_argument('--tol', type=float, default=26)
    parser.add_argument('--check', help='portrait：另存一张暗底合成图，用来检查抠图')
    parser.add_argument('--dominant', choices=list('rgb'), default='r')
    parser.add_argument('--min', type=float, default=40)
    parser.add_argument('--range', type=float, default=80)
    parser.add_argument('--color', help='chroma：半透明边缘的填充色，不传则保留原色')
    args = parser.parse_args()
    if args.mode == 'portrait':
        image, touch = place(remove_bg(args.src, args.tol), int(args.size), args.margin)
        image.save(args.out)
        if args.check:
            check = Image.new('RGBA', image.size, (30, 28, 26, 255))
            check.alpha_composite(image)
            check.convert('RGB').save(args.check)
        print(args.out, image.size, '贴边', {key: bool(value) for key, value in touch.items()})
    elif args.mode == 'cover':
        w, h = (int(v) for v in args.size.split('x'))
        image = Image.open(args.src).convert('RGB')
        scale = max(w / image.width, h / image.height)
        image = image.resize((round(image.width * scale), round(image.height * scale)), Image.LANCZOS)
        x, y = (image.width - w) // 2, (image.height - h) // 2
        image.crop((x, y, x + w, y + h)).save(args.out)
        print(args.out, (w, h))
    else:
        rgba = np.asarray(Image.open(args.src).convert('RGBA')).astype(np.float32)
        index = 'rgb'.index(args.dominant)
        others = [i for i in range(3) if i != index]
        chroma = rgba[..., index] - np.maximum(rgba[..., others[0]], rgba[..., others[1]])
        alpha = np.clip((chroma - args.min) / args.range, 0, 1) * rgba[..., 3] / 255
        ys, xs = np.where(alpha > 0.05)
        if not ys.size:
            raise SystemExit(f'没有像素通过筛选：通道 {args.dominant} 比其余通道高出的量都低于 --min {args.min}。换 --dominant，或降低 --min、--range')
        color = rgba[..., :3]
        if args.color:
            fill = np.array([int(args.color.lstrip('#')[i:i + 2], 16) for i in (0, 2, 4)], np.float32)
            color = np.where(alpha[..., None] > 0.5, color, fill)
        out = np.dstack([color, alpha * 255])
        image = Image.fromarray(out.astype(np.uint8), 'RGBA').crop((max(xs.min() - 8, 0), max(ys.min() - 8, 0), xs.max() + 9, ys.max() + 9))
        image.save(args.out)
        print(args.out, image.size)


if __name__ == '__main__':
    main()
