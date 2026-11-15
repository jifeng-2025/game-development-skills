#!/usr/bin/env python3
"""切图体检（只读）。  python audit_slices.py <slices目录> [--glob '*/*__v*.png']

旗标（是提醒，最后要看图确认）：
  HALO    透明图的半透明像素占比过高且铺到画布边：「透明」里烤进了光晕，用 cutout.py chroma 抠
  TOUCH   内容贴到画布边：可能被裁切
  DIM     黑底图主体亮度低：build_slices 会归一化，通常不用重生
  HOLLOW? 黑底图内部比边缘暗：实心元素要在 spec 里加 fill；空心框、描边类属正常
纯绿底图按 T 类判断（类别列显示 T绿底）。
"""
import argparse
import glob
import os

import numpy as np
from PIL import Image
from scipy import ndimage


def audit(path):
    image = Image.open(path)
    rgba = np.asarray(image.convert('RGBA')).astype(np.float32)
    alpha, lum = rgba[..., 3], rgba[..., :3].mean(-1)
    flags = []
    corners = rgba[[0, 0, -1, -1], [0, -1, 0, -1]]
    green = alpha.min() > 250 and corners[:, 1].min() > 180 and corners[:, [0, 2]].max() < 90
    if green:                                        # 绿底 T 图：build_slices 会抠掉，按内容判断
        mask = ~((rgba[..., 1] > 180) & (rgba[..., 0] < 90) & (rgba[..., 2] < 90))
        kind, stat = 'T绿底', f'内容占比 {mask.mean():.2f}'
    elif (alpha < 250).mean() > 0.05:
        mask = alpha > 8
        kind, stat = 'T', f'半透明 {((alpha > 8) & (alpha < 200)).sum() / max(mask.sum(), 1):.2f}'
        if ((alpha > 8) & (alpha < 200)).sum() / max(mask.sum(), 1) > 0.3 and mask[0].any() and mask[-1].any():
            flags.append('HALO')
    else:
        mask = lum > 20
        lit = lum[mask] if mask.any() else np.zeros(1)
        p99 = np.percentile(lit, 99)
        kind, stat = 'K', f'最亮 {int(lum.max())} p99 {int(p99)}'
        if p99 < 180:
            flags.append('DIM')
        solid = ndimage.binary_fill_holes(ndimage.binary_closing(mask, iterations=4))
        core = ndimage.binary_erosion(solid, iterations=max(4, min(image.size) // 80))
        if core.sum() > solid.sum() * 0.05 and lum[core].mean() < 0.45 * p99:
            flags.append('HOLLOW?')
    ys, xs = np.where(mask)
    edge = ''.join(c for c, hit in zip('上下左右', (mask[0].any(), mask[-1].any(), mask[:, 0].any(), mask[:, -1].any())) if hit)
    if edge:
        flags.append('TOUCH')
    box = f'{xs.min()},{ys.min()}-{xs.max()},{ys.max()}' if xs.size else '空'
    return kind, f'{image.size[0]}×{image.size[1]}', box, stat, edge or '-', ' '.join(flags) or 'ok'


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('root')
    parser.add_argument('--glob', default='*/*__v*.png')
    args = parser.parse_args()
    print('文件 | 类 | 尺寸 | 内容框 | 亮度/透明 | 贴边 | 旗标')
    for path in sorted(glob.glob(os.path.join(args.root, args.glob))):
        print(os.path.relpath(path, args.root), '|', ' | '.join(audit(path)))


if __name__ == '__main__':
    main()
