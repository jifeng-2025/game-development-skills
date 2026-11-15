"""生成贴图去「大理石杂纹」 → 平色块 + 少量笔触，整体提亮一档。
flat = 大半径中值滤波 + 5 档明度量化；out = flat*(1-keep) + 原图*keep；再提亮。
用法: python3 flatten_tile_soft.py src dst [--median 15] [--levels 5] [--keep 0.25] [--bright 1.2]"""
import argparse
from PIL import Image, ImageFilter, ImageEnhance
ap=argparse.ArgumentParser(); ap.add_argument('src'); ap.add_argument('dst')
ap.add_argument('--median',type=int,default=15); ap.add_argument('--levels',type=int,default=5)
ap.add_argument('--keep',type=float,default=0.25); ap.add_argument('--bright',type=float,default=1.2)
a=ap.parse_args()
src=Image.open(a.src).convert('RGB')
small=src.resize((src.width//2,src.height//2),Image.LANCZOS).filter(ImageFilter.MedianFilter(a.median)).filter(ImageFilter.MedianFilter(a.median))
flat=small.resize(src.size,Image.LANCZOS)
flat=flat.quantize(colors=a.levels,method=Image.Quantize.MEDIANCUT,dither=Image.Dither.NONE).convert('RGB')
flat=flat.filter(ImageFilter.ModeFilter(9))
out=Image.blend(flat,src,a.keep)
out=ImageEnhance.Brightness(out).enhance(a.bright)
out.save(a.dst,quality=92); print('saved',a.dst)
