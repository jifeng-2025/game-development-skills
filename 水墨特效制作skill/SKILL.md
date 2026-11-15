---
name: game-ink-vfx-pipeline
description: 用 ForgeaX 做水墨风（或其他笔触风）2.5D 动作游戏战斗特效的全流程：白墨黑底贴图生成 → 亮度转 alpha 预处理 → 事件驱动时间线 → WGSL 笔触材质 → 预览截图 → 实战录屏/抓帧/帧时间取证 → preview 回归后提交。投射物、飞刃、剑气（「子弹制作」）也归本技能。触发词：特效、VFX、刀光、剑气、飞刃、投射物、子弹、预警、受击特效、击杀化墨、粒子、转场、去色、墨晕、特效截图、特效取证、特效性能、p95、贴图转透明、ForgeaX 材质。
---

# 水墨战斗特效流水线（ForgeaX）

## 适用场景 / 不适用

适用：
- ForgeaX（engine 0.4.x）项目里，战斗逻辑已经能发事件（或即将发），需要做刀光、技能、受击、击杀、敌人预警、投射物、Boss 招式、转场 / 全屏去色等表现。
- 风格以「笔触 + 描边」为主（水墨、手绘、平涂描边）：贴图是单色笔触，颜色在材质里上。
- 需要给主控交可复核的证据：精确卡帧的预览截图、实战截图 / 录屏、帧时间、回归结果。

不适用：
- 写实粒子 / 体积烟火 / 物理模拟特效（这里没有 GPU 粒子模拟，粒子是 CPU 轨迹 + 点精灵批）。
- 战斗判定本身（伤害范围、时长、事件何时发）：那是游戏逻辑会话的事，特效只读事件，判定数值通过接口请求对齐。
- 后处理（去色、暗角、雨线）的着色：特效只输出信号值，后处理归渲染 / 游戏逻辑会话。
- UI 层动画（技能图标冷却等）。

## 输入

1. **战斗事件定义**（如 `assets/combat/events.ts` 的联合类型）和广播入口（如 `onCombatEvent(listener)`）。没有就先写接口请求，用预览先做。
2. **判定数值**：每个技能 / 预警的半径、半角、时长、宽度（从 combat 代码或规格表抄，写进时间线常量并注明来源）。
3. **相机参数**：固定斜俯视的偏航 yaw、俯仰、距离、视场角，最好有单一来源文件（如 `view/oblique.ts`）。
4. **美术方向**：墨色、描边色、强调色（朱红等）、流派色；参考图 2–3 张（只取笔触气质）。
5. **工具**：内置生图（ImageGen）、ForgeaX CLI（`pnpm exec forgeax …`）、本技能 `scripts/`。
6. **写入边界**：只写特效目录（如 `assets/vfx/**` 和 `assets/art/vfx/**`）；dev owner 由谁启动、谁停。

## 文件清单（本技能目录）

| 文件 | 用途 |
|---|---|
| `scripts/prepare-textures.mjs` | 白墨黑底 PNG → 透明贴图 + meta + manifest + `textures.ts`（配置驱动，含加粗与内缝遮罩） |
| `scripts/verify-textures.mjs` | 贴图边框 / 透明度校验 |
| `scripts/texture-diff-guard.sh` | 重新生成前后比哈希，只允许目标贴图变化 |
| `scripts/capture-preview.sh` | 共享 dev owner 上的预览精确卡帧截图 |
| `scripts/contact-sheet.mjs` | 多张截图拼 2 列缩略图（省看图预算） |
| `scripts/isolated-preview.sh` | 基线 commit + 当前特效改动 → 隔离 worktree 构建并起 preview |
| `scripts/play-preview-events.mjs` | `project play` 驱动隔离 preview，按真实事件节拍截图（JSON 计划） |
| `scripts/live.mjs` | 共享 dev owner 页面里取证：eval / 下载录像 / 下载抓帧 |
| `scripts/ps-shim.sh` | 沙箱 `ps` 替身 |
| `scripts/lib-upng.mjs` | 公共：找 upng-js、读 PNG、参数解析 |
| `templates/materials.ts` `ink-surface.wgsl` `renderer.ts` `geometry.ts` | 笔触材质、着色器、渲染器、网格（通用，改包 ID / 模块名 / 色板） |
| `templates/vfx.pack.ts` | 插件胶水：订阅、Presentation、信号、统计、降级、`definePack` 注册（项目相关部分要改） |
| `templates/timeline-skeleton.ts` `timeline.test.example.ts` | 时间线骨架与单测样板 |
| `templates/preview-harness.ts` | 预览驱动（确定性时钟 + 场景表） |
| `templates/verify-materials.mts` | 材质编译验证 |
| `templates/live-driver.ts` | 页面内实战驱动：开局、自动战斗、录像、计时、抓帧（全局名要改） |
| `templates/texture-prompt.txt` `textures.config.example.json` `play-plan.example.json` `report-template.md` | 生图提示词、预处理配置、取证计划、报告模板 |

## 步骤

### 0. 开工前检查（5 分钟，别跳）
```bash
cd <game>; git log --oneline -3; git status --short          # 记基线；看清别的会话的未提交改动（不碰）
pnpm exec forgeax dev status --json --detail | python3 -c 'import json,sys;v=json.load(sys.stdin)["value"];print(v.get("phase"),(v.get("workers") or {}).get("engine"))'
grep -n "kind:" assets/combat/events.ts | head -40             # 事件联合类型（路径按参数）
ls .forgeax/play/lock.json 2>/dev/null                         # 有锁 = 别的会话在 play，等
```
- 确认：dev owner 是谁的（不是自己的不 stop / restart）、Worker 开没开（开着则 eval 里没有 `document`）、事件里有没有你要的字段、有没有页面 → 引擎的调试命令通道。
- 缺事件 / 字段：先按「步骤 4 · 字段没定稿时」做，同时写接口请求。

### 1. 生成白墨黑底贴图（每种元素一张）
- 用 `templates/texture-prompt.txt` 的提示词模板，一张图只要一个元素；序列帧用 4×4 或 2×2 网格（每格同尺度、留白）。
- 需要的基础集（够做完一整套战斗）：刀光弧 `slash`、宽刀光 `slash-wide`、直线笔触 `line`、墨溅序列 `splat`(4×4)、墨爆环 `burst`、冲击环 `shockwave`、预警扇形 `fan`、预警圆 `ring`、溶解噪声 `noise`(无缝)、墨雾 `mist`(2×2)、火花 `spark`(2×2)。
- 存成 `<concepts>/<asset>/<asset>__<view>__v<NN>.png`，同名 `.prompt.txt` 存提示词。
- 生完先自己看一遍：元素没被切边、背景纯黑、没有文字和边框。

### 2. 预处理成游戏贴图
```bash
S=<本技能目录>/scripts
cp <本技能目录>/templates/textures.config.example.json <工作目录>/textures.config.json   # 改路径、entries、guidNamespace
zsh $S/texture-diff-guard.sh before <game>/assets/art/vfx          # 已有贴图时先拍快照
node $S/prepare-textures.mjs --config <工作目录>/textures.config.json
node $S/verify-textures.mjs --game <game> --dir <game>/assets/art/vfx
zsh $S/texture-diff-guard.sh after <game>/assets/art/vfx           # 只应列出你想改的那几张
```
- **配置里必须列出全部贴图**（不只新加的那张）：脚本按 `entries` 重写整个 `manifest.json` 和 `textures.ts`，漏掉的条目会从 `textures.ts` 消失。新加一张贴图的正确结果：`texture-diff-guard` 报「no texture changed」（旧贴图字节不变），`git diff` 里 `manifest.json` 只多一条、`textures.ts` 只多一行。
- 产出：`<key>.png`（RGB 白、A=亮度、4 px 透明边 + 3 px 渐隐）、`.meta.json`（mipmap 开，噪声 repeat，其余 clamp）、`manifest.json`、`textures.ts`（key → 稳定 GUID）。
- 细笔触要加粗：在 `thicken` 里给比例（刀光 1.5、直线和墨雾 1.8），脚本会闭运算填干笔缝、膨胀到目标实色面积，并把「笔触外形内部的缝」写进 RGB=0，着色器据此不在内缝描白边。

### 3. 材质与渲染器（一次性搭好，之后很少改）
- 从 `templates/` 复制 `materials.ts`、`ink-surface.wgsl`、`renderer.ts`、`geometry.ts` 到特效目录，改包 ID 和着色器模块名。
- 材质：`Materials.standard({surfaceModule:'<game>::vfx_surface', parameters:[…], values, queue, renderState})`，透明混合、`depthWriteEnabled:false`、`cullMode:'none'`。粒子用 `Materials.unlit` 点精灵；墨滴用无贴图的实心圆（见踩坑）。
- 着色器能力（模板已有）：墨体 `smoothstep(0.03,0.3,a)` 实心化；屏幕像素宽度的外描边（`outline` px，`rim` 颜色，`crit` 变朱红并加宽）；刀光 `sweep` 从头到尾扫出；`phase` 噪声溶解；`split` 从中间裂开；预警 `fill` 倒计时填充 + `wedge` 扇形极坐标重映射；`bloom` 转场墨晕；`tip` 刀尖变色。
- 渲染器：每个网格特效一个实体（材质从原型 `assets.copy`），每种粒子贴图一个点批（`assets.writeRange` 写 position/color/uv1）。**每帧 `assets.update` 只传数值，绝不传贴图绑定**；值没变就跳过；粒子只上传用到的前缀。
- 插件：复制 `templates/vfx.pack.ts`，改事件 / 状态的 import、场景实体名（`player`、`camera`）、信号名和全局名。它用 `definePack` 注册 `plugin/vfx`；要让游戏加载，需要挂到场景插件下（这一步通常在游戏逻辑会话的文件里，写接口请求请对方挂，特效会话不改别人的文件）。
- 编译验证：复制 `templates/verify-materials.mts`，`pnpm exec tsx <vfx>/verify-materials.mts`，每种材质（网格 / 预警 / 粒子 / 叠加层）都是 `"ok": true` 才继续。WGSL 参数名和 `materials.ts` 不一致时只会在这里报错，或者在画面上整块不显示。

### 4. 事件驱动时间线
- 从 `templates/timeline-skeleton.ts` 起步：`handle(event,state)` 把事件变成若干 Effect（位置、尺寸、寿命、`age` 为负 = 延迟出现），`tick(dt,state)` 推进曲线，渲染器每帧读 `effects`。时间线不 import 引擎，所以能直接 vitest。
- 插件（`vfx.pack.ts`）负责：订阅战斗广播；每帧读主角、剑、相机、敌人位置组成 `Presentation`；调用 `tick` 和 `renderer.update`；把去色 / 隐藏主角 / 剑光 / 转场等信号写进一个**全局共享**对象，给后处理读。
- 单测从 `templates/timeline.test.example.ts` 起步：`pnpm exec vitest run <vfx 目录>`。
- 每类表现的节拍写成命名常量（如 `E_BEATS = {mist:0, link:.03, cut:.1, ground:.16}`），测试按常量断言。
- 常用配方（数值是实测能读的起点）：
  - 刀光：弧形网格，按段放大 ×1.00/1.18/1.42，0.06 s 扫出，寿命约 0.32 s，后半段溶解；暴击描边变朱红并加 2 帧（2/60 s）纸白闪。
  - 预警：方形面片 + 着色器把贴图扇形按「真实半角 / 贴图半角」重映射并按真实半径裁剪；透明度从 0.35 随判定时长升到 1，填充从顶点推进；渲染队列比玩家特效高 100，玩家特效进入预警区时压到 20%。
  - 击杀化墨：竖立墨雾上散 + 墨滴（重力抛物线，落地变地面墨点 2 s）+ 地面墨痕（不透明度 ≥ 0.9）。
  - 投射物：每个投射物事件一个水平旋转月牙（`arc` 网格，自转约 28 rad/s）+ 火花拖尾，按 `speed × life` 飞完。
  - 多道剑气（扇形 N 道）：每道一笔直线墨笔，起点外移 0.6 m，中间那道先出、两侧晚 0.02 s；在暗地面上用 5 px 亮纸白描边 + 刀尖 20% 强调色 + 出手 0.1 s 白闪。
  - 持续状态（着火等）：按敌人编号记剩余时间，每帧从游戏写的敌人坐标数组读位置，让余烬跟随；死亡时补一次爆裂（收到专门的爆裂事件后不再自己补）。
  - 全屏转场：相机前 1 m 的面片，`RenderQueue.Overlay` + `depthCompare:'always'`，着色器用「半径 + 噪声」推进不规则墨边，半径按进度的 1.5 次方增长；同时输出 0..1 信号。
- 事件字段没定稿时：处理函数接受多种形状（如 `[x,z]`/`[x,y,z]`/`{x,z}`），并把期望字段写进接口请求表。

### 5. 预览截图（精确卡帧）
- 复制 `templates/preview-harness.ts` 到特效目录，为每个要验收的表现写一个场景（事件列表 + 发生时刻）。它要求插件导出 `startVfx(world, assets, feed)` 且 feed 支持 `delta`（确定性时钟）；`dev eval` 里有全局 `simulation`（含 world / assets），脚本会把它传给 `preview()`。
- 拍：
```bash
GAME=<game> PREVIEW_MODULE=<game>/assets/vfx/preview.ts YAW_DEG=<yaw> \
  zsh <本技能目录>/scripts/capture-preview.sh <scenario> <秒> <evidence>/<NN>-<名>-t<秒>.png
```
- 关键节拍至少两张（出手 / 峰值，消散中）。批量拍时每批 ≤ 5 张一条命令，避免命令超时被杀。
- 看图前先拼图：`node scripts/contact-sheet.mjs --game <game> sheet.png a.png b.png c.png d.png`，再用看图工具一次看一张拼图；提问要写清每格应该是什么、要找什么问题（矩形边框、白色杂纹、数量、遮挡）。

### 6. 实战取证（真实输入、真实事件）
两条路，优先 A：
- **A. 隔离 preview + project play**（不碰共享 dev owner，最接近交付物）：
  1. 构建（**前台**、沙箱外）：`ISO_STEP=build zsh scripts/isolated-preview.sh <game> <基线 commit> <端口> "assets/vfx assets/art/vfx" [--html-head …]`；再起服务（后台任务）：`ISO_STEP=serve zsh scripts/isolated-preview.sh <game> <基线> <端口>`。之后改了代码：`ISO_STEP=sync …`（同步改动 + 重新构建）→ 停掉服务任务 → 再 `serve`。
  2. 写 `play-plan.json`（模板 `templates/play-plan.example.json`）：开局按键、选卡键、开局后的调试命令（无敌、自动战斗）、要抓的事件和节拍。
  3. `VFX_URL=http://localhost:<端口>/ VFX_OUT=<evidence> VFX_PLAN=<plan.json> pnpm exec forgeax project play <本技能>/scripts/play-preview-events.mjs --json --timeout-ms 900000`
  4. 读 `<plan>-result.json`：`miss` 的目标换时机或换房间再跑。要拍下一个房间（转场、新房间的场景物件），在计划里加 `walk.exits`（每个房间的出口坐标），脚本会在出口打开后关掉自动战斗、用实测按键方向走过去。
  5. 跑完先确认 `<plan>-result.json` 的修改时间是这次的：`project play` 失败时（例如 `play-not-ready` / `session-failed`）不会重写结果文件，读到的是上一次的。
- **B. 共享 dev owner 的页面里驱动**（需要录像、帧时间、页面内抓帧时）：dev owner 必须关 Worker 启动（见踩坑），然后用 `templates/live-driver.ts`（改全局名）+ `scripts/live.mjs`：
```bash
DRIVER=<game>/assets/vfx/live-driver.ts GAME=<game> node scripts/live.mjs eval \
  'await D.start("ink"); D.recStart(); D.timingStart(); await D.fight(20500,{ult:true}); const r=await D.recStop(); return {r,t:D.timingStop()};'
DRIVER=… GAME=… node scripts/live.mjs video <evidence>/V<NNN>-live-20s.webm
DRIVER=… GAME=… node scripts/live.mjs eval 'return await D.snapOn("kill",30000,[["live-kill-soul",280]]);'
DRIVER=… GAME=… node scripts/live.mjs snaps <evidence>
```
- 特效插件要暴露只读统计 `globalThis.<stats>`：`events{kind:count}`、`peakEffects/peakParticles`、`dropped`、`updateMs[]`、主角 / 敌人位置。取证脚本只读它，游戏逻辑永远不读。

### 7. 性能
- 同一局里先开特效测 20 s，再用对照开关关掉特效测 20 s（开关只给取证用），记 p50 / p95 / p99 帧间隔和特效每帧更新耗时 p95、峰值对象数、丢弃数。
- 超标时依次：粒子批只传已用前缀 → 网格值不变跳过更新 → 自适应降级（更新耗时均值 > 2.5 ms 时爆发粒子最多降到 50%，< 1.5 ms 回升；关键演出如 Boss 死亡不降）。

### 8. 提交
- 回归命令（都经 `play.sh`，见踩坑）：官方冒烟 `sh play.sh <隔离副本> scripts/playthrough.mjs --require-ui`；三间房通关先 `ISO_STEP=serve` 起 preview，再 `F001_URL=http://localhost:<端口>/ F001_MODE=full F001_RUNS=2 F001_HEX=mouse F001_OUT=<evidence> sh play.sh <隔离副本> scripts/preview-run.mjs --timeout-ms 1500000`。
- 硬规则：在隔离 preview 上用 `project play` 跑项目的通关脚本 3 次，3 次都通关、console/page 错误 0，才提交；时间来不及就撤回，不提交。
- 只 `git add` 自己的特效文件；工作区里别的会话的改动不碰。提交说明写验证方式和结果。

## 验收标准
- 贴图：`verify-textures` 全部 ok（非噪声贴图边框 alpha=0、最小 alpha=0、有可见像素；噪声全不透明）；重新生成后只有目标贴图字节变化。
- 代码：`tsc` 无特效目录错误；特效单测全过（每个新表现至少一条：数量、节拍、只在条件下出现）；材质编译全部 ok。
- 预览截图：每个表现至少两拍；画面中**无矩形边框 / 方块硬边**；笔触是实心墨体 + 外缘一圈描边，内缝无白线；多道 / 多枚的数量一眼数得清。
- 预警：尺寸与判定数值逐项对表（半径、半角、时长）；压在玩家特效之上；被打断时不出命中特效（只有预警跑满时长 ≥ 70% 才出）。
- 流派 / 变体：实战截图能一眼区分（描边色 + 专属元素）。
- 实战：20 s 录屏一段，附事件计数（攻击、命中、击杀、技能、预警）；峰值对象数、丢弃 = 0。
- 性能：特效每帧更新 p95 ≤ ~2 ms；开 / 关特效帧 p95 差 ≤ ~2 ms；记录测量形态（Worker 开 / 关、是否同时录像）。
- 稳定性：preview 下进最重的房间停 15 s × 3 不崩；通关回归 × 3、错误 0。

## 踩坑与对策

**贴图**
- 生图常有极细干笔，游戏里缩小 5–8 倍后只剩描边。→ 预处理 `thicken`（闭运算 r6 + 膨胀到实色 ×1.5–1.8），而不是在着色器里膨胀（随镜头距离变）。
- 描白边会描到笔触内部的长缝，形成白色杂纹。→ 预处理用大半径（r30）闭运算求外形，把「外形内、墨体外」的像素写进 RGB=0，着色器描边乘以 `smoothstep(0.3,0.8,mask.r)`。
- 贴图边缘只要有一点 alpha，放大后就是矩形边框。→ 4 px 全透明边 + 3 px 渐隐，`verify-textures` 检查边框 alpha=0。
- 扇形预警贴图的张角是画死的（约 48° 半角）；非等比拉伸去适配 130° 的 Boss 扇形会变形，还会在两侧和顶点背后出碎片。→ 方形面片 + 着色器极坐标重映射 + 按真实半角 / 半径裁剪。
- 墨滴点精灵用墨溅第一帧会是一颗小星，7–20 px 时直接消失。→ 墨滴点批不绑贴图，用实心圆点。
- 贴图预处理会整体重写目录。→ 前后用 `texture-diff-guard.sh` 比哈希。

**可读性**
- **点精灵（粒子）不能停在地面上**：点精灵是朝向镜头的方片，中心贴地时下半边被地面深度挡掉，看起来是一片贴在地上的「平面半圆」，而且落地后留得越久越多（QA 实测：朱焰墨滴清完房间后满地红半圆）。→ 下落粒子离地 0.18 m 内淡出；落地只做 0.25 s 的溅开；要留在地上的墨痕 / 灼痕一律用平面网格贴花。余烬类（火星）用负重力上飘、随寿命缩小 + 闪烁淡出。
- 墙面贴花只在朝向镜头的墙面可见：斜俯视下，背对镜头那一侧的墙内面被墙顶挡住。→ 先截一张确认哪面墙可见，只往那一面贴；暗色墙上的黑墨字要加粗贴图（`thicken` ~1.35）、描边加到 3–4 px、尺寸放大到墙高的大半。
- 黑墨在暗色地砖上「看不见」，第一反应以为没渲染。→ 先做对照实验：同一帧放 4 块样本（墨色 / 纸白 × 两种高度）截图，4 块都在就是对比度问题。对策：地面特效不透明度 ≥ 0.9、描边保留到淡出、笔触加宽；剑气类加亮纸白粗描边。
- 竖直面片沿攻击方向放，攻击朝屏幕上下时侧对镜头只剩一条线。→ 竖直元素一律转向镜头（yaw = −相机偏航）。
- 投射物做成沿飞行方向的细长笔触，朝屏幕上方飞时被透视压成一条线。→ 水平旋转月牙。
- 多道剑气从同一点出发会在剑柄处挤成一团。→ 起点外移 0.6 m。
- 对白框 / 标题文字挡住屏幕中央。→ 预览场景整体下移或上移（`SHIFT`），取证时等字幕消失再拍（`noSubtitle`）。
- 后处理的全屏效果（例如雨线斜纹）在大面积纯黑上会显出白色条纹，看起来像特效的 bug。→ 用游戏的后处理开关关掉对照（`capture-preview.sh` 的 `POST=off`），确认后给后处理会话提「转场 / 去色期间减弱」的接口请求。

- 场景类贴花（墙上字、地面指引墨痕、门口墨封）要排除在「玩家特效进入预警区压到 20%」之外，否则只要附近有敌人预警，它们就几乎看不见（实测透明度 0.19）。→ 用一个场景角色集合跳过压暗。
- 墙面贴花的位置不能按碰撞线（可走区域的墙面坐标）算：墙模型的可见内面可能比碰撞线更靠里，贴花会埋进墙里，只从灯笼等缺口处漏出几块白。→ 先往里放 0.3 m 左右实拍确认，并避开靠墙的道具。
- 实战里「看不见」先别猜：在插件只读统计里临时加一个 `probe` 字段（目标特效的透明度、年龄、位置），`play-preview-events.mjs` 会把它写进结果文件；确认后删掉。

**ForgeaX 引擎（0.4.19 实测）**
- **每帧 `assets.update` 带着贴图绑定会让引擎重复发布同一版本贴图，渲染端拒收后崩溃**（preview 下进敌人多、预警多的房间约 5 s 崩，dev 下时序不同复现不了）。→ 参数拆成 `meshNumbers()`（每帧）和 `meshValues(key)`（只建原型时）；加单测断言每帧参数里没有 `texture`。
- 插件模块会被加载多份（各插件 import 的同名模块不是同一实例），模块单例的状态（`run`、事件广播）可能是过期副本。→ 跨插件状态挂 `globalThis`；特效插件登记各副本的广播，采用「实际发出过事件那份」的状态；关键状态（流派等）再从事件推断兜底。信号对象也挂全局，多个实例各自登记贡献、取最大值，否则预览和正式插件互相清零。
- 引擎 Worker 模式（默认 auto）下 `dev eval` 跑在 Worker 里，没有 `document`；页面 UI 与 Worker 各一份游戏状态，曾经卡在标题页、不发战斗事件。→ 先确认游戏有「页面 → 引擎」命令通道（如 `__xxxSend`）；没有就用 `dev start --workers '{"engine":false,"render":false,"kernels":false}'` 开单线程 owner 取证，并提接口请求。注意单线程模式帧时间基线更高，报告里要写明形态。
- 引擎在暂停后 `dev capture` 会卡住（等不到新帧，`live-app-bridge-timeout`）。→ 精确卡帧用页面内 `canvas.captureStream()` + `ImageCapture.grabFrame()`（live-driver 的 `snap`）。
- 中断的 `dev eval` 会一直挂着，之后只能 `status / reload / stop`（`live-eval-running`）。→ 长求值给足 `--timeoutMs`，命令本身别被外层超时杀；挂了就 `dev reload`（只对自己启动的 owner 做）。
- eval 返回值必须是纯 JSON（数组里不能有 `undefined` 之外的引擎句柄），否则 `script-result-unserializable`。
- 同一 eval 里并发两路 `captureStream` 抓帧会冲突报错。→ 抓帧串行。
- Boss 等打断类事件：combat 打断时也发 `end`。→ 用「预警存活时间 ≥ 判定时长 × 0.7」区分真命中。
- 顿帧（hitstop）期间 combat 暂停计时，预警会比时长晚结束。→ 预警寿命 = 时长 + 0.3 s，等 `end` 再收。

**环境与流程（WorkBuddy）**
- **`project play` 报 `play-not-ready / session-failed / browser.newPage: Target crashed`（`browser-capture-failed`），干净基线和 `--headless true` 也一样：不是环境坏了**，是 WorkBuddy 沙箱和引擎自带 Chromium 的沙箱（`chromiumSandbox:true`）冲突。→ 一律用修复会话 skill 的 `游戏预览故障修复skill/scripts/play.sh` 跑 play（它用系统 Chrome + `--no-sandbox`，经 `FORGEAX_BROWSER_EXECUTABLE` 注入，并放空 `ps` 替身），**脚本本身在沙箱外运行**：
  `sh <skills>/游戏预览故障修复skill/scripts/play.sh <项目或隔离副本目录> scripts/playthrough.mjs --require-ui`
  环境变量照常前置（如 `VFX_URL=… VFX_PLAN=… sh play.sh <dir> <本技能>/scripts/play-preview-events.mjs --timeout-ms 900000`）；它把完整输出写进临时日志，只打印最后一行 JSON 和日志路径，别把 play 的 stdout 接 `head`（会杀掉进程）。
- 隔离副本放在 `/tmp`，隔天（尤其周末）会被系统清掉，`git worktree list` 显示 `prunable`。→ 每次开工先 `ls` 副本，不在就用 `isolated-preview.sh ISO_STEP=build` 按同一基线重建。
- 后台任务里的 `project build` 会失败（`native-cook-failed`，`connect ECONNREFUSED …sandbox-broker….sock`）。→ 构建放前台（沙箱外），后台任务只跑 `project preview`。
- `project play` 偶发 `play-not-ready` / `session-failed`：commit 阶段的 `[safe-delete] … spawnSync` 失败，多发生在排队等锁之后、命令被自动转入后台时。→ 锁释放后直接重跑一次；结果文件时间要核对（见步骤 6）。
- 取证脚本要在发出调试命令（无敌、自动战斗）**之前**记下事件计数，并立刻开始盯：自动战斗可能在开场对白期间就清完第一个房间，等对白结束再开始盯就全部错过。
- 沙箱禁止 `ps`，`forgeax dev start` / `project play` / `project preview` 报 `spawn EPERM` / `live-discovery-invalid`。→ `source scripts/ps-shim.sh`，并在沙箱外运行。
- 单轮看图有预算（约 128 MB），批量截图很快用完。→ 先拼 2×2 / 3×2 缩略图再看；需要定位时用像素差分或运行时探针代替看图。
- `/tmp` 会被清。→ 工具脚本放在技能目录或项目内，不要只放 `/tmp`。
- zsh 里把命令存进变量再调用会被当成一个文件名。→ 用函数 `L() { node …; }`。
- macOS `sed -i` 需要 `''`，含中文和括号的替换容易错。→ 用 Python 做「断言锚点存在再替换」，任何一处锚点缺失整份不写。
- 游戏逻辑会话改代码时运行时频繁重载；`dev status` 为 `ready` 再拍；revision 变了要重读。
- `project play` 有项目级锁（`.forgeax/play/lock.json`），别的会话在跑时**等它释放，不要抢锁或删锁**。
- 共享 dev owner 不是自己启动的，就不要 stop / restart；需要特殊配置时用隔离 worktree + preview。
- 相机距离会被别的会话改（例如 22 → 16），预览布局偏移要按「当前距离 / 编写时距离」缩放。
- 预览里同一时刻的多个事件要按书写顺序发（例如击杀先于刷新、出招先于命中），不能倒序遍历。
- 主控常有时间盒（如 2 小时内提交、否则撤回）：先做最小改动 + 单测，立刻进入隔离 preview 回归，不顺手做别的。

## 交接格式
- 报告：`reports/vfx/V<NNN>.md`，结构见 `templates/report-template.md`（结论表 → 改动 → 证据表 → 检查 → 接口请求 → 限制）。长程任务另写 `reports/vfx/V<NNN>-progress.md`，每项一行：`[HH:MM] 项 · 完成/部分/跳过 · 证据 · 下一项`。
- 证据目录：`evidence/vfx/V<NNN>/`。预览图 `<NN>-<表现>-t<秒>.png`（如 `08-telegraph-fan-boss-t0.90.png`）；修订版加 `-v2`；实战图带 `live`（如 `V002-live-transition-a.jpg`、`ink-q3-a.png`）；诊断对照加后缀（`-postoff`）；测量 `NN-perf-*.json`；回归 `<tag>-full-<n>.json`。
- 接口请求：表格，按字母连续编号（跨任务不重用），每条写事件 / 字段形状、缺省值、特效侧的兜底、为什么需要；被裁定后在下一份报告里写「落实情况」。
- 回报主控时必须写：提交号、只改了哪些文件、验证命令与结果（几次、错误数）、哪些只是预览、需要谁决定什么。

## 参数（换项目只改这一节）

| 项 | 墨刃 / inkblade 的值 |
|---|---|
| 游戏根目录 | `/Users/huangjifeng/Desktop/1/inkblade` |
| 特效代码 / 贴图目录 | `assets/vfx/`、`assets/art/vfx/`（贴图 32 张，GUID 命名空间 `inkblade/v001/texture/`） |
| 概念图目录 | `/Users/huangjifeng/Desktop/1/arpg-command-center/assets/concepts/vfx-*` |
| 报告 / 证据 | `arpg-command-center/reports/vfx/`、`arpg-command-center/evidence/vfx/V<NNN>/` |
| 引擎 | `@forgeax/engine 0.4.19`；后处理 `assets/ink/ink.pack.ts`（读 `vfxSignals`） |
| 特效包 ID | `e4d86ad0-6535-4f2c-9e5c-56798fbe1001`；着色器模块 `inkblade::vfx_surface` |
| 事件源 | `assets/combat/events.ts`，`onCombatEvent()`；敌人坐标 `run.spots[enemy]=[x,z,hp]` |
| 相机 | `assets/view/oblique.ts`：yaw 38°、pitch 49°、距离 16（Boss 32）、FOV 30°；`FACE_CAMERA=-38°` |
| 色板 | 墨 `[.035,.045,.065]`；纸白描边 `[.88,.84,.74,.85]`；亮纸白 `[1,.97,.9]`；朱红 `[.85,.055,.025]`；预警描边 `[1,.32,.16,1]`；余烬 `[1,.36,.08]`；黄铜 `[1,.78,.32]`；灼痕 `[.30,.035,.02]` |
| 描边 | 默认 2.5 px；多道剑气 5 px；暴击 ×2.2 |
| 预警判定 | 傀儡扇形 R2.1/半角 0.85/0.8 s；Boss 扇形 R3.4/1.15/1.0 s；Boss 圆 R2.6/1.2 s；针兵直线 9×0.6/0.6 s；Boss 槽位 5 |
| 上限 | 网格 80、粒子 768、预警 16；Boss 死亡 312 粒子 / 2 s |
| 贴图加粗 | `line 1.8, slash 1.5, slash-wide 1.5, mist-00..02 1.8` |
| 调试全局 | 页面：`__inkView`（状态）、`__inkSend({t:'god'|'auto'|'boss'|'hex',…})`、`__inkSet(bool)`（后处理开关）；引擎：`__inkRun`、`__inkVfxStats`、`__inkVfxSignals`、`__inkVfxCamera`、`__inkVfxOff`（性能对照） |
| 开局按键 | Enter 推进标题 / 台词；数字键 1/2/3 选流派（墨锋 / 朱焰 / 机关），再按一次确认；F2 无敌；F4 跳 Boss |
| play 包装 | `/Users/huangjifeng/Desktop/1/arpg-command-center/.workbuddy/skills/游戏预览故障修复skill/scripts/play.sh`（系统 Chrome `/Applications/Google Chrome.app`，可用 `FIX_CHROME` 覆盖） |
| 回归脚本 | 官方 `scripts/playthrough.mjs --require-ui`；`scripts/preview-run.mjs`（`F001_URL`、`F001_MODE=corridor|full`、`F001_RUNS=3`、`F001_HOLD=15`、`F001_OUT`） |
| 构建 | `pnpm exec forgeax project build --html-head boot/ink-loading.html`；preview 端口用 4811–4813 |
| 性能基线 | 单线程模式（Worker 关）：关特效 p95 19.5 ms、开特效 20.9 ms、特效更新 p95 2.06 ms |
