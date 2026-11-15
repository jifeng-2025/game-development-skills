# A005 export: char-hero v003 GLB (sword in right hand) + __sword-hip variant + 3 previews
# run: Blender -b <v003>/char-hero.blend --python export_v003.py [-- hip]
import bpy, math, os, sys
ROOT = '/Users/huangjifeng/Desktop/1/arpg-command-center'
EXP = f'{ROOT}/assets/exports/char-hero/v003'; PRV = f'{ROOT}/assets/previews/char-hero/v003'
os.makedirs(EXP, exist_ok=True); os.makedirs(PRV, exist_ok=True)
HIP = 'hip' in sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else False
sc = bpy.context.scene; arm = bpy.data.objects['char-hero_rig']
hand = [bpy.data.objects['char-hero_sword'], bpy.data.objects['char-hero_sword_outline']]
hip = [bpy.data.objects['char-hero_swordhip'], bpy.data.objects['char-hero_swordhip_outline']]
if HIP:   # same node names as main GLB so the engine can swap files
    for o in hand: o.name += '_hand'; o.hide_render = True
    hip[0].name = 'char-hero_sword'; hip[1].name = 'char-hero_sword_outline'
    for o in hip: o.hide_render = False
    swords = hip; out = f'{EXP}/char-hero__sword-hip.glb'
else:
    swords = hand; out = f'{EXP}/char-hero.glb'
for t in arm.animation_data.nla_tracks: t.mute = False
arm.animation_data.action = None
for pb in arm.pose.bones: pb.matrix_basis.identity()
objs = [arm, bpy.data.objects['char-hero_body'], bpy.data.objects['char-hero_outline']] + swords
for o in sc.objects: o.select_set(False)
for o in objs: o.hide_set(False); o.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_yup=True, export_apply=False,
    export_texcoords=True, export_normals=True, export_materials='EXPORT', export_image_format='AUTO',
    export_cameras=False, export_lights=False, export_extras=False, export_morph=False,
    export_skins=True, export_all_influences=False, export_def_bones=False, export_rest_position_armature=True,
    export_animations=True, export_animation_mode='NLA_TRACKS', export_force_sampling=True, export_frame_range=False,
    export_anim_single_armature=True, export_reset_pose_bones=True)
# pure-black materials must stay unlit (else ForgeaX material-artifact-conflict); Blender exporter drops it
UNLIT = ['M_char-hero_inkarm', 'M_char-hero_outline', 'M_char-hero_sword_outline']
exec(open(f'{ROOT}/.workbuddy/skills/3D资产制作skill/scripts/glb_set_unlit.py').read().split("if __name__")[0])
patch(out, set(UNLIT))
print('EXPORTED', out, round(os.path.getsize(out) / 1e6, 3), 'MB')

if not HIP:   # previews: idle frame 1, workbench flat, ortho
    for t in arm.animation_data.nla_tracks: t.mute = (t.name != 'idle')
    sc.frame_set(1)
    for o in hip: o.hide_render = True
    cam = bpy.data.objects.new('pv', bpy.data.cameras.new('pv')); sc.collection.objects.link(cam); sc.camera = cam
    cam.data.type = 'ORTHO'; cam.data.ortho_scale = 2.3
    sc.render.engine = 'BLENDER_WORKBENCH'; sc.display.shading.light = 'FLAT'; sc.display.shading.color_type = 'TEXTURE'
    sc.render.resolution_x = sc.render.resolution_y = 1024
    for name, el, az in [('oblique55', 55, 0), ('front', 0, 0), ('side', 0, 90)]:
        e = math.radians(el); a = math.radians(az); d = 10
        cam.location = (d * math.cos(e) * math.sin(a), d * math.cos(e) * math.cos(a), 0.9 + d * math.sin(e))
        cam.rotation_euler = (math.radians(90) - e, 0, math.pi - a)
        sc.render.filepath = f'{PRV}/char-hero__{name}.png'; bpy.ops.render.render(write_still=True)
    print('PREVIEWS', os.listdir(PRV))
