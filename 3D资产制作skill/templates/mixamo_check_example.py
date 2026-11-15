# A005 self-check: per-clip oblique-55 renders + outline/body separation + sword penetration + strike frames
# run: Blender -b <v003>/char-hero.blend --python check_v003.py
import bpy, math, os, json
from mathutils import Vector
from mathutils.bvhtree import BVHTree
ROOT = '/Users/huangjifeng/Desktop/1/arpg-command-center'
EV = f'{ROOT}/assets/source/char-hero/v003/evidence/clips'; os.makedirs(EV, exist_ok=True)
CLIPS = ['idle', 'run', 'dash', 'atk1', 'atk2', 'atk3', 'q', 'hit', 'death']
sc = bpy.context.scene; arm = bpy.data.objects['char-hero_rig']
body = bpy.data.objects['char-hero_body']; outl = bpy.data.objects['char-hero_outline']
sw = bpy.data.objects['char-hero_sword']
for n in ('char-hero_swordhip', 'char-hero_swordhip_outline'):
    bpy.data.objects[n].hide_render = True; bpy.data.objects[n].hide_set(True)
cam = bpy.data.objects.get('chk_cam') or bpy.data.objects.new('chk_cam', bpy.data.cameras.new('chk_cam'))
if cam.name not in sc.collection.objects: sc.collection.objects.link(cam)
cam.data.type = 'ORTHO'; cam.data.ortho_scale = 2.8
el = math.radians(55); dist = 10
cam.location = (0, dist * math.cos(el), 0.8 + dist * math.sin(el)); cam.rotation_euler = (math.radians(90) - el, 0, math.pi)
sc.camera = cam
sc.render.engine = 'BLENDER_WORKBENCH'; sc.display.shading.light = 'FLAT'; sc.display.shading.color_type = 'TEXTURE'
sc.render.resolution_x = sc.render.resolution_y = 384; sc.render.film_transparent = False
sc.world = sc.world or bpy.data.worlds.new('w')

def solo(c):
    for t in arm.animation_data.nla_tracks: t.mute = (t.name != c)
def verts(o):
    dg = bpy.context.evaluated_depsgraph_get(); e = o.evaluated_get(dg); m = e.to_mesh()
    r = [e.matrix_world @ v.co for v in m.vertices]; e.to_mesh_clear(); return r
def body_bvh():
    dg = bpy.context.evaluated_depsgraph_get(); e = body.evaluated_get(dg); m = e.to_mesh()
    vs = [e.matrix_world @ v.co for v in m.vertices]; ps = [tuple(p.vertices) for p in m.polygons]
    e.to_mesh_clear(); return BVHTree.FromPolygons(vs, ps)

report = {}
for c in CLIPS:
    solo(c); act = bpy.data.actions[c]; n = int(act.frame_range[1])
    seps = []; pen = 0; tipspd = []; prev_tip = None
    for f in range(1, n + 1):
        sc.frame_set(f)
        b = verts(body); o = verts(outl)
        d = [(o[i] - b[i]).length for i in range(len(b))]; seps.append((min(d), max(d)))
        sv = [sw.matrix_world @ v.co for v in sw.data.vertices]
        tip = max(sv, key=lambda p: (p - (sw.matrix_world.translation)).length)
        if prev_tip is not None: tipspd.append(((tip - prev_tip).length * 30, f))
        prev_tip = tip
        tree = body_bvh(); k = 0
        for p in sv:
            loc, nor, idx, dd = tree.find_nearest(p)
            if loc is not None and dd < 0.08 and (p - loc).dot(nor) < 0: k += 1
        pen = max(pen, k)
    peak = max(tipspd) if tipspd else (0, 0)
    report[c] = {'frames': n, 'seconds': round(n / 30, 3),
                 'outline_gap_min_m': round(min(s[0] for s in seps), 4), 'outline_gap_max_m': round(max(s[1] for s in seps), 4),
                 'sword_verts_inside_body_max': pen, 'sword_tip_peak_speed_mps': round(peak[0], 2), 'peak_frame': peak[1],
                 'peak_time_s': round((peak[1] - 1) / 30, 3)}
    print('CHK', c, report[c])
    for i, f in enumerate([1, max(1, round(n * 0.35)), max(1, round(n * 0.65)), n]):
        sc.frame_set(f); sc.render.filepath = f'{EV}/{c}_{i}_f{f:02d}.png'; bpy.ops.render.render(write_still=True)
json.dump(report, open(f'{EV}/../clip_check.json', 'w'), indent=1, ensure_ascii=False)
