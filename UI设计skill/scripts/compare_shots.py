#!/usr/bin/env python3
"""把两组同名截图并排拼成对比图（左=参考稿，右=实机）。看一张图就能比完一屏。

  python compare_shots.py --ref <参考截图目录> --live <实机截图目录> --out <目录> [--width 960]
"""
import argparse
import glob
import os

from PIL import Image

parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
parser.add_argument('--ref', required=True)
parser.add_argument('--live', required=True)
parser.add_argument('--out', required=True)
parser.add_argument('--width', type=int, default=960)
args = parser.parse_args()
os.makedirs(args.out, exist_ok=True)
for ref in sorted(glob.glob(os.path.join(args.ref, '*.png'))):
    name = os.path.basename(ref)
    live = os.path.join(args.live, name)
    if not os.path.exists(live):
        print(name, '实机缺这张')
        continue
    a, b = (Image.open(path).convert('RGB') for path in (ref, live))
    a = a.resize((args.width, round(a.height * args.width / a.width)), Image.LANCZOS)
    b = b.resize((args.width, round(b.height * args.width / b.width)), Image.LANCZOS)
    sheet = Image.new('RGB', (args.width * 2 + 8, max(a.height, b.height)), (255, 0, 255))
    sheet.paste(a, (0, 0))
    sheet.paste(b, (args.width + 8, 0))
    sheet.save(os.path.join(args.out, name))
    print(name, 'ok')
