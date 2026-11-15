---
name: game-concept-prompt-batch
description: 为游戏建立统一画风并批量生成概念图：定设计目标与审美原则 → 风格锚点 → 同构图的「游戏画面目标图」选画风 → 写可批量执行的 PROMPTS.md（风格前缀、背景块、命名、勾选表）→ 交给生图执行者（Codex 等）批量出图 → 逐张审图、重生提示词。触发词：生图提示词、概念图、风格锚点、画风、PROMPTS.md、批量生图、审图、风格统一检查、设定板、三视图、重生、keyart。
---

# 游戏概念图：画风确定与批量生图

## 适用场景 / 不适用

**适用**
- 新游戏或新关卡开工，需要一套画风统一的图：场景氛围图、地面和墙面贴图、角色三视图（给 3D 用）、道具参考、特效贴图、UI 素材。
- 生图由另一个执行者（Codex 或用户手动）完成，本会话负责写规格、审图、给重生提示词。

**不适用**
- 把图做成 3D 模型：交给 `3D资产制作skill`。
- UI 切图和拼装、特效 Shader：交给 `UI设计skill`、`水墨特效制作skill`。

## 输入

- 设计文档里的美术决策：视角、镜头角度、配色比例、禁用颜色、主题场景、叙事一句话。
- 资产清单：每个资产怎么进游戏（直接贴图 / 3D 参考 / UI / 特效 / 只作风格参考）。
- 资产合同：目录和命名规则（`assets/concepts/<asset-id>/<asset-id>__<view>__v<NN>.png`）。
- 生图工具及其限制：最大尺寸、能否选模型、是否支持负面词。不支持负面词的工具，要把负面词改写成「Do not include: …」。
- 可选：制作人给的参考作品。只能当文字描述的参考，不能当底图（版权）。

## 步骤

### 1. 先写设计目标和审美原则（不针对任何生图工具）
在 PROMPTS.md 开头写「A 节」（模板见 `templates/PROMPTS.template.md`）：
- 一句话设计目标，以及画面必须让玩家一眼看清的三件事（一般是主角、危险、方向）。
- 每个美术元素承担什么表达功能，例如低饱和带来肃杀，一抹红制造焦点，破败表达衰落。方法和例子见 `references/art-direction-method.md`。
- 列出该题材的 AI 俗套（AI 最爱反复生成的元素），写进负面词。
- 每个主要资产设计 1–2 个**可控差异（签名设计）**：写清楚它表达什么、靠什么控制（颜色、明度、位置、比例）。

### 2. 风格锚点
- 先生成一张游戏镜头下的关键画面（keyart），用户挑一张作为锚点。**锚点批准之前不批量生图。**
- 锚点里要有主角、一种敌人、一个危险预警和主场景元素，后面所有图都附它当风格参考。
- 签名设计改了（例如全院只留一棵红树），就先出一张签名版锚点验证差异成不成立，再批量。

### 3. 同构图的「游戏画面目标图」选画风
- 用**完全相同的构图和机位**（游戏相机，例如斜俯视 55°）、相同的元素，出 2–3 张不同画风的游戏画面图。例如：A 是水墨渲染，B 是手绘平涂加描边，C 是写实 PBR。
- 让用户选。选中的那张就是之后的「**画面验收标准图**」：引擎画面和所有素材都对照它。可以场景和角色各选一张标准图。
- 把定下来的画风写成三段英文**风格前缀**：场景（S-SCENE）、角色和道具（S-CHAR）、特效（S-VFX）。

### 4. 写批量清单 PROMPTS.md
按 `templates/PROMPTS.template.md` 写：
- **背景块**按用途固定：BG-3D 灰底给 3D 参考，BG-PLAN 正上方平面图，BG-TILE 无缝贴图，BG-VFX 黑底白元素（亮度当透明度），BG-UI 白底。
- 清单每行写：编号、asset-id / view、**进游戏方式**、画幅、背景块、英文正文、追加负面。
- 3D 参考图一律要求：纯灰底、无投影、A 字姿势、四肢分开、武器不遮挡身体；侧视要求「exact 90 degree side profile facing right」；背视要求「camera directly behind, no face visible, heels toward camera」。
- 角色先出设定板（sheet）定稿，再出 front → side → back；后面几张都附 front 和设定板。
- 地面整图用 `plan`（正上方正交），不要用斜俯视；特效图用黑底白墨。
- 写好勾选表 §4 和「保留的现有图」§5。

### 5. 交给生图执行者
- 用 `templates/batch-executor-prompt.md` 填好后整段交给执行者，或让用户转交。
- 要写清楚：开工前检查（参考图存在）、提示词怎么拼、参考图规则、不覆盖文件、`.prompt.txt` 日志、自查只看哪几项、写入边界、汇报格式。
- 批量阶段让执行者「疑似问题也不重生」，最后由审图统一判断；单张定向重生时，再允许它最多重生 2 次。

### 6. 审图
脚本需要 Pillow：没有就执行 `python3 -m pip install --target /tmp/pylib pillow`，命令前加 `PYTHONPATH=/tmp/pylib`。`scripts/` 是相对本 skill 目录的路径。
1. 生成拼图：
   ```
   python3 scripts/contact_sheet.py --groups <concepts> <evidence>/
   python3 scripts/contact_sheet.py <evidence>/x_check.jpg a.png b.png …    # 关键图放大并排
   ```
2. 数值统计：`python3 scripts/review_stats.py <concepts> <evidence>/stats.json`
   - 看禁用颜色占比、四角背景色（灰底是否约 128，黑底是否为 0）、尺寸和画幅。
3. 逐组看图，按「验收标准」打标记。审图报告按 `templates/review-report.template.md` 写。
4. 需要重生的图，给出**改过的完整提示词**：把错的地方改成正面描述，再加明确禁止，例如「the tip is completely MISSING and must not appear anywhere」。

### 7. 收尾
- 旧图移到 `assets/concepts/_archive/`，可以恢复，不删除。
- PROMPTS 换大版本时，旧版也归档。
- 采用哪一版写进审图报告，后面的流程按报告取图。

## 验收标准（审图逐张检查）

| 项 | 标准 |
|---|---|
| 设计目标 | 能表达 A 节的设计目标；签名设计在、方位对（左右不对称件要分清是角色自身的左右还是画面的左右） |
| 可读性 | 在游戏相机下，主角是全图对比度最高的元素；危险预警一眼可见 |
| 风格统一 | 和锚点或标准图的笔触、材质、配色比例一致；数值上禁用颜色占比 ≈ 0（预警、血、关键 UI 除外） |
| 视角正确 | front 平视；side 是纯侧面；back 看不到脸、前襟和鞋尖；plan 没有透视和地平线；topdown 符合游戏相机角度 |
| 3D 可用（3D 参考类） | 纯灰底、无投影、全身入画、A 字姿势、四肢分开、配件不遮挡躯干；多视图之间服装、比例、左右不对称件一致 |
| 贴图可用（tile / plan） | 正上方平光；没有雨丝、反光焦点、物体；tile 四边可以接上（不行就交后期偏移修补） |
| 特效 / UI | 黑底只有白元素，或白底居中留边；没有格线、数字、文字；序列帧每格不越界 |
| 文字水印 | 一律没有（标题带字尝试单列例外） |
| 俗套 | 没有 A.3 里拒绝的元素 |

**豁免，不作为重生理由**：尺寸低于规格（工具上限）、画幅略有出入、纯侧面时双腿前后重叠。

判定标记：✅ 采用 · 🔧 可用、后期修 · 🔁 重生（附提示词）· ⏸ 备选 · ⏳ 待定。关键项（签名设计、视角、禁用颜色、左右件）有一项不符就是 🔁。

## 踩坑与对策

- **生图工具的尺寸上限**：16:9 约 1672×941，2:3 为 1024×1536，1:1 为 1254×1254，3:1 为 2172×724，2:1 为 1774×887。规格写 2048 也出不来，**不要让执行者因为尺寸重生**；贴图类之后放大。
- **画幅不听话**：要 4:1 时只给 3:1。重生两次也不会变，直接接受，或者后期补边。
- **模型名查不到**：Codex 的 image_gen 不返回模型名，日志写「模型未知」，manifest 的 generator 也如实写，不编造。
- **侧视最容易错成 3/4 侧**：加「exact 90 degree side profile, orthographic」，并附 front 作参考。
- **背视最容易「背面长脸」**：会画出前襟、腰带结、正面鞋尖、面具。要写明「back of head is smooth, no mask, no face, heels face the camera」，并点名背后应有的部件，例如发条钥匙、烟囱。
- **断口、缺口这类「缺失」特征**：模型倾向画成「裂了但还在」。要写「completely MISSING, must not appear anywhere」，并在负面词里加「separate fragment, intact blade」。
- **贴图类会被画成整幅场景**：墙、瓦、木的 tile 第一轮生成了带柱子、灯笼的场景。要用 BG-TILE，并在正文里写「material surface only, no objects, no scene」。
- **地面平面图带雨丝**：雨是场景氛围，写进平面图就会被当成贴图花纹。plan 和 tile 的负面词里加「rain streaks, reflections of sky」。
- **圆形预警画成椭圆**：写「straight top-down orthographic, perfect circle」。
- **背景块拼错**：执行者会把 BG-3D 拼给场景图。每行都写明背景代号，并让执行者把最终提示词全文写进 `.prompt.txt` 以便追查。
- **红色泛滥**：漆柱、符纸、绑绳、小灯都会自己变红。颜色写成具体的「deep muted oxblood-ochre faded to grey」，并用统计脚本查红色占比。
- **俗套回流**：不写负面词时，红灯笼、竹林、满月、摆拍侠客会反复出现。场景类统一加俗套负面词。
- **签名设计在锚点里画不出来**：例如帽檐缺口、单侧手臂的特殊材质。不要死磕锚点，放到角色资产包和 3D 阶段补。
- **自动重生会越修越偏**：批量阶段不让执行者自己重生；重生只针对具体问题，旧版本保留。
- **外部素材**：只用 CC0 底图（例如 Poly Haven），并记录来源 URL、作者、许可。受版权保护的游戏截图只能写成文字描述。写实 CC0 贴图和手绘画风冲突，最后可能整体弃用。

## 交接格式

- **规格**：`assets/concepts/PROMPTS.md`（vN），A 节审美原则 + §0 规则 + §1 风格前缀 + §2 背景块 + §3 清单 + §4 勾选表 + §5 保留图。
- **图片**：`assets/concepts/<asset-id>/<asset-id>__<view>__v<NN>.png`，旁边是同名 `.prompt.txt`。
- **审图报告**：`reports/assets/<任务号>.md`；证据放 `evidence/assets/<任务号>/`（stats.json、分组拼图、放大对比）。
- **对话回报**：结论 3 行（锚点、整体统一、可否进入下一步）+ 重生几张（列 id 和原因）+ 后期修几张 + 待用户决定的事项（附推荐）+ 下一轮给执行者的完整指令。

## 参数（换项目只改这一节）

| 参数 | 墨刃（inkblade）当前值 |
|---|---|
| 项目根 | `/Users/huangjifeng/Desktop/1/arpg-command-center` |
| 清单 / 归档 | `assets/concepts/PROMPTS.md`（v4）；`assets/concepts/_archive/` |
| 游戏相机 | 斜俯视约 55°（参考《哈迪斯》），仅 PC 键鼠 |
| 设计目标 | 「剑断了，恨没断」；雨夜天工坊外院 |
| 画风 | 画风 D：地面和墙《哈迪斯》式手绘、不描边；角色和道具 2 档硬色阶 + 黑色外轮廓；特效水墨笔触 |
| 标准图 / 锚点 | 场景 `env-courtyard-ingame__topdown__v03.png`；角色 `env-courtyard-ingame__topdown__v02.png`；配色 `env-courtyard-keyart__topdown__v03.png` |
| 配色 | 黑白灰约 70% / 赭石靛青约 20% / 朱红 <10%；信号红（朱红）只给危招、暴击、血、关键 UI；地标红（暗朱砂，哑光不发光）只给饮魂枯树；黄铜和暗金为唯一暖色点缀 |
| 俗套负面词 | red lanterns, bamboo, full moon, cherry blossoms, pagoda silhouette, plaques with writing, hero posing with sword raised, red scarf |
| 签名设计 | 主角：缺角斗笠（角色右前方）、右前臂墨臂、左腰长剑；场景：全院唯一的饮魂枯树；Boss：庙宇金刚改造的战偶 |
| 生图执行者 | Codex 内置 image_gen（模型名不可查）；尺寸上限见「踩坑」 |
| 禁用颜色统计阈值 | 红：HSV 色相 ≤18° 或 ≥342°、S>0.5、V>0.35 |
