---
name: game-ui-skin-pipeline
description: 用 AI 生图为网页游戏做整套 UI 皮肤：UI 规格 → 效果图方案 → 用户选定 → 切图清单与提示词 → 黑底转透明上色 → HTML 拼装预览 → 内联 WebP 进 ForgeaX → 对接说明。也含剧情立绘和插画的抠图裁切。触发词：做 UI、UI 换皮、UI 美术、HUD 美术、效果图、mockup、切图、九宫格、border-image、立绘、开场插画、皮肤不显示、preview 下 UI 图裂了。
---

# 游戏 UI 皮肤流水线

## 适用场景 / 不适用

适用：DOM + CSS 做 UI 的网页游戏，图由外部生图工具（GPT / Codex 等）生成；风格要统一，文字用字体渲染。

不适用：
- 引擎内 3D UI、世界空间 UI；
- 概念图和场景批量生图（用 `概念图与批量提示词skill`）；
- 特效贴图（用 `水墨特效制作skill`）；
- 纯 CSS 就能画完的工具型界面。

本 Skill 的工作方式：**你写规格和提示词，用户负责生图，每个闸门停下等用户。** 你自己不生图。

## 输入

| 需要 | 说明 |
|---|---|
| UI 规格 | 界面清单（编号、内容、布局、交互）、布局图、统一视觉语言。没有就先和用户定 |
| 风格参考图 | 游戏实机画风、配色、已有 UI 素材 |
| 文案 | 菜单、技能、叙事台词，用于效果图 |
| 目标引擎 | ForgeaX 或其他。决定步骤 8 走内联还是普通静态资源 |
| 现有占位 UI | 如果已有，读 DOM 的 id / class，对接表按它写 |

先填好文末「参数」一节。环境只需一次：

```sh
PY=$(sh <SKILL_DIR>/scripts/setup_env.sh | tail -1)
```

`<SKILL_DIR>` 是本 Skill 目录。后面所有 Python 命令都用 `$PY`；换了 shell 就重新运行这一行。环境默认在 `~/.cache/game-ui-skin/venv`，用环境变量 `UI_VENV` 可以换位置。

## 步骤

### 0. 确认规格（闸门：缺规格就停下问用户）
核对「输入」表。没有界面清单、布局和色彩规则时，先和用户定下来再往下走，不要自己编。

### 1. 写总清单（闸门：写完停下）
复制 `templates/UI-ART.template.md` 到 `<UI_DIR>/UI-ART.md` 并填写。效果图提示词骨架在 `references/slice-prompts.md` 开头。
- 定 3 个差异足够大的风格方向，各写一个英文方向块。差异在结构上（比如有框 / 无框 / 机械框），不要只换颜色。
- 标题、HUD、选择卡这 3 屏最影响观感，各出 A、B、C 三版，共 9 张。其他界面先不出。
- 每屏的提示词写成「共用正文 + 该方案追加正文」，共用正文里写全这屏必须有的元素和数量。
- HUD 的提示词里要写：HUD 总面积上限、中央保持干净、哪个角要留空。

用户在生图工具里生成。给用户的指令用 `templates/codex-batch.md`，文末有 mockup 的替换段。

### 2. 审图并让用户选定（闸门：等用户选）
逐张看图，按「验收标准 · 效果图」检查。把建议告诉用户，由用户选定。复制 `templates/review-report.template.md` 写审图报告，内容：
- 选定方案，以及不再出 mockup 的界面沿用哪套语言；
- 色彩使用规则定稿（允许的位置逐条列，禁止的也列）；
- 每个选定方案的修正项：元素数量错、混入别的方案、错字、缺状态、位置不对。

可以混搭：不同界面选不同方向。用户选定后追加的改动（顺序、菜单项）也记进报告。规格文件归别人管时，只在报告里列出「需同步」，不要自己改。

### 3. 写切图清单（闸门：写完等用户生图）
按元素拆分，追加到 UI-ART.md 的「切图清单」。提示词模板在 `references/slice-prompts.md`，每张写成完整提示词，以选定 mockup 为参考图。
- 先做复用：同一张笔触可以当血条填充、短标记、按钮。总数尽量控制在 20 张以内。
- 每张定「背景类型」：
  - **K（黑底白元素）**：单色元素，比如笔触、遮罩、晕染。一张可以着多种颜色。
  - **T（透明或绿底）**：带多种颜色或材质的元素，比如卡框、徽章。
- 切图一律不带字。字由 DOM 渲染，印章、角标也只做底图。
- 每张写交付尺寸（CSS 尺寸和 @2x）、九宫格参数和复用位置。

九宫格参数写成 `border-image-slice` 百分比（基于去空边后的图），写法：

```css
border:0 solid transparent; border-width:<上> <右> <下> <左>;
border-image:url(<文件>) <slice> fill / <border-width> stretch;
```

「横拉」元素只切左右：`0 30% 0 30%`，元素高度等于图的 CSS 高度。

分两批生成：先生不能砍的界面（HUD、Boss、字幕、选择卡、标题），再生其余。

### 4. 审切图
```sh
$PY <SKILL_DIR>/scripts/audit_slices.py <UI_DIR>/slices
```
旗标含义见脚本头部说明。旗标只是提醒，每张都要再看图确认。处理方式：

| 现象 | 处理 | 重生吗 |
|---|---|---|
| HALO：单色元素的「透明」图带光晕 | `$PY <SKILL_DIR>/scripts/cutout.py chroma --in x__v01.png --out x__v02.png --dominant <r\|g\|b> --color '#元素色'`，spec 指向 v02。青、黄等双通道色加 `--min 10 --range 15` | 不用 |
| HALO：多色元素 | chroma 只能留一种颜色，别的颜色会丢 | 要，改绿底 |
| DIM：黑底图偏暗 | 转换时自动归一化 | 不用 |
| HOLLOW?：实心元素中心发暗 | spec 里加 `"fill": true`；条状笔触用 `"fill": 40` | 不用 |
| HOLLOW?：本来就是空心框 | 忽略 | 不用 |
| TOUCH 且看图确实被裁切 | 重生 | 要 |
| 图里有字、有多个元素、形状错 | 重生 | 要 |

Codex 自查说「疑似裁切」时，以脚本的内容框为准。

### 5. 转换
以 `templates/slices.spec.example.json` 为起点写 `<UI_DIR>/slices.spec.json`，运行：

```sh
$PY <SKILL_DIR>/scripts/build_slices.py --spec <UI_DIR>/slices.spec.json --src <UI_DIR>/slices --out <UI_DIR>/export
```
产出 `<UI_DIR>/export/<screen>/<element>[-<tint>].png` 和 `manifest.json`。
`box` 是 @2x 像素。横拉元素写 `"fit":"height"`，全屏元素写 `"fit":"stretch"`。规格字段见脚本头部说明。

### 6. HTML 拼装预览
把 `templates/preview.html` 复制到 `<UI_DIR>/preview/index.html`，把一张**不含 UI** 的实机或场景图放到 `<UI_DIR>/preview/bg.png`，改 `:root` 里的色板和卡片字色、文案、尺寸，让每个界面用真实切图拼出来。模板里的文件名对应示例 spec，改了 spec 就要同步。

```sh
$PY <SKILL_DIR>/scripts/shot_preview.py --html <UI_DIR>/preview/index.html --screens title,hud,boss,cards,pause,death --out <UI_DIR>/preview/shots
```
`?s=<screen>` 选界面，`--screens` 的名字和模板 `nav` 按钮的 `data-s` 一致；转场有持续动画，单独打开看。看截图，发现切图问题回到步骤 4–5，布局问题在 CSS 里改。这份页面就是后面的参考实现，CSS 要能直接抄走。

### 7. 写对接说明
复制 `templates/integration-report.template.md` 写报告，要有：切图 → DOM 对照、CSS 尺寸、九宫格、动效表、**文字层级表**、验收清单、已知风险。DOM 名沿用现有占位。相比占位要改的结构单独列出来。

接入代码由谁写按项目分工。**如果你不负责写游戏代码，到这里交付**；步骤 8、9 写进对接说明，交给集成方执行。

### 8. 接入游戏
**ForgeaX（0.4.x）**：图不能走文件路由，必须内联。

1. 把 `export/` 复制到游戏仓库的皮肤目录。
2. 写 boxes 文件（格式见 `templates/boxes.example.json`），值是每张图在 UI 舞台上**最终实际**的最大 CSS 框。
3. 生成内联模块：
   ```sh
   $PY <SKILL_DIR>/scripts/inline_skin.py --skin-dir <皮肤目录> --boxes boxes.json --out <UI代码目录>/skin-images.ts --used-in <样式文件>
   ```
   输出里 `notInBoxes` 是磁盘上没用到的图，`unreferenced` 是 boxes 里样式没引用的图。正常情况下 `unreferenced` 为空，`notInBoxes` 里的图要确认是有意不用。
4. 在样式里每张图只写一次，作为 `:root` 的 CSS 变量，其他地方用 `var()`：
   ```ts
   const skinVar = (file: SkinFile) => `--skin-${file.replace(/\.png$/, '').replace(/[^a-z0-9]+/g, '-')}`;
   const images = (Object.keys(skinImages) as SkinFile[]).map((f) => `${skinVar(f)}:url("${skinImages[f]}")`).join(';');
   ```
5. 舞台固定 1920×1080，用 `transform: scale(min(宽/1920, 高/1080))` 等比缩放。全局按钮重置必须是零优先级：
   ```css
   :where(#ui-stage button){font-family:inherit;background:none;border:0;color:inherit;cursor:pointer}
   ```
6. DOM 只放在 frontend 插件，不进 Engine Worker。
7. 改了切图后：重跑 build_slices → 复制 → inline_skin → 重新构建。

**其他引擎**：跳过 2–4，按引擎的静态资源方式引用 `export/`，其余相同。

### 9. 实机验证
只在 dev 下看不算数，必须在**构建产物**上验。ForgeaX：

```sh
pnpm exec forgeax project build --html-head <加载页 html>
pnpm exec forgeax project preview --port <端口>
# 用真实键鼠逐屏截图的脚本，在里面调用 scripts/skin-check.mjs
pnpm exec forgeax project play <脚本> --json
```
截图放到一个目录，文件名和参考截图相同，然后并排比较：

```sh
$PY <SKILL_DIR>/scripts/compare_shots.py --ref <UI_DIR>/preview/shots --live <实机截图目录> --out <对比目录>
```
按「验收标准 · 实机」逐项过。最终 zip 要解压后用普通静态服务器（`python3 -m http.server`）再跑一遍同样的截图脚本。

### 10. 立绘和插画（可选）
提示词模板在 `references/slice-prompts.md`。原图存 `<UI_DIR>/story/_raw/<名字>__v01.png`，最终文件放 `<UI_DIR>/story/`。

```sh
$PY <SKILL_DIR>/scripts/cutout.py portrait --in _raw/a__v01.png --out a.png --size 1024 --check /tmp/a-check.png
$PY <SKILL_DIR>/scripts/cutout.py cover --in _raw/b__v01.png --out b.png --size 1920x1080
```
`--check` 输出暗底合成图，看有没有残留灰底、有没有把人物抠出洞。封闭区域残留噪点时加大 `--tol`（如 34）。图同样要走步骤 8 内联。

## 验收标准

### 效果图
| 项 | 标准 |
|---|---|
| 不挡战斗 | HUD 总面积 < 8%；只在四角和上下边；屏幕中央 60% 区域干净；引擎信息条位置留空 |
| 字号（1080p） | 主标题 ≥ 120 px；界面标题 ≥ 56；菜单 ≥ 40；字幕 ≥ 32；卡片说明 ≥ 24；按键角标 ≥ 18 |
| 对比度 | 文字和背后底色目测 ≥ 4.5:1；浅色字压场景时必须有深色衬底或描边 |
| 警示色 | 只在规定位置；单屏面积 ≤ 5%（地面预警和大招除外） |
| 风格 | 和实机画风同一世界；无发光、无手游金框宝石感 |
| 信息完整 | 规格列出的元素都在，数量正确，位置和布局图一致 |

### 切图
- 无字，单元素，未被裁切（`audit_slices.py` 无 TOUCH，全屏元素除外）。
- 无 HALO。实心元素无 HOLLOW。
- 转换后叠在**中灰和实机暗底**上各看一次：无空洞、无白边或绿边。

### 实机
- 每屏和预览截图并排比较，位置、大小、颜色一致。
- 页面检查：皮肤变量解码失败数 0，`/@fs/` 请求 0 次，console 和 page 错误 0。标题和首场战斗各检查一次。
- 1920×1080 和 1280×720 下都不溢出。
- 警示色只出现在规则列出的位置。
- 深色填充满值时，在暗场景上也看得出是满条。
- 同一时刻屏幕文字不重叠：教学、横幅、对话、暂停卡逐对互斥检查。
- 对话框和立绘不挡主角；Boss 登场时 Boss 和主角都在画面里。
- 插画上的字幕在最暗和最亮的插画上都读得清。
- 键盘和真实鼠标点击（按住约 100 ms）都能操作菜单和选择卡。
- 规格里的元素逐项对照：徽章内容、提示行、统计项都在，不只是框在。
- zip 解压到静态服务器后结果相同。

## 踩坑与对策

### 生图
| 现象 | 对策 |
|---|---|
| 模型不按指定画布，实际尺寸几乎都偏离 | 不是问题。流程不依赖原始尺寸，转换时去空边再缩放 |
| 「透明」PNG 里烤进整片灰白光晕（半透明像素 79% 且铺满画布） | 体检看 HALO，用 `cutout.py chroma` 抠。整张单色元素优先改走 K 类 |
| 黑底元素整体发灰（最亮只有 82） | 按第 99 百分位归一化后可用，不用重生 |
| 黑底元素中心发黑、只有边缘亮。提示词已要求「画亮」仍然出现 | 已验证：`fill` 形态学填实。推断（未实测）：提示词里写 ink / dense core 让模型把主体画黑，所以模板改写 solid white |
| 效果图里元素数量错、混入别的方案、写错字 | 正常现象，不重生。记进修正项，切图阶段按规格来 |
| AI 写的中文不可控 | 切图不带字；印章内部留空 |
| 叙事插画方向画反（「走出门」画成走进门） | 提示词先写镜头站在哪一侧，再写动作。交给执行者时要求自查方向 |
| 立绘用透明底容易带晕 | 用纯灰 `#808080` 底再抠。灰底实际不完全平，脚本取四边中位数 + 连通域 |
| 立绘宽幅构图，肩臂贴边 | 接受，底对齐摆放；或在提示词里写每边留边距 |
| 执行者看到问题就想重生，或擅自后期 | 指令里写明：有问题只写备注，不重生，不后期 |

### 转换和预览
| 现象 | 对策 |
|---|---|
| 横拉元素按 contain 缩放后被压矮（64 高变 46） | 用 `"fit":"height"`，宽度靠九宫格拉 |
| 条状笔触 `fill:true` 填不满 | 用大迭代数（如 40） |
| 判断贴边时，零星噪点让四边都算贴边 | 脚本用开运算 + 覆盖率 > 3% 判定 |
| 被线条围住的底灰抠不掉（帽檐、剑、脸之间） | 脚本同时去掉大块封闭区域，阈值收紧到 0.7 倍，防止抠掉衣服上的灰 |
| 预览底图里画着 UI，被误认为是切图 | 用不含 UI 的底图；用了就在对接说明里写明 |
| 预览里背景压太暗，大笔触看不见 | 主视觉界面压暗要轻（约 0.28），弹窗界面约 0.62 |
| `backdrop-filter` 去色在无头截图里没生效 | 去色加在游戏 canvas 的 `style.filter` 上 |
| `cutout.py chroma` 报没有像素通过筛选 | `--dominant` 选错，或者元素是青、黄这类双通道色，按报错调参数 |
| 无头截图不报错也没有产物 | 缺 `--no-sandbox`。`shot_preview.py` 已带上，优先用 Playwright 的 chrome-headless-shell |
| macOS 没有 `timeout` 命令；这个环境里 `sed -i ''` 会失败 | 用 Python 超时和文本替换 |
| Python 缺 PIL；`/tmp` 里的 venv 隔天消失 | 用 `setup_env.sh`，环境放 `~/.cache` |

### 接入和实机
| 现象 | 根因 | 对策 |
|---|---|---|
| dev 正常，preview 和 zip 里皮肤全没 | `/@fs/绝对路径` 只有 dev 服务器能解析 | 内联 data URL，验证 `/@fs/` 请求为 0 |
| Pack cooking 报 `glob is not a function` 或 `uncaptured program input` | 插件模块在 Node 里 cook，不能用 `import.meta.glob` 或资源导入 | 同样用内联常量模块 |
| 按钮笔触和卡框从来没显示，dev 下也没有 | `#stage button{border:0}` 优先级高，清掉了 `border-image` | 重置写在 `:where()` 里 |
| 同一张图在多处用，样式表膨胀 | data URL 被写了多遍 | 只在 `:root` 写一次，用 `var()` |
| 内联图体积偏大 | 没有按实际显示框缩 | boxes 用最终 CSS 框，集成时尺寸改过要同步。这样 PNG 11 MB 转 WebP 2.9 MB |
| 真实鼠标点击选不中，键盘正常 | 卡片每 40 ms 重建，mousedown 和 mouseup 落在不同元素上 | 选项不变时不重建 DOM，只改 class。测试用按住约 100 ms 的真实点击 |
| 用鼠标时选中音不响 | 反馈只挂在键盘路径上 | 键盘和鼠标走同一个选择函数 |
| 鼠标停在面板位置时打开暂停，高亮落到危险项 | 悬停即选中 | 打开时默认第一项，鼠标实际移动后才跟随 |
| 深色填充满血时像空条 | 深色压暗场景 | 深色填充加浅色细边。**预览必须用暗场景看** |
| 深色字压暗插画几乎看不清 | 字幕沿用了亮底样式 | 插画上一律浅色字加深色衬底或描边 |
| 教学句和横幅叠在一起，读成一句乱话 | 多个提示共用同一位置 | 对接说明写文字层级表，提示排队或分区 |
| 暂停时对话框还显示，和暂停卡重叠 | 对话层不跟随暂停 | 暂停、死亡时隐藏对话和教学层 |
| 立绘对话框占屏幕下方约 1/4，挡住主角 | 对话层比规格的字幕条大得多 | 先算对话框占屏比，再确认不挡主角 |
| 选择卡徽章是空框、提示行缺失 | 集成时按切图做，文字内容漏了 | 对接表里把 DOM 内容写全，验收逐项对 |
| 满格描边是一个方框 | 用了 CSS `outline`，它不跟随图形轮廓 | 描边烘进图，或用 `drop-shadow` |
| 指定字体没有生效，回退到系统宋体 | 没有打包字体文件 | 对接说明写清字体文件和打包方式，或定稿时就用系统字体 |

## 交接格式

| 交付 | 位置 | 内容 |
|---|---|---|
| 总清单 | `<UI_DIR>/UI-ART.md` | 提示词、切图表、勾选表 |
| 原始图 | `<UI_DIR>/mockups/<screen>__opt<A\|B\|C>__v01.png`，`<UI_DIR>/slices/<screen>/<element>__v01.png`，各带 `.prompt.txt` | 不覆盖，版本号递增 |
| 转换配置 | `<UI_DIR>/slices.spec.json` | 改切图后可重跑 |
| 游戏用图 | `<UI_DIR>/export/` | 带 `manifest.json` |
| 拼装预览 | `<UI_DIR>/preview/index.html`，`preview/shots/*.png` | CSS 参考实现 |
| 审图报告 | `<REPORT_DIR>/<任务号>-review.md` | 选定方案、色彩规则、修正项、切图审查 |
| 对接说明 | `<REPORT_DIR>/<任务号>-integration.md` | 按模板 |
| 实机证据 | `<EVIDENCE_DIR>/shots/`，`compare/`，`skin-check` 结果 | 交付时必须有 |

回报时写清：产出路径、用户选定了什么、哪些问题已修、哪些需要别人同步、还有什么没验证。

## 参数

换项目只改这一节。下面是《墨刃》（inkblade）的取值。下一关直接用。下一款游戏：把整个 Skill 目录复制到新项目的 `.workbuddy/skills/` 再改这一节，不要改这份。其他文件不含项目值，模板和示例 spec 里的色值是占位。

| 参数 | 值 |
|---|---|
| `<UI_DIR>` | `/Users/huangjifeng/Desktop/1/arpg-command-center/assets/ui` |
| `<REPORT_DIR>` | `/Users/huangjifeng/Desktop/1/arpg-command-center/reports/ui` |
| `<EVIDENCE_DIR>` | `/Users/huangjifeng/Desktop/1/arpg-command-center/evidence/fix/<任务号>` |
| 游戏仓库 | `/Users/huangjifeng/Desktop/1/inkblade` |
| 皮肤目录 | `inkblade/assets/art/ui/skin/` |
| UI 代码 | `inkblade/assets/ui/skin-hud.ts`（样式和 DOM），`skin-images.ts`，`story-plates.ts`（内联图），`scripts/inline-skin.py`（BOXES 表） |
| 现有 spec | `assets/ui/tools/build_slices.py` 的 `SPEC` 表（本 Skill 之前的版本，字段可转成 JSON） |
| 引擎 | `@forgeax/engine` 0.4.19；命令在游戏仓库里用 `pnpm exec forgeax`，参数先用 `forgeax help <cmd> --json` 查 |
| 加载页 | `boot/ink-loading.html` |
| 预览端口 | 不要用 5173，那是别的会话在用；例如 4801 |
| UI 舞台 | 1920×1080 |
| 引擎信息条 | 左下角，不可关闭，HUD 避开 |
| DOM 命名 | `#ui-title`、`#ui-menu`、`#ui-hud-hp`、`#ui-hud-ink`、`#ui-hud-skills`、`#ui-boss`、`#ui-subtitle`、`#ui-hex`、`.ui-hex-card`、`#ui-teach`、`#ui-transition`、`#ui-pause`、`#ui-death`、`#ui-ending` |
| 色板（tints） | `ink #15130F`、`paper #E9E2D0`、`red #B8322A`、`brass #A8864A`，全部哑光 |
| 警示色规则 | 朱红只给血条、预警、关键提示（角标、选中标记、印章、资源满）、朱焰流派色；按键底标用黄铜 |
| 字体 | `"Songti SC","STKaiti","KaiTi",serif` |
| 动效 | 出现 250 ms `cubic-bezier(.2,.7,.2,1)`，消失 200 ms `ease-in`；不用弹跳、不用发光 |
| 风格参考 | `assets/concepts/env-courtyard-ingame/` v03（场景）、v02（角色），`env-courtyard-keyart/` v03（配色） |
| `{MEDIUM}` | `an ink-wash wuxia punk action game, sumi-e dry-brush ink style` |
| 生图工具 | Codex 内置 `image_gen`，常见画布 1536×1024、1024×1536、1024×1024、1672×941 |
| 权限边界 | UI 会话只写 `assets/ui/**`、`reports/ui/**`；`UI-NARRATIVE.md` 等规格文件归主控，游戏代码归 Cursor 或修复会话 |
