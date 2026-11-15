# 在 Blender 里（MCP execute_blender_code）运行：按面中心位置条件导出 UV 三角形，给 recolor_palette_masked.py 当掩码。
# 先设置 OBJ_NAME、OUT_JSON、PRED（lambda c: 条件，c 为面中心）。
import bpy, json
me = bpy.data.objects[OBJ_NAME].data; uv = me.uv_layers.active.data
tris = [[[uv[i].uv.x, uv[i].uv.y] for i in p.loop_indices] for p in me.polygons if PRED(p.center)]
json.dump(tris, open(OUT_JSON, 'w')); print('mask faces', len(tris))
