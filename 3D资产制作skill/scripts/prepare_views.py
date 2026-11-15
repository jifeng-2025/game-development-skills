"""把概念图转成混元多视图输入（JPG），原图不动。
用法: python3 prepare_views.py <out_dir> --front a.png --right b.png --back c.png [--left d.png]
right = 角色朝画面右的纯侧面图（看到角色左半身）。3/4 视角图不要传（接口不支持）。"""
import argparse, os
from PIL import Image
ap = argparse.ArgumentParser(); ap.add_argument('out')
for v in ('front', 'right', 'back', 'left'):
    ap.add_argument('--' + v)
a = ap.parse_args(); os.makedirs(a.out, exist_ok=True)
for v in ('front', 'right', 'back', 'left'):
    p = getattr(a, v)
    if p:
        im = Image.open(p).convert('RGB')
        if max(im.size) > 5000:
            im.thumbnail((5000, 5000))
        im.save(os.path.join(a.out, v + '.jpg'), quality=90)
        print(v, im.size, os.path.getsize(os.path.join(a.out, v + '.jpg')) // 1024, 'KB')
assert getattr(a, 'front'), '必须有 --front'
