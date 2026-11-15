"""按色板精确换色，UV 掩码内的同色像素改成另一种颜色（例：衣服提白但脸和手保持肤色）。
用法: python3 recolor_palette_masked.py src.png dst.png mask_uv_tris.json \
        --map '#8A8478=#E4DED0,#B3AC9E=#F0EBDF' --masked '#B88E6A'
mask_uv_tris.json：Blender 里导出的 [[ [u,v],[u,v],[u,v] ], ...]（见 SKILL.md 步骤 B6）。
前提：贴图已用 flatten_texture.py --palette 量化，颜色是精确值。"""
import json,sys,argparse
from PIL import Image, ImageDraw
ap=argparse.ArgumentParser(); ap.add_argument('src'); ap.add_argument('dst'); ap.add_argument('uvj')
ap.add_argument('--map',required=True); ap.add_argument('--masked',required=True)
A=ap.parse_args(); src,dst,uvj=A.src,A.dst,A.uvj
hx=lambda h:tuple(int(h.strip().lstrip('#')[i:i+2],16) for i in (0,2,4))
a=Image.open(src).convert('RGB'); W,H=a.size; px=a.load()
mask=Image.new('L',(W,H),0); d=ImageDraw.Draw(mask)
for t in json.load(open(uvj)): d.polygon([(u%1*W,(1-v%1)*H) for u,v in t],fill=255)
mp=mask.load()
ROBE={hx(a):hx(b) for a,b in (x.split('=') for x in A.map.split(','))}
SKIN=hx(A.masked)
for y in range(H):
    for x in range(W):
        c=px[x,y]
        if c in ROBE: px[x,y]=SKIN if mp[x,y] else ROBE[c]
a.save(dst); print('ok')
