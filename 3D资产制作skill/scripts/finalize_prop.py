"""交付收尾：检查 GLB、独立 Blender 进程重新导入、写 manifest、复制证据。
环境变量：ASSET_ROOT（必填，项目根）、PROP_VERSION（默认 v001）、BLENDER（默认 macOS 路径）、
          GENERATOR / PROVENANCE（写进 manifest，可选）、EVIDENCE_TASK（证据子目录名，默认 A003）
用法: python3 finalize_prop.py <asset-id> <budget> <dims-json> <notes-json> [concept...]"""
import json, os, subprocess, sys, shutil
R = os.environ['ASSET_ROOT']
BLENDER = os.environ.get('BLENDER', '/Applications/Blender.app/Contents/MacOS/Blender')
aid, budget = sys.argv[1], int(sys.argv[2])
dims, notes = json.loads(sys.argv[3]), json.loads(sys.argv[4])
concepts = sys.argv[5:]
V = os.environ.get('PROP_VERSION', 'v001')
glb = f'{R}/assets/exports/{aid}/{V}/{aid}.glb'
ins = json.loads(subprocess.check_output([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'inspect_glb.py'), glb]))
expr = ("import bpy;bpy.ops.import_scene.gltf(filepath=%r);"
        "print('RE',[(o.name,sum(len(p.vertices)-2 for p in o.data.polygons),"
        "round(min((o.matrix_world@v.co).z for v in o.data.vertices),4),"
        "round(max((o.matrix_world@v.co).z for v in o.data.vertices),4),len(o.data.materials)) "
        "for o in bpy.data.objects if o.type=='MESH' and o.name.startswith(%r)])") % (glb, aid)
out = subprocess.run([BLENDER, '-b', '--factory-startup', '--python-expr', expr],
                     capture_output=True, text=True).stdout
re_line = [l for l in out.splitlines() if l.startswith('RE')][0]
body = next(n for n in ins['nodes'] if n['name'] == f'{aid}_body')
outl = next(n for n in ins['nodes'] if n['name'] == f'{aid}_outline')
tex = [{'name': i} for i in ins['images']]
src = f'{R}/assets/source/{aid}/{V}'
m = {
    'assetId': aid, 'version': V, 'conceptImages': concepts,
    'source': {'blend': f'assets/source/{aid}/{V}/{aid}.blend', 'buildScript': f'assets/source/{aid}/{V}/scripts/build.py',
               
               'textures': sorted(f'assets/source/{aid}/{V}/' + f for f in os.listdir(src) if f.startswith('T_'))},
    'export': f'assets/exports/{aid}/{V}/{aid}.glb', 'exportSizeMB': ins['size_MB'],
    'previewPaths': [f'assets/previews/{aid}/{V}/{aid}__{v}.png' for v in ('oblique55', 'front', 'side')],
    'dimensions': dims, 'units': 'm', 'forwardAxis': '-Z', 'upAxis': '+Y', 'origin': 'bottom-center',
    'triangles': {'body': body['tris'], 'outline': outl['tris'], 'total': ins['tris_total'], 'budget': budget},
    'bboxGltf': {'min': ins['bbox_min_yup'], 'max': ins['bbox_max_yup']},
    'materials': ins['materials'], 'textures': tex, 'meshes': [body['name'], outl['name']], 'animations': [],
    'extensionsUsed': ins['extensionsUsed'],
    'generator': os.environ.get('GENERATOR', 'Blender 手工低模（build.py），无 3D 生成'),
    'provenance': os.environ.get('PROVENANCE'),
    'blenderVersion': subprocess.run([BLENDER, '--version'], capture_output=True, text=True).stdout.splitlines()[0],
    'checklist': None, 'reimportCheck': re_line, 'notes': notes,
}
json.dump(m, open(f'{R}/assets/exports/{aid}/{V}/manifest.json', 'w'), ensure_ascii=False, indent=1)
ev = f"{R}/evidence/assets/{os.environ.get('EVIDENCE_TASK', 'A003')}/{aid}"
os.makedirs(ev, exist_ok=True)
json.dump(ins, open(f'{ev}/glb_inspect.json', 'w'), ensure_ascii=False, indent=1)
print(json.dumps({'size_MB': ins['size_MB'], 'tris': ins['tris_total'], 'budget': budget, 'ext': ins['extensionsUsed'],
                  'mats': ins['materials'], 'imgs': ins['images'], 'bbox': [ins['bbox_min_yup'], ins['bbox_max_yup']]}, ensure_ascii=False))
print(re_line)
