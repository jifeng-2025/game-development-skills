#!/usr/bin/env python3
"""把生成的切图转成游戏可用的 PNG。

  python build_slices.py --spec slices.spec.json --src <slices目录> --out <export目录>

spec 字段（示例见 templates/slices.spec.example.json）：
  tints: {名字: "#RRGGBB"}
  items[]: id, src（相对 --src）, kind, box [宽, 高]（输出 @2x 像素）, tints（K 类必填）, fill, fit
    kind  T = 彩色元素：透明 PNG 或纯绿底，绿底自动抠除；K = 黑底白元素：亮度→alpha，RGB 填色值，一张出多色
    fit   contain（默认，等比放进 box）/ height（横拉元素：按高度缩放，宽度靠九宫格）/ stretch（铺满，全屏暗角用）
    fill  true 或整数（闭运算迭代数，默认 4）：把中心发暗的墨团、粗笔触内部填实
输出：<out>/<screen>/<element>[-<tint>].png 和 <out>/manifest.json（文件、@2x 尺寸、CSS 尺寸）
"""
import argparse
import json
import os

import numpy as np
from PIL import Image
from scipy import ndimage


def hex_rgb(value):
    value = value.lstrip('#')
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))


def k_alpha(path, fill):
    lum = np.asarray(Image.open(path).convert('L')).astype(np.float32)
    lit = lum[lum > 20]
    hi = np.percentile(lit, 99) if lit.size else 255
    alpha = np.clip((lum - 8) / max(hi - 8, 1), 0, 1)
    if fill:
        it = 4 if fill is True else int(fill)
        mask = ndimage.binary_closing(np.pad(alpha > 0.03, it), iterations=it)[it:-it, it:-it]
        mask = ndimage.binary_fill_holes(mask)
        mask = ndimage.binary_erosion(mask, iterations=6)
        soft = ndimage.gaussian_filter(mask.astype(np.float32), 4)
        alpha = np.maximum(alpha, soft * (0.88 + 0.12 * alpha))
    return alpha


def load_t(path):
    """读 T 类图。没有有效 alpha 且四角是纯绿时按绿幕抠除并去绿边。"""
    image = Image.open(path).convert('RGBA')
    rgba = np.asarray(image).astype(np.float32)
    corners = rgba[[0, 0, -1, -1], [0, -1, 0, -1]]
    green = corners[:, 1].min() > 180 and corners[:, [0, 2]].max() < 90
    if rgba[..., 3].min() > 250 and green:
        r, g, b = rgba[..., 0], rgba[..., 1], rgba[..., 2]
        spill = g - np.maximum(r, b)
        rgba[..., 3] = 255 * (1 - np.clip((spill - 30) / 90, 0, 1))
        rgba[..., 1] = np.minimum(g, np.maximum(r, b) + 12)
        return Image.fromarray(rgba.astype(np.uint8), 'RGBA'), True
    return image, False


def trim_box(alpha, thr=0.03, pad=4):
    ys, xs = np.where(alpha > thr)
    if not ys.size:
        raise SystemExit('图里没有可见内容')
    h, w = alpha.shape
    return max(xs.min() - pad, 0), max(ys.min() - pad, 0), min(xs.max() + pad + 1, w), min(ys.max() + pad + 1, h)


def fit_image(image, box, mode):
    if mode == 'stretch':
        return image.resize(tuple(box), Image.LANCZOS)
    scale = box[1] / image.height if mode == 'height' else min(box[0] / image.width, box[1] / image.height)
    return image.resize((max(1, round(image.width * scale)), max(1, round(image.height * scale))), Image.LANCZOS)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--spec', required=True)
    parser.add_argument('--src', required=True)
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    spec = json.load(open(args.spec, encoding='utf-8'))
    tints = {name: hex_rgb(value) for name, value in spec.get('tints', {}).items()}
    manifest = []

    def emit(item, image, name):
        path = os.path.join(args.out, name)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        image.save(path)
        manifest.append({'id': item['id'], 'file': name, 'size2x': list(image.size),
                         'css': [image.width // 2, image.height // 2]})

    for item in spec['items']:
        source = os.path.join(args.src, item['src'])
        screen = os.path.dirname(item['src'])
        element = os.path.basename(item['src']).split('__')[0]
        mode = item.get('fit', 'contain')
        if item['kind'] == 'T':
            image, keyed = load_t(source)
            alpha = np.asarray(image)[..., 3] / 255.0
            emit(item, fit_image(image.crop(trim_box(alpha)), item['box'], mode), f'{screen}/{element}.png')
            if keyed:
                print(f"{item['id']}: 检测到绿底，已抠除")
        elif item['kind'] == 'K':
            alpha = k_alpha(source, item.get('fill', False))
            if mode != 'stretch':
                x0, y0, x1, y1 = trim_box(alpha)
                alpha = alpha[y0:y1, x0:x1]
            for tint in item['tints']:
                rgba = np.zeros(alpha.shape + (4,), np.uint8)
                rgba[..., :3] = tints[tint]
                rgba[..., 3] = (alpha * 255).astype(np.uint8)
                emit(item, fit_image(Image.fromarray(rgba, 'RGBA'), item['box'], mode), f'{screen}/{element}-{tint}.png')
        else:
            raise SystemExit(f"{item['id']}: 未知 kind {item['kind']}")
    with open(os.path.join(args.out, 'manifest.json'), 'w', encoding='utf-8') as handle:
        json.dump(manifest, handle, ensure_ascii=False, indent=1)
    for row in manifest:
        print(row['id'], row['file'], row['size2x'], 'css', row['css'])


if __name__ == '__main__':
    main()
