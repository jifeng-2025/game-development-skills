"""prop-hall-front：厅堂正面（宽约 8 m、高 5 m），正面朝 +Y（glTF -Z），原点在底面中心。
参考 env-courtyard-ingame__topdown__v03 画面上方：黑漆木门窗、暖琥珀色窗格、两侧黑柱带黄铜箍、瓦檐。"""
import math
# 运行前在同一 exec 环境里设置 ASSET_ROOT、PROP_VERSION，并把 KIT 指向 skill 的 scripts/prop_kit.py
exec(open(KIT).read())
k = PropKit('prop-hall-front')
S = k.src
stone = k.mat('stone', tex=f'{S}/T_prop-hall-front_stone_basecolor.jpg')
wood = k.mat('wood', tex=f'{S}/T_prop-hall-front_wood_basecolor.jpg')
plaster = k.mat('plaster', tex=f'{S}/T_prop-hall-front_plaster_basecolor.jpg')
roof = k.mat('roof', tex=f'{S}/T_prop-hall-front_roof_basecolor.jpg')
glow = k.mat('glow', tex=f'{S}/T_prop-hall-front_glow_basecolor.png', emit=1.0, emit_tex=True)
brass = k.mat('brass', color='#8C6A2B')
frame = k.mat('frame', color='#161618')     # 门窗框：比木墙更黑，勾出门窗分格
ridge = k.mat('ridge', color='#26262A')
V = lambda *c: k.bm.verts.new(c)

PLAT_H = 0.48            # 台基高度 = 三级石阶总高，可直接接 prop-stone-steps
FY = 0.0                 # 门窗立面所在 y
# ---- 台基
k.box((0, -0.4, PLAT_H / 2), (8.4, 2.4, PLAT_H), stone, 1.8, skip=('bottom',))
# ---- 墙体（立面后面的实体，侧面和背面用白灰）
k.box((0, -0.70, PLAT_H + 1.56), (7.0, 1.2, 3.12), plaster, 2.0, skip=('bottom', '+y'))
# 立面木板墙（贴在 y=FY）
k.box((0, FY - 0.05, PLAT_H + 1.56), (7.0, 0.1, 3.12), wood, 1.2, skip=('bottom', '-y'))


def panel(x0, x1, z0, z1, y, mi):
    """面朝 +Y 的四边形（逆时针从 +Y 看：左下→右下→右上→左上）。"""
    # 从 +Y 看逆时针：右下(x0) → 左下(x1)…… 这里 +Y 视角下 -X 在右侧
    vs = [V(x1, y, z0), V(x0, y, z0), V(x0, y, z1), V(x1, y, z1)]
    f = k.face(vs, mi, fixed=[(0, 0), (1, 0), (1, 1), (0, 1)])
    if f.normal.y < 0:
        f.normal_flip()
    return f


GY = FY + 0.012          # 窗格贴在立面前 1.2 cm
# 中门两扇：上半窗格透光，下半木板
for x0, x1 in ((-1.20, -0.02), (0.02, 1.20)):
    panel(x0 + 0.08, x1 - 0.08, PLAT_H + 1.45, PLAT_H + 2.55, GY, glow)
# 两侧窗：各两扇窗格
for sx in (-1, 1):
    for a, b in ((1.55, 2.35), (2.45, 3.25)):
        x0, x1 = sorted((sx * a, sx * b))
        panel(x0, x1, PLAT_H + 1.30, PLAT_H + 2.40, GY, glow)
# 门窗框（凸出立面 4 cm 的黑框条）
FD = 0.08
def bar(cx, cz, w, h):
    k.box((cx, FY + 0.02, cz), (w, FD, h), frame, 1.0, skip=('-y',))
top, bot = PLAT_H + 2.70, PLAT_H
for x in (-1.25, 0.0, 1.25):                          # 门框立梃
    bar(x, (top + bot) / 2, 0.10 if x else 0.06, top - bot)
bar(0, top, 2.6, 0.12)                                # 门楣
bar(0, PLAT_H + 2.60, 2.5, 0.08)                      # 门上枋
bar(0, PLAT_H + 1.40, 2.5, 0.08)                      # 门腰枋
for sx in (-1, 1):
    for x in (1.50, 2.40, 3.30):                      # 窗框立梃
        bar(sx * x, PLAT_H + 1.85, 0.08, 1.30)
    bar(sx * 2.40, PLAT_H + 2.47, 1.90, 0.10)         # 窗上框
    bar(sx * 2.40, PLAT_H + 1.23, 1.90, 0.10)         # 窗下框
# ---- 两侧黑柱（带上下黄铜箍）
for sx in (-1, 1):
    k.cyl((sx * 3.70, 0.30, PLAT_H), 3.40, 0.22, wood, sides=12, scale=1.2, caps=(False, True))
    for z0 in (PLAT_H + 0.15, PLAT_H + 3.00):
        k.cyl((sx * 3.70, 0.30, z0), 0.16, 0.24, brass, sides=12)
# ---- 檐下额枋和白灰檐板
k.box((0, 0.15, PLAT_H + 3.52), (8.2, 0.55, 0.24), wood, 1.2)
k.box((0, -0.20, PLAT_H + 3.71), (7.8, 0.30, 0.14), plaster, 2.0)   # 檐板，藏在屋面下


# ---- 屋面：前坡带上翘檐角，后坡短
def sheet(rows, t, mi, sc):
    """rows: 自上而下的若干行顶点（每行同样多个点）。生成带厚度 t 的板（向下偏移）。"""
    top = [[V(*p) for p in r] for r in rows]
    bot = [[V(p[0], p[1], p[2] - t) for p in r] for r in rows]
    R, C = len(rows), len(rows[0])
    for i in range(R - 1):
        for j in range(C - 1):
            f = k.face([top[i][j], top[i + 1][j], top[i + 1][j + 1], top[i][j + 1]], mi, sc)
            if f.normal.z < 0:
                f.normal_flip()
            g = k.face([bot[i][j], bot[i][j + 1], bot[i + 1][j + 1], bot[i + 1][j]], mi, sc)
            if g.normal.z > 0:
                g.normal_flip()
    def edge(a, b):
        for (p, q), (r, s) in zip(zip(a, a[1:]), zip(b, b[1:])):
            k.face([p, q, s, r], mi, sc)
    edge(top[-1], bot[-1]); edge(bot[0], top[0])
    edge([r[0] for r in bot], [r[0] for r in top]); edge([r[-1] for r in top], [r[-1] for r in bot])


ZR = 4.62                # 屋脊线
ZE = PLAT_H + 3.66       # 前檐口
XS = [-4.6, -3.9, 3.9, 4.6]
lift = [0.32, 0.0, 0.0, 0.32]       # 檐角上翘
fwd = [0.15, 0.0, 0.0, 0.15]
front = [[(x, -0.9, ZR) for x in XS],
         [(x, -0.05, (ZR + ZE) / 2 + 0.04) for x in XS],
         [(x, 0.75 + fwd[i], ZE + lift[i]) for i, x in enumerate(XS)]]
sheet(front, 0.10, roof, 1.5)
back = [[(x, -0.9, ZR) for x in (-4.6, 4.6)], [(x, -1.9, ZR - 0.45) for x in (-4.6, 4.6)]]
sheet(back, 0.10, roof, 1.5)
k.box((0, -0.9, ZR + 0.06), (9.4, 0.30, 0.22), ridge, 1.0)
for sx in (-1, 1):                                    # 屋脊两端翘起的脊兽块
    k.box((sx * 4.62, -0.9, ZR + 0.19), (0.30, 0.32, 0.38), ridge, 1.0, taper=(0.6, 0.8))
k.build_object()
k.outline(0.02 if k.ver != 'v001' else 0.01)   # v002 描边加粗到 2 cm
st = k.stats()
print(st)
glb, mb = k.export_and_preview(target_z=2.5, scale=10.5)
print(glb, round(mb, 3), 'MB')
