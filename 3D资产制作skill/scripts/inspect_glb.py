"""打印 GLB 的节点、网格三角面、材质、贴图、包围盒（不依赖 Blender）。"""
import json,struct,sys
p=sys.argv[1]; b=open(p,'rb').read()
assert b[:4]==b'glTF'; l=struct.unpack('<I',b[12:16])[0]; j=json.loads(b[20:20+l])
acc=j['accessors']
out={'size_MB':round(len(b)/1048576,3),'nodes':[],'materials':[m.get('name') for m in j.get('materials',[])],
     'images':[i.get('name') for i in j.get('images',[])],'textures':len(j.get('textures',[])),
     'extensionsUsed':j.get('extensionsUsed',[]),'animations':len(j.get('animations',[])),'skins':len(j.get('skins',[]))}
mn=[1e9]*3; mx=[-1e9]*3; total=0
for n in j['nodes']:
    if 'mesh' not in n: out['nodes'].append({'name':n.get('name'),'mesh':None}); continue
    m=j['meshes'][n['mesh']]; tri=0
    for pr in m['primitives']:
        tri+= (acc[pr['indices']]['count'] if 'indices' in pr else acc[pr['attributes']['POSITION']]['count'])//3
        a=acc[pr['attributes']['POSITION']]
        for i in range(3): mn[i]=min(mn[i],a['min'][i]); mx[i]=max(mx[i],a['max'][i])
    total+=tri
    out['nodes'].append({'name':n.get('name'),'mesh':m.get('name'),'tris':tri,'materials':[j['materials'][pr['material']]['name'] for pr in m['primitives'] if 'material' in pr],
                         't':n.get('translation'),'r':n.get('rotation'),'s':n.get('scale')})
out['tris_total']=total; out['bbox_min_yup']=[round(x,4) for x in mn]; out['bbox_max_yup']=[round(x,4) for x in mx]
out['double_sided']={m.get('name'):m.get('doubleSided',False) for m in j.get('materials',[])}
print(json.dumps(out,ensure_ascii=False,indent=1))
