# A006 self-check + timing markers: run  ASSET_ID=<id> Blender -b <v002>/<id>.blend --python check_anim.py
# - outline/body vertex gap per frame (shell must stay within its thickness), lowest vertex (ground)
# - timing markers per clip (written to evidence/clip_check.json, consumed by the manifest):
#     windupStart  = attacking hand(s) rise more than 6 % of body height above the clip's first frame
#     strike       = peak speed of the attacking hand(s)            (attack / sweep)
#     contact      = first frame after the peak where the hands are below 8 % of height (slam), or the held contact frame
#     groundHit    = first frame the hips come within 5 cm (puppet) / 15 cm (boss) of their minimum (death)
#     roarStart    = peak hand speed (enrage)
# - oblique 55 deg renders: 4 frames per clip + marker frames
import bpy, math, os, json
ID = os.environ['ASSET_ID']
ROOT = '/Users/huangjifeng/Desktop/1/arpg-command-center'
EV = f'{ROOT}/assets/source/{ID}/v002/evidence'; os.makedirs(f'{EV}/clips', exist_ok=True)
sc = bpy.context.scene; arm = bpy.data.objects[f'{ID}_rig']
body = bpy.data.objects[f'{ID}_body']; outl = bpy.data.objects[f'{ID}_outline']
H = {'enemy-puppet': 1.6, 'boss-1': 5.0}[ID]
meta = eval(arm['a006_meta'])
MARK = {'enemy-puppet': {'attack': ('strike', ['RightHand'])},
        'boss-1': {'sweep': ('strike', ['LeftHand']), 'slam': ('contact', ['LeftHand', 'RightHand']),
                   'enrage': ('roar', ['LeftHand', 'RightHand'])}}[ID]
LOOP = {'idle', 'walk'}
THK = {'enemy-puppet': 0.015, 'boss-1': 0.04}[ID]

def solo(c):
    for t in arm.animation_data.nla_tracks: t.mute = (t.name != c)
def ev_verts(o):
    dg = bpy.context.evaluated_depsgraph_get(); e = o.evaluated_get(dg); m = e.to_mesh()
    r = [e.matrix_world @ v.co for v in m.vertices]; e.to_mesh_clear(); return r
def bone(n): return arm.matrix_world @ arm.pose.bones[n].head

cam = bpy.data.objects.new('chk', bpy.data.cameras.new('chk')); sc.collection.objects.link(cam); sc.camera = cam
cam.data.type = 'ORTHO'; cam.data.ortho_scale = H * 1.9
el = math.radians(55); d = H * 8
cam.location = (0, d * math.cos(el), H * 0.45 + d * math.sin(el)); cam.rotation_euler = (math.radians(90) - el, 0, math.pi)
cam.data.clip_end = d * 3
sc.render.engine = 'BLENDER_WORKBENCH'; sc.display.shading.light = 'FLAT'; sc.display.shading.color_type = 'TEXTURE'
sc.render.resolution_x = sc.render.resolution_y = 320

rep = {}
for c in meta:
    solo(c); n = meta[c]['out_frames']
    gaps = []; low = []; hands = []; hips = []
    for f in range(1, n + 1):
        sc.frame_set(f)
        b = ev_verts(body); o = ev_verts(outl)
        dd = [(o[i] - b[i]).length for i in range(len(b))]; gaps.append((min(dd), max(dd)))
        low.append(min(p.z for p in b))
        hips.append(bone('Hips').z)
        if c in MARK: hands.append([bone(h).copy() for h in MARK[c][1]])
    r = {'frames': n, 'seconds': round(n / 30, 3), 'loop': c in LOOP,
         'outline_gap_min_m': round(min(g[0] for g in gaps), 4), 'outline_gap_max_m': round(max(g[1] for g in gaps), 4),
         'lowest_vertex_min_m': round(min(low), 3), 'src_frames': meta[c]['src']}
    T = lambda f: round((f - 1) / 30, 3)
    marks = {}
    if c in MARK:
        kind = MARK[c][0]
        z = [sum(p.z for p in hs) / len(hs) for hs in hands]
        spd = [0] + [max((hands[f][k] - hands[f - 1][k]).length for k in range(len(hands[f]))) * 30 for f in range(1, n)]
        pk = max(range(n), key=lambda f: spd[f])
        if kind != 'roar':
            ws = next((f for f in range(n) if z[f] > z[0] + 0.06 * H), 0)
            marks['windupStart'] = T(ws + 1)
        if kind == 'strike': marks['strike'] = T(pk + 1)
        elif kind == 'contact':
            ct = meta[c]['contact_out']
            if ct is None: ct = next(f for f in range(pk, n) if z[f] < 0.08 * H) + 1
            marks['contact'] = T(ct)
        else: marks['roarStart'] = T(pk + 1)
        r['peak_hand_speed_mps'] = round(spd[pk], 1)
    if c == 'death':
        mn = min(hips); gh = next(f for f in range(n) if hips[f] < mn + (0.05 if H < 3 else 0.15))
        marks['groundHit'] = T(gh + 1)
    if meta[c]['contact_out'] and 'contact' not in marks:
        marks['impactHold'] = T(meta[c]['contact_out'])
    r['markers_s'] = marks
    rep[c] = r; print('CHK', c, r)
    frames = sorted({1, max(1, round(n * 0.33)), max(1, round(n * 0.66)), n} | {round(v * 30) + 1 for v in marks.values()})
    for f in frames:
        sc.frame_set(f); sc.render.filepath = f'{EV}/clips/{c}_f{f:03d}.png'; bpy.ops.render.render(write_still=True)
json.dump(rep, open(f'{EV}/clip_check.json', 'w'), indent=1, ensure_ascii=False)
