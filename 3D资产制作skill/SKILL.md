---
name: game-3d-asset-pipeline
description: 把游戏概念图做成可进引擎的低模 GLB：多视图参考 → 混元 3D 生成 → Blender（MCP 或命令行）加工（减面、尺度、朝向、外壳描边、色块化贴图、唯一命名）→ GLB 导出与重导入核对 → manifest；道具不走生成，直接在 Blender 里用脚本手工建低模；角色可再走 Mixamo 自动绑骨 + 动作库，合并成单 GLB 多 clip（外壳继承权重、武器挂手骨）。触发词：3D 资产、出模型、图转 3D、混元 3D、Blender 加工、GLB 导出、低模、描边外壳、道具建模、prop、角色模型、Boss 模型、manifest、绑骨、骨骼动画、Mixamo、动作合并、animation clip。
---

# 游戏 3D 资产管线（概念图 → 低模 GLB）

## 适用场景 / 不适用

**适用**
- 斜俯视或第三人称游戏里**必须会动或要转视角的物体**：主角、敌人、Boss，用「多视图 → 混元 3D → Blender 加工」。
- 结构简单的**场景道具**：灯、柱、墙段、树、箱子、建筑立面、台阶，用 Blender 脚本手工建低模（不消耗积分，可以重跑）。
- 卡通 / 平涂 / 硬色阶画风：只要 baseColor 加黑色外壳描边，明暗交给引擎 Shader。

**不适用**
- 地面、远景、特效贴图、UI：这些直接用生图（见 `概念图与批量提示词skill`），不要做 3D。
- 写实 PBR、要法线和金属粗糙度贴图的项目：本流程会主动删掉这些贴图。
- 骨骼绑定和动画：静态 GLB 交付后另开任务，按下面「D. 骨骼绑定与动作（Mixamo）」做；手工 Rigify、面部表情、布料模拟不在本流程内。

## 输入

| 输入 | 要求 |
|---|---|
| 规格书 | 每个资产的身高 / 尺寸、三角面预算、「必须看得出」的剪影特征、特殊处理（删什么、哪里换材质） |
| 概念图（生成用） | **front、right（纯 90° 侧面，角色朝画面右）、back** 三张，2:3，纯灰底、无投影、A 字姿势、四肢分开；风格一致性已经审过 |
| 外观参考 | 设定板（sheet）、长剑这类配件的设定图；用于 Blender 里手工补细节 |
| 道具参考 | 一张道具合图（三分之二视角）+ 可平铺贴图（木、墙、瓦、石，tile 图） |
| 引擎资产合同 | 坐标轴、朝向、单位、原点、命名、是否允许 glTF 扩展、单文件大小上限。**以合同为准，规格书写法和合同冲突时，报告并按合同做** |
| 工具 | Blender 5.x（MCP 可选）；Python 3 + Pillow；WorkBuddy 的 `buddy-multimodal-generation` 技能和 `connect_cloud_service` |

## 步骤

### A. 准备（每次开工都做）

1. **读规格和合同**，把每个资产的预算、尺寸、特殊处理抄进自己的清单。
2. **确认 Blender**：
   - 有 Blender MCP 时，第一次调用 `get_scene_info`（只读）确认连接。
   - 如果用户 Blender 里已经有场景，先用 `execute_blender_code` 执行 `bpy.ops.wm.save_as_mainfile(filepath=<evidence>/user_scene_backup_<时间>.blend, copy=True)` 备份，**之后每个资产都建独立的新 Scene**，不碰用户场景。
   - MCP 不可用时，改用命令行：`<BLENDER> -b --python <script.py>`。所有脚本都兼容命令行，不要卡在 MCP 配置上。
3. **Pillow**：Python 里没有 Pillow 时，执行 `python3 -m pip install --target /tmp/pylib pillow`，之后所有贴图脚本都加 `PYTHONPATH=/tmp/pylib`。
4. **工作目录**：命令里的 `scripts/`、`templates/` 都是相对本 skill 目录的路径。
5. **设置环境**：`export ASSET_ROOT=<项目根>`（下面有 `assets/source|exports|previews`）。在 Blender 里 exec 脚本前，也要在同一个环境里先写 `ASSET_ROOT = '...'`。

### B. 角色 / 敌人 / Boss（混元 3D）

1. **报积分并取得同意**：每个模型用 LowPoly + 多视图是 **35 积分**（LowPoly 25 + 多视图 10），失败不扣分；用户预先同意过的额度内可以直接做。
2. **准备视图**：
   `python3 scripts/prepare_views.py $ASSET_ROOT/assets/source/<id>/v001/input --front <front.png> --right <side.png> --back <back.png>`
3. **提交生成**：先调用 `connect_cloud_service`，取得 `clientTempToken`，然后：
   `python3 scripts/hunyuan_3d.py submit --in .../input --out $ASSET_ROOT/assets/source/<id>/v001 --token <token>`
   - 会立刻返回 job_id。多个资产可以连续提交，并行生成（默认最多 3 个并发）。
4. **等待并下载**：
   `python3 scripts/hunyuan_3d.py poll --out .../v001 --job <job_id> --token <token>`
   - 一个任务约 10–12 分钟。token 约 15 分钟过期，过期就重新调用 `connect_cloud_service`，**继续 poll 原 job，不要重新 submit**。
   - 下载得到 `raw.glb`，`status.json` 里有实际扣的积分。
5. **在 Blender 里分步加工**。完整可运行示例见 `templates/gen_pipeline_example.py`。
   - MCP 模式：用 `execute_blender_code` 一次只调一个函数，看打印的数值，主要步骤后用 `look` 截图检查。
   - 命令行模式：每次都是新进程、不保留状态，所以整条流程写进一个脚本，用 `-b --factory-startup --python` 运行。贴图色块化在两遍之间做：第一遍跑到 `save_texture_raw()`，第二遍跑全程。

   ```python
   ASSET_ROOT = '...'; exec(open('<skill>/scripts/gen_asset_kit.py').read())
   g = GenAsset('<id>', 'v001'); g.import_raw()
   g.normalize(height=<身高>)            # 缩放到身高，原点在脚底中心
   g.clean()                             # 合并 0.001 m 重点，删 <50 面的碎块
   # 用 look(mode='angles', views=['front','right','back','top']) 看清哪里要删 / 换材质
   g.delete_faces(lambda c,col: <条件>)   # 例：飘带 c.z>1.4 and c.x<-0.07；烟雾 c.z>4.2 and col.max()>0.45 and 饱和度<0.25
   g.assign_material('glow', '<暗金色 hex>', lambda c,col: <条件>, emit=0.6)   # 例：红灯 col[0]>0.3 and col[0]>3*col[1]
   g.save_texture_raw()
   ```
   - 在外部做贴图色块化（固定色板，不用自动量化）：
     `python3 scripts/flatten_texture.py tex_raw_basecolor.png T_<id>_body_basecolor.png --size 1024 --palette '<色板>' [--red2gold --gold '<暗金>']`
     Boss 可以用 `--size 2048 --median 7`。
   - 回到 Blender 继续：
     `g.use_texture('T_<id>_body_basecolor.png'); g.decimate(target_tris=<(预算-配件)/2>); g.face_flip()`
     （截图确认原始正面朝 -Y 再调用 `face_flip()`）
   - 需要切口（例如帽檐缺口）：先在缺口位置建一个闭合的楔形挤出体当刀具，然后 `g.boolean_cut('<cutter>')`；切完数一下区域内残留的面数，应该接近 0。
   - 局部换色（例：衣服提白，但脸和手不变）：先用 `scripts/export_uv_mask.blender.py` 导出 UV 掩码，再运行
     `python3 scripts/recolor_palette_masked.py src.png dst.png mask.json --map '#旧=#新,...' --masked '#肤色'`
   - 配件（武器等）：按设定图手工建（参考 `templates/prop_build_example_*.py` 的写法），复制一份作为子物体挂到角色上，命名为 `<id>_<配件>`；同时单独导出一份 `prop-<配件>.glb`（原点在握持点），给引擎做持握状态用。
   - 挂件穿模检查：用 `mathutils.bvhtree.BVHTree.find_nearest`，查配件每个顶点到身体表面的距离，最小距离应 ≥ 3 cm。
   - 描边外壳：`g.outline(<厚度>)`；配件单独 `g.outline(0.004, src='<id>_sword', name='<id>_sword_outline')`。
   - 导出：`g.export(target_z=<身高/2>, scale=<画框>)`，得到 GLB、3 张预览（斜俯视 55°、正面、侧面）和独立 `.blend`。
6. **核对与 manifest**：
   - `python3 scripts/inspect_glb.py <glb>`：看三角面、包围盒、`extensionsUsed` 只允许 `KHR_materials_unlit`、命名。
   - `python3 scripts/check_blend_textures.py <blend>`：`.blend` 里的贴图都能找到。
   - 用 `templates/manifest.template.json` 填 manifest，未知的写 null。或者对道具型资产直接用 `finalize_prop.py`，它会在独立进程里重新导入并写 manifest。

### C. 道具（Blender 手工低模，0 积分）

1. **准备专用贴图**（原图不动，统一 1024²）：
   `python3 scripts/prep_tile.py <tile.png> $ASSET_ROOT/assets/source/<id>/v001/T_<id>_<部位>_basecolor.jpg [--brightness 1.1]`
   - 发光窗格这类贴图用 Pillow 画：琥珀色底加黑格栅。
2. **写建模脚本** `assets/source/<id>/v001/scripts/build.py`，参考 `templates/prop_build_example_hall.py`（建筑立面、发光窗格、檐角翘起）和 `templates/prop_build_example_tiling_wall.py`（可无缝拼接的墙段）。模板第一行 `exec(open(KIT).read())` 要求在同一个 exec 环境里先定义 `ASSET_ROOT` 和 `KIT`（skill 的 `scripts/prop_kit.py` 路径）：
   ```python
   exec(open(KIT).read())                         # KIT = <skill>/scripts/prop_kit.py
   k = PropKit('<id>'); wood = k.mat('wood', tex=f'{k.src}/T_<id>_wood_basecolor.jpg')
   glow = k.mat('glow', tex=..., emit=1.0, emit_tex=True); brass = k.mat('brass', color='<黄铜色 hex>')
   k.box(center, size, mat, uv_scale, skip=(...), taper=(tx,ty)); k.cyl(base, h, r, mat, sides=..); k.poly_prism(pts, y0, y1, mat)
   k.build_object(); k.outline(0.01); k.export_and_preview(target_z=<高/2>, scale=<画框>)
   ```
   - 正面统一朝 +Y，原点在底面中心。UV 按世界坐标投影（`scale` 是贴图每循环几米），所以相邻物体的贴图连续。
3. 在 Blender MCP 里 exec 这个脚本，然后把斜俯视预览拼成一张图检查。要改就改脚本重跑：PropKit 会清掉同名旧 Scene 和 mesh。
4. **收尾**：
   `ASSET_ROOT=... python3 scripts/finalize_prop.py <id> <预算> '<尺寸json>' '<notes json>' <参考图...>`
   - 它会检查 GLB、在独立 Blender 进程里重新导入核对、写 manifest、把证据存到 `evidence/`。
5. **出新版本**（只改贴图或描边）：把 build.py 复制到 `assets/source/<id>/v002/scripts/`，贴图放进 v002 目录；在 Blender 的 exec 环境里先写 `PROP_VERSION = 'v002'` 再运行（PropKit 读这个全局变量），收尾时用 `PROP_VERSION=v002 python3 scripts/finalize_prop.py ...`（读环境变量）。脚本里可以用 `k.ver != 'v001'` 区分新旧版本的参数（例如描边厚度）。
   - 贴图要更平、更亮：`python3 scripts/flatten_tile_soft.py src dst --keep 0.25 --bright 1.2`；石材、瓦片要保留结构线时用 `--median 7~9 --keep 0.35~0.4`。

### D. 骨骼绑定与动作（Mixamo）

前提：角色已有通过初验的静态版本（vN），A 字或 T 字姿势、四肢分开。产物是**一个 GLB，内含一份蒙皮网格 + N 条 animation clip**（引擎切换动作只是换 clip，不换模型）。四个模板可以无状态重跑，改顶部常量即可：`templates/mixamo_prep_example.py → mixamo_build_example.py → mixamo_check_example.py → mixamo_export_example.py`。

1. **上传件**（`mixamo_prep_example.py`）：从 vN 的 `.blend` 只导出身体网格为 FBX：`assets/source/<id>/v(N+1)/mixamo-upload.fbx`。
   - 去掉武器、描边外壳、布尔刀具、相机；单位米、缩放 1；`path_mode='COPY', embed_textures=True` 把贴图打进 FBX。
   - **网格先绕 Z 轴转 180°**：我们的 Blender 源文件正面朝 +Y（导出后为 glTF -Z），Mixamo 要正面朝 -Y。
   - 外壳**不上传**：它和身体重叠、法线朝内，会干扰自动绑骨；之后从身体继承权重最准。
   - 用独立进程重新导入 FBX，从 -Y 方向渲染一张图确认是正面、有贴图。
2. **Mixamo 网页**（要求制作人登录 Adobe 账号；agent 可以操作已登录的浏览器，或者交给 Codex 或制作人手动操作）：
   - Upload Character → 确认正面朝镜头 → 放标记点：下巴（Chin，**别放到帽檐上**）、两个手腕、两个手肘、两个膝盖、腹股沟；勾 Use Symmetry；Skeleton LOD 选 Standard。
   - 下载设置：FBX Binary、30 fps、Keyframe Reduction none；**第一个选 With Skin，其余选 Without Skin**；有 In Place 选项就勾上。
   - 每个动作记录原名、版本和滑块参数，写到 `mixamo/SELECTION.md`；文件名直接用 clip 名（`idle.fbx`、`atk1.fbx` 等）。
   - 绝不做付费、订阅或修改账号设置的操作。
   - 选动作的风格提示：单手剑用 **Sword And Shield** 系列，但不要举盾、盾击、踢腿；Great Sword 系列是双手大剑。游戏攻击间隔短时，选出刀前预备短的版本。
3. **合并**（`mixamo_build_example.py`，Blender 命令行）：
   - 骨架和绑定网格取自 With Skin 文件。**Without Skin 文件的静止姿势是 T 字，With Skin 的是上传时的 A 字**，局部旋转不能直接套用。脚本逐帧取动作文件里每根骨头在骨架空间的朝向，赋给我们的骨架：根骨（Hips）只取相对位移，其余骨骼的位置由层级推出。
   - 身体权重：Mixamo 网格和原网格顶点逐一对应，用 Data Transfer（`VGROUP_WEIGHTS`，`vert_mapping='TOPOLOGY'`）传到原网格上，原 UV、材质名、贴图都保留；传之前断言两边顶点数相等。外壳同样用 Data Transfer 从身体继承权重（外壳是法线外推得到的，顶点顺序和身体一致），再加同一个 Armature 修改器。
   - 骨骼名去掉 `mixamorig:` 前缀；骨架转 180° 回到 +Y，然后 `transform_apply`，让骨架和网格的世界矩阵都是单位阵。
   - 位移交给代码驱动：有明显水平位移的 clip（攻击、翻滚、死亡），在重定向时把 Hips 的水平分量锁成首帧值。In Place 不一定代表没有位移，先测再锁。
   - 截帧：先逐帧打印 Hips 的高度和前后位移，再决定截哪段。例如 Stand To Roll 的前 13 帧是后撤蓄力，只保留滚翻主体。
   - 每个 clip 建一个 NLA 轨道（轨道名即 clip 名）；导出时 `export_animation_mode='NLA_TRACKS'`。
   - 武器挂手骨：`parent_type='BONE'`，`matrix_parent_inverse` 设为单位阵，`matrix_basis = 骨骼尾端世界矩阵的逆 × 握点矩阵`。握点在剑柄中段，剑身从拇指一侧伸出（与骨骼方向正交、朝角色正前），护手沿指节线；再用 `BLADE_PITCH` 往指节方向压（墨刃用 -30°）。另外复制一份挂到 Hips 的腰挂版本，导出成 `<id>__sword-hip.glb`，节点名相同。
4. **自检**（`mixamo_check_example.py`）：每个 clip 静音其他 NLA 轨道后逐帧检查：
   - 外壳到身体的顶点间距：最大值应约等于外壳厚度，超过就是外壳脱离了；
   - 剑的顶点在身体内部的数量：握柄约 3 个是正常的，明显更多就要调握点或接受并在报告里说明；
   - 剑尖速度峰值帧：作为出刀时间写进 manifest，供代码对齐攻击判定；
   - 斜俯视 55° 每个 clip 4 帧，拼成一张图；另外用约 20° 的四分之三视角放大检查握剑，斜俯视角下斗笠会挡住手。
5. **导出与核对**（`mixamo_export_example.py`）：GLB 导出时 `export_skins=True, export_animation_mode='NLA_TRACKS', export_force_sampling=True, export_rest_position_armature=True`。然后检查：
   - `inspect_glb.py`：animations 数量、`extensionsUsed` 只有 `KHR_materials_unlit`、三角面；
   - 读 GLB 的 JSON：每条动画 = 骨骼数 × 3 个通道，蒙皮网格节点没有 TRS；
   - 独立进程重新导入，核对动作数、骨骼数、面数，身体包围盒应与上一版静态 GLB 一致（Blender 导入器生成的 `Icosphere` 是骨骼显示形状，不算面数）。
6. manifest 增加 `skeleton`（关节数、根骨、绑定姿势）和 `animations[]`（名字、帧数、秒数、是否循环、Mixamo 原名、根位移处理方式、出刀峰值时间）。敌人还要写 `windupStart_s`、`strikeOrContact_s`（供预警对齐）。
7. **敌人 / Boss 变体**（A006；模板 `mixamo_enemy_build_example.py / _check_ / _export_`，用 `ASSET_ID=<id>` 运行，所有差异都写在 `CFG` 里）：
   - **硬部件刚性化**（不改骨架，只改权重）：先把手指骨权重并入 Hand；武器刃、巨拳等腕部以外的顶点 → 100% Hand；烟囱、炉门、背后钥匙等 → 部件内所有顶点用同一套权重（部件内平均，**排除** `*Arm`/`*Hand` 骨，避免跟着手臂走）。先画「主导骨着色图」（按每个顶点权重最大的骨头着色）定位部件，再用坐标盒或材质 + 1 圈邻面选择。自动绑骨后硬部件弯曲变形，不等于要手绑：只要骨架关节位置对，就继续下载动作，权重在这里重做。
   - **朝向审计**：逐 clip 打印 Hips / Spine2 / Head 的偏航角。剑盾、持弓系列的站姿会侧身 54–62°。受击这类短反应改成**以 idle 为底**（`rebase`：每骨局部旋转 = idle 首帧 × 源首帧⁻¹ × 源当前帧）；整体偏一点的用 `yaw` 常量转正（符号以实测为准）；攻击只要出刀帧正对前方，就保留起手扭身；结尾转身的截掉。
   - **重型攻击**（`retime`）：0.8 倍速重采样（带小数子帧），在源落地帧插入 n 帧停顿，同时让髋部下沉 2–4% 身高，形成加重感。跳得太高的用 `jump_scale` 只压缩向上的髋位移。
   - **防穿地**（`ground`）：大体型角色套人形动作，拳头和躯干会入地。逐帧求蒙皮后的最低点，平滑后抬髋；需要脚不动时（砸地）给 Leg 骨加 IK（链长 2，目标是原脚踝轨迹），然后用 `nla.bake(visual_keying, clear_constraints)` 烘焙。允许入地量写进 CFG（砸地 0.25 m）。
   - **时间标记**（`check_anim.py`）：前摇开始 = 出手的手抬过首帧 6% 身高；出刀 = 手速峰值；落地 = 停顿帧，或手速峰值后手低于 8% 身高的第一帧。另外检查出刀帧手的方位角是否在正前方（±30°）。

## 验收标准（每个资产逐项填写，写进报告）

| # | 项 | 标准 | 怎么查 |
|---|---|---|---|
| 1 | 三角面 | 主体 + 外壳 + 配件合计 ≤ 预算 | `inspect_glb.py` 的 `tris_total` |
| 2 | 身高 / 尺寸 | 误差 ±5% | GLB 包围盒的 Y 尺寸 |
| 3 | 原点 | 脚底（底面）中心，最低点 0 ±1 cm | 包围盒 min Y = 0 |
| 4 | 朝向 | 正面朝 glTF -Z | GLB 里脸、胸口、灯窗、门窗所在一侧的 Z 是负的；背后的特征（钥匙、烟囱）在 +Z |
| 5 | 剪影 | 斜俯视 55° 预览里，规格书「必须看得出」的每一项都能看到 | 预览图和参考图并排对比；**有疑问交给主控和制作人判断，不要自己放行** |
| 6 | 描边 | 外壳完整，没有破洞；正面看不到外壳穿进模型；拼接件接缝没有黑线 | 正面、侧面、头部特写；拼接件放两段测试 |
| 7 | 贴图 | 色块化，没有写实噪点和烘焙阴影；禁用颜色（例如朱红）只出现在允许的地方 | 截图；需要时统计红色像素占比 |
| 8 | 命名 | 网格 `<id>_body / _outline / _<配件>`，材质 `M_<id>_<部位>`，贴图 `T_<id>_<部位>_basecolor`，没有 `Material`、`Image` 这类默认名 | `inspect_glb.py` 的 materials / images |
| 9 | 文件 | GLB ≤ 单文件上限；`extensionsUsed` 只有 `KHR_materials_unlit`，且纯黑材质（外壳、武器外壳、墨色部分）都带它；重新导入后面数、尺寸、材质数一致 | `finalize_prop.py` 的 RE 行，或者独立进程重新导入 |
| 10 | 产物齐全 | `.blend`、`.glb`、`manifest.json`、3 张预览；`.blend` 独立打开时贴图都在 | `check_blend_textures.py` |

10 项都满足才算 Blender 初验通过，结论只写「**待引擎验收**」：Blender 里好看不等于引擎导入通过。

## 踩坑与对策

**工具本身**
- 所有脚本都**不依赖项目里的其他文件**，只靠 `ASSET_ROOT` 和本目录。第一次自检时 `finalize_prop.py` 还在找旧项目的 `_tools/inspect_glb.py`，已改成用同目录脚本；换项目时如果出现路径报错，先 `grep -rn "/Users" scripts templates`。
- Blender 命令行 `-b` 模式没有 window，不能 `window.scene = 新场景`；两个工具包在无窗口时会清空并复用当前场景（`_new_scene`），所以命令行一个进程只处理一个资产。
- 减面会让最低点略低于 0（约 -0.3 mm），`decimate()` 结束时会自动重新贴地。

**混元 3D**
- 多视图的 `ViewType` 只接受 **back / left / right**，传 `right_front`（3/4 视角）会直接报错（不扣分）。3/4 视角图只能留作人工对照。
- 4 张图的 base64 放在命令行参数里会报 `argument list too long`，所以 `hunyuan_3d.py` 在 Python 进程内调用技能脚本。
- **LowPoly 并不保证低面数**：小怪约 1.5 万面，Boss 输出了 49.5 万面，在 Blender 里一样要 decimate。
- 生成器会把**烟雾、飘带、头发丝这些非实体**也做成网格：烟雾按「高度 + 浅色低饱和」删，飘带按位置删，减面后剩下的碎块（<50 面）统一删掉。
- `clientTempToken` 约 15 分钟过期；技能自带的阻塞轮询最长 600 s，常常被工具超时打断。所以用 `submit --no-poll` + `poll`，掉线后只 poll 原 job。
- 原始贴图是 4096² 的写实贴图，必须色块化。

**朝向和坐标**
- Blender 导出 glTF 时的换算是 (x, y, z) → (x, z, -y)。**所以 Blender 里朝 -Y，导出后是 +Z**。要 glTF 朝 -Z，Blender 里就得朝 +Y。规格书写「Blender 里面朝 -Y」是错的，遇到要报告。
- glTF 导入后旋转在 `matrix_world` 里，要先 `data.transform(matrix_world)` 烘进网格，否则后面的尺寸和位置都会算错。
- 混元模型导入后正面朝 -Y：规整完先截图确认，再转 180°。

**网格加工**
- **布尔的 EXACT 求解器在生成网格上会静默失败**：不报错，面也没切掉。用 FLOAT 求解器，切完数一下区域内残留的面数。
- Voxel Remesh 会毁掉 UV 和贴图，生成网格只要是一个连通块、法线正常，就不用 remesh。
- Solidify 做外壳会保留内外两层，三角面翻倍，容易超预算。改用「顶点沿法线外推 + 翻转面」，面数和主体一样。
- 外壳会低于地面（z<0），要压回 0，不然原点检查和引擎贴地都会出问题。
- 可拼接件（墙段）：外壳顶点在端头压回边界，并删掉端面外壳，否则拼接处有黑线；UV 用世界坐标投影，贴图才连续。

**贴图和材质**
- 自动量化（median-cut）会把白面具、锈色、肤色吞成一档棕色。**用项目固定色板量化**。
- 局部换色时，按颜色全局替换会误伤脸和手（同样是浅色）。要用 UV 掩码排除。
- Principled BSDF 的 `Specular IOR Level` 不是 0.5，会导出 `KHR_materials_specular`；`Emission Strength` > 1 会导出 `KHR_materials_emissive_strength`。引擎不认这类扩展，脚本里统一复位，导出后查 `extensionsUsed`：除下一条的 `KHR_materials_unlit` 外不能有别的。
- **纯黑材质必须带 `KHR_materials_unlit`**（描边外壳 `*_outline`、武器外壳、墨色部分如主角墨臂 `*_inkarm`）。Blender 导出器只在发光/背景着色器时写 unlit，Principled BSDF 做的纯黑会导出成受光材质。在 ForgeaX 里，两个都蒙皮、都只有颜色因子的受光材质会编译成同一个着色器程序，颜色默认值不同就报 `material-artifact-conflict (param-schema)`，引擎拒绝启动（A005 v003 首次导出踩过，修复会话 F006 在游戏里那份 GLB 上补了）。做法：每次导出后跑 `python3 scripts/glb_set_unlit.py <glb> --names M_<id>_outline,...`（显式列名，缺一个就报错退出），导出模板已内置。重导出旧版本时也要跑，并和游戏里那份 GLB 比对材质 JSON。
- 用 `bpy.data.libraries.write(..., path_remap='RELATIVE_ALL')` 存 `.blend` 前，贴图路径要改成 `//文件名`；存完要在当前会话**恢复绝对路径**，否则接下来的预览贴图全丢（Workbench 里显示粉色）。
- Workbench 平光预览看不出台阶的高低差：台阶踢面换一个压暗的材质，分层才看得见。

**斜俯视构图**
- 55° 俯角下，檐口出挑一大就会挡住灯窗和门窗格。灯笼檐口约 7 cm，厅堂前檐约 0.75 m 是可行的值。
- 小特征（帽檐缺口等）要比正面设定图上**大一档**才看得见：缺口从 45° 加到 65° 才一眼可辨。
- 挂在腰间的长武器容易穿过下摆：以护手为轴向外转约 9°，再外移约 3.5 cm。

**Mixamo 与骨骼动画**
- With Skin 的静止姿势是上传姿势（A 字），Without Skin 的是 T 字：直接把动作套到 A 字骨架上会扭曲，必须在骨架空间重定向。可以对比两种文件里 `RightHand` 的 `head_local` 来确认。
- 选 Standard Skeleton (65)，实际可能只有 33 根骨（手只有食指链）。不影响斜俯视游戏，但不要指望有手指动画。
- Mixamo 导入后，骨架对象带 X 轴 +90° 旋转，网格子物体带 -90°；网格解除父级时保留世界矩阵，再和骨架一起转向、`transform_apply`。
- Blender 5.x 的动作是分层结构（slots / channelbags），读 fcurve 用 `bpy_extras.anim_utils.action_get_channelbag_for_slot`；新建 NLA strip 后设置 `strip.action_slot`。
- 外壳权重用拓扑映射最准；只有顶点数不一致时，才退回 `POLYINTERP_NEAREST`。
- 短刀动作给长剑用时，剑身方向由手腕决定，可能偏高：把 `BLADE_PITCH` 设成 0 / -20 / -30 渲染对比图，再定。
- 攻击片段通常 0.8–1.2 s，远长于 ARPG 的普攻间隔，在报告里给出出刀峰值时间，交给代码截短或加速播放，资产里不要硬剪。
- 傀儡在 Mixamo 预览里刀刃「弯钩、分叉」：原因是手指骨（Thumb、Index）各分走一段刀刃的权重，不是骨架错了。按 D.7 把手指权重并入 Hand、刀刃改成刚性即可。
- 不带蒙皮的动作文件，`rest` 的 Hips 位置和带蒙皮文件略有不同（Boss 差约 2 cm）：重定向只取相对位移，所以不影响；`frame_set(int, subframe=…)` 可以对源动作做小数帧采样。
- Mixamo 的 FBX 导入后材质名会带 `.001`，按材质选顶点时用 `name.split('.')[0]` 比较。
- Blender 5 的 `Bone` 没有 `select` 属性；`nla.bake(only_selected=False)` 不需要选中骨骼。
- `Matrix.Rotation(θ,4,'Y')` 在 Mixamo 骨架空间（Y 向上）做偏航修正，转回 Blender 后符号与直觉相反，修正后要重新测量。
- 本机 `sed` 是 GNU 版本，`sed -i ''` 会把 `''` 当成文件名报错；改脚本用编辑工具或 Python。

**操作纪律**
- MCP 的 `execute_blender_code` 每次只做一步并打印数值。同一步连续失败 2 次就换方法。
- 直接连插件的 socket 测试时，如果约 40 s 后才回 `Client timed out`，说明 Blender 主线程没有执行命令：把 Blender 放到前台、关掉弹窗、在 N 面板重新连接。自定义 MCP 要在 WorkBuddy 连接器页「自定义连接器」里点信任，并**新开会话**才会加载工具。

## 交接格式

**每交付一个资产，在对话里发一次：**
```
<asset-id> v001 已交付：
- GLB：路径，大小 MB，三角面 body/outline/weapon
- 身高：x.xx m；原点：OK；朝向：OK
- 验收：8/10（第 5、7 项请判断）或 10/10
- 斜俯视预览：路径
- 积分消耗：x
- 待引擎验收
```

**文件**
- 源文件：`assets/source/<id>/vNNN/`，含 `raw.glb`、`input/`、`T_*.png|jpg`、`<id>.blend`、`scripts/build.py`
- 导出：`assets/exports/<id>/vNNN/<id>.glb`、`manifest.json`
- 预览：`assets/previews/<id>/vNNN/<id>__oblique55.png | __front.png | __side.png`
- 证据：`evidence/assets/<任务号>/<id>/`，含预览拼图、特写、`glb_inspect.json`、生成任务记录
- 报告：追加到 `reports/assets/<任务号>.md`；新版本另写一份给引擎开发的替换通知，写清只改路径里的版本号、哪些不变
- 版本：改动一律出新版本目录（v002），旧版本不删不覆盖；节点、材质、贴图名保持不变，方便引擎只换路径

## 参数（换项目只改这一节）

| 参数 | 墨刃（inkblade）当前值 |
|---|---|
| 项目根 `ASSET_ROOT` | `/Users/huangjifeng/Desktop/1/arpg-command-center` |
| 规格书 / 合同 | `handoffs/A003-3d-spec.md`、`contracts/assets.md` |
| Blender | `/Applications/Blender.app/Contents/MacOS/Blender`（5.2.1 LTS，不在 PATH）；MCP：`uvx mcp-for-blender`，端口 9876 |
| 引擎约定 | ForgeaX 0.4.19：GLB、Y 向上、面朝 -Z、米、原点脚底中心、贴图和材质唯一命名、不使用不常见扩展、单个 GLB ≤ 8 MB |
| 身高 / 预算 | 主角 1.8 m ≤ 15k（含长剑）；小怪傀儡 1.6 m ≤ 8k；Boss 5.0 m ≤ 20k；道具：灯笼 1.4 m ≤ 1.5k、柱 3.2 m ≤ 800、墙段 4 m ≤ 1.5k、枯树 4 m ≤ 3k、齿轮箱 0.8 m ≤ 800、厅堂正面 ≤ 4k、石阶 ≤ 300（预算都含外壳） |
| 外壳厚度 | 角色 1.5 cm、Boss 4 cm、道具 1 cm（大建筑 2 cm）、细长武器 4 mm；颜色 `#0A0A0A` |
| 色板（角色 / 道具） | 傀儡 `#121214,#26262A,#3E3E44,#5A5A60,#2C3240,#4A3A26,#6E5530,#8C6A2B,#B8955A,#6E3820,#9C5428,#8E8A84,#D6D2C8`；Boss 再加 `#3E4A66,#C08A2E`；主角 `#111214,#26262A,#3E3E44,#5E5E64,#2F3B52,#45526E,#D8D2C4,#B3AC9E,#8A8478,#C9A07A,#8E6A50,#5E4632,#8C6A2B,#B8955A` |
| 特殊材质色 | 暗金自发光 `#8C6A2B`（小怪灯）、`#C08A2E`（Boss 炉心）；主角墨臂 `#111214`；黄铜 `#8C6A2B`；饮魂枯树 `#6E3B35` / 枝梢 `#3A211E`（哑光不发光）；长衫提白 `#E4DED0 / #F0EBDF`；肤色 `#B88E6A` |
| 禁用颜色 | 朱红只用于危招预警、暴击、血、关键 UI；角色、Boss、道具本体不用 |
| 道具贴图来源 | `assets/concepts/env-wood-lacquer|env-wall-plaster|env-roof-tile|env-courtyard-ground/*__tile__v02.png` |
| 混元积分 | LowPoly + 多视图 35 / 个；本项目 3 个角色共 105 |
| 预览 | Workbench 平光、固有色、1024²、正交相机，斜俯视 55°；灰底（MCP 下约 `#373737`，命令行 factory 模式下约 `#808080`，都可以） |
| 敌人动作（A006） | 傀儡 41 骨 / Boss 33 骨；clip 傀儡 `idle / walk / attack / hit / death`，Boss `idle / walk / sweep / slam / hit / enrage / death`；sweep、slam 用 0.8 倍速加落地停顿；外壳厚度傀儡 1.5 cm、Boss 4 cm；样板 `assets/source/{enemy-puppet,boss-1}/v002/` |
| 主角动作（A005） | Mixamo 33 骨、根骨 `Hips`、无前缀；clip `idle / run / dash / atk1 / atk2 / atk3 / q / hit / death`，30 fps；锁水平位移的 clip：dash、atk1–3、death；剑挂 `RightHand`，`BLADE_PITCH=-30`；样板 `assets/source/char-hero/v003/` |
