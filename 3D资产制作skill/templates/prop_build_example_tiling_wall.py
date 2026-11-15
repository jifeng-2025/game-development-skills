# 运行前在同一 exec 环境里设置 ASSET_ROOT、PROP_VERSION，并把 KIT 指向 skill 的 scripts/prop_kit.py
exec(open(KIT).read())
k = PropKit('prop-wall-eave')
S = k.src
stone = k.mat('stone', tex=f'{S}/T_prop-wall-eave_stone_basecolor.jpg')
plaster = k.mat('plaster', tex=f'{S}/T_prop-wall-eave_plaster_basecolor.jpg')
wood = k.mat('wood', tex=f'{S}/T_prop-wall-eave_wood_basecolor.jpg')
roof = k.mat('roof', tex=f'{S}/T_prop-wall-eave_roof_basecolor.jpg')
ridge = k.mat('ridge', color='#26262A')
L = 4.0
HX = L / 2


def slab(y_ridge, z_ridge, y_eave, z_eave, t, mi, sc):
    """沿 X 贯通的斜屋面板（两端截平，便于拼接）。"""
    v = lambda x, y, z: k.bm.verts.new((x, y, z))
    a = [v(-HX, y_ridge, z_ridge), v(HX, y_ridge, z_ridge), v(HX, y_eave, z_eave), v(-HX, y_eave, z_eave)]
    b = [v(-HX, y_ridge, z_ridge - t), v(HX, y_ridge, z_ridge - t), v(HX, y_eave, z_eave - t), v(-HX, y_eave, z_eave - t)]
    k.face(a if y_eave > y_ridge else list(reversed(a)), mi, sc)
    k.face(list(reversed(b)) if y_eave > y_ridge else b, mi, sc)
    k.face([b[3], b[2], a[2], a[3]] if y_eave > y_ridge else [a[3], a[2], b[2], b[3]], mi, sc)
    # 两端截面（拼接面）保留，避免从端头看穿
    k.face([b[0], b[3], a[3], a[0]] if y_eave > y_ridge else [a[0], a[3], b[3], b[0]], mi, sc)
    k.face([a[1], a[2], b[2], b[1]] if y_eave > y_ridge else [b[1], b[2], a[2], a[1]], mi, sc)


k.box((0, 0, 0.175), (L, 0.46, 0.35), stone, 1.8)           # 青石墙基
k.box((0, 0, 1.40), (L, 0.34, 2.10), plaster, 2.0)          # 白灰墙身 0.35–2.45 m
k.box((0, 0, 2.51), (L, 0.44, 0.12), wood, 1.2)             # 檐下黑漆木枋
slab(0.0, 2.93, 0.70, 2.58, 0.07, roof, 1.5)                # 前坡（+Y）
slab(0.0, 2.93, -0.70, 2.58, 0.07, roof, 1.5)               # 后坡（-Y）
k.box((0, 0, 2.95), (L, 0.18, 0.10), ridge, 1.0)            # 屋脊
# 山墙填充：木枋顶 (z 2.57) 到屋面底之间的三角楔体，沿 X 贯通，端面截平
yy, zb, zt = 0.22, 2.57, 2.86
P = [(-yy, zb), (yy, zb), (0.0, zt)]
fr = [k.bm.verts.new((HX, y, z)) for y, z in P]
bk = [k.bm.verts.new((-HX, y, z)) for y, z in P]
k.face(fr, plaster, 2.0); k.face(list(reversed(bk)), plaster, 2.0)
for i in range(3):
    j = (i + 1) % 3
    k.face([bk[i], bk[j], fr[j], fr[i]], plaster, 2.0)
k.build_object()
k.outline(0.01)
# 拼接端：外壳顶点压回 x=±2.0，并删掉端面上的外壳面，相邻墙段拼接时接缝处不出黑线
import bmesh as _bm
om = k.outl.data; b = _bm.new(); b.from_mesh(om)
for v in b.verts:
    if abs(v.co.x) > HX: v.co.x = HX if v.co.x > 0 else -HX
ends = [f for f in b.faces if all(abs(v.co.x - HX) < 1e-5 for v in f.verts) or all(abs(v.co.x + HX) < 1e-5 for v in f.verts)]
_bm.ops.delete(b, geom=ends, context='FACES'); b.to_mesh(om); b.free()
print(k.stats())
glb, mb = k.export_and_preview(target_z=1.5, scale=4.6)
print(glb, round(mb, 3), 'MB')
