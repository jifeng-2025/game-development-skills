"""3D 生成贴图色块化（去写实噪点，只留固有色）：缩放 → 中值滤波去写实噪点 → (可选)红色改暗金 → 色阶量化。
用法: python3 flatten_texture.py in.png out.png --size 1024 [--median 5] [--palette '#121214,#26262A,...'] [--red2gold --gold '#8C6A2B']
不给 --palette 时用 --colors 自动量化（不推荐：会把白色和锈色吞成同一档）。"""
import argparse, colorsys
from PIL import Image, ImageFilter
ap=argparse.ArgumentParser(); ap.add_argument('src'); ap.add_argument('dst')
ap.add_argument('--size',type=int,default=1024); ap.add_argument('--colors',type=int,default=10)
ap.add_argument('--median',type=int,default=5); ap.add_argument('--red2gold',action='store_true',help='把高饱和红色像素替换为 --gold 颜色（禁红色板用）')
ap.add_argument('--gold',default='#8C6A2B')
ap.add_argument('--palette',default='',help='comma separated hex list; if set, map to this fixed palette instead of median-cut')
a=ap.parse_args()
im=Image.open(a.src).convert('RGB').resize((a.size,a.size),Image.LANCZOS)
im=im.filter(ImageFilter.MedianFilter(a.median)).filter(ImageFilter.MedianFilter(3))
if a.red2gold:
    px=im.load(); gold=tuple(int(a.gold.lstrip('#')[i:i+2],16) for i in (0,2,4)); n=0
    for y in range(im.height):
        for x in range(im.width):
            r,g,b=px[x,y]; h,s,v=colorsys.rgb_to_hsv(r/255,g/255,b/255)
            if (h<0.03 or h>0.95) and s>0.55 and v>0.3: px[x,y]=gold; n+=1
    print('red->gold px',n)
if a.palette:
    cols=[tuple(int(h.strip().lstrip('#')[i:i+2],16) for i in (0,2,4)) for h in a.palette.split(',')]
    flat=[c for col in cols for c in col]; flat+= [0]*(768-len(flat))
    pal=Image.new('P',(1,1)); pal.putpalette(flat)
    q=im.quantize(palette=pal,dither=Image.Dither.NONE).convert('RGB')
else:
    q=im.quantize(colors=a.colors,method=Image.Quantize.MEDIANCUT,dither=Image.Dither.NONE).convert('RGB')
q.save(a.dst); print('saved',a.dst,q.size)
