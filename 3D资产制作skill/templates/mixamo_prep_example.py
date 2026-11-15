# A005 step1: v002 -> Mixamo upload FBX (body only, no sword, A-pose, meters)
# run: Blender -b --factory-startup --python prep_mixamo.py
import bpy, os, math, shutil, mathutils
ROOT = '/Users/huangjifeng/Desktop/1/arpg-command-center'
SRC = f'{ROOT}/assets/source/char-hero/v002/char-hero.blend'
DST = f'{ROOT}/assets/source/char-hero/v003'
bpy.ops.wm.open_mainfile(filepath=SRC)
sc = bpy.data.scenes['A003_char-hero_v002']; bpy.context.window.scene = sc if bpy.context.window else None
for n in ('cutter_hat_v2', 'A003_cam'):
    o = bpy.data.objects.get(n)
    if o: bpy.data.objects.remove(o)
sc.name = 'A005_char-hero_v003'
sc.unit_settings.system = 'METRIC'; sc.unit_settings.scale_length = 1.0
# v002 faces +Y (glTF -Z). Mixamo expects Blender-standard front -Y -> rotate 180 about Z, baked into mesh.
R = mathutils.Matrix.Rotation(math.pi, 4, 'Z')
for n in ('char-hero_body', 'char-hero_outline', 'char-hero_sword', 'char-hero_sword_outline'):
    o = bpy.data.objects[n]; o.data.transform(R); o.data.update()
# textures absolute so FBX can embed them
for im in bpy.data.images:
    if im.filepath.startswith('//'):
        p = f'{ROOT}/assets/source/char-hero/v002/' + im.filepath[2:]
        shutil.copy(p, DST); im.filepath = p
body = bpy.data.objects['char-hero_body']
# keep outline/sword in the prep blend (outline later inherits body weights via Data Transfer)
bpy.ops.object.select_all(action='DESELECT') if bpy.context.view_layer else None
for o in sc.objects: o.select_set(False)
body.select_set(True); bpy.context.view_layer.objects.active = body
fbx = f'{DST}/mixamo-upload.fbx'
bpy.ops.export_scene.fbx(filepath=fbx, use_selection=True, object_types={'MESH'},
    apply_unit_scale=True, apply_scale_options='FBX_SCALE_ALL', axis_forward='-Z', axis_up='Y',
    mesh_smooth_type='FACE', add_leaf_bones=False, path_mode='COPY', embed_textures=True, bake_anim=False)
bpy.ops.wm.save_as_mainfile(filepath=f'{DST}/char-hero_prep.blend', copy=True)
me = body.data
bb = [body.matrix_world @ mathutils.Vector(c) for c in body.bound_box]
print('EXPORTED', fbx, os.path.getsize(fbx), 'verts', len(me.vertices), 'tris', sum(len(p.vertices)-2 for p in me.polygons),
      'bbox', [round(min(v[i] for v in bb),3) for i in range(3)], [round(max(v[i] for v in bb),3) for i in range(3)])
