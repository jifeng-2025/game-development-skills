# 生成模型加工全流程示例（自检时用真实混元输出跑通：15116 → 3900 三角面 + 外壳，GLB 0.56 MB，无扩展）。
# 命令行：<BLENDER> -b --factory-startup --python gen_pipeline_example.py
#   命令行模式每次都是新进程、没有状态，所以整条流程写在一个脚本里；贴图色块化要在运行前用 flatten_texture.py 做好
#   （第一遍只跑到 save_texture_raw，做完色块化再跑全程）。
# MCP 模式：把下面各行拆开，逐步 execute_blender_code，每步后 look 截图。
ASSET_ROOT = '/path/to/project'                      # ← 改
SKILL = '/path/to/3D资产制作skill'            # ← 改
exec(open(f'{SKILL}/scripts/gen_asset_kit.py').read())
g = GenAsset('enemy-xxx', 'v001')
g.import_raw()                                       # 读 assets/source/enemy-xxx/v001/raw.glb
g.normalize(height=1.6)
g.clean()
g.delete_faces(lambda c, col: c.z > 1.40 and c.x < -0.075)      # 例：删头顶飘带（先截图定位）
g.assign_material('glow', '#8C6A2B',                              # 例：胸口红灯改暗金自发光
                  lambda c, col: 0.95 < c.z < 1.5 and abs(c.x) < 0.4 and col[0] > 0.3 and col[0] > 3 * col[1] and col[0] > 3 * col[2],
                  emit=0.6)
g.save_texture_raw()
import os
if os.path.exists(f'{g.src}/T_enemy-xxx_body_basecolor.png'):
    g.use_texture('T_enemy-xxx_body_basecolor.png')
    g.decimate(target_tris=3900)
    g.face_flip()                                    # 混元正面朝 -Y → 转到 +Y（glTF -Z）
    g.outline(0.015)
    g.info()
    g.export(target_z=0.8, scale=2.0)
