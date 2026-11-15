---
name: game-qa-blind-review
description: 独立 QA / 试玩官的「只看证据」盲评流程。锁定被测提交，隔离构建 preview，用真实键鼠的脚本取证；逐条核对各会话的「声称」，按六项 0–10 打分，列出阻断 / 严重 / 瑕疵三级问题，给出下一关最该先改的 5 件事。附带可复用的取证脚本、拼图、对比图和音效归因工具。触发词：QA、盲评、试玩、验收试玩、独立验收、打分、问题清单、核对报告声称、回归试玩、Q00N。
---

# 游戏独立 QA 盲评（只看证据）

QA 不写游戏代码、不改游戏文件、不派单，结论直接交给制作人，**不需要和主控一致**。目的是打破「主控派单、主控验收」的盲区。

## 适用场景 / 不适用

适用：
- 一个里程碑或演示前，对一个**已提交的版本**做整体试玩打分。
- 核对修复、特效、音频、UI 等会话报告里的「已修好 / 已实现」是否真的成立。
- 对已知的崩溃或卡死做多次复测（例如「进某房间停 N 秒，测 3 次」）。

不适用：
- 定位根因、二分、写修复（交给修复类 skill；QA 只给复现步骤和证据）。
- 单个特效或 UI 的制作验收（由各自的 pipeline skill 负责自检）。
- 需要读源码才能判断的问题：QA 只写「现象 + 复现」，不推测原因。

## 输入

| 输入 | 用途 | 在哪写明 |
|---|---|---|
| 游戏仓库与被测提交（或「等某会话提交后的 HEAD」） | 锁定被测版本 | 参数 |
| 设计文档：GDD、UI / 叙事规格、对外介绍稿 | 评分标准、叙事节点清单、UI 清单 | 参数 |
| 画面目标图、UI 参考稿截图 | 画面和 UI 打分时做对照 | 参数 |
| 要核对的报告清单（只看它们**声称**了什么） | 第 1 节逐条核对 | 参数 |
| 运行方式文档（build、preview、按键、调试键） | 构建命令、辅助键 | 参数 |
| QA profile（`templates/profile.<游戏>.json`） | 让脚本认识页面状态、阶段、按键 | 步骤 2 |
| 写权限范围：只写 `reports/qa/**` 和 `evidence/qa/**` | 硬规则 | 参数 |

**不读**：游戏源码；任何 agent 的自评分（包括对外介绍稿里的分数）。测试脚本、运行文档、资源文件的元数据（例如 wav 时长）可以读，报告里要写明读过哪些。

**环境前提**：macOS 加 zsh/sh；游戏目录里已有 `node_modules`，能跑 `pnpm exec forgeax`；`python3` 装了 Pillow；系统装了 Chrome。各脚本是否要在 agent 沙箱外运行：

| 脚本 | 沙箱 | 耗时（Q001 实测，约 130 MB 的构建） |
|---|---|---|
| `export-build.sh`（导出、build、preview） | 沙箱内可以跑 | build 约 75–95 s；preview 常驻，需要后台运行 |
| `play.sh`（probe-state / qa-run / manual-run / 官方冒烟） | **必须在沙箱外，并且用后台方式运行** | 每次启动 play 临时项目约 60–75 s；每局开页约 7–9 s；hold 约 45 s，full 约 55–70 s，boss 约 50–120 s，death（含重开跟随）约 90–150 s，pick 约 28 s，manual 约 70–600 s |
| `zip-serve.sh`（校验、解压、托管 zip） | 沙箱内可以跑 | 秒级；托管常驻，需要后台运行 |
| `*.py`、`check-refs.sh`、`wait-for-commit.sh` | 沙箱内可以跑 | 秒级；wait 最长 150 min |

一次 `play.sh` 会按 `QA_RUNS` 顺序跑完多局，同一 mode 的多局合并成一次调用，省掉重复的启动开销。整轮（基础矩阵 + 回归 + 无辅助 + zip）实测约 2–2.5 小时，建议把多个 mode 串在一条后台命令里。

**同一时刻只跑一个 play**：`play.sh` 发现 `--port` 端口还在监听就拒绝启动（退出码 3）。不要和 `export-build.sh` 的 build 同时跑（共享缓存会报 `commit-failed`）。

## 步骤

### 1. 锁定被测版本
1. `git -C <repo> log --oneline -3` 加 `git status --short`，确认题目说的那个提交是否已经落地。
2. 还有别的会话未提交时，在后台运行 `scripts/wait-for-commit.sh <repo> <被等的目录> 150`，同时先做步骤 2 的准备。它会在 HEAD 前进或该目录变干净时退出；超时退出码为 2，此时按当前 HEAD 测，并在报告里写明「工作区不干净」。
3. 被测版本 = 落地后的 HEAD 短 SHA，写进报告第一行。之后**所有构建都用这个 SHA**，不用工作区。
4. 读上一轮 QA 报告、本轮要核对的修复报告；有多会话协作规范（例如 coordination skill 的「公共踩坑」）的先读。`/tmp` 下上一轮的构建隔天可能已经不在，一律按 SHA 重建。

### 2. 隔离构建，启动 preview
1. 后台运行：`QA_HEAD_MARK=<加载页文字> scripts/export-build.sh <repo> <SHA> /tmp/<qa>/sut <html-head 片段> <preview 端口>`。
   - 脚本会 `git archive` 导出、软链 `node_modules`、`project build`；端口参数不为空时，在前台跑 `project preview --port`。
   - 端口选别人不用的（**不要用主演示端口**），先 `curl -s -o /dev/null -w '%{http_code}' http://localhost:<端口>/` 确认返回 200。
2. 第一次接触这个游戏时，运行 `scripts/probe-state.mjs`（经 `scripts/play.sh`），列出页面暴露的 `__*` 全局，以及标题、确认后、推进后三份状态快照。据此复制 `templates/profile.inkblade.json` 为 `profile.<游戏>.json`，改 `stateGlobal`、`fields`、`phases`、`keys`、`pick`、`exits`、`*Room`、`bossMaxHp`。
3. 再用 1 局 `QA_MODE=hold QA_RUNS=1` 干跑，验证 profile 正确，输出到 `/tmp`，不进正式证据目录。

### 3. 跑测试矩阵（每个结论至少 2 次）
统一命令（**要在 agent 沙箱外运行**）：
```bash
QA_PROFILE=<profile> QA_URL=http://localhost:<preview端口>/ QA_OUT=<evidence>/Q00N \
QA_MODE=<mode> QA_RUNS=<n> QA_PICKS=<plan> QA_W=<w> QA_H=<h> \
  scripts/play.sh /tmp/<qa>/sut <skill>/scripts/qa-run.mjs --port <另一个空闲端口> --timeout-ms 1800000
```
推荐矩阵（Q001–Q003 实际跑过的；前 5 行约 25 分钟，全部约 2 小时）：

| 局 | mode | runs | picks | 分辨率 | 覆盖 |
|---|---|---|---|---|---|
| hold | `hold` | 3 | `mouse0,mouse1,mouse2` | 1280×720 | 已知崩溃点停 N 秒；每次用鼠标选不同的卡（三个强化各一局） |
| full | `full` | 2 | `Digit2,Digit3` | 1920×1080 | 完整流程、全部叙事节点、UI 截图、加载时长 |
| boss | `boss` | 2 | `Digit1,mouse2` | 1920×1080 | Boss 后段关掉 auto 手打；手动选 Boss 后的三选一；结局后按确认去了哪里 |
| death | `death` | 2 | `Digit3,Digit2` | 1280×720 | 不开无敌等死、死亡画面、确认键 |
| pick | `pick` | 2 | 补没覆盖到的 `mouseN` / `DigitN` | 1280×720 | 让每张卡的鼠标、每个数字键都 ≥2 次 |
| **manual**（`scripts/manual-run.mjs`） | 无辅助 | 2 | `Digit1,Digit2,Digit3` | 1280×720 | **不开无敌、不开 auto、不跳关**的整局：用时、死亡次数和位置、重开出生点、卡住处。`QA_BOSS_DIE_RUNS=1` 让第 1 局在第一次进 Boss 战时放下手柄直到死亡，再继续玩（专测「Boss 战死亡 → 重开」） |
| zip | `full`，`QA_URL` 指向 `zip-serve.sh` 的端口 | ≥1 | 任意 | 1920×1080 | 交付包能否被玩家托管运行 |
| 形态专项 | `boss` + `QA_SWING_PRE` / `QA_POST_MANUAL` / `QA_POST_SWING_ONLY` / `id:<卡>` | 2 | 例如 `Digit3,id:gear` | 1920×1080 | 「每第 N 击」这类效果：关掉 auto，朝空地打完一套连击后连拍，前后各 3 次（升阶前、升阶后） |
| 官方冒烟 | 题目给的 `project play <官方脚本> --require-ui --json` | 2 | — | — | 照原样跑，失败时把 `play.json` 和 `*-failure.png` 复制进 `evidence/.../playthrough/` |

`death` 模式现在**不会在按确认后结束**：它会继续跟随重开的那一局（开无敌 + auto），记录出生点（`death.follow.spawn`），走到第一间房的出口；离开第一间房才算通过，`QA_DEATH_FOLLOW_S`（默认 90 秒）内没离开记为 `stuck` 并截 `restart-STUCK`。设成 0 可恢复旧行为。

台词专项：`QA_TEXT_FOLLOW_MS=1500` 让每条新字幕出现时截一张、1.5 秒后再截一张，并在 `run.json` 的 `textFollow` 里记录前后的 hold、击杀、Boss 血量、坐标，用来判断「战斗台词是否暂停了战斗」。

`QA_PICKS` 的轮换规则：第 i 局（从 0 开始）的第 k 次选卡（从 1 开始）用 `PICKS[(i + k - 1) % len]`。例如 `QA_RUNS=2 QA_PICKS=Digit1,mouse2`：第 1 局先按键 1，Boss 后鼠标点第 3 张；第 2 局先鼠标点第 3 张，Boss 后按键 1。`mouseN` 的 N 从 0 开始，`DigitN` 就是按 N 键。

每局产出 `<evidence>/<mode>-<i>/NNN-<名>.png|jpg` 和 `run.json`。`run.json` 包括：时间线、50 ms 页面日志（短暂出现的台词或提示也不会漏）、选卡探针（卡片中心最上层是否就是卡片本身、第一次输入后的待确认状态、确认后的阶段）、对话探针（3.5 秒不按键不能翻页，按 1 次键要翻页）、击杀记录、每个房间的坐标范围、卡死检测、音频播放日志、错误、警告。

**manual-run.mjs 说明**：它是**脚本化玩家**，不是真人。只用真实键鼠；瞄准依据是截图里朱红预警像素的位置（用 `jpeg-js` 解码，`QA_JPEG` 指向游戏 node_modules 里的那份）；被预警罩住就冲刺躲开；E 依赖游戏自身的索敌；出口打开后按学到的 WASD 基向量走过去。`run.json` 里有 `deaths[]`、`respawns[]`（每次重开时的房间和坐标）、`track[]`（1 Hz）、`stuck[]`（`QA_STUCK_S` 秒内没有击杀、换房或 Boss 掉血；走路不会重置这个计时）。报告里只能说「脚本化玩家的难度下限」，真人手感仍标未验证。

**回归复测**（上一轮的问题逐条复测）：每条在本轮找一张对应截图，写进 pairs JSON，执行 `QA_LEFT_LABEL="Q00x <旧SHA> BEFORE" python3 scripts/compare.py pairs.json <evidence>/compare-fix "Q00y <新SHA> AFTER"`，报告里用「已修 / 部分 / 仍在 / 回归」表。

**zip 实测**：`QA_HEAD_MARK=<加载页文字> scripts/zip-serve.sh <zip> /tmp/<qa>/zip <端口> <报告里的 sha256>`（后台运行），它会校验 sha256、列出文件、打印 README 开头、检查加载页标记，然后用 `python3 -m http.server` 托管；再对这个端口跑 `full`。

### 4. 整理数据
- `python3 scripts/summarize.py <evidence>/Q00N/*-[0-9] --table` → 第 0 节运行总表。
- `python3 scripts/summarize.py <run目录...>` → 逐局看选卡、对话、叙事日志。
- `python3 scripts/audio-attrib.py <音效 wav 目录> <run目录...> --by-phase` → 按时长把播放次数归到具体音效，并列出「一次都没响」的候选。时长相同的音效写成 `a|b`，报告里如实说明。

### 5. 看图（省看图额度，先拼图再放大）
- 拼图：`python3 scripts/sheet.py <evidence>/Q00N/sheets/<名>.jpg 4 480 "<文件列表>"`，一张最多约 16 格。看完全局再挑单张。
- 放大：`python3 scripts/crop.py <src> <out> 0.25 0.36 0.75 0.56 2`（≤1 的值按比例裁）。文字重叠、血条、细小特效**必须放大后再下结论**。裁剪前先确认原图尺寸（1280 和 1920 的坐标不一样）。
- 对照图：复制 `templates/compare-pairs.example.json`，改成本轮的路径，然后 `python3 scripts/compare.py pairs.json <evidence>/Q00N/compare "<repo> <SHA> preview"`。
- 给看图工具的提问要具体：「数一数从主角发出的剑气条数」「这个红色竖条是贴在剑上，还是独立立着的片」。不要问「有什么问题」。

### 6. 写报告
按 `templates/report-template.md` 的 0–6 节写：先写核对和打分，再写问题清单和建议。最后运行 `scripts/check-refs.sh <报告> <evidence>/Q00N`，确保报告里引用的每个证据文件都存在。

### 7. 收尾
关掉**自己**启动的 preview（停掉后台任务），不动别人的进程。`/tmp` 下的构建目录可以留着。把脚本复制一份到 `<evidence>/Q00N/tools/`，方便以后复现。

## 验收标准

**对被测游戏的检查清单**（Q001 实际用过，每项 ≥2 次）：
- [ ] 已知崩溃点：在 preview 下进入该处停 15 秒，3/3 不出报错页、无 page/console 错误、不卡死。
- [ ] 三选一：每张卡用真实鼠标（按住约 120 ms）各点 ≥2 次；第一次点击出现待确认状态，第二次点击进入战斗。数字键 1/2/3 各 ≥2 次。卡片中心最上层元素就是卡片本身。
- [ ] UI 皮肤：preview 下所有 `--skin-*`（或项目约定的前缀）都能解码，`/@fs/` 请求为 0，在标题和首场战斗各查一次。
- [ ] 每个强化的形态变化都有截图（例如三刺、着火爆裂、飞刃）；升阶形态单独列出。
- [ ] 主角全程可见：检查对话框、屋顶、墙体、特效是否遮挡。
- [ ] 小怪受击后击杀计数递增；死亡后消失，清房后的截图里没有残留。
- [ ] 对话：不按键不翻页，按 1 次翻 1 行；战斗中的台词不暂停战斗。
- [ ] 音效：AudioContext 状态为 running，各类音效都有播放次数，列出没响过的。
- [ ] 叙事节点：设计文档里的每个节点，文字是否出现、画面要素是否出现，分两列打勾。
- [ ] 死亡流程、结局流程、暂停、结局后和死亡后按确认去了哪里，与文档对照。
- [ ] **死亡重开**：在第一间房和 Boss 房各死 ≥2 次，重开后出生点正确，并且能走出第一间房（death 跟随 / manual 的 respawns）。
- [ ] **无辅助整局 ≥2**：用时、死亡次数和位置、卡住处；至少 1 局强制死在 Boss 战后重开并通关。
- [ ] **交付包**：zip 校验 sha256、README 内容、能托管运行并通关 ≥1 局。
- [ ] **标题菜单**：每一项用键盘和鼠标各选一次，只有「开始」类的项会开局。
- [ ] 稳定性：开页到可输入的秒数、启动重试警告占几局、每个房间的坐标范围（是否掉出地图）、卡死次数、是否穿模。

**对 QA 报告的检查清单**：
- [ ] 第一行写明被测提交 SHA 和构建方式；写明用了哪些辅助手段、哪些测试没做。
- [ ] 每条声称都有判定：有证据 / 无证据 / 与实测矛盾 / 部分 / 未验证，并附证据路径。
- [ ] 六项分数每项都有依据，并至少附 1 张截图。
- [ ] 每个问题都写明现象、复现步骤、「x/y 次」和截图路径；只见过 1 次的标「待复现」。
- [ ] 有未验证清单；没有引用任何自评分；`check-refs.sh` 通过；只写了允许的目录。

**六项打分锚点（0–10）**：
| 分 | 画面接近度 | 战斗可读性 | 打击感 | UI 一致性 | 叙事连贯 | 稳定性 |
|---|---|---|---|---|---|---|
| 9–10 | 同构图截图和目标图难以区分 | 任意截图里一眼能找到主角、预警、敌人 | 顿帧、震屏、击退、音画同步都有实测证据 | 和参考稿逐项一致 | 所有节点的文字和画面都到位，读起来通顺 | 多局 0 错误，无穿模，加载 < 5 秒 |
| 7–8 | 色板、材质、光照、角色风格都对，差在细节 | 偶尔被文字或特效遮挡 | 特效和音效到位，手感有部分证据 | 布局和素材一致，缺 1–3 个元素 | 文字全到，少数画面要素缺 | 0 错误，有个别穿模或重试 |
| 5–6 | 方向对，但镜头、材质、亮度、角色比例中 ≥3 处明显偏差 | 有 ≥2 类遮挡或冲突（字压在战斗上、Boss 不在画面里…） | 只有静帧加音效计数可依据 | 有重叠或错位，缺 ≥3 个元素 | 文字全到，但关键画面没出现 | 0 报错页，但官方冒烟失败或有穿模 |
| ≤4 | 只有色板接近 | 主角或预警经常看不清 | 缺特效或音效 | 和参考稿不像 | 节点缺失或顺序错 | 有崩溃或卡死 |

**问题分级**：**阻断** = 玩家无法继续（崩溃、卡死、无法输入、无法过关）；**严重** = 明显降低体验（关键文字看不清或重叠、Boss 不可见或穿模、遮挡主角、错误的视觉元素、交付流程跑不通）；**瑕疵** = 其余与规格不符或打磨类问题。同级内按影响面（多少玩家、多长时间会看到）排序。

## 踩坑与对策

**被测版本**
1. 别的会话还在改，工作区和 HEAD 不一致。直接在工作区构建会把别人未提交的改动一起测进去。→ 用 `wait-for-commit.sh` 等提交落地，再用 `git archive <SHA>` 导出构建。报告写 SHA，不写「最新版本」。
2. `git archive | tar` 时工具会提示「file rollback is not tracked」，可以忽略。软链 `node_modules` 后可以直接 build（实测 77–95 秒），不需要重新 install。

**ForgeaX preview / play**
3. 引擎启动的 Chromium 用的是 `chromiumSandbox:true`，在 WorkBuddy 沙箱里会报 `browser.newPage: Target crashed`（`play-not-ready`）。→ 用 `scripts/play.sh`：系统 Chrome 加 `--no-sandbox`，作为 `FORGEAX_BROWSER_EXECUTABLE`，PATH 前放一个只 `exit 0` 的 `ps` 替身，并且**在沙箱外运行**。
4. `project play` 不能直接打开 dist，它会自己起一个临时项目。→ 在脚本里 `play.page.context().browser().newContext()` 另开页面，访问 preview URL。验收要用 preview，不用 dev：dev 和 preview 的时序、资源路径不同，有的崩溃只在 preview 出现，`/@fs/绝对路径` 也只在 dev 能解析。
5. `project play` 的输出里夹着大量加载日志。→ 先重定向到文件，再 `grep '^{"ok"'`；**不要接 `| head`**，会因为 EPIPE 中断。
6. 游戏在 Worker 里跑，页面只暴露一份状态快照全局和一个命令入口全局（名字见参数节和 profile）。→ QA 只读快照判断阶段；命令入口只用来开关游戏自带的 auto，并在报告里写明。
7. 7/11 局出现 `scene load asset-dependency-failed (attempt 1); retrying` 后恢复。这算警告不算错误，但要在稳定性里写「x/y 局需要重试」。
8. 官方冒烟脚本可能已经跟不上游戏流程（例如开场改成需要按键推进，脚本只等不按）。→ 照原样跑、照实记「x/2 失败」，归为流程问题，不算游戏 bug，并在建议里提出更新。

**输入与流程**
9. 瞬时点击能选中、真人点击却选不中的 bug 确实出现过（UI 每 40 ms 重绘，按下和松开之间按钮被替换了）。→ 鼠标点击一律 `{ delay: 120 }`，并探测卡片中心最上层是不是卡片本身。
10. 开着 auto 时，游戏会**自动选掉** Boss 后的三选一，这个叙事节点在截图里就看不到了。→ 要验证这个节点必须用 `boss` 模式（Boss 半血以下关掉 auto 手打，Boss 后手动选卡）。
11. 结局最后一行如果按确认键，可能直接重开新一局。→ 结局台词用鼠标点击推进；要测「结局后按确认去哪里」时单独记录（Q001 发现它会重开，而不是回标题）。
12. 鼠标停在选卡位置后按 Esc，暂停菜单的高亮会跟着鼠标走，可能直接落在「回标题」上。→ 这是一个发现；只想测键盘时，先把鼠标移开。
13. 教学提示只显示约 1.2 秒，250 ms 轮询会漏。→ 用 `addInitScript` 注入 50 ms 页面日志（qa-run.mjs 已内置），叙事节点以日志为准、截图为辅。
14. 状态快照里的「当前选择」字段不一定反映第二次选择（Q001 里 Boss 后选的是另一个流派，但该字段仍是第一次的选择，因为升阶记在别的字段里）。→ 第二次选卡是否生效，以选后提示文字（「<流派>入剑……」这类）和画面为准；`pickNow` 只当参考。
15. 换房的那一帧，房间号已经变了，但角色还没传送过去，坐标会把两个房间的范围混在一起（看上去像掉出地图）。→ qa-run.mjs 已跳过转场帧和进房 0.5 s 内的采样；如果看到某房间坐标跨度异常，先查是不是这个原因。
16. 探针要按到「阶段字段变化」才停；只看快照有没有变化会停在打字机效果中途。→ probe-state.mjs 已按阶段字段判断（`QA_PHASE_KEY` 可改）。

**音频**
17. canvas 录屏没有音轨，无头浏览器也听不到声音。→ 在 `AudioBufferSourceNode.prototype.start` 上挂钩子计数（必须用 init script，在页面脚本之前注入），再按 buffer 时长和 wav 文件对照归类。这能证明「播放了」，不能证明「好听」，听感一律标未验证。
18. 别的报告说「没有音效」时，以实测播放次数为准（Q001 实测和音频报告矛盾）。

**看图与判断**
19. 单轮看图额度有限（约 128 MB）。→ 先拼图再放大；一张拼图最多约 16 格。
20. 视觉模型会读错小字、漏看小元素。→ 文字重叠、血条是否为空、某个部件是否贴在模型上，都要裁剪放大到 ≥600 px 宽再问，并且换一局的截图再确认一次。第一次裁剪前先看原图尺寸，坐标错了会裁偏。
21. 静帧无法证明顿帧、震屏、击退、受击闪白。→ 写「未验证（只有静帧）」，或者另录视频；不能根据特效看起来多就推断打击感好。
22. 辅助手段会改变体验：开无敌就测不到受击，开 auto 就测不到手感和难度，跳 Boss 就会跳过叙事节点。→ 报告第一节写清楚哪些局用了哪些辅助；打击感和难度在没有真人局时，分数要标注证据有限。

**进程与脚本**
23. 允许出沙箱的**前台**命令被工具超时结束（退出码 137 / SIGTERM）时，里面的 `project play` 还在后台跑；直接重跑会让两局同时写进同一个证据目录（Q002 因此作废过一局）。→ 长时间的 play 一律后台运行；`play.sh` 已在启动前检查 `--port` 是否还在监听，有残留就退出码 3；每次调用用唯一的 `QA_TAG`；改脚本和跑 play 不要放在同一条命令里。
24. 自写的辅助循环必须处理「需要按键推进的台词」（状态里的 holdLine）。有的游戏会在这种台词时冻结整场战斗，循环不按键，复现就整局作废（Q002 第一版 repro 就是这样）。→ 任何等待循环里都加「phase 是对白 或 holdLine 为真 → 按确认」。
25. 死亡模式只测到按确认为止，会漏掉「重开后人物没复位、走不出第一间房」这种阻断（Q002 的 B1 是从无辅助局的坐标里才发现的）。→ 用新的 death 跟随（步骤 3），并在无辅助局里至少强制死在 Boss 战一次。
26. 卡住检测不能被「正在往出口走」重置，否则人物卡在墙后来回走也不会报卡住。manual-run.mjs 已改成只有击杀、换房、Boss 掉血才算进展。
27. 页面没有暴露敌人坐标时，无辅助瞄准只能靠画面像素；主角位置识别也不稳（Q002 约 78% 帧退回屏幕中心）。报告里如实写，不据此评价手感。可以建议游戏侧暴露只读的敌人列表供 QA 使用。
28. 「每第 N 击」类效果和 E、Q、刀光重叠就数不清。→ 关掉 auto，朝空地打完整套连击再连拍（`QA_SWING_PRE` / `QA_POST_SWING_ONLY`）；按音效时长触发连拍（`QA_BURST_AUDIO_MS`）会被转场等同时长的音效误触发。Q003 实测：升阶前 6/6 套连击都拍到飞刃；升阶后 6 套里只有 1 套拍到（其余只见齿轮碎屑），静帧分不清是飞出画面还是没发射，要多拍几套并换空旷方向。
29. `QA_POST_MANUAL` 的手动动作间隔要大于技能冷却（Q 冷却 4 秒；间隔 1.3 秒时第 2 次是空放）。

**协作边界**
30. 只停自己启动的后台任务，不结束别人的进程，不占用主演示端口；只写 `reports/qa/**` 和 `evidence/qa/**`。脚本放 `evidence/.../tools/`，不放进游戏仓库。

## 交接格式

- 报告：`reports/qa/Q00N.md`（编号顺延），结构照 `templates/report-template.md`。
- 证据：`evidence/qa/Q00N/`
  - `<mode>-<i>/NNN-<名>.png|jpg`、`run.json`：截图三位编号按时间顺序；名字用 `title`、`pick1-armed`、`hold-10s`、`room2-enter`、`subtitle-r1`、`kill-r0-b2`（`-bN` 表示连拍第 N 帧）、`ending-final`、`death-1.9s`、`ERROR`。
  - `sheets/`：拼图和放大图，命名说明内容，例如 `teach-banner-overlap-c1.png`。
  - `compare/`：目标图对照，例如 `scene-vs-v03.jpg`、`ui-hud.jpg`。
  - `playthrough/`：官方冒烟脚本的 `run{1,2}-play.json` 和失败截图。
  - `tools/`：本轮实际用的脚本和 profile。
- 问题编号：严重 `S1..`，瑕疵 `F1..`，阻断 `B1..`。下一轮复测时在原编号后写「已修 / 部分 / 仍在 / 回归」，修复前后并排图放 `compare-fix/`。
- 新一轮发现的问题编号接着上一轮的往后排（例如 Q002 有 S9，Q003 新的严重问题从 S10 开始），避免同号指两件事。
- 对话里的回报：被测 SHA、一句话总评、六项分数、严重问题一行一条、下一关 5 件事、未验证项、报告和证据路径。

## 参数

换项目只改这一节，再改一份 profile JSON。

| 参数 | 墨刃（inkblade）Q001 取值 |
|---|---|
| 游戏仓库 | `/Users/huangjifeng/Desktop/1/inkblade` |
| 指挥中心（报告和证据的根目录） | `/Users/huangjifeng/Desktop/1/arpg-command-center` |
| 允许写入 | `arpg-command-center/reports/qa/**`、`arpg-command-center/evidence/qa/**`（另加本 skill 目录，仅在写 skill 时） |
| 引擎 | `@forgeax/engine` 0.4.19（WebGPU，引擎跑在 Worker 里） |
| 构建 | `pnpm exec forgeax project build --html-head boot/ink-loading.html`；加载页标记 `QA_HEAD_MARK=墨研中` |
| 预览 | `pnpm exec forgeax project preview --port <端口>`；主演示端口 **5173，禁止占用**；QA 用过 4841/4842（Q001）、4861–4863（Q002）、4871–4873（Q003：preview / play / zip）。开工前用 `lsof -nP -iTCP -sTCP:LISTEN` 看哪些被别的会话占着 |
| 官方冒烟 | `pnpm exec forgeax project play scripts/playthrough.mjs --require-ui --json` |
| 运行方式和按键 | `inkblade/DEMO.md`：Enter 确认，Esc 暂停，F2 无敌，F4 跳到内院 Boss，F1 水墨后处理，Q/E/R 技能，Space 冲刺 |
| profile | `templates/profile.inkblade.json`（`__inkView`、`__inkSend`、`#ui-stage`、`.ui-hex-card`、`is-armed`、`data-hex`、`--skin-`；出口 `[[0,-2.15],[0,60.5],[0,-56]]`；回廊为房间 1，内院 Boss 为房间 2，Boss 血量 220，墨魂满 5 格） |
| 设计文档 | `arpg-command-center/GDD.md`（§7 共 12 个叙事节点）、`UI-NARRATIVE.md`（§2.2 UI 清单）、`MENTOR-BRIEF.md`（其中的自评分不参考） |
| 画面目标图 | `arpg-command-center/assets/concepts/env-courtyard-ingame/`（v03 场景、v02 角色）、`assets/concepts/env-courtyard-keyart/`（v03） |
| UI 参考稿 | `arpg-command-center/assets/ui/preview/shots/`（title、hud、hex、pause、boss、death，均为 1920×1080） |
| 要核对的报告（Q001） | `reports/fix/F001.md`、`F002.md`、`reports/vfx/V005.md`、`reports/audio/AU001.md` |
| 音效目录（音效归因用） | `inkblade/assets/audio/sfx/` |
| 浏览器 | `/Applications/Google Chrome.app`（`QA_CHROME` 可改） |
| 无辅助脚本的解码库 | `QA_JPEG=<被测副本>/node_modules/.pnpm/jpeg-js@0.4.4/node_modules/jpeg-js` |
| 协作公共踩坑 | `arpg-command-center/.workbuddy/skills/游戏主控协作skill/SKILL.md`「公共踩坑」 |
| 上一轮报告 | Q002：`reports/qa/Q002.md`（被测 `81b8016`）；Q003：`reports/qa/Q003.md`（被测 `482d07e`）。更早：`reports/qa/Q001.md`（被测提交 `37955da`），证据在 `evidence/qa/Q001/`。注意：Q001 用的是本 skill 脚本的前身，目录和文件名是 `corridor-*`、`hex1-*`，`run.json` 里的字段是 `hex`、`hexNow`；本 skill 改名为 `hold-*`、`pick1-*`、`picks`、`pickNow`。`summarize.py` 只能读新格式 |
