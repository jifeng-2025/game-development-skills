# A006 export: <id> v002 GLB (skinned body + outline, N clips) + 3 previews. run: ASSET_ID=<id> Blender -b <v002>/<id>.blend --python export_anim.py
import bpy, math, os
ID = os.environ['ASSET_ID']
ROOT = '/Users/huangjifeng/Desktop/1/arpg-command-center'
EXP = f'{ROOT}/assets/exports/{ID}/v002'; PRV = f'{ROOT}/assets/previews/{ID}/v002'
os.makedirs(EXP, exist_ok=True); os.makedirs(PRV, exist_ok=True)
H = {'enemy-puppet': 1.6, 'boss-1': 5.0}[ID]
UNLIT = [f'M_{ID}_outline']          # pure-black materials: must stay KHR_materials_unlit (ForgeaX material-artifact-conflict)
sc = bpy.context.scene; arm = bpy.data.objects[f'{ID}_rig']
for t in arm.animation_data.nla_tracks: t.mute = False
arm.animation_data.action = None
for pb in arm.pose.bones: pb.matrix_basis.identity()
objs = [arm, bpy.data.objects[f'{ID}_body'], bpy.data.objects[f'{ID}_outline']]
for o in sc.objects: o.select_set(False)
for o in objs: o.hide_set(False); o.select_set(True)
bpy.context.view_layer.objects.active = arm
out = f'{EXP}/{ID}.glb'
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_yup=True, export_apply=False,
    export_texcoords=True, export_normals=True, export_materials='EXPORT', export_image_format='AUTO',
    export_cameras=False, export_lights=False, export_extras=False, export_morph=False,
    export_skins=True, export_all_influences=False, export_def_bones=False, export_rest_position_armature=True,
    export_animations=True, export_animation_mode='NLA_TRACKS', export_force_sampling=True, export_frame_range=False,
    export_anim_single_armature=True, export_reset_pose_bones=True)
exec(open(f'{ROOT}/.workbuddy/skills/3D资产制作skill/scripts/glb_set_unlit.py').read().split("if __name__")[0])
patch(out, set(UNLIT))
print('EXPORTED', out, round(os.path.getsize(out) / 1e6, 3), 'MB')
for t in arm.animation_data.nla_tracks: t.mute = (t.name != 'idle')
sc.frame_set(1)
cam = bpy.data.objects.new('pv', bpy.data.cameras.new('pv')); sc.collection.objects.link(cam); sc.camera = cam
cam.data.type = 'ORTHO'; cam.data.ortho_scale = H * 1.3; cam.data.clip_end = H * 40
sc.render.engine = 'BLENDER_WORKBENCH'; sc.display.shading.light = 'FLAT'; sc.display.shading.color_type = 'TEXTURE'
sc.render.resolution_x = sc.render.resolution_y = 1024
for name, el, az in [('oblique55', 55, 0), ('front', 0, 0), ('side', 0, 90)]:
    e = math.radians(el); a = math.radians(az); d = H * 8
    cam.location = (d * math.cos(e) * math.sin(a), d * math.cos(e) * math.cos(a), H * 0.5 + d * math.sin(e))
    cam.rotation_euler = (math.radians(90) - e, 0, math.pi - a)
    sc.render.filepath = f'{PRV}/{ID}__{name}.png'; bpy.ops.render.render(write_still=True)
print('PREVIEWS', sorted(os.listdir(PRV)))
