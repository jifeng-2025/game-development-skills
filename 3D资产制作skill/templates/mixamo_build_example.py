# A005 step3: Mixamo rig + 9 clips -> char-hero v003 (skinned body + outline, sword on right hand)
# run: Blender -b --factory-startup --python build_v003.py   (stateless; rebuilds from v002 + mixamo/*.fbx)
import bpy, math, os
from mathutils import Vector, Matrix
from bpy_extras import anim_utils

ROOT = '/Users/huangjifeng/Desktop/1/arpg-command-center'
V2 = f'{ROOT}/assets/source/char-hero/v002'
V3 = f'{ROOT}/assets/source/char-hero/v003'
MX = f'{V3}/mixamo'
CLIPS = ['idle', 'run', 'dash', 'atk1', 'atk2', 'atk3', 'q', 'hit', 'death']
LOCK_XZ = {'dash', 'atk1', 'atk2', 'atk3', 'death'}   # horizontal hips motion -> constant (code drives displacement)
TRIM = {'dash': (14, 37)}                             # keep roll core only; first 13 frames are a backward wind-up
PREFIX = 'mixamorig:'
RZ = Matrix.Rotation(math.pi, 4, 'Z')                 # Mixamo front -Y -> Blender +Y (= glTF -Z)

bpy.ops.wm.open_mainfile(filepath=f'{V2}/char-hero.blend')
sc = bpy.context.scene
for n in ('cutter_hat_v2',):
    bpy.data.objects.remove(bpy.data.objects[n])
sc.name = 'A005_char-hero_v003'; sc.render.fps = 30; sc.render.fps_base = 1
for im in bpy.data.images:
    if im.filepath.startswith('//'):
        im.filepath = f'{V3}/' + im.filepath[2:]
body = bpy.data.objects['char-hero_body']; outl = bpy.data.objects['char-hero_outline']
sw = bpy.data.objects['char-hero_sword']; swo = bpy.data.objects['char-hero_sword_outline']

def channelbag(act):
    return anim_utils.action_get_channelbag_for_slot(act, act.slots[0])

def sel(objs, active):
    for o in sc.objects: o.select_set(False)
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = active

# ---- 1. rig + bind mesh from idle (With Skin, A-pose rest) ----
before = set(bpy.data.objects)
bpy.ops.import_scene.fbx(filepath=f'{MX}/idle.fbx')
new = [o for o in bpy.data.objects if o not in before]
arm = [o for o in new if o.type == 'ARMATURE'][0]; mxm = [o for o in new if o.type == 'MESH'][0]
old_idle = arm.animation_data.action; arm.animation_data.action = None
w = mxm.matrix_world.copy(); mxm.parent = None; mxm.matrix_world = w
for m in list(mxm.modifiers): mxm.modifiers.remove(m)
arm.name = 'char-hero_rig'; arm.data.name = 'char-hero_rig'
for b in arm.data.bones:
    if b.name.startswith(PREFIX): b.name = b.name[len(PREFIX):]
for pb in arm.pose.bones:
    pb.rotation_mode = 'QUATERNION'; pb.matrix_basis = Matrix.Identity(4)
bpy.data.actions.remove(old_idle)

# ---- 2. retarget every clip by armature-space bone orientation (clip rests are T-pose, ours is A-pose) ----
order = []
def walk(b):
    order.append(b)
    for c in b.children: walk(c)
walk([b for b in arm.data.bones if b.parent is None][0])
REST = {b.name: b.matrix_local.copy() for b in arm.data.bones}
acts = {}
for c in CLIPS:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=f'{MX}/{c}.fbx')
    new = [o for o in bpy.data.objects if o not in before]
    ca = [o for o in new if o.type == 'ARMATURE'][0]
    cact = ca.animation_data.action
    f0, f1 = TRIM.get(c, tuple(int(x) for x in cact.frame_range))
    crest_hips = ca.data.bones[PREFIX + 'Hips'].matrix_local.translation.copy()
    act = bpy.data.actions.new(c); act.use_fake_user = True
    arm.animation_data_create(); arm.animation_data.action = act
    hips0 = None
    for f in range(f0, f1 + 1):
        sc.frame_set(f)
        M = {}
        for b in order:
            cm = ca.pose.bones[PREFIX + b.name].matrix
            R = cm.to_quaternion().to_matrix().to_4x4()
            if b.parent is None:
                t = cm.translation - crest_hips + REST[b.name].translation
                if hips0 is None: hips0 = t.copy()
                if c in LOCK_XZ: t.x, t.z = hips0.x, hips0.z      # armature space is Y-up here
                M[b.name] = Matrix.Translation(t) @ R
                basis = REST[b.name].inverted() @ M[b.name]
            else:
                rel = REST[b.parent.name].inverted() @ REST[b.name]
                head = (M[b.parent.name] @ rel).translation
                M[b.name] = Matrix.Translation(head) @ R
                basis = rel.inverted() @ M[b.parent.name].inverted() @ M[b.name]
            pb = arm.pose.bones[b.name]
            loc, rot, _ = basis.decompose()
            prev = pb.rotation_quaternion.copy()
            if f > f0: rot.make_compatible(prev)
            pb.location = loc if b.parent is None else Vector()
            pb.rotation_quaternion = rot
            pb.keyframe_insert('rotation_quaternion', frame=f - f0 + 1, group=b.name)
            if b.parent is None: pb.keyframe_insert('location', frame=f - f0 + 1, group=b.name)
    arm.animation_data.action = None
    acts[c] = act
    for o in new:
        data = o.data; bpy.data.objects.remove(o)
        if data is not None and data.users == 0:
            (bpy.data.armatures if isinstance(data, bpy.types.Armature) else bpy.data.meshes).remove(data)
    if cact.users == 0: bpy.data.actions.remove(cact)
    print('CLIP', c, 'src frames', (f0, f1), '-> 1..', f1 - f0 + 1)
for pb in arm.pose.bones: pb.matrix_basis = Matrix.Identity(4)

# ---- 3. orientation: Mixamo front -Y -> +Y; bake object transforms (rig + bind mesh) ----
arm.matrix_world = RZ @ arm.matrix_world; mxm.matrix_world = RZ @ mxm.matrix_world
sel([arm, mxm], arm); bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
hb = arm.data.bones['Hips'].matrix_local
print('HIPS local axes  X', hb.col[0].xyz.to_tuple(2), 'Y', hb.col[1].xyz.to_tuple(2), 'Z', hb.col[2].xyz.to_tuple(2))

# ---- 4. skin body (Data Transfer by topology from Mixamo mesh), outline from body ----
def transfer(dst, src):
    for g in list(dst.vertex_groups): dst.vertex_groups.remove(g)
    m = dst.modifiers.new('DT_weights', 'DATA_TRANSFER'); m.object = src
    m.use_vert_data = True; m.data_types_verts = {'VGROUP_WEIGHTS'}; m.vert_mapping = 'TOPOLOGY'
    m.layers_vgroup_select_src = 'ALL'; m.layers_vgroup_select_dst = 'NAME'
    sel([dst], dst)
    bpy.ops.object.datalayout_transfer(modifier=m.name)
    bpy.ops.object.modifier_apply(modifier=m.name)
for g in mxm.vertex_groups:
    if g.name.startswith(PREFIX): g.name = g.name[len(PREFIX):]
assert len(mxm.data.vertices) == len(body.data.vertices) == len(outl.data.vertices)
transfer(body, mxm)
transfer(outl, body)
for o in (body, outl):
    o.parent = arm; o.matrix_parent_inverse = Matrix.Identity(4); o.matrix_world = Matrix.Identity(4)
    am = o.modifiers.new('Armature', 'ARMATURE'); am.object = arm
    print('SKIN', o.name, 'groups', len(o.vertex_groups),
          'unweighted verts', sum(1 for v in o.data.vertices if not v.groups))
mx_mats = {m for m in mxm.data.materials if m}
mesh = mxm.data; bpy.data.objects.remove(mxm); bpy.data.meshes.remove(mesh)
for m in mx_mats:
    if m.users == 0: bpy.data.materials.remove(m)

# ---- 5. NLA tracks (one per clip, exported as glTF animations) ----
ad = arm.animation_data or arm.animation_data_create()
ad.action = None
for t in list(ad.nla_tracks): ad.nla_tracks.remove(t)
for c in CLIPS:
    t = ad.nla_tracks.new(); t.name = c
    s = t.strips.new(c, 1, acts[c])
    try: s.action_slot = acts[c].slots[0]
    except Exception as e: print('slot', c, e)
    t.mute = False

# ---- 6. sword: grip -> right hand; hip copy kept for alternate export ----
def bone_tail_world(bname):
    b = arm.data.bones[bname]
    return arm.matrix_world @ b.matrix_local @ Matrix.Translation((0, b.length, 0))

def sword_frame(obj):
    co = [obj.matrix_world @ v.co for v in obj.data.vertices]
    c = sum(co, Vector()) / len(co)
    tip = max(co, key=lambda p: (p - c).length); pommel = max(co, key=lambda p: (p - tip).length)
    ax = (pommel - tip).normalized(); L = (pommel - tip).length
    guard_pts = [p for p in co if 1.00 <= (p - tip).dot(ax) <= 1.06]
    gp = max(guard_pts, key=lambda p: ((p - tip) - ax * (p - tip).dot(ax)).length)
    wv = ((gp - tip) - ax * (gp - tip).dot(ax)).normalized()
    grip = tip + ax * 1.14                     # between guard (1.06) and pommel (1.29)
    blade = -ax                                # grip -> tip
    return grip, blade, wv

GRIP_ALONG = 0.075    # m from RightHand head along hand dir (palm centre / fist)
GRIP_PALM = 0.02      # m toward body (palm side)
BLADE_PITCH = float(os.environ.get('BLADE_PITCH', '-30'))    # deg extra tilt of blade around guard axis
grip, blade, wv = sword_frame(sw)
hbone = arm.data.bones['RightHand']
H = arm.matrix_world @ hbone.matrix_local
hand_dir = (H.col[1].xyz).normalized(); hand_head = H.translation
palm = Vector((-1, 0, 0))                      # right hand is at +X; palm faces the thigh (-X)
P = hand_head + hand_dir * GRIP_ALONG + palm * GRIP_PALM
B = Vector((0, 1, 0)); B = (B - hand_dir * B.dot(hand_dir)).normalized()     # blade forward (thumb side)
Dp = (hand_dir - B * hand_dir.dot(B)).normalized()                         # guard spans along knuckle line
B = Matrix.Rotation(math.radians(BLADE_PITCH), 3, Dp.cross(B)) @ B
def frame3(a, b):
    b = (b - a * b.dot(a)).normalized(); return Matrix((a, b, a.cross(b))).transposed()
Rm = frame3(B, Dp) @ frame3(blade, wv).inverted()
M = Matrix.Translation(P) @ Rm.to_4x4() @ Matrix.Translation(-grip)

hip = {}
for o in (sw, swo):
    hcopy = o.copy(); hcopy.data = o.data.copy(); sc.collection.objects.link(hcopy)
    hcopy.name = o.name.replace('char-hero_sword', 'char-hero_swordhip'); hcopy.hide_render = True
    hip[o.name] = hcopy
    o.data.transform(o.matrix_world); o.matrix_world = Matrix.Identity(4)
    o.data.transform(Matrix.Translation(-P) @ M)          # vertices relative to grip point
    o.parent = arm; o.parent_type = 'BONE'; o.parent_bone = 'RightHand'
    o.matrix_parent_inverse = Matrix.Identity(4)
    o.matrix_basis = bone_tail_world('RightHand').inverted() @ Matrix.Translation(P)
for o in hip.values():
    o.data.transform(o.matrix_world); o.matrix_world = Matrix.Identity(4)
    o.parent = arm; o.parent_type = 'BONE'; o.parent_bone = 'Hips'
    o.matrix_parent_inverse = Matrix.Identity(4)
    o.matrix_basis = bone_tail_world('Hips').inverted()
    o.data.name = o.name
print('SWORD grip world', tuple(round(x, 3) for x in P), 'blade dir', B.to_tuple(2), 'guard axis', Dp.to_tuple(2))

bpy.data.orphans_purge(do_recursive=True)
for m in bpy.data.materials:
    if m.node_tree:
        for n in m.node_tree.nodes:
            if n.type == 'BSDF_PRINCIPLED':
                n.inputs['Specular IOR Level'].default_value = 0.5
                n.inputs['Emission Strength'].default_value = min(1.0, n.inputs['Emission Strength'].default_value)
print('MATERIALS', [m.name for m in bpy.data.materials], 'IMAGES', [(i.name, i.filepath) for i in bpy.data.images])
print('OBJECTS', [(o.name, o.type, o.parent.name if o.parent else None, o.parent_bone) for o in sc.objects])
sc.frame_start = 1; sc.frame_end = 77
bpy.ops.wm.save_as_mainfile(filepath=f'{V3}/char-hero.blend', relative_remap=True)
print('SAVED', f'{V3}/char-hero.blend')
