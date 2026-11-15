# A006: Mixamo rig + clips -> <id> v002 (skinned body + outline, rigid hard parts, retimed heavy attacks)
# run: ASSET_ID=<id> Blender -b --factory-startup --python build_anim.py   (stateless; rebuilds from v001 + v002/mixamo/*.fbx)
# Same retarget as char-hero v003 (A005): Without-Skin clips rest in T-pose, our bind is the uploaded pose -> per-frame
# armature-space bone orientation copy; Hips takes relative translation only.
import bpy, math, os
from mathutils import Vector, Matrix

ID = os.environ.get('ASSET_ID', 'enemy-puppet')
ROOT = '/Users/huangjifeng/Desktop/1/arpg-command-center'
V1 = f'{ROOT}/assets/source/{ID}/v001'; V2 = f'{ROOT}/assets/source/{ID}/v002'; MX = f'{V2}/mixamo'
PREFIX = 'mixamorig:'
RZ = Matrix.Rotation(math.pi, 4, 'Z')          # Mixamo front -Y -> Blender +Y (= glTF -Z)

CFG = {
 'enemy-puppet': dict(
    H=1.6, clips=['idle', 'walk', 'attack', 'hit', 'death'],
    lock={'attack', 'death'},                   # horizontal Hips motion -> first-frame value (AI drives position)
    trim={}, retime={}, jump_scale={},
    rebase={'hit'},                             # sword-and-shield stance (hips 54 deg off) -> delta on idle frame 1
    yaw={},
    ground={'death': dict(allow=0.03, ik=False)},
    rigid=[('hand_beyond_wrist', 0.03),         # forearm blades: everything past the wrist -> 100 % Hand
           ('box_uniform', 'key', (-0.2, 0.2), (0.2, 1.0), (1.3, 2.0))]),   # wind-up key on the back (Mixamo coords)
 'boss-1': dict(
    H=5.0, clips=['idle', 'walk', 'sweep', 'slam', 'hit', 'enrage', 'death'],
    lock={'sweep', 'slam', 'death'},
    trim={'slam': (1, 80)},                     # source turns 67 deg into a ready pose after frame ~82
    # speed 0.8 (=1.25x longer); hold n frames at the source contact frame and dip the hips (fraction of height)
    retime={'sweep': dict(speed=0.8, hold_src=43, hold=3, dip=0.02),
            'slam': dict(speed=0.8, hold_src=52, hold=5, dip=0.04)},
    jump_scale={'slam': 0.45},                  # source jumps 4.2 m; keep 45 % of the upward hips travel
    rebase={'hit'},                             # bow stance (hips 62 deg off) -> delta on idle frame 1
    yaw={'enrage': 11},                          # whole clip 11-19 deg off -> mean(hips, head) facing forward
    # human clip vs giant fists/torso: lift the hips until the lowest vertex is >= -allow; slam keeps feet planted (leg IK)
    ground={'slam': dict(allow=0.25, ik=True), 'death': dict(allow=0.05, ik=False)},
    rigid=[('hand_beyond_wrist', 0.05),         # giant fists
           ('chimney', 4.15, 0.45),             # z > 4.15 m, |x| > 0.45 m, not head-dominated -> per side uniform
           ('material_uniform', 'M_boss-1_core', 1)]),   # furnace core + 1 ring of neighbours
}[ID]
CLIPS = CFG['clips']; H = CFG['H']

bpy.ops.wm.open_mainfile(filepath=f'{V1}/{ID}.blend')
sc = bpy.context.scene
for o in [o for o in sc.objects if o.type != 'MESH']: bpy.data.objects.remove(o)
sc.name = f'A006_{ID}_v002'; sc.render.fps = 30; sc.render.fps_base = 1
for im in bpy.data.images:
    if im.filepath.startswith('//'): im.filepath = f'{V2}/' + im.filepath[2:]
body = bpy.data.objects[f'{ID}_body']; outl = bpy.data.objects[f'{ID}_outline']

def sel(objs, active):
    for o in sc.objects: o.select_set(False)
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = active

# ---- 1. rig + bind mesh from idle (With Skin) ----
before = set(bpy.data.objects)
bpy.ops.import_scene.fbx(filepath=f'{MX}/idle.fbx')
new = [o for o in bpy.data.objects if o not in before]
arm = [o for o in new if o.type == 'ARMATURE'][0]; mxm = [o for o in new if o.type == 'MESH'][0]
old_idle = arm.animation_data.action; arm.animation_data.action = None
w = mxm.matrix_world.copy(); mxm.parent = None; mxm.matrix_world = w
for m in list(mxm.modifiers): mxm.modifiers.remove(m)
arm.name = f'{ID}_rig'; arm.data.name = f'{ID}_rig'
for b in arm.data.bones:
    if b.name.startswith(PREFIX): b.name = b.name[len(PREFIX):]
for g in mxm.vertex_groups:
    if g.name.startswith(PREFIX): g.name = g.name[len(PREFIX):]
for pb in arm.pose.bones:
    pb.rotation_mode = 'QUATERNION'; pb.matrix_basis = Matrix.Identity(4)
bpy.data.actions.remove(old_idle)
bpy.context.view_layer.update()

# ---- 2. weight surgery on the Mixamo bind mesh (Mixamo world coords: front -Y, Left side = +X) ----
me = mxm.data; Wm = mxm.matrix_world; Aw = arm.matrix_world
VS = [Wm @ v.co for v in me.vertices]
gname = {g.index: g.name for g in mxm.vertex_groups}
WT = [{gname[g.group]: g.weight for g in v.groups if g.weight > 0} for v in me.vertices]
def dom(i): return max(WT[i], key=WT[i].get) if WT[i] else ''
DOM0 = [dom(i) for i in range(len(VS))]
# 2a. fingers -> hand (finger chains bent the blades / split the fists)
for wt in WT:
    for k in [k for k in wt if ('Hand' in k and not k.endswith('Hand'))]:
        side = 'Left' if k.startswith('Left') else 'Right'
        wt[side + 'Hand'] = wt.get(side + 'Hand', 0) + wt.pop(k)
report = []
def set_uniform(ix, label):
    acc = {}
    for i in ix:
        for k, x in WT[i].items():
            if k.endswith('Arm') or 'Hand' in k: continue      # rigid body parts must not follow the limbs
            acc[k] = acc.get(k, 0) + x
    s = sum(acc.values()); avg = {k: x / s for k, x in acc.items() if x / s > 0.02}
    s = sum(avg.values()); avg = {k: x / s for k, x in avg.items()}
    for i in ix: WT[i] = dict(avg)
    report.append((label, len(ix), {k: round(x, 2) for k, x in sorted(avg.items(), key=lambda kv: -kv[1])}))
for r in CFG['rigid']:
    if r[0] == 'hand_beyond_wrist':
        for side in ('Left', 'Right'):
            hb = arm.data.bones[side + 'Hand']; fb = arm.data.bones[side + 'ForeArm']
            wrist = Aw @ hb.head_local; ax = ((Aw @ fb.tail_local) - (Aw @ fb.head_local)).normalized()
            ix = [i for i in range(len(VS)) if (VS[i] - wrist).dot(ax) > r[1] and DOM0[i].startswith(side + 'Hand')]
            for i in ix: WT[i] = {side + 'Hand': 1.0}
            report.append((f'{side} beyond wrist -> {side}Hand', len(ix), {}))
    elif r[0] == 'box_uniform':
        (x0, x1), (y0, y1), (z0, z1) = r[2], r[3], r[4]
        ix = [i for i, p in enumerate(VS) if x0 < p.x < x1 and y0 < p.y < y1 and z0 < p.z < z1]
        set_uniform(ix, r[1])
    elif r[0] == 'chimney':
        for side, sgn in (('Left', 1), ('Right', -1)):
            ix = [i for i, p in enumerate(VS) if p.z > r[1] and p.x * sgn > r[2] and DOM0[i] != 'Head']
            set_uniform(ix, f'{side} chimney')
    elif r[0] == 'material_uniform':
        mi = [k for k, m in enumerate(me.materials) if m and m.name.split('.')[0] == r[1]]
        print('CORE mats', [m.name for m in me.materials], mi); mi = mi[0]
        ix = {v for p in me.polygons if p.material_index == mi for v in p.vertices}
        for _ in range(r[2]):
            ix |= {v for p in me.polygons if ix.intersection(p.vertices) for v in p.vertices}
        set_uniform(sorted(ix), r[1])
for g in list(mxm.vertex_groups): mxm.vertex_groups.remove(g)
groups = {}
for i, wt in enumerate(WT):
    s = sum(wt.values())
    for k, x in wt.items():
        if k not in groups: groups[k] = mxm.vertex_groups.new(name=k)
        groups[k].add([i], x / s, 'REPLACE')
for rr in report: print('RIGID', rr)

# ---- 3. retarget every clip ----
order = []
def walk(b):
    order.append(b)
    for c in b.children: walk(c)
walk([b for b in arm.data.bones if b.parent is None][0])
REST = {b.name: b.matrix_local.copy() for b in arm.data.bones}

def src_times(c, f0, f1):
    rt = CFG['retime'].get(c)
    if not rt: return [float(f) for f in range(f0, f1 + 1)], None
    t, out = float(f0), []
    while t <= f1 + 1e-6: out.append(t); t += rt['speed']
    k = min(range(len(out)), key=lambda j: abs(out[j] - rt['hold_src']))
    out[k] = float(rt['hold_src'])
    out = out[:k + 1] + [out[k]] * rt['hold'] + out[k + 1:]
    return out, k

def dip_curve(n, k, rt):
    d = [0.0] * n
    if k is None: return d
    a = rt['dip'] * H; e = k + rt['hold']
    for j in range(n):
        if k - 2 <= j < k: x = (j - (k - 2)) / 2
        elif k <= j <= e: x = 1.0
        elif e < j <= e + 6: x = 1 - (j - e) / 6
        else: continue
        d[j] = a * (0.5 - 0.5 * math.cos(math.pi * x))
    return d

acts = {}; meta = {}; IDLE0 = {}
for c in CLIPS:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=f'{MX}/{c}.fbx')
    new = [o for o in bpy.data.objects if o not in before]
    ca = [o for o in new if o.type == 'ARMATURE'][0]; cact = ca.animation_data.action
    f0, f1 = CFG['trim'].get(c, tuple(int(x) for x in cact.frame_range))
    crest_hips = ca.data.bones[PREFIX + 'Hips'].matrix_local.translation.copy()
    times, kc = src_times(c, f0, f1)
    dips = dip_curve(len(times), kc, CFG['retime'].get(c, {}))
    js = CFG['jump_scale'].get(c)
    act = bpy.data.actions.new(c); act.use_fake_user = True
    arm.animation_data_create(); arm.animation_data.action = act
    hips0 = None; prevq = {}; base0 = {}
    Ryaw = Matrix.Rotation(math.radians(CFG['yaw'].get(c, 0)), 4, 'Y')      # armature space: Y is up; +deg lowers final Blender yaw
    for j, ts in enumerate(times):
        sc.frame_set(int(ts), subframe=ts - int(ts))
        M = {}
        for b in order:
            cm = ca.pose.bones[PREFIX + b.name].matrix
            R = cm.to_quaternion().to_matrix().to_4x4()
            if b.parent is None:
                t = cm.translation - crest_hips + REST[b.name].translation
                if hips0 is None: hips0 = t.copy()
                if c in CFG['lock']: t.x, t.z = hips0.x, hips0.z          # armature space: Y is up
                if js is not None and t.y > REST[b.name].translation.y:
                    t.y = REST[b.name].translation.y + (t.y - REST[b.name].translation.y) * js
                t.y -= dips[j]
                M[b.name] = Ryaw @ Matrix.Translation(t) @ R
                basis = REST[b.name].inverted() @ M[b.name]
            else:
                rel = REST[b.parent.name].inverted() @ REST[b.name]
                head = (M[b.parent.name] @ rel).translation
                M[b.name] = Matrix.Translation(head) @ R
                basis = rel.inverted() @ M[b.parent.name].inverted() @ M[b.name]
            pb = arm.pose.bones[b.name]
            loc, rot, _ = basis.decompose()
            if c == 'idle' and j == 0: IDLE0[b.name] = (loc.copy(), rot.copy())
            if c in CFG['rebase']:
                if j == 0: base0[b.name] = (loc.copy(), rot.copy())
                rot = IDLE0[b.name][1] @ base0[b.name][1].inverted() @ rot
                loc = IDLE0[b.name][0] + (loc - base0[b.name][0])
            if b.name in prevq: rot.make_compatible(prevq[b.name])
            prevq[b.name] = rot.copy()
            pb.rotation_quaternion = rot
            pb.keyframe_insert('rotation_quaternion', frame=j + 1, group=b.name)
            if b.parent is None:
                pb.location = loc; pb.keyframe_insert('location', frame=j + 1, group=b.name)
    arm.animation_data.action = None
    acts[c] = act
    meta[c] = dict(src=(f0, f1), out_frames=len(times), contact_out=(kc + 1) if kc is not None else None)
    for o in new:
        data = o.data; bpy.data.objects.remove(o)
        if data is not None and data.users == 0:
            (bpy.data.armatures if isinstance(data, bpy.types.Armature) else bpy.data.meshes).remove(data)
    if cact.users == 0: bpy.data.actions.remove(cact)
    print('CLIP', c, meta[c])
for pb in arm.pose.bones: pb.matrix_basis = Matrix.Identity(4)

# ---- 4. orientation + bake transforms ----
arm.matrix_world = RZ @ arm.matrix_world; mxm.matrix_world = RZ @ mxm.matrix_world
sel([arm, mxm], arm); bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# ---- 5. skin body from Mixamo mesh (topology), outline from body (topology) ----
def transfer(dst, src):
    for g in list(dst.vertex_groups): dst.vertex_groups.remove(g)
    m = dst.modifiers.new('DT_weights', 'DATA_TRANSFER'); m.object = src
    m.use_vert_data = True; m.data_types_verts = {'VGROUP_WEIGHTS'}; m.vert_mapping = 'TOPOLOGY'
    m.layers_vgroup_select_src = 'ALL'; m.layers_vgroup_select_dst = 'NAME'
    sel([dst], dst); bpy.ops.object.datalayout_transfer(modifier=m.name); bpy.ops.object.modifier_apply(modifier=m.name)
assert len(mxm.data.vertices) == len(body.data.vertices) == len(outl.data.vertices)
d = max((mxm.data.vertices[i].co - body.data.vertices[i].co).length for i in range(len(body.data.vertices)))
print('VERTEX MATCH max dist', d); assert d < 1e-4
transfer(body, mxm); transfer(outl, body)
for o in (body, outl):
    o.parent = arm; o.matrix_parent_inverse = Matrix.Identity(4); o.matrix_world = Matrix.Identity(4)
    am = o.modifiers.new('Armature', 'ARMATURE'); am.object = arm
    print('SKIN', o.name, 'groups', len(o.vertex_groups), 'unweighted', sum(1 for v in o.data.vertices if not v.groups))
mx_mats = {m for m in mxm.data.materials if m}
mesh = mxm.data; bpy.data.objects.remove(mxm); bpy.data.meshes.remove(mesh)
for m in mx_mats:
    if m.users == 0: bpy.data.materials.remove(m)

# ---- 6a. ground fix: lift hips where the skinned body goes below the ground; optional leg IK keeps the feet planted ----
def lowest():
    dg = bpy.context.evaluated_depsgraph_get(); e = body.evaluated_get(dg); m = e.to_mesh()
    z = min((e.matrix_world @ v.co).z for v in m.vertices); e.to_mesh_clear(); return z
ad = arm.animation_data
for c, g in CFG['ground'].items():
    act = acts[c]; ad.action = act; n = meta[c]['out_frames']
    low = []
    feet = {s: [] for s in ('LeftFoot', 'RightFoot')}
    for f in range(1, n + 1):
        sc.frame_set(f); low.append(lowest())
        for s in feet: feet[s].append((arm.matrix_world @ arm.pose.bones[s].head).copy())
    need = [max(0.0, -z - g['allow']) for z in low]
    Wn = 4
    mx_ = [max(need[max(0, i - Wn):i + Wn + 1]) for i in range(n)]
    lift = [sum(mx_[max(0, i - 2):i + 3]) / len(mx_[max(0, i - 2):i + 3]) for i in range(n)]
    lift = [max(a, b) for a, b in zip(lift, need)]
    hb = arm.pose.bones['Hips']; up = (arm.data.bones['Hips'].matrix_local.to_3x3().inverted() @ Vector((0, 0, 1)))
    for f in range(1, n + 1):
        sc.frame_set(f); hb.location = hb.location + up * lift[f - 1]
        hb.keyframe_insert('location', frame=f, group='Hips')
    if g['ik']:
        emp = {}
        for s, pts in feet.items():
            e = bpy.data.objects.new('ik_' + s, None); sc.collection.objects.link(e); emp[s] = e
            for f, p in enumerate(pts, 1):
                e.location = p; e.keyframe_insert('location', frame=f)
            leg = arm.pose.bones[s.replace('Foot', 'Leg')]
            k = leg.constraints.new('IK'); k.target = e; k.chain_count = 2; k.use_stretch = False
        sel([arm], arm); bpy.ops.object.mode_set(mode='POSE')
        bpy.ops.nla.bake(frame_start=1, frame_end=n, only_selected=False, visual_keying=True, clear_constraints=True,
                         use_current_action=True, bake_types={'POSE'})
        bpy.ops.object.mode_set(mode='OBJECT')
        for e in emp.values(): bpy.data.objects.remove(e)
        acts[c] = ad.action
    low2 = []
    for f in range(1, n + 1): sc.frame_set(f); low2.append(lowest())
    print('GROUND', c, 'lowest before', round(min(low), 3), 'after', round(min(low2), 3), 'max lift', round(max(lift), 3), 'ik', g['ik'])
    ad.action = None

# ---- 6. NLA tracks ----
ad = arm.animation_data or arm.animation_data_create(); ad.action = None
for t in list(ad.nla_tracks): ad.nla_tracks.remove(t)
for c in CLIPS:
    t = ad.nla_tracks.new(); t.name = c
    s = t.strips.new(c, 1, acts[c])
    try: s.action_slot = acts[c].slots[0]
    except Exception as e: print('slot', c, e)

bpy.data.orphans_purge(do_recursive=True)
for m in bpy.data.materials:
    if m.node_tree:
        for n in m.node_tree.nodes:
            if n.type == 'BSDF_PRINCIPLED':
                n.inputs['Specular IOR Level'].default_value = 0.5
                n.inputs['Emission Strength'].default_value = min(1.0, n.inputs['Emission Strength'].default_value)
arm['a006_meta'] = repr(meta)
sc.frame_start = 1; sc.frame_end = max(m['out_frames'] for m in meta.values())
print('MATERIALS', [m.name for m in bpy.data.materials], 'IMAGES', [i.name for i in bpy.data.images])
bpy.ops.wm.save_as_mainfile(filepath=f'{V2}/{ID}.blend', relative_remap=True)
print('SAVED', f'{V2}/{ID}.blend')
