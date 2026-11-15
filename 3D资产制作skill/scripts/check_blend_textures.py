"""独立 Blender 进程打开每个 .blend，确认场景和贴图都能找到（防止相对路径丢图）。
用法: python3 check_blend_textures.py a.blend [b.blend ...]   （环境变量 BLENDER 可改路径）"""
import os, subprocess, sys
B = os.environ.get('BLENDER', '/Applications/Blender.app/Contents/MacOS/Blender')
expr = ("import bpy,os;print('CHK',[s.name for s in bpy.data.scenes],"
        "[(i.name,os.path.exists(bpy.path.abspath(i.filepath)),tuple(i.size)) for i in bpy.data.images if i.name.startswith('T_')])")
bad = 0
for f in sys.argv[1:]:
    out = subprocess.run([B, '-b', f, '--python-expr', expr], capture_output=True, text=True).stdout
    line = next((l for l in out.splitlines() if l.startswith('CHK')), 'CHK <读取失败>')
    print(os.path.basename(f), line)
    bad += ('False' in line) or ('读取失败' in line)
sys.exit(1 if bad else 0)
